import type { CalibrationProfile } from "./gaze-math.js";
import type { GazeVector } from "./types.js";

export type CalibrationStepId = "center" | "up" | "down" | "right" | "left";

/** Adım sırası. Hepsi tamamlanmadan kalibrasyon bitmez; atlama yoktur. */
export const CALIBRATION_STEPS: readonly CalibrationStepId[] = [
  "center",
  "up",
  "down",
  "right",
  "left",
];

/**
 * Bir karenin neden sayılmadığı.
 * - settling: hedef yeni göründü, gözün oraya gitmesi bekleniyor
 * - ok: kare sayıldı
 * - noface / blink: yüz yok / göz kırpılıyor (kırpma ilerlemeyi yalnızca duraklatır)
 * - weak: doğru yönde ama yeterince bakılmıyor
 * - wrongdir: başka yöne bakılıyor
 * - unstable: bakış sabit değil
 */
export type CalibrationIssue =
  | "settling"
  | "ok"
  | "noface"
  | "blink"
  | "weak"
  | "wrongdir"
  | "unstable";

export interface CalibrationFrame {
  timestamp: number;
  hasFace: boolean;
  /** 0..1, iki gözün kırpma skorunun büyüğü. */
  blink: number;
  /** Kalibrasyon öncesi birleşik ham bakış (GazeSample.input). */
  input: GazeVector;
}

export interface CalibrationState {
  step: CalibrationStepId;
  /** 0 tabanlı adım sırası. */
  index: number;
  total: number;
  /** Bu adımın tamamlanma oranı 0..1. */
  progress: number;
  issue: CalibrationIssue;
  /** Adım uzun süredir tamamlanamıyor: daha açıklayıcı ipucu gösterilmeli. */
  struggling: boolean;
  done: boolean;
}

/** Son karenin ölçümleri (hata ayıklama göstergesi için). Ham birim. */
export interface CalibrationMetrics {
  /** Hedef yönündeki sapma. */
  along: number;
  /** Diğer eksendeki sapma. */
  cross: number;
  /** Bu adımda geçmek için gereken en az sapma. */
  min: number;
  blink: number;
}

export interface CalibrationResult {
  profile: CalibrationProfile;
  /**
   * Yatay eksen ters mi. Bazı kameralar/sanal kameralar görüntüyü aynalı
   * verir; o zaman sağa bakış sol gibi görünür. Veriden öğrenilir.
   */
  flipX: boolean;
}

export interface CalibrationSessionOptions {
  /**
   * Henüz ölçülmemiş yönler için canlı nokta önizlemesinde kullanılan menzil.
   * Kabul kararını etkilemez. Varsayılan 0.2.
   */
  seedRange?: number;
}

/** Hedef göründükten sonra gözün oraya varması için beklenen süre (ms). */
const SETTLE_MS = 700;
/** Adımın geçilmesi için gereken net geçerli bakış süresi (ms). */
const HOLD_MS = 1200;
/** Bu süreden kısa sapmalar hiç cezalandırılmaz (ms). */
const GRACE_MS = 200;
/**
 * Affın ötesindeki geçersiz kareler ilerlemeyi bu hızla GERİ alır (sıfırlamaz).
 * 1.5 => geçerli karelerin ~%60'ı aşılmadan adım ilerlemez; titrek ama
 * çoğunlukla doğru bakış geçer, çoğunlukla yanlış bakış geçemez.
 */
const DECAY = 1.5;
/** Kareler arası süre bu değerle sınırlanır: takılan bir kare adımı tek başına geçirmesin. */
const MAX_DT = 100;
/** Kırpma eşiği. */
const BLINK_THRESHOLD = 0.5;
/** Aşağı bakınca göz kapağı iner ve kırpma skoru yükselir; bu adımda eşik yüksek. */
const BLINK_THRESHOLD_DOWN = 0.85;
/** Gerçek kırpma bundan kısa sürer; daha uzun "kırpma" kapak inmesidir, kare değerlendirilir (ms). */
const BLINK_MAX_MS = 400;
/**
 * Bu skorun üstünde göz kapalı sayılır: ne kadar sürerse sürsün kare sayılmaz.
 * Arada kalan uzun skorlar (aşağı bakış, doğal olarak düşük göz kapağı) sayılır.
 */
