import { Emitter } from "./event-emitter.js";
import { GazeCalibration } from "./GazeCalibration.js";
import type { GazeTracker } from "./GazeTracker.js";
import type {
  GazeLabels,
  GazeNavigatorOptions,
  GazeSample,
  ZoneActionContext,
  ZoneDefinition,
} from "./types.js";

type Dir = "up" | "down" | "left" | "right";

const posToDir = (p: ZoneDefinition["position"]): Dir =>
  p === "top" ? "up" : p === "bottom" ? "down" : (p as Dir);

const DEFAULT_LABELS: GazeLabels = {
  up: "Yukarı kaydır",
  down: "Aşağı kaydır",
  back: "Geri",
  forward: "İleri",
  statusOn: "Göz takibi açık",
  statusSearching: "Yüz aranıyor…",
  statusOff: "Göz takibi kapalı",
  toggleOn: "Göz kontrolünü aç",
  toggleOff: "Göz kontrolünü kapat",
  cameraDenied: "Kamera erişimi reddedildi — düğmeler klavye/fare ile kullanılabilir.",
  recalibrate: "Yeniden kalibre et",
  calibrationRequired: "Göz kontrolü için kalibrasyon gerekli",
  calibTitle: "Kalibrasyon",
  calibStep: "Adım {n} / {total}",
  calibCenter: "Ekranın ortasındaki noktaya bakın.",
  calibUp: "Yukarıdaki noktaya bakın.",
  calibDown: "Aşağıdaki noktaya bakın.",
  calibLeft: "Soldaki noktaya bakın.",
  calibRight: "Sağdaki noktaya bakın.",
  calibHold: "Böyle kalın…",
  calibNoFace: "Yüzünüz görünmüyor. Kameraya dönün.",
  calibWeak: "Gözlerinizi noktaya doğru biraz daha çevirin.",
  calibWrongDir: "Parlayan noktaya bakın.",
  calibUnstable: "Bakışınızı noktada sabit tutun.",
  calibStruggle:
    "Başınızı sabit tutup yalnızca gözlerinizi noktaya çevirin. Yüzünüzün iyi aydınlandığından emin olun.",
  calibDone: "Kalibrasyon tamamlandı.",
  calibCancel: "Vazgeç",
};

