import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { Emitter } from "./event-emitter.js";
import {
  AdaptiveCalibrator,
  blendshapesToGaze,
  combineEyeHead,
  defaultRangeSeed,
  EmaSmoother,
  matrixToEuler,
  type CalibrationProfile,
} from "./gaze-math.js";
import type { CalibrationResult } from "./calibration-core.js";
import type { GazeSample, GazeTrackerOptions, HeadPose } from "./types.js";

const DEFAULT_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const DEFAULT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const STORAGE_PREFIX = "gazekit:calib:v1";
/** Kayıt en fazla bu sıklıkla yazılır (ms). */
const SAVE_INTERVAL = 2000;
/** Göz kırpma bu skorun üstündeyse kare öğrenmeye alınmaz (kırpma "aşağı" tepe gibi görünür). */
const BLINK_THRESHOLD = 0.45;
/** Yüz bu süreden uzun kaybolup geri gelirse duruş değişmiş sayılır, merkez yeniden öğrenilir (ms). */
const RECENTER_AFTER_LOST = 1000;

interface TrackerEvents extends Record<string, unknown> {
  ready: void;
  gaze: GazeSample;
  facelost: void;
  facefound: void;
  error: Error;
  /** Cihaz yönü değişti; yeni yön için kalibrasyon yoksa `calibrated` false. */
  orientationchange: { orientation: "portrait" | "landscape"; calibrated: boolean };
  /** Açık kalibrasyon uygulandı ya da sıfırlandı. */
  calibrationchange: { calibrated: boolean };
}

type ResolvedOptions = Required<
  Omit<GazeTrackerOptions, "video" | "cameraConstraints">
> & {
  video?: HTMLVideoElement;
  cameraConstraints?: MediaTrackConstraints;
};

/**
 * Kamerayı açar, MediaPipe FaceLandmarker'ı VIDEO modunda çalıştırır ve
 * her karede yön kestirimi (GazeSample) yayınlar. Tüm işlem cihaz üstünde;
 * hiçbir görüntü ağa gönderilmez.
 */
export class GazeTracker extends Emitter<TrackerEvents> {
  private opts: ResolvedOptions;
  private landmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private ownsVideo = false;
  private stream: MediaStream | null = null;
  private smoother: EmaSmoother;
  private calibrator: AdaptiveCalibrator;
  private rafId = 0;
  private lastTs = -1;
  private hadFace = false;
  private lostAt = -1;
  private _running = false;
  private lastSave = 0;
  private dirty = false;
  private orientationMql: MediaQueryList | null = null;
  private currentOrientation: "portrait" | "landscape";
  private learningPaused = false;
  /** Bu yön için açık kalibrasyon tamamlandı mı. */
  private calibratedFlag = false;
  /** Kamera görüntüsü yatayda aynalı (kalibrasyonda öğrenilir). */
  private flipX = false;

  constructor(options: GazeTrackerOptions = {}) {
    super();
    this.opts = {
      video: options.video,
      wasmBasePath: options.wasmBasePath ?? DEFAULT_WASM,
      modelAssetPath: options.modelAssetPath ?? DEFAULT_MODEL,
      delegate: options.delegate ?? "GPU",
      gain: options.gain ?? 2.4,
      smoothing: options.smoothing ?? 0.35,
      headInfluence: options.headInfluence ?? 0,
      autoCenter: options.autoCenter ?? true,
      autoRange: options.autoRange ?? true,
      persistCalibration: options.persistCalibration ?? true,
      autoCenterRate: options.autoCenterRate ?? 0.02,
      cameraConstraints: options.cameraConstraints,
    };
    this.currentOrientation = readOrientation();
    this.smoother = new EmaSmoother(this.opts.smoothing);
    this.calibrator = new AdaptiveCalibrator({
      center: this.opts.autoCenter,
      range: this.opts.autoRange,
      fixedGain: this.opts.gain,
      seedRange: defaultRangeSeed(),
    });
    this.loadCalibration();
  }

  get running(): boolean {
    return this._running;
  }

  get videoElement(): HTMLVideoElement | null {
    return this.video;
  }

  /** Şu anki öğrenilmiş kalibrasyon profili (hata ayıklama / gösterim için). */
  get calibration(): CalibrationProfile {
    return this.calibrator.profile;
  }

