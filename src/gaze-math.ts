import type { GazeVector, HeadPose } from "./types.js";

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/**
 * MediaPipe göz blendshape'lerinden yön vektörü üretir.
 * Blendshape adlarındaki "Left/Right" öznenin anatomik gözünü belirtir.
 * Özne SAĞA baktığında: sol göz içe (In) + sağ göz dışa (Out) döner.
 * Sonuç: +x = öznenin sağı = ekranın sağı, +y = yukarı. (Yaklaşık [-0.6, 0.6].)
 */
export function blendshapesToGaze(bs: Record<string, number>): GazeVector {
  const g = (n: string) => bs[n] ?? 0;
  const x =
    (g("eyeLookInLeft") + g("eyeLookOutRight") -
      (g("eyeLookOutLeft") + g("eyeLookInRight"))) /
    2;
  const y =
    (g("eyeLookUpLeft") + g("eyeLookUpRight") -
      (g("eyeLookDownLeft") + g("eyeLookDownRight"))) /
    2;
  return { x, y };
}

/**
 * MediaPipe facial transformation matrix'inden (column-major 4x4) yaklaşık
 * Euler açıları çıkarır. Radyan. Yaklaşıktır; yalnız kafa katkısı için kullanılır.
 */
export function matrixToEuler(m: Float32Array | number[]): HeadPose {
  const r00 = m[0], r10 = m[1];
  const r02 = m[8], r12 = m[9], r22 = m[10];
  const yaw = Math.atan2(r02, r22);
  const pitch = Math.atan2(-r12, Math.hypot(r02, r22));
  const roll = Math.atan2(r10, r00);
  return { yaw, pitch, roll };
}

/** Üstel hareketli ortalama tabanlı yumuşatıcı. */
export class EmaSmoother {
  private value: GazeVector | null = null;
  constructor(private alpha: number) {}

  push(next: GazeVector): GazeVector {
    if (!this.value) {
      this.value = { ...next };
    } else {
      this.value.x += this.alpha * (next.x - this.value.x);
      this.value.y += this.alpha * (next.y - this.value.y);
    }
    return { ...this.value };
  }

  reset(): void {
    this.value = null;
  }
}

/**
 * Notr bakis noktasini izleyip cikarir.
 *
 * @deprecated `AdaptiveCalibrator` kullanin. Deadzone ham birimde sabit
 * oldugu icin telefonda (menzil ~0.2) menzilin ~%60'ina denk gelir ve
 * kismi bakislari birkac saniyede notr sanip yutar.
 */
export class CenterTracker {
  private base: GazeVector | null = null;

  constructor(private alpha: number, private deadzone: number) {}

  apply(eye: GazeVector): GazeVector {
    if (!this.base) this.base = { ...eye };
    const dx = eye.x - this.base.x;
    const dy = eye.y - this.base.y;
    if (Math.hypot(dx, dy) < this.deadzone) {
      this.base.x += this.alpha * dx;
      this.base.y += this.alpha * dy;
    }
    return { x: dx, y: dy };
  }

  reset(): void {
    this.base = null;
  }
}

/** Öğrenilen kalibrasyon profili. Değerler ham blendshape biriminde. */
export interface CalibrationProfile {
  /** Nötr bakış merkezi. */
  cx: number;
  cy: number;
  /** Merkezden her yöne tipik erişim (>0). Asimetrik: aşağı bakış göz kapağı yüzünden genelde zayıftır. */
  left: number;
  right: number;
  up: number;
  down: number;
}

export interface AdaptiveCalibratorOptions {
  /** Nötr merkezi öğren. */
  center: boolean;
  /** Erişimi (menzili) öğren. false ise `fixedGain` ile sabit ölçekler. */
  range: boolean;
  /** range=false iken kullanılan sabit kazanç. */
  fixedGain: number;
  /** Başlangıç erişimi (cihaz sınıfına göre tohum). */
  seedRange: number;
}

// --- ayar sabitleri (hepsi normalize uzayda ya da oran; cihazdan bağımsız) ---
/** Isınma: ilk N öğrenme karesinde merkez koşulsuz ve hızlı oturur. */
const WARMUP_FRAMES = 45;
const WARMUP_RATE = 0.1;
/** Oturmuş durumda merkez, yalnızca bu normalize yarıçap içindeyken güncellenir. */
const CENTER_ZONE = 0.25;
const CENTER_RATE = 0.02;
/**
 * Kilitlenmeye karşı emniyet: bölge dışında da çok yavaş merkez kayması.
 * Yarı ömür ~60 sn (60fps). Uzun dwell'leri ancak ~%10 aşındırır.
 */
