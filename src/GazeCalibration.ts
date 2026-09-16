import {
  CalibrationSession,
  type CalibrationIssue,
  type CalibrationResult,
  type CalibrationState,
  type CalibrationStepId,
} from "./calibration-core.js";
import type { GazeTracker } from "./GazeTracker.js";
import type { GazeLabels, GazeSample } from "./types.js";

export interface GazeCalibrationOptions {
  tracker: GazeTracker;
  labels: GazeLabels;
  /** Ekranın ekleneceği kök. Varsayılan document.body. */
  root?: HTMLElement;
  /** CSS değişken override'ları (navigator ile aynı tema). */
  theme?: Record<string, string>;
}

const STYLE_ID = "gazekit-calibration-styles";
const CSS = `
.gk-cal{position:fixed;inset:0;z-index:2147483001;pointer-events:auto;
  background:rgba(15,23,42,.94);color:#f8fafc;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --gk-accent:#3b82f6;--gk-edge:18px;--gk-target:56px;
  --gk-top:calc(var(--gk-edge) + env(safe-area-inset-top,0px));
  --gk-bottom:calc(var(--gk-edge) + env(safe-area-inset-bottom,0px));
  --gk-left:calc(var(--gk-edge) + env(safe-area-inset-left,0px));
  --gk-right:calc(var(--gk-edge) + env(safe-area-inset-right,0px))}
.gk-cal-panel{position:absolute;left:50%;top:26%;transform:translate(-50%,-50%);
  width:min(88vw,520px);text-align:center}
.gk-cal[data-step="up"] .gk-cal-panel{top:62%}
.gk-cal[data-step="down"] .gk-cal-panel{top:38%}
.gk-cal-title{margin:0 0 2px;font-size:20px;font-weight:600}
.gk-cal-step{margin:0 0 10px;font-size:13px;opacity:.75}
.gk-cal-instr{margin:0;font-size:18px;line-height:1.35}
.gk-cal-hint{margin:8px 0 0;min-height:1.3em;font-size:14px;line-height:1.3;color:#fcd34d}
.gk-cal-struggle{margin:6px 0 0;font-size:13px;line-height:1.35;opacity:.85}
.gk-cal-dots{display:flex;justify-content:center;gap:6px;margin-top:12px}
.gk-cal-dots span{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.25)}
.gk-cal-dots span[data-s="done"]{background:#22c55e}
.gk-cal-dots span[data-s="now"]{background:var(--gk-accent)}
.gk-cal-target{position:absolute;width:var(--gk-target);height:var(--gk-target);
  transform:translate(-50%,-50%);border-radius:50%;display:grid;place-items:center}
.gk-cal-target::before{content:"";position:absolute;inset:0;border-radius:50%;
  background:conic-gradient(var(--gk-accent) calc(var(--gk-progress,0)*1turn),rgba(255,255,255,.2) 0);
  -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 calc(100% - 6px));
  mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 calc(100% - 6px))}
.gk-cal-target::after{content:"";width:16px;height:16px;border-radius:50%;background:#fff}
.gk-cal[data-step="center"] .gk-cal-target{left:50%;top:50%}
.gk-cal[data-step="up"] .gk-cal-target{left:50%;top:calc(var(--gk-top) + var(--gk-target)/2)}
.gk-cal[data-step="down"] .gk-cal-target{left:50%;top:calc(100% - var(--gk-bottom) - var(--gk-target)/2)}
.gk-cal[data-step="left"] .gk-cal-target{left:calc(var(--gk-left) + var(--gk-target)/2);top:50%}
.gk-cal[data-step="right"] .gk-cal-target{left:calc(100% - var(--gk-right) - var(--gk-target)/2);top:50%}
.gk-cal[data-done] .gk-cal-target{display:none}
.gk-cal-cancel{position:absolute;right:var(--gk-right);bottom:var(--gk-bottom);
  background:rgba(255,255,255,.12);color:#f8fafc;border:1px solid rgba(255,255,255,.3);
  border-radius:999px;padding:8px 14px;font:inherit;font-size:13px;cursor:pointer}
.gk-cal-cancel:focus-visible{outline:3px solid #fff;outline-offset:3px}
.gk-cal-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:no-preference){
  .gk-cal-target{transition:left .35s ease,top .35s ease}
  .gk-cal-target::after{animation:gk-cal-pulse 1.2s ease-in-out infinite}
  @keyframes gk-cal-pulse{50%{transform:scale(.6)}}
}`;

/** Tamamlandı mesajının ekranda kalma süresi (ms). */
const DONE_MS = 900;
/** İpucu bu süre kararlı kalmadan değişmez; her karede titremesin (ms). */
const HINT_STABLE_MS = 250;

