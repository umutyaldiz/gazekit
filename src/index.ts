import { GazeTracker } from "./GazeTracker.js";
import { GazeNavigator } from "./GazeNavigator.js";
import type { GazeNavigatorOptions, GazeTrackerOptions } from "./types.js";

export { GazeTracker } from "./GazeTracker.js";
export { GazeNavigator } from "./GazeNavigator.js";
export { GazeCalibration } from "./GazeCalibration.js";
export type { GazeCalibrationOptions } from "./GazeCalibration.js";
export {
  CalibrationSession,
  CALIBRATION_STEPS,
  MIN_DEFLECTION,
} from "./calibration-core.js";
export type {
  CalibrationFrame,
  CalibrationIssue,
  CalibrationResult,
  CalibrationState,
  CalibrationStepId,
} from "./calibration-core.js";
export * from "./types.js";
export {
  AdaptiveCalibrator,
  blendshapesToGaze,
  CenterTracker,
  combineEyeHead,
  defaultRangeSeed,
  matrixToEuler,
  composeGaze,
  EmaSmoother,
  clamp,
} from "./gaze-math.js";
export type {
  AdaptiveCalibratorOptions,
  CalibrationProfile,
} from "./gaze-math.js";

export interface GazeKitOptions
  extends GazeTrackerOptions,
    Omit<GazeNavigatorOptions, "tracker"> {
  /** init() sonrası otomatik başlat + navigator'ı enable et. Varsayılan true. */
  autoStart?: boolean;
}

export interface GazeKitHandle {
  tracker: GazeTracker;
  navigator: GazeNavigator;
  /**
   * Kamera+model hazırlar, (autoStart ise) takibi başlatır. Kalibrasyon
   * zorunluysa ve yapılmamışsa kalibrasyon ekranı tamamlanana kadar bekler;
   * kullanıcı vazgeçerse AbortError ile reddedilir.
   */
  start(): Promise<void>;
  /** Kalibrasyonu yeniden yapar (ör. kendi "yeniden kalibre et" düğmen için). */
  calibrate(): Promise<void>;
  /** Takibi durdurur ama kamerayı kapatmaz. */
  stop(): void;
  /** Her şeyi serbest bırakır. */
  destroy(): void;
}

/**
 * Tek çağrıda tracker + overlay kurar.
 *
 * @example
 * const gk = createGazeKit({ dwellTime: 800, showGazeDot: true });
 * await gk.start(); // kamera izni istenir
 */
export function createGazeKit(options: GazeKitOptions = {}): GazeKitHandle {
  const {
    autoStart = true,
    // tracker opsiyonları
    video, wasmBasePath, modelAssetPath, delegate,
    gain, smoothing, headInfluence, cameraConstraints,
    autoCenter, autoRange, persistCalibration, autoCenterRate,
    // navigator opsiyonları geri kalanı
    ...navOptions
  } = options;

  const tracker = new GazeTracker({
    video, wasmBasePath, modelAssetPath, delegate,
    gain, smoothing, headInfluence, cameraConstraints,
    autoCenter, autoRange, persistCalibration, autoCenterRate,
  });
  const navigator = new GazeNavigator({ ...navOptions, tracker });

  return {
    tracker,
    navigator,
    async start() {
      await tracker.init();
      tracker.start();
      if (!autoStart) return;
      if (navOptions.requireCalibration !== false && !tracker.isCalibrated) {
        await navigator.calibrate(); // tamamlanınca navigator kendini açar
      } else {
        navigator.enable();
      }
    },
    calibrate() {
      return navigator.calibrate();
    },
    stop() {
      tracker.stop();
      navigator.disable();
    },
    destroy() {
      navigator.destroy();
      tracker.destroy();
    },
  };
}