const DRIFT_RATE = 0.0002;
/** Yeni tepeye hızlı genişle, tepeye varmayan bakışta yavaş daral -> yüksek persentil takibi. */
const GROW = 0.08;
const SHRINK = 0.004;
/** O yöne anlamlı bakış sayılması için erişimin bu oranı aşılmalı (daralma kapısı). */
const SHRINK_GATE = 0.35;
/** Öğrenilen erişimin bu kadarı kenar (1.0) sayılır: zorlanmadan ulaşılsın. */
const REACH = 0.85;
/**
 * Erişim sınırları (ham birim). Tahmine dayalı öğrenmede alt sınır gürültünün
 * kenara büyümesini engeller. Açık kalibrasyon gerçekten daha küçük bir erişim
 * ölçtüyse (ör. zayıf aşağı bakış) o yön için alt sınır ölçümden türetilir;
 * aksi halde tam bakış bile kenara ulaşamazdı.
 */
const MIN_RANGE = 0.08;
const ABS_MIN_RANGE = 0.02;
const MAX_RANGE = 0.8;
/** Ölçülen erişim, öğrenmeyle en fazla bu oranına kadar daralabilir. */
const MEASURED_FLOOR_RATIO = 0.6;
/** Öğrenme için iç yumuşatma (çıkışı etkilemez; tek kare gürültü menzili şişirmesin). */
const LEARN_ALPHA = 0.3;

type RangeKey = "left" | "right" | "up" | "down";

/**
 * Kalibrasyonsuz uyarlamalı kalibrasyon.
 *
 * Neden gerekli: göz blendshape menzili cihaza göre ~2.5 kat değişir
 * (telefon ~0.2, laptop ~0.5). Ham birimde yazılmış her sabit eşik bir
 * cihazda yanlış kalır. Bu sınıf merkezi ve her yönün erişimini öğrenir,
 * tüm eşikleri erişime oranla tanımlar; böylece aynı ayar her cihazda
 * aynı davranır.
 */
export class AdaptiveCalibrator {
  private p: CalibrationProfile;
  private learnFrames = 0;
  private smooth: GazeVector | null = null;
  /** Yön başına erişim alt sınırı. */
  private floor: Record<RangeKey, number> = {
    left: MIN_RANGE, right: MIN_RANGE, up: MIN_RANGE, down: MIN_RANGE,
  };

  constructor(private o: AdaptiveCalibratorOptions, initial?: Partial<CalibrationProfile>) {
    const s = clamp(o.seedRange, MIN_RANGE, MAX_RANGE);
    this.p = { cx: 0, cy: 0, left: s, right: s, up: s, down: s, ...initial };
  }

  /**
   * @param v    Birleşik ham bakış (x: + sağ, y: + yukarı)
   * @param learn false ise (ör. göz kırpma) yalnızca dönüştürür, öğrenmez.
   * @returns [-1, 1] aralığında normalize bakış
   */
  apply(v: GazeVector, learn = true): GazeVector {
    const out = this.transform(v);
    if (learn) this.learn(v);
    return out;
  }

  private transform(v: GazeVector): GazeVector {
    const p = this.p;
    const dx = v.x - p.cx;
    const dy = v.y - p.cy;
    const sx = this.o.range ? 1 / ((dx >= 0 ? p.right : p.left) * REACH) : this.o.fixedGain;
    const sy = this.o.range ? 1 / ((dy >= 0 ? p.up : p.down) * REACH) : this.o.fixedGain;
    return { x: clamp(dx * sx, -1, 1), y: clamp(dy * sy, -1, 1) };
  }

  private learn(v: GazeVector): void {
    // öğrenme, tek kare gürültüye karşı hafif yumuşatılmış sinyal üzerinden
    if (!this.smooth) this.smooth = { ...v };
    else {
      this.smooth.x += LEARN_ALPHA * (v.x - this.smooth.x);
      this.smooth.y += LEARN_ALPHA * (v.y - this.smooth.y);
    }
    const s = this.smooth;
    const p = this.p;
    const warm = this.learnFrames < WARMUP_FRAMES;
    this.learnFrames++;

    if (this.o.center) {
      const dx = s.x - p.cx;
      const dy = s.y - p.cy;
      let rate: number;
      if (warm) {
        // Başlat'a basan kullanıcı ekrana bakıyordur: koşulsuz otur.
        // Bölge kapısı burada kilitlenmeye yol açardı (ofset büyükse
        // nötr bakış bölge dışı görünür ve merkez hiç öğrenilmez).
        rate = WARMUP_RATE;
      } else {
        const n = this.transform(s);
        rate = Math.hypot(n.x, n.y) < CENTER_ZONE ? CENTER_RATE : DRIFT_RATE;
      }
      p.cx += rate * dx;
      p.cy += rate * dy;
    }

    // Isınmada ofset henüz çıkmadığı için erişim öğrenilmez (sahte tepe olur).
    if (this.o.range && !warm) {
      const dx = s.x - p.cx;
      const dy = s.y - p.cy;
      this.learnRange(dx >= 0 ? "right" : "left", Math.abs(dx));
      this.learnRange(dy >= 0 ? "up" : "down", Math.abs(dy));
    }
  }