const EYES_CLOSED = 0.9;
const EYES_CLOSED_DOWN = 0.97;
/**
 * Bir yön adımının sayılması için merkezden gereken sapmanın üst sınırı (ham birim).
 * Gerçek eşik merkez adımında ölçülen gürültüden türetilir: sessiz cihazda daha düşük.
 */
export const MIN_DEFLECTION = 0.035;
const MIN_DEFLECTION_FLOOR = 0.018;
/** Eşik = gürültü standart sapması × bu katsayı (FLOOR..MIN_DEFLECTION aralığında). */
const NOISE_K = 4;
/** Diğer eksendeki sapma, hedef yönündekinin bu katından büyükse yanlış yön. */
const CROSS_RATIO = 1.5;
/** Merkez adımında örneklerin ortalamadan en fazla sapması (ham birim). */
const CENTER_JITTER = 0.05;
/** Kararlılık için son kaç kabul edilmiş örneğin medyanına bakılır. */
const STABLE_WINDOW = 15;
/** Bu süreden uzun süren adımda ek ipucu gösterilir (ms). */
const STRUGGLE_MS = 5000;
/** Önizleme noktası: ölçülen erişimin bu kadarı hedefe denk gelir (AdaptiveCalibrator ile aynı). */
const PREVIEW_REACH = 0.85;
/**
 * Sonuçtaki her menzil en az (merkez gürültüsü × bu katsayı) olur. Menzil
 * gürültüye göre çok küçükse düz bakarken bile bölge yanlışlıkla tetiklenir.
 * Çalışmadaki yumuşatma (0.35) std'yi ~0.46'ya indirir; 3σ tepe ~1.4×std.
 * Bunun 0.85 erişimde 0.4 eşiğinin altında kalması ~4×std ister; 5 güvenlik payı.
 */
const NOISE_RANGE_K = 5;

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a: number[]): number => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

type DirStep = Exclude<CalibrationStepId, "center">;

/**
 * Zorunlu, adım adım kalibrasyonun saf mantığı (DOM yok, test edilebilir).
 * Her kareyi `push` ile ver; `state` UI'ın ne göstereceğini söyler.
 */
export class CalibrationSession {
  private seedRange: number;
  private index = 0;
  private stepStart = -1;
  private lastT = -1;
  private held = 0;
  private badSince = -1;
  private blinkSince = -1;
  private centerSamples: GazeVector[] = [];
  private alongSamples: number[] = [];
  /** İlk yatay adımda veriden okunan geçici işaret. */
  private tentativeSign = 0;
  private center: GazeVector | null = null;
  private ranges: Partial<Record<DirStep, number>> = {};
  /** Sağ hedefe bakınca ham x'in işareti (+1 normal, -1 aynalı). 0 = henüz bilinmiyor. */
  private rightSign = 0;
  private minX = MIN_DEFLECTION;
  private minY = MIN_DEFLECTION;
  private noiseX = 0;
  private noiseY = 0;
  private lastInput: GazeVector | null = null;
  private _metrics: CalibrationMetrics = { along: 0, cross: 0, min: MIN_DEFLECTION, blink: 0 };
  private _state: CalibrationState;

  constructor(options: CalibrationSessionOptions = {}) {
    this.seedRange = options.seedRange ?? 0.2;
    this._state = this.snapshot("settling");
  }

  get state(): CalibrationState {
    return this._state;
  }

  get metrics(): CalibrationMetrics {
    return { ...this._metrics };
  }

  /**
   * Canlı bakış noktası için ekran uzayında yaklaşık konum: (0,0) merkez,
   * ±1 kenardaki hedefler. Ölçülmüş yönlerde ölçüm, diğerlerinde tohum menzil
   * kullanılır. Yüz yoksa null. Yalnızca geri bildirim içindir.
   */
  get preview(): GazeVector | null {
    const v = this.lastInput;
    if (!v) return null;
    let c = this.center;
    if (!c && this.centerSamples.length > 0) {
      c = {
        x: median(this.centerSamples.map((s) => s.x)),
        y: median(this.centerSamples.map((s) => s.y)),
      };
    }
    if (!c) return { x: 0, y: 0 };
    const sign = this.rightSign || this.tentativeSign || 1;
    const dx = (v.x - c.x) * sign;
    const dy = v.y - c.y;
    const r = (k: DirStep) => (this.ranges[k] ?? this.seedRange) * PREVIEW_REACH;
    return {
      x: clamp(dx / (dx >= 0 ? r("right") : r("left")), -1.1, 1.1),
      y: clamp(dy / (dy >= 0 ? r("up") : r("down")), -1.1, 1.1),
    };
  }