let uid = 0;

/**
 * Zorunlu, adım adım kalibrasyon ekranı. Her adım geçilmeden bir sonrakine
 * geçilmez; atlama yoktur. Yalnızca "Vazgeç" ile tamamen iptal edilebilir
 * (o durumda göz kontrolü açılmaz).
 */
export class GazeCalibration {
  private tracker: GazeTracker;
  private labels: GazeLabels;
  private root: HTMLElement;
  private theme?: Record<string, string>;
  private session = new CalibrationSession();

  private el: HTMLDivElement | null = null;
  private stepEl!: HTMLParagraphElement;
  private instrEl!: HTMLParagraphElement;
  private hintEl!: HTMLParagraphElement;
  private struggleEl!: HTMLParagraphElement;
  private dotsEl!: HTMLDivElement;
  private targetEl!: HTMLDivElement;
  private cancelEl!: HTMLButtonElement;
  private liveEl!: HTMLDivElement;

  private pending: Promise<CalibrationResult> | null = null;
  private resolve?: (r: CalibrationResult) => void;
  private reject?: (e: Error) => void;
  private unsub: (() => void) | null = null;
  private doneTimer = 0;
  private prevFocus: Element | null = null;

  private lastIndex = -1;
  private hintCandidate: CalibrationIssue | null = null;
  private hintSince = 0;
  private hintShown: CalibrationIssue | null = null;
  private struggleAnnounced = false;

  constructor(options: GazeCalibrationOptions) {
    this.tracker = options.tracker;
    this.labels = options.labels;
    this.root = options.root ?? document.body;
    this.theme = options.theme;
  }

  get active(): boolean {
    return this.pending !== null;
  }

  /**
   * Kalibrasyonu başlatır. Tüm adımlar geçilince sonuç tracker'a uygulanır
   * ve promise çözülür. "Vazgeç" ile iptal edilirse AbortError ile reddedilir.
   */
  run(): Promise<CalibrationResult> {
    if (this.pending) return this.pending;
    this.pending = new Promise<CalibrationResult>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.session.restart();
    this.lastIndex = -1;
    this.struggleAnnounced = false;
    this.mount();
    this.render(this.session.state, performance.now());
    this.tracker.setLearningPaused(true);
    this.unsub = this.tracker.on("gaze", this.onGaze);
    return this.pending;
  }

  /** Kalibrasyonu iptal eder; hiçbir adım sonucu uygulanmaz. */
  cancel(): void {
    if (!this.pending) return;
    const reject = this.reject;
    this.cleanup();
    const err = new Error("Kalibrasyon iptal edildi");
    err.name = "AbortError";
    reject?.(err);
  }

  destroy(): void {
    this.cancel();
  }

  private onGaze = (s: GazeSample): void => {
    const st = this.session.push({
      timestamp: s.timestamp,
      hasFace: s.hasFace,
      blink: s.blink ?? 0,
      input: s.input ?? s.raw,
    });
    this.render(st, s.timestamp);
    if (!st.done) return;

    this.unsub?.();
    this.unsub = null;
    const result = this.session.result!;
    this.tracker.applyCalibration(result);
    this.showDone();
    const resolve = this.resolve;
    this.doneTimer = window.setTimeout(() => {
      this.cleanup();
      resolve?.(result);
    }, DONE_MS);
  };

  // --- DOM ---