  private learnRange(k: RangeKey, mag: number): void {
    const cur = this.p[k];
    let next = cur;
    if (mag > cur) next = cur + GROW * (mag - cur);
    else if (mag > SHRINK_GATE * cur) next = cur - SHRINK * (cur - mag);
    // aksi halde nötrde ya da başka yöne bakıyor: tut
    this.p[k] = clamp(next, this.floor[k], MAX_RANGE);
  }

  /** Merkezi yeniden öğren (duruş değişti, yüz kaybolup geri geldi...). Erişim korunur. */
  recenter(): void {
    this.learnFrames = 0;
    this.smooth = null;
  }

  /** Her şeyi tohum değerlere döndür. */
  reset(): void {
    const s = clamp(this.o.seedRange, MIN_RANGE, MAX_RANGE);
    this.p = { cx: 0, cy: 0, left: s, right: s, up: s, down: s };
    this.floor = { left: MIN_RANGE, right: MIN_RANGE, up: MIN_RANGE, down: MIN_RANGE };
    this.recenter();
  }

  get profile(): CalibrationProfile {
    return { ...this.p };
  }

  /**
   * Kayıtlı ya da ölçülmüş erişimi yükle. Merkez yüklenmez: oturuşa bağlıdır,
   * her oturumda ısınmayla öğrenilir. Küçük (ölçülmüş) değerler korunur ve o
   * yönün alt sınırı ölçüme göre ayarlanır.
   */
  loadRanges(r: Pick<CalibrationProfile, RangeKey>): void {
    for (const k of ["left", "right", "up", "down"] as RangeKey[]) {
      const val = r[k];
      if (typeof val !== "number" || !Number.isFinite(val)) continue;
      const v = clamp(val, ABS_MIN_RANGE, MAX_RANGE);
      this.p[k] = v;
      this.floor[k] = clamp(v * MEASURED_FLOOR_RATIO, ABS_MIN_RANGE, MIN_RANGE);
    }
  }

  /**
   * Açık kalibrasyonun ölçtüğü profili uygula. Merkez az önce ölçüldüğü için
   * ısınma atlanır; uyarlamalı öğrenme bu profilden devam eder.
   */
  setProfile(p: CalibrationProfile): void {
    this.loadRanges(p);
    if (Number.isFinite(p.cx)) this.p.cx = p.cx;
    if (Number.isFinite(p.cy)) this.p.cy = p.cy;
    this.learnFrames = WARMUP_FRAMES;
    this.smooth = null;
  }
}

/** Cihaz sınıfına göre başlangıç erişimi: dokunmatik/küçük ekran -> gözler az döner. */
export function defaultRangeSeed(): number {
  try {
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const small = typeof screen !== "undefined" && Math.min(screen.width, screen.height) < 600;
    return coarse || small ? 0.18 : 0.35;
  } catch {
    return 0.3;
  }
}

const MAX_YAW = 0.6; // ~34° — kafa katkısı normalizasyonu
const MAX_PITCH = 0.5;
/** Kafa katkısını göz ölçeğine getirir: headInfluence=1 iken tipik göz erişimi kadar. */
const HEAD_SCALE = 0.4;

/**
 * Göz ve kafa pozunu ham birimde birleştirir (kalibrasyon öncesi, kazançsız).
 * Ölçekleme ve merkezleme sonra `AdaptiveCalibrator` tarafından yapılır.
 */
export function combineEyeHead(
  eye: GazeVector,
  head: HeadPose | undefined,
  headInfluence: number
): GazeVector {
  if (!head || headInfluence <= 0) return { x: eye.x, y: eye.y };
  const k = headInfluence * HEAD_SCALE;
  return {
    x: eye.x + k * clamp(head.yaw / MAX_YAW, -1, 1),
    y: eye.y + k * clamp(head.pitch / MAX_PITCH, -1, 1),
  };
}

/** Göz vektörünü kazançla ölçekler ve (opsiyonel) kafa pozunu karıştırır. */
export function composeGaze(
  eye: GazeVector,
  head: HeadPose | undefined,
  gain: number,
  headInfluence: number
): GazeVector {
  let x = eye.x * gain;
  let y = eye.y * gain;
  if (head && headInfluence > 0) {
    x += headInfluence * clamp(head.yaw / MAX_YAW, -1, 1);
    y += headInfluence * clamp(head.pitch / MAX_PITCH, -1, 1);
  }
  return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
}