const ICONS: Record<Dir, string> = {
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>`,
  down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
  left: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>`,
  right: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`,
};

const STYLE_ID = "gazekit-styles";
const CSS = `
.gk-root{position:fixed;inset:0;z-index:2147483000;pointer-events:none;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --gk-accent:#3b82f6;--gk-btn-bg:rgba(17,24,39,.82);--gk-btn-fg:#fff;
  --gk-ring:6px;--gk-size:76px;--gk-edge:18px}
.gk-btn{position:absolute;width:var(--gk-size);height:var(--gk-size);
  display:grid;place-items:center;border-radius:50%;border:0;cursor:pointer;
  background:var(--gk-btn-bg);color:var(--gk-btn-fg);pointer-events:auto;
  box-shadow:0 6px 20px rgba(0,0,0,.35)}
.gk-btn svg{width:38px;height:38px;fill:none;stroke:currentColor;stroke-width:2.4;
  stroke-linecap:round;stroke-linejoin:round}
.gk-btn::before{content:"";position:absolute;inset:calc(-1*var(--gk-ring));
  border-radius:50%;
  background:conic-gradient(var(--gk-accent) calc(var(--gk-progress,0)*1turn),transparent 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--gk-ring)),#000 calc(100% - var(--gk-ring)));
  mask:radial-gradient(farthest-side,transparent calc(100% - var(--gk-ring)),#000 calc(100% - var(--gk-ring)))}
.gk-btn.gk-active{outline:2px solid var(--gk-accent);outline-offset:4px}
.gk-btn:focus-visible{outline:3px solid #fff;outline-offset:3px}
.gk-top{top:var(--gk-edge);left:50%;transform:translateX(-50%)}
.gk-bottom{bottom:var(--gk-edge);left:50%;transform:translateX(-50%)}
.gk-left{left:var(--gk-edge);top:50%;transform:translateY(-50%)}
.gk-right{right:var(--gk-edge);top:50%;transform:translateY(-50%)}
.gk-status{position:absolute;bottom:calc(var(--gk-edge) + var(--gk-size) + 12px);
  left:50%;transform:translateX(-50%);pointer-events:none;
  background:var(--gk-btn-bg);color:var(--gk-btn-fg);
  padding:6px 12px;border-radius:999px;font-size:13px;line-height:1;
  display:flex;align-items:center;gap:8px;white-space:nowrap}
.gk-dot-state{width:9px;height:9px;border-radius:50%;background:#f59e0b}
.gk-status[data-state="on"] .gk-dot-state{background:#22c55e}
.gk-status[data-state="off"] .gk-dot-state{background:#ef4444}
.gk-controls{position:absolute;top:var(--gk-edge);right:var(--gk-edge);
  display:flex;flex-direction:column;align-items:flex-end;gap:8px}
.gk-toggle,.gk-recal{pointer-events:auto;background:var(--gk-btn-bg);color:var(--gk-btn-fg);
  border:0;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer}
.gk-toggle:focus-visible,.gk-recal:focus-visible{outline:3px solid #fff;outline-offset:3px}
.gk-gaze-dot{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;
  border-radius:50%;background:var(--gk-accent);opacity:.85;pointer-events:none;
  box-shadow:0 0 0 3px rgba(255,255,255,.6)}
.gk-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:no-preference){
  .gk-btn{transition:transform .12s ease,outline-color .12s ease}
  .gk-btn.gk-active{transform:scale(1.06)}
  .gk-top.gk-active,.gk-bottom.gk-active{transform:translateX(-50%) scale(1.06)}
  .gk-left.gk-active,.gk-right.gk-active{transform:translateY(-50%) scale(1.06)}
  .gk-gaze-dot{transition:left .06s linear,top .06s linear}
}`;

interface NavEvents extends Record<string, unknown> {
  action: { zone: ZoneDefinition; ctx: ZoneActionContext };
  enabledchange: boolean;
  /** Kalibrasyon ekranı açıldı (true) / kapandı (false). */
  calibratingchange: boolean;
}

export class GazeNavigator extends Emitter<NavEvents> {
  private tracker: GazeTracker;
  private root: HTMLElement;
  private host: HTMLDivElement;
  private labels: GazeLabels;
  private dwellTime: number;
  private threshold: number;
  private scrollSpeed: number;
  private scrollTarget: Window | HTMLElement;
  private onAction?: GazeNavigatorOptions["onAction"];
  private requireCalibration: boolean;
  private theme?: Record<string, string>;
  private calibration: GazeCalibration;
  private calibrating: Promise<void> | null = null;

  private slots: Record<Dir, ZoneDefinition | null> = {
    up: null, down: null, left: null, right: null,
  };
  private buttons = new Map<Dir, HTMLButtonElement>();
  private statusEl!: HTMLDivElement;
  private statusText!: HTMLSpanElement;
  private toggleEl!: HTMLButtonElement;
  private recalEl!: HTMLButtonElement;
  private liveEl!: HTMLDivElement;
  private gazeDot: HTMLDivElement | null = null;

  private enabled = false;
  private current: Dir | null = null;
  private dwellStart = 0;
  private holding = false;
  private firedOnce = false;
  private lastFire = 0;
  private lastAnnounce = "";
  private unsub: Array<() => void> = [];

  constructor(options: GazeNavigatorOptions) {
    super();
    this.tracker = options.tracker;
    this.root = options.root ?? document.body;
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
    this.dwellTime = options.dwellTime ?? 900;
    this.threshold = options.threshold ?? 0.4;
    this.scrollSpeed = options.scrollSpeed ?? 16;
    this.scrollTarget = options.scrollTarget ?? window;
    this.onAction = options.onAction;
    this.requireCalibration = options.requireCalibration !== false;
    this.theme = options.theme;
    this.calibration = new GazeCalibration({
      tracker: this.tracker,
      labels: this.labels,
      root: this.root,
      theme: this.theme,
      // hata ayıklama noktası açıksa kalibrasyonda ham ölçümleri de göster
      debug: options.showGazeDot === true,
    });

    this.buildZones(options);
    this.injectStyles();
    this.host = this.buildOverlay(options);
    this.root.appendChild(this.host);

    if (options.theme) {
      for (const [k, v] of Object.entries(options.theme)) {
        this.host.style.setProperty(k, v);
      }
    }

    this.unsub.push(this.tracker.on("gaze", this.onGaze));
    this.unsub.push(this.tracker.on("facelost", () => this.reset()));
    this.unsub.push(
      this.tracker.on("error", () => this.setStatus("off", this.labels.cameraDenied))
    );
    // Telefon yan çevrildi ve o yön hiç kalibre edilmedi: kullanım sürüyorsa yeniden zorunlu.
    this.unsub.push(
      this.tracker.on("orientationchange", ({ calibrated }) => {
        if (this.requireCalibration && !calibrated && this.enabled) {
          void this.calibrate().catch(() => {});
        }
      })
    );
    this.setStatus("off", this.labels.statusOff);
  }

  // --- kamuya açık kontrol ---

  /**
   * Göz kontrolünü açar. Kalibrasyon zorunluysa ve bu cihaz yönü için henüz
   * yapılmadıysa önce kalibrasyon ekranı açılır; tamamlanınca kontrol açılır.
   */
  enable(): void {
    if (this.enabled || this.calibrating) return;
    if (this.requireCalibration && !this.tracker.isCalibrated) {
      void this.calibrate().catch(() => {});
      return;
    }
    this.enableNow();
  }

  /**
   * Kalibrasyon ekranını açar (ilk kez ya da yeniden). Tüm adımlar geçilince
   * göz kontrolü açılır. "Vazgeç" ile iptal edilirse AbortError ile reddedilir;
   * önceden geçerli bir kalibrasyon varsa ve kontrol açıksa açık kalır.
   */
  calibrate(): Promise<void> {
    if (this.calibrating) return this.calibrating;
    const wasEnabled = this.enabled;
    if (wasEnabled) this.disableNow();
    this.setStatus("searching", this.labels.calibTitle);
    this.emit("calibratingchange", true);

    this.calibrating = this.calibration
      .run()
      .then(
        () => {
          this.calibrating = null;
          this.emit("calibratingchange", false);
          this.enableNow();
        },
        (err: unknown) => {
          this.calibrating = null;
          this.emit("calibratingchange", false);
          if (wasEnabled && (!this.requireCalibration || this.tracker.isCalibrated)) {
            this.enableNow();
          } else {
            this.setStatus("off", this.labels.calibrationRequired);
          }
          throw err;
        }
      );
    return this.calibrating;
  }

  /** Kalibrasyon ekranı açık mı. */
  isCalibrating(): boolean {
    return this.calibrating !== null;
  }

  private enableNow(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.toggleEl.setAttribute("aria-pressed", "true");
    this.toggleEl.textContent = this.labels.toggleOff;
    this.setStatus("searching", this.labels.statusSearching);
    this.emit("enabledchange", true);
  }

  disable(): void {
    // Kalibrasyon sırasında kapatmak = kalibrasyonu iptal etmek.
    if (this.calibrating) {
      this.calibration.cancel();
      return;
    }
    this.disableNow();
  }

  private disableNow(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.reset();
    this.toggleEl.setAttribute("aria-pressed", "false");
    this.toggleEl.textContent = this.labels.toggleOn;
    this.setStatus("off", this.labels.statusOff);
    this.emit("enabledchange", false);
  }

  toggle(): void {
    this.enabled ? this.disable() : this.enable();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  destroy(): void {
    this.calibration.destroy();
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.host.remove();
    this.clear();
  }

  // --- kurulum ---

  private buildZones(options: GazeNavigatorOptions): void {
    const z = options.zones ?? {};
    const on = (v: boolean | undefined) => v !== false;
    const scroll = (dir: 1 | -1) => (ctx: ZoneActionContext) => {
      void ctx;
      this.doScroll(dir * this.scrollSpeed);
    };

    if (on(z.up)) {
      this.slots.up = {
        id: "up", label: this.labels.up, announce: "Yukarı kaydırılıyor",
        position: "top", mode: "hold",
        onActivate: () => {}, onHold: scroll(-1),
      };
    }
    if (on(z.down)) {
      this.slots.down = {
        id: "down", label: this.labels.down, announce: "Aşağı kaydırılıyor",
        position: "bottom", mode: "hold",
        onActivate: () => {}, onHold: scroll(1),
      };
    }
    if (on(z.back)) {
      this.slots.left = {
        id: "left", label: this.labels.back, announce: "Geri gidildi",
        position: "left", mode: "once", cooldown: 1200,
        onActivate: () => history.back(),
      };
    }
    if (on(z.forward)) {
      this.slots.right = {
        id: "right", label: this.labels.forward, announce: "İleri gidildi",
        position: "right", mode: "once", cooldown: 1200,
        onActivate: () => history.forward(),
      };
    }
    for (const cz of options.customZones ?? []) {
      this.slots[posToDir(cz.position)] = cz;
    }
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  private buildOverlay(options: GazeNavigatorOptions): HTMLDivElement {
    const host = document.createElement("div");
    host.className = "gk-root";
    host.setAttribute("role", "toolbar");
    host.setAttribute("aria-label", "Göz ile gezinme");

    const posClass: Record<Dir, string> = {
      up: "gk-top", down: "gk-bottom", left: "gk-left", right: "gk-right",
    };
    (Object.keys(this.slots) as Dir[]).forEach((dir) => {
      const zone = this.slots[dir];
      if (!zone) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `gk-btn ${posClass[dir]}`;
      btn.setAttribute("aria-label", zone.label);
      btn.innerHTML = zone.icon ?? ICONS[dir];
      btn.addEventListener("click", () => this.manualTrigger(dir));
      host.appendChild(btn);
      this.buttons.set(dir, btn);
    });

    this.statusEl = document.createElement("div");
    this.statusEl.className = "gk-status";
    const dot = document.createElement("span");
    dot.className = "gk-dot-state";
    this.statusText = document.createElement("span");
    this.statusEl.append(dot, this.statusText);
    host.appendChild(this.statusEl);

    this.toggleEl = document.createElement("button");
    this.toggleEl.type = "button";
    this.toggleEl.className = "gk-toggle";
    this.toggleEl.setAttribute("aria-pressed", "false");
    this.toggleEl.textContent = this.labels.toggleOn;
    this.toggleEl.addEventListener("click", () => this.toggle());

    this.recalEl = document.createElement("button");
    this.recalEl.type = "button";
    this.recalEl.className = "gk-recal";
    this.recalEl.textContent = this.labels.recalibrate;
    this.recalEl.addEventListener("click", () => {
      void this.calibrate().catch(() => {});
    });

    const controls = document.createElement("div");
    controls.className = "gk-controls";
    controls.append(this.toggleEl, this.recalEl);
    host.appendChild(controls);

    this.liveEl = document.createElement("div");
    this.liveEl.className = "gk-sr";
    this.liveEl.setAttribute("aria-live", "polite");
    this.liveEl.setAttribute("aria-atomic", "true");
    host.appendChild(this.liveEl);

    if (options.showGazeDot) {
      this.gazeDot = document.createElement("div");
      this.gazeDot.className = "gk-gaze-dot";
      this.gazeDot.style.display = "none";
      host.appendChild(this.gazeDot);
    }
    return host;
  }

  // --- döngü ---

  private onGaze = (sample: GazeSample): void => {
    if (this.calibrating) {
      if (this.gazeDot) this.gazeDot.style.display = "none";
      return;
    }
    this.updateGazeDot(sample);
    if (!this.enabled) return;

    if (!sample.hasFace) {
      this.setStatus("searching", this.labels.statusSearching);
      this.reset();
      return;
    }
    this.setStatus("on", this.labels.statusOn);

    const dir = this.pickDir(sample);
    const now = sample.timestamp;

    if (dir !== this.current) {
      this.clearActive();
      this.current = dir;
      this.dwellStart = now;
      this.holding = false;
      this.firedOnce = false;
      if (dir) this.buttons.get(dir)?.classList.add("gk-active");
    }
    if (!dir) return;

    const zone = this.slots[dir]!;
    const btn = this.buttons.get(dir)!;
    const elapsed = now - this.dwellStart;
    const ctx: ZoneActionContext = {
      zone, sample, heldFor: elapsed, navigator: this,
    };

    if (zone.mode === "hold") {
      if (!this.holding) {
        this.setProgress(btn, Math.min(elapsed / this.dwellTime, 1));
        if (elapsed >= this.dwellTime) {
          this.holding = true;
          this.fire(zone, ctx);
        }
      } else {
        this.setProgress(btn, 1);
        zone.onHold?.(ctx);
      }
    } else {
      if (!this.firedOnce) {
        this.setProgress(btn, Math.min(elapsed / this.dwellTime, 1));
        if (elapsed >= this.dwellTime && now - this.lastFire > (zone.cooldown ?? 1000)) {
          this.firedOnce = true;
          this.lastFire = now;
          this.setProgress(btn, 0);
          this.fire(zone, ctx);
        }
      }
    }
  };

  private pickDir(sample: GazeSample): Dir | null {
    const { x, y } = sample.gaze;
    const t = this.threshold;
    const ax = Math.abs(x), ay = Math.abs(y);
    if (ax < t && ay < t) return null;
    const dir: Dir = ay >= ax ? (y > 0 ? "up" : "down") : x > 0 ? "right" : "left";
    return this.slots[dir] ? dir : null;
  }

  private fire(zone: ZoneDefinition, ctx: ZoneActionContext): void {
    zone.onActivate(ctx);
    this.announce(zone.announce ?? zone.label);
    this.onAction?.(zone, ctx);
    this.emit("action", { zone, ctx });
  }

  private manualTrigger(dir: Dir): void {
    const zone = this.slots[dir];
    if (!zone) return;
    const ctx: ZoneActionContext = {
      zone,
      sample: {
        timestamp: performance.now(), hasFace: false,
        gaze: { x: 0, y: 0 }, raw: { x: 0, y: 0 }, confidence: 0,
      },
      heldFor: 0, navigator: this,
    };
    if (zone.mode === "hold") {
      // klavye/fare geri dönüşü: tek seferde bir "sayfa" kadar kaydır
      this.doScroll(Math.sign(zone.id === "down" ? 1 : -1) * this.scrollSpeed * 24);
    }
    this.fire(zone, ctx);
  }

  private doScroll(dy: number): void {
    if (this.scrollTarget === window) {
      window.scrollBy({ top: dy, behavior: "auto" });
    } else {
      (this.scrollTarget as HTMLElement).scrollBy({ top: dy, behavior: "auto" });
    }
  }

  // --- UI yardımcıları ---

  private setProgress(btn: HTMLButtonElement, p: number): void {
    btn.style.setProperty("--gk-progress", String(p));
  }

  private clearActive(): void {
    if (this.current) {
      const b = this.buttons.get(this.current);
      b?.classList.remove("gk-active");
      if (b) this.setProgress(b, 0);
    }
  }

  private reset(): void {
    this.clearActive();
    this.current = null;
    this.holding = false;
    this.firedOnce = false;
  }

  private setStatus(state: "on" | "off" | "searching", text: string): void {
    this.statusEl.dataset.state = state;
    this.statusText.textContent = text;
  }

  private announce(msg: string): void {
    if (msg === this.lastAnnounce) this.liveEl.textContent = "";
    this.lastAnnounce = msg;
    // reflow ile ekran okuyucunun tekrarı yakalamasını sağla
    requestAnimationFrame(() => (this.liveEl.textContent = msg));
  }

  private updateGazeDot(sample: GazeSample): void {
    if (!this.gazeDot) return;
    if (!sample.hasFace) {
      this.gazeDot.style.display = "none";
      return;
    }
    this.gazeDot.style.display = "block";
    // Nokta .gk-root icinde absolute konumlanir; olcek de o kutudan alinmali.
    // window.innerHeight mobilde dinamik URL cubugu yuzunden fixed kutunun
    // yuksekligiyle uyusmaz, nokta asagi tasar.
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    const cx = (sample.gaze.x * 0.5 + 0.5) * w;
    const cy = (0.5 - sample.gaze.y * 0.5) * h;
    this.gazeDot.style.left = `${cx}px`;
    this.gazeDot.style.top = `${cy}px`;
  }
}
