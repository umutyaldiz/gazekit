import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { Emitter } from "./event-emitter.js";
import {
  blendshapesToGaze,
  composeGaze,
  EmaSmoother,
  matrixToEuler,
} from "./gaze-math.js";
import type { GazeSample, GazeTrackerOptions, HeadPose } from "./types.js";

const DEFAULT_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const DEFAULT_MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

interface TrackerEvents extends Record<string, unknown> {
  ready: void;
  gaze: GazeSample;
  facelost: void;
  facefound: void;
  error: Error;
}

/**
 * Kamerayı açar, MediaPipe FaceLandmarker'ı VIDEO modunda çalıştırır ve
 * her karede yön kestirimi (GazeSample) yayınlar. Tüm işlem cihaz üstünde;
 * hiçbir görüntü ağa gönderilmez.
 */
export class GazeTracker extends Emitter<TrackerEvents> {
  private opts: Required<
    Omit<GazeTrackerOptions, "video" | "cameraConstraints">
  > & {
    video?: HTMLVideoElement;
    cameraConstraints?: MediaTrackConstraints;
  };
  private landmarker: FaceLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private ownsVideo = false;
  private stream: MediaStream | null = null;
  private smoother: EmaSmoother;
  private rafId = 0;
  private lastTs = -1;
  private hadFace = false;
  private _running = false;

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
      cameraConstraints: options.cameraConstraints,
    };
    this.smoother = new EmaSmoother(this.opts.smoothing);
  }

  get running(): boolean {
    return this._running;
  }

  get videoElement(): HTMLVideoElement | null {
    return this.video;
  }

  /** Modeli ve kamerayı hazırlar. Kamera izni burada istenir. */
  async init(): Promise<void> {
    try {
      const fileset = await FilesetResolver.forVisionTasks(
        this.opts.wasmBasePath
      );
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: this.opts.modelAssetPath,
          delegate: this.opts.delegate,
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });

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
      this.emit("ready", undefined);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.emit("error", e);
      throw e;
    }
  }

  start(): void {
    if (this._running || !this.landmarker || !this.video) return;
    this._running = true;
    this.loop();
  }

  stop(): void {
    this._running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.smoother.reset();
  }

  /** Kamerayı ve modeli tamamen serbest bırakır. */
  destroy(): void {
    this.stop();
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
      this.emit("facefound", undefined);
    }

    const blendshapes: Record<string, number> = {};
    for (const c of bsList[0].categories) {
      blendshapes[c.categoryName] = c.score;
    }

    let head: HeadPose | undefined;
    const mtx = result.facialTransformationMatrixes;
    if (mtx && mtx.length > 0) head = matrixToEuler(mtx[0].data);

    const eye = blendshapesToGaze(blendshapes);
    const raw = composeGaze(
      eye,
      head,
      this.opts.gain,
      this.opts.headInfluence
    );
    const gaze = this.smoother.push(raw);

    this.emit("gaze", {
      timestamp: ts,
      hasFace: true,
      gaze,
      raw,
      head,
      blendshapes,
      confidence: 1,
    });
  };
}