  /**
   * Nötr merkezi yeniden öğren. Kullanıcı oturuşunu değiştirdiğinde çağır.
   * Öğrenilmiş menzil korunur; yalnızca merkez ~1 sn içinde yeniden oturur.
   */
  recenter(): void {
    this.calibrator.recenter();
    this.smoother.reset();
  }

  /** Mevcut cihaz yönü için açık kalibrasyon tamamlanmış mı. */
  get isCalibrated(): boolean {
    return this.calibratedFlag;
  }

  /**
   * Uyarlamalı öğrenmeyi duraklatır. Açık kalibrasyon sırasında kullanıcı
   * bilerek kenarlara bakar; bu bakışlar merkez sanılmamalı.
   */
  setLearningPaused(paused: boolean): void {
    this.learningPaused = paused;
  }

  /** Açık kalibrasyonun sonucunu uygular ve kaydeder. */
  applyCalibration(result: CalibrationResult): void {
    this.flipX = result.flipX;
    this.calibrator.setProfile(result.profile);
    this.smoother.reset();
    this.calibratedFlag = true;
    this.dirty = true;
    this.saveCalibration(true);
    this.emit("calibrationchange", { calibrated: true });
  }

  /** Öğrenilmiş kalibrasyonu ve kaydını tamamen siler. */
  resetCalibration(): void {
    this.calibrator.reset();
    this.smoother.reset();
    this.dirty = false;
    this.calibratedFlag = false;
    this.flipX = false;
    const key = this.storageKey();
    if (key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* depolama erişilemez (gizli mod vb.) */
      }
    }
    this.emit("calibrationchange", { calibrated: false });
  }

  /** Modeli ve kamerayı hazırlar. Kamera izni burada istenir. */
  async init(): Promise<void> {
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        this.opts.wasmBasePath
      );
      this.landmarker = await this.createLandmarker(fileset);

      this.video =
        this.opts.video ??
        ((): HTMLVideoElement => {
          const v = document.createElement("video");
          v.setAttribute("playsinline", "");
          v.muted = true;
          v.style.display = "none";
          document.body.appendChild(v);
          this.ownsVideo = true;
          return v;
        })();

      this.stream = await navigator.mediaDevices.getUserMedia({
        video: this.opts.cameraConstraints ?? {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.watchOrientation();
      this.emit("ready", undefined);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit("error", e);
      throw e;
    }
  }

  /**
   * GPU delegate bazı cihazlarda desteklenmez (bazı Android WebView'ler,
   * eski iOS). O durumda CPU ile yeniden dener; aksi halde model hiç yüklenmez.
   */
  private async createLandmarker(
    fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>
  ): Promise<FaceLandmarker> {
    const build = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.opts.modelAssetPath, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    if (this.opts.delegate === "CPU") return build("CPU");
    try {
      return await build("GPU");
    } catch {
      return build("CPU");
    }
  }

  start(): void {
    if (this._running || !this.landmarker || !this.video) return;
    this._running = true;
    // Durdurulup yeniden başlatıldıysa kullanıcı yer değiştirmiş olabilir.
    this.recenter();
    this.loop();
  }

  stop(): void {
    this._running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.smoother.reset();
    this.saveCalibration(true);
  }

  /** Kamerayı ve modeli tamamen serbest bırakır. */
  destroy(): void {
    this.stop();
    this.unwatchOrientation();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) {
      this.video.srcObject = null;
      if (this.ownsVideo) this.video.remove();
    }
    this.landmarker?.close();
    this.landmarker = null;
    this.clear();
  }

  // --- kalıcılık ---

  private storageKey(
    orientation: "portrait" | "landscape" = this.currentOrientation
  ): string | null {
    const p = this.opts.persistCalibration;
    if (!p) return null;
    const prefix = typeof p === "string" ? p : STORAGE_PREFIX;
    return `${prefix}:${orientation}`;
  }

  private loadCalibration(): void {
    const key = this.storageKey();
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.calibrator.loadRanges(data);
      // Eski (v0.1.x) kayıtlarda bu alan yok: zorunlu kalibrasyon bir kez yapılır.
      this.calibratedFlag = data?.calibrated === true;
      this.flipX = data?.flipX === true;
    } catch {
      /* bozuk kayıt ya da depolama yok: tohum değerlerle devam */
    }
  }

  private saveCalibration(force = false): void {
    if (!this.dirty) return;
    const now = performance.now();
    if (!force && now - this.lastSave < SAVE_INTERVAL) return;
    const key = this.storageKey();
    if (!key) return;
    const { left, right, up, down } = this.calibrator.profile;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          left, right, up, down,
          calibrated: this.calibratedFlag,
          flipX: this.flipX,
        })
      );
      this.lastSave = now;
      this.dirty = false;
    } catch {
      /* kota dolu / gizli mod: sessizce geç */
    }
  }

  /**
   * Telefon yan çevrilince göz menzili değişir (ekranın görme açısı farklı).
   * Her yön için ayrı profil tutulur: eskisini kendi anahtarına yaz, yenisini yükle.
   */
  private onOrientationChange = (): void => {
    const next = readOrientation();
    if (next === this.currentOrientation) return;
    this.saveCalibration(true); // hâlâ eski yönün anahtarına yazar
    this.currentOrientation = next;
    this.calibrator.reset();
    this.calibratedFlag = false;
    this.flipX = false;
    this.loadCalibration();
    this.recenter();
    this.emit("orientationchange", {
      orientation: next,
      calibrated: this.calibratedFlag,
    });
  };

  private watchOrientation(): void {
    try {
      this.orientationMql = matchMedia("(orientation: portrait)");
      this.orientationMql.addEventListener("change", this.onOrientationChange);
    } catch {
      this.orientationMql = null;
    }
  }

  private unwatchOrientation(): void {
    this.orientationMql?.removeEventListener("change", this.onOrientationChange);
    this.orientationMql = null;
  }

  // --- döngü ---

  private loop = (): void => {
    if (!this._running || !this.landmarker || !this.video) return;
    this.rafId = requestAnimationFrame(this.loop);

    if (this.video.readyState < 2) return;

    // MediaPipe kesin artan zaman damgası ister.
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;

    let result: FaceLandmarkerResult;
    try {
      result = this.landmarker.detectForVideo(this.video, ts);
    } catch {
      return;
    }

    const bsList = result.faceBlendshapes;
    if (!bsList || bsList.length === 0) {
      if (this.hadFace) {
        this.hadFace = false;
        this.lostAt = ts;
        this.emit("facelost", undefined);
      }
      this.emit("gaze", {
        timestamp: ts,
        hasFace: false,
        gaze: { x: 0, y: 0 },
        raw: { x: 0, y: 0 },
        confidence: 0,
      });
      return;
    }

    if (!this.hadFace) {
      this.hadFace = true;
      // Uzun kayıp: kullanıcı muhtemelen yer değiştirdi, merkezi yeniden öğren.
      if (this.lostAt >= 0 && ts - this.lostAt > RECENTER_AFTER_LOST) {
        this.recenter();
      }
      this.emit("facefound", undefined);
    }

    const blendshapes: Record<string, number> = {};
    for (const c of bsList[0].categories) {
      blendshapes[c.categoryName] = c.score;
    }

    let head: HeadPose | undefined;
    const mtx = result.facialTransformationMatrixes;
    if (mtx && mtx.length > 0) head = matrixToEuler(mtx[0].data);

    // Kırpma anında göz blendshape'leri "aşağı" tepe gibi görünür;
    // öğrenilirse aşağı menzili sahte şekilde şişer.
    const blink = Math.max(
      blendshapes.eyeBlinkLeft ?? 0,
      blendshapes.eyeBlinkRight ?? 0
    );
    const learn = !this.learningPaused && blink < BLINK_THRESHOLD;

    // input: kalibrasyon öncesi, ayna düzeltmesi öncesi sinyal (açık kalibrasyon bunu ölçer)
    const input = combineEyeHead(
      blendshapesToGaze(blendshapes),
      head,
      this.opts.headInfluence
    );
    const combined = this.flipX ? { x: -input.x, y: input.y } : input;
    const raw = this.calibrator.apply(combined, learn);
    const gaze = this.smoother.push(raw);

    if (learn) {
      this.dirty = true;
      this.saveCalibration();
    }

    this.emit("gaze", {
      timestamp: ts,
      hasFace: true,
      gaze,
      raw,
      input,
      blink,
      head,
      blendshapes,
      confidence: 1,
    });
  };
}

function readOrientation(): "portrait" | "landscape" {
  try {
    return matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
  } catch {
    return "landscape";
  }
}