  private mount(): void {
    this.injectStyles();
    const id = `gk-cal-title-${++uid}`;
    const el = document.createElement("div");
    el.className = "gk-cal";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", id);
    if (this.theme) {
      for (const [k, v] of Object.entries(this.theme)) el.style.setProperty(k, v);
    }

    const panel = document.createElement("div");
    panel.className = "gk-cal-panel";
    const title = document.createElement("h2");
    title.className = "gk-cal-title";
    title.id = id;
    title.textContent = this.labels.calibTitle;
    this.stepEl = document.createElement("p");
    this.stepEl.className = "gk-cal-step";
    this.instrEl = document.createElement("p");
    this.instrEl.className = "gk-cal-instr";
    this.hintEl = document.createElement("p");
    this.hintEl.className = "gk-cal-hint";
    this.struggleEl = document.createElement("p");
    this.struggleEl.className = "gk-cal-struggle";
    this.struggleEl.hidden = true;
    this.dotsEl = document.createElement("div");
    this.dotsEl.className = "gk-cal-dots";
    this.dotsEl.setAttribute("aria-hidden", "true");
    panel.append(title, this.stepEl, this.instrEl, this.hintEl, this.struggleEl, this.dotsEl);

    this.targetEl = document.createElement("div");
    this.targetEl.className = "gk-cal-target";
    this.targetEl.setAttribute("aria-hidden", "true");

    this.cancelEl = document.createElement("button");
    this.cancelEl.type = "button";
    this.cancelEl.className = "gk-cal-cancel";
    this.cancelEl.textContent = this.labels.calibCancel;
    this.cancelEl.addEventListener("click", () => this.cancel());

    this.liveEl = document.createElement("div");
    this.liveEl.className = "gk-cal-sr";
    this.liveEl.setAttribute("aria-live", "assertive");
    this.liveEl.setAttribute("aria-atomic", "true");

    el.append(panel, this.targetEl, this.cancelEl, this.liveEl);
    el.addEventListener("keydown", this.onKeyDown);
    this.root.appendChild(el);
    this.el = el;

    this.prevFocus = document.activeElement;
    this.cancelEl.focus();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.cancel();
    } else if (e.key === "Tab") {
      // Diyalogdaki tek odaklanabilir öğe: odak dışarı kaçmasın.
      e.preventDefault();
      this.cancelEl.focus();
    }
  };

  private render(st: CalibrationState, now: number): void {
    if (!this.el) return;

    if (st.index !== this.lastIndex) {
      this.lastIndex = st.index;
      this.el.dataset.step = st.step;
      this.stepEl.textContent = this.labels.calibStep
        .replace("{n}", String(st.index + 1))
        .replace("{total}", String(st.total));
      const instr = this.instruction(st.step);
      this.instrEl.textContent = instr;
      this.announce(`${this.stepEl.textContent}. ${instr}`);
      this.dotsEl.replaceChildren(
        ...Array.from({ length: st.total }, (_, i) => {
          const d = document.createElement("span");
          d.dataset.s = i < st.index ? "done" : i === st.index ? "now" : "todo";
          return d;
        })
      );
      this.hintCandidate = null;
      this.hintShown = null;
      this.hintEl.textContent = "";
      this.struggleEl.hidden = true;
      this.struggleAnnounced = false;
    }

    this.targetEl.style.setProperty("--gk-progress", String(st.progress));

    // kırpma ipucu değiştirmez; son gösterileni korur
    if (st.issue !== "blink") {
      if (st.issue !== this.hintCandidate) {
        this.hintCandidate = st.issue;
        this.hintSince = now;
      } else if (st.issue !== this.hintShown && now - this.hintSince >= HINT_STABLE_MS) {
        this.hintShown = st.issue;
        this.hintEl.textContent = this.hint(st.issue);
      }
    }

    if (st.struggling && this.struggleEl.hidden) {
      this.struggleEl.textContent = this.labels.calibStruggle;
      this.struggleEl.hidden = false;
      if (!this.struggleAnnounced) {
        this.struggleAnnounced = true;
        this.announce(this.labels.calibStruggle);
      }
    }
  }

  private showDone(): void {
    if (!this.el) return;
    this.el.dataset.done = "";
    this.stepEl.textContent = "";
    this.instrEl.textContent = this.labels.calibDone;
    this.hintEl.textContent = "";
    this.struggleEl.hidden = true;
    this.dotsEl.querySelectorAll("span").forEach((d) => (d.dataset.s = "done"));
    this.announce(this.labels.calibDone);
  }

  private instruction(step: CalibrationStepId): string {
    const l = this.labels;
    return { center: l.calibCenter, up: l.calibUp, down: l.calibDown, left: l.calibLeft, right: l.calibRight }[step];
  }

  private hint(issue: CalibrationIssue): string {
    const l = this.labels;
    switch (issue) {
      case "ok": return l.calibHold;
      case "noface": return l.calibNoFace;
      case "weak": return l.calibWeak;
      case "wrongdir": return l.calibWrongDir;
      case "unstable": return l.calibUnstable;
      default: return "";
    }
  }

  private announce(msg: string): void {
    this.liveEl.textContent = "";
    requestAnimationFrame(() => {
      if (this.liveEl) this.liveEl.textContent = msg;
    });
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  private cleanup(): void {
    this.unsub?.();
    this.unsub = null;
    if (this.doneTimer) window.clearTimeout(this.doneTimer);
    this.doneTimer = 0;
    this.tracker.setLearningPaused(false);
    this.el?.removeEventListener("keydown", this.onKeyDown);
    this.el?.remove();
    this.el = null;
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus();
    }
    this.prevFocus = null;
    this.pending = null;
    this.resolve = undefined;
    this.reject = undefined;
  }
}
