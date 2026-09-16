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

export interface CalibrationResult {
  profile: CalibrationProfile;
  /**
   * Yatay eksen ters mi. Bazı kameralar/sanal kameralar görüntüyü aynalı
   * verir; o zaman sağa bakış sol gibi görünür. Veriden öğrenilir.
   */
  flipX: boolean;
}

/** Hedef göründükten sonra gözün oraya varması için beklenen süre (ms). */
const SETTLE_MS = 700;
/** Adımın geçilmesi için gereken geçerli bakış süresi (ms). */
const HOLD_MS = 1200;
/** Bu süreden kısa sapmalar affedilir; daha uzunu adımın ilerlemesini sıfırlar (ms). */
const GRACE_MS = 200;
/** Kareler arası süre bu değerle sınırlanır: takılan bir kare adımı tek başına geçirmesin. */
const MAX_DT = 100;
const BLINK_THRESHOLD = 0.45;
/**
 * Bir yön adımının sayılması için merkezden en az bu kadar sapma (ham birim).
 * Tipik gürültü ~0.012, telefonda tam bakış ~0.14-0.24.
 */
export const MIN_DEFLECTION = 0.04;
/** Merkez adımında örneklerin ortalamadan en fazla sapması (ham birim). */
const CENTER_JITTER = 0.05;
/** Bu süreden uzun süren adımda ek ipucu gösterilir (ms). */
const STRUGGLE_MS = 5000;

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

/**
 * Zorunlu, adım adım kalibrasyonun saf mantığı (DOM yok, test edilebilir).
 * Her kareyi `push` ile ver; `state` UI'ın ne göstereceğini söyler.
 */
export class CalibrationSession {
  private index = 0;
  private stepStart = -1;
  private lastT = -1;
  private held = 0;
  private badSince = -1;
  private centerSamples: GazeVector[] = [];
  private alongSamples: number[] = [];
  /** İlk yatay adımda veriden okunan geçici işaret. */
  private tentativeSign = 0;
  private center: GazeVector | null = null;
  private ranges: Partial<Record<Exclude<CalibrationStepId, "center">, number>> = {};
  /** Sağ hedefe bakınca ham x'in işareti (+1 normal, -1 aynalı). 0 = henüz bilinmiyor. */
  private rightSign = 0;
  private _state: CalibrationState;

  constructor() {
    this._state = this.snapshot("settling");
  }

  get state(): CalibrationState {
    return this._state;
  }

  /** Tüm adımlar geçildiyse sonuç; aksi halde null. */
  get result(): CalibrationResult | null {
    if (!this._state.done || !this.center) return null;
    const flipX = this.rightSign < 0;
    const s = flipX ? -1 : 1;
    const r = this.ranges;
    return {
      flipX,
      profile: {
        cx: this.center.x * s,
        cy: this.center.y,
        up: r.up!,
        down: r.down!,
        right: r.right!,
        left: r.left!,
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
    this.resetStep();
    this._state = this.snapshot("settling");
  }

  push(f: CalibrationFrame): CalibrationState {
    if (this._state.done) return this._state;
    const t = f.timestamp;
    if (this.stepStart < 0) this.stepStart = t;
    const dt = this.lastT < 0 ? 0 : Math.min(Math.max(t - this.lastT, 0), MAX_DT);
    this.lastT = t;

    if (t - this.stepStart < SETTLE_MS) return (this._state = this.snapshot("settling"));
    if (!f.hasFace) return this.bad(t, "noface");
    // Kırpma doğaldır: ilerlemeyi ne artırır ne sıfırlar.
    if (f.blink >= BLINK_THRESHOLD) return (this._state = this.snapshot("blink"));

    const issue = this.judge(f.input);
    if (issue !== "ok") return this.bad(t, issue);

    this.badSince = -1;
    this.held += dt;
    if (this.held >= HOLD_MS) this.completeStep(t);
    return (this._state = this.snapshot("ok"));
  }

  private judge(v: GazeVector): CalibrationIssue {
    const step = CALIBRATION_STEPS[this.index];

    if (step === "center") {
      const n = this.centerSamples.length;
      if (n > 0) {
        const mx = mean(this.centerSamples.map((s) => s.x));
        const my = mean(this.centerSamples.map((s) => s.y));
        if (Math.hypot(v.x - mx, v.y - my) > CENTER_JITTER) return "unstable";
      }
      this.centerSamples.push({ x: v.x, y: v.y });
      return "ok";
    }

    const c = this.center!;
    const dx = v.x - c.x;
    const dy = v.y - c.y;
    let along: number;
    let cross: number;

    if (step === "up" || step === "down") {
      along = step === "up" ? dy : -dy;
      cross = Math.abs(dx);
    } else {
      cross = Math.abs(dy);
      let expected = this.rightSign === 0 ? 0 : step === "right" ? this.rightSign : -this.rightSign;
      if (expected === 0) {
        // İlk yatay adım: kamera aynalı olabilir, yönü veriden öğren.
        if (this.tentativeSign === 0 && Math.abs(dx) >= MIN_DEFLECTION && Math.abs(dx) >= cross) {
          this.tentativeSign = Math.sign(dx);
        }
        expected = this.tentativeSign || 1;
      }
      along = dx * expected;
    }

    if (along < 0 && -along >= MIN_DEFLECTION) return "wrongdir";
    if (cross > Math.max(along, MIN_DEFLECTION)) return "wrongdir";
    if (along < MIN_DEFLECTION) return "weak";

    if (this.alongSamples.length > 0) {
      const m = mean(this.alongSamples);
      if (Math.abs(along - m) > Math.max(0.04, 0.4 * m)) return "unstable";
    }
    this.alongSamples.push(along);
    return "ok";
  }

  private bad(t: number, issue: CalibrationIssue): CalibrationState {
    if (this.badSince < 0) this.badSince = t;
    if (t - this.badSince > GRACE_MS) this.resetStep();
    return (this._state = this.snapshot(issue));
  }

  private completeStep(t: number): void {
    const step = CALIBRATION_STEPS[this.index];
    if (step === "center") {
      this.center = {
        x: median(this.centerSamples.map((s) => s.x)),
        y: median(this.centerSamples.map((s) => s.y)),
      };
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
      progress: done ? 1 : Math.min(this.held / HOLD_MS, 1),
      issue,
      struggling: !done && this.stepStart >= 0 && this.lastT - this.stepStart > STRUGGLE_MS,
      done,
    };
  }
}