  /** Tüm adımlar geçildiyse sonuç; aksi halde null. */
  get result(): CalibrationResult | null {
    if (!this._state.done || !this.center) return null;
    const flipX = this.rightSign < 0;
    const s = flipX ? -1 : 1;
    const r = this.ranges;
    const fx = NOISE_RANGE_K * this.noiseX;
    const fy = NOISE_RANGE_K * this.noiseY;
    return {
      flipX,
      profile: {
        cx: this.center.x * s,
        cy: this.center.y,
        up: Math.max(r.up!, fy),
        down: Math.max(r.down!, fy),
        right: Math.max(r.right!, fx),
        left: Math.max(r.left!, fx),
      },
    };
  }

  /** En baştan başlat. */
  restart(): void {
    this.index = 0;
    this.stepStart = -1;
    this.lastT = -1;
    this.center = null;
    this.ranges = {};
    this.rightSign = 0;
    this.minX = MIN_DEFLECTION;
    this.minY = MIN_DEFLECTION;
    this.noiseX = 0;
    this.noiseY = 0;
    this.lastInput = null;
    this.resetStep();
    this._state = this.snapshot("settling");
  }

  push(f: CalibrationFrame): CalibrationState {
    if (this._state.done) return this._state;
    const t = f.timestamp;
    if (this.stepStart < 0) this.stepStart = t;
    const dt = this.lastT < 0 ? 0 : Math.min(Math.max(t - this.lastT, 0), MAX_DT);
    this.lastT = t;
    this.lastInput = f.hasFace ? { x: f.input.x, y: f.input.y } : null;
    this._metrics.blink = f.hasFace ? f.blink : 0;

    if (t - this.stepStart < SETTLE_MS) return (this._state = this.snapshot("settling"));
    if (!f.hasFace) {
      this.blinkSince = -1;
      return this.bad(t, dt, "noface");
    }

    const step = CALIBRATION_STEPS[this.index];
    const blinkTh = step === "down" ? BLINK_THRESHOLD_DOWN : BLINK_THRESHOLD;
    const closedTh = step === "down" ? EYES_CLOSED_DOWN : EYES_CLOSED;
    if (f.blink >= closedTh) {
      // Gözler kapalı: bakış verisi anlamsız, süre ne olursa olsun sayılmaz.
      if (this.blinkSince < 0) this.blinkSince = t;
      return (this._state = this.snapshot("blink"));
    }
    if (f.blink >= blinkTh) {
      if (this.blinkSince < 0) this.blinkSince = t;
      // Kısa kırpma doğaldır: ilerlemeyi ne artırır ne geri alır.
      // Uzun süren "kırpma" kapak inmesidir (aşağı bakış): kare değerlendirilir.
      if (t - this.blinkSince < BLINK_MAX_MS) return (this._state = this.snapshot("blink"));
    } else {
      this.blinkSince = -1;
    }

    const issue = this.judge(f.input);
    if (issue !== "ok") return this.bad(t, dt, issue);

    this.badSince = -1;
    this.held += dt;
    if (this.held >= HOLD_MS) this.completeStep(t);
    return (this._state = this.snapshot("ok"));
  }

  private judge(v: GazeVector): CalibrationIssue {
    const step = CALIBRATION_STEPS[this.index];

    if (step === "center") {
      const n = this.centerSamples.length;
      this._metrics.along = 0;
      this._metrics.cross = 0;
      if (n > 0) {
        const mx = mean(this.centerSamples.map((s) => s.x));
        const my = mean(this.centerSamples.map((s) => s.y));
        const d = Math.hypot(v.x - mx, v.y - my);
        this._metrics.along = d;
        this._metrics.min = CENTER_JITTER;
        if (d > CENTER_JITTER) return "unstable";
      }
      this.centerSamples.push({ x: v.x, y: v.y });
      return "ok";
    }

    const c = this.center!;
    const dx = v.x - c.x;
    const dy = v.y - c.y;
    const vertical = step === "up" || step === "down";
    const min = vertical ? this.minY : this.minX;
    const crossMin = vertical ? this.minX : this.minY;
    let along: number;
    let cross: number;

    if (vertical) {
      along = step === "up" ? dy : -dy;
      cross = Math.abs(dx);
    } else {
      cross = Math.abs(dy);
      let expected = this.rightSign === 0 ? 0 : step === "right" ? this.rightSign : -this.rightSign;
      if (expected === 0) {
        // İlk yatay adım: kamera aynalı olabilir, yönü veriden öğren.
        if (this.tentativeSign === 0 && Math.abs(dx) >= min && cross <= CROSS_RATIO * Math.abs(dx)) {
          this.tentativeSign = Math.sign(dx);
        }
        expected = this.tentativeSign || 1;
      }
      along = dx * expected;
    }
    this._metrics.along = along;
    this._metrics.cross = cross;
    this._metrics.min = min;

    if (along < 0 && -along >= min) return "wrongdir";
    if (cross > Math.max(CROSS_RATIO * along, crossMin)) return "wrongdir";
    if (along < min) return "weak";

    const n = this.alongSamples.length;
    if (n >= 3) {
      const m = median(this.alongSamples.slice(-STABLE_WINDOW));
      if (Math.abs(along - m) > Math.max(0.03, 0.45 * m)) return "unstable";
    }
    this.alongSamples.push(along);
    return "ok";
  }

  private bad(t: number, dt: number, issue: CalibrationIssue): CalibrationState {
    if (this.badSince < 0) this.badSince = t;
    if (t - this.badSince > GRACE_MS) {
      // Sıfırlamak yerine geri al: çoğunlukla doğru bakan titrek sinyal de ilerleyebilsin.
      this.held -= dt * DECAY;
      if (this.held <= 0) this.resetStep();
    }
    return (this._state = this.snapshot(issue));
  }

  private completeStep(t: number): void {
    const step = CALIBRATION_STEPS[this.index];
    if (step === "center") {
      const xs = this.centerSamples.map((s) => s.x);
      const ys = this.centerSamples.map((s) => s.y);
      this.center = { x: median(xs), y: median(ys) };
      // Eşiği cihazın gürültüsüne göre ayarla: sessiz cihazda zayıf ama gerçek bakışlar da geçsin.
      this.noiseX = std(xs);
      this.noiseY = std(ys);
      this.minX = clamp(NOISE_K * this.noiseX, MIN_DEFLECTION_FLOOR, MIN_DEFLECTION);
      this.minY = clamp(NOISE_K * this.noiseY, MIN_DEFLECTION_FLOOR, MIN_DEFLECTION);
    } else {
      this.ranges[step] = median(this.alongSamples);
      if ((step === "right" || step === "left") && this.rightSign === 0) {
        this.rightSign = step === "right" ? this.tentativeSign || 1 : -(this.tentativeSign || 1);
      }
    }
    this.index++;
    this.stepStart = t;
    this.resetStep();
  }

  /** Yalnızca içinde bulunulan adımın ilerlemesini sıfırlar; geçilmiş adımlar korunur. */
  private resetStep(): void {
    this.held = 0;
    this.badSince = -1;
    this.blinkSince = -1;
    this.centerSamples = [];
    this.alongSamples = [];
    this.tentativeSign = 0;
  }

  private snapshot(issue: CalibrationIssue): CalibrationState {
    const total = CALIBRATION_STEPS.length;
    const done = this.index >= total;
    const index = Math.min(this.index, total - 1);
    return {
      step: CALIBRATION_STEPS[index],
      index,
      total,
      progress: done ? 1 : clamp(this.held / HOLD_MS, 0, 1),
      issue,
      struggling: !done && this.stepStart >= 0 && this.lastT - this.stepStart > STRUGGLE_MS,
      done,
    };
  }
}
