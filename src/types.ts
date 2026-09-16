/** Normalize edilmiş bakış vektörü. +x = sağ, +y = yukarı (yaklaşık [-1, 1]). */
export interface GazeVector {
  x: number;
  y: number;
}

/** Kafa pozu (radyan). Yaklaşıktır; ileri seviye ayar için sample içinde sunulur. */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/** GazeTracker'ın her karede yaydığı örnek. */
export interface GazeSample {
  timestamp: number;
  /** Bu karede yüz tespit edildi mi. */
  hasFace: boolean;
  /** Yumuşatılmış (smoothed) bakış vektörü. */
  gaze: GazeVector;
  /** Ham (yumuşatma öncesi) bakış vektörü. */
  raw: GazeVector;
  head?: HeadPose;
  /** MediaPipe blendshape skorları (categoryName -> 0..1). */
  blendshapes?: Record<string, number>;
  /** 0..1 arası güven; yüz yoksa 0. */
  confidence: number;
}

export type ZoneMode = "hold" | "once";
export type ZonePosition = "top" | "bottom" | "left" | "right";
export type ZoneId = "up" | "down" | "left" | "right" | (string & {});

export interface ZoneActionContext {
  zone: ZoneDefinition;
  sample: GazeSample;
  /** Bölge kaç ms'dir aktif. */
  heldFor: number;
  navigator: import("./GazeNavigator.js").GazeNavigator;
}

export interface ZoneDefinition {
  id: ZoneId;
  /** Ekranda ve ekran okuyucuda görünen etiket. */
  label: string;
  /** Ekran okuyucu duyurusu (aria-live). Verilmezse label kullanılır. */
  announce?: string;
  position: ZonePosition;
  /** "hold": dwell sonrası basılı gibi tekrar (scroll). "once": dwell sonunda bir kez. */
  mode: ZoneMode;
  onActivate: (ctx: ZoneActionContext) => void;
  /** "hold" modunda basılı tutuldukça her karede çağrılır. */
  onHold?: (ctx: ZoneActionContext) => void;
  /** İnline SVG ikon (opsiyonel; verilmezse yöne göre varsayılan ok). */
  icon?: string;
  /** "once" modunda tekrar tetiklenme arası minimum süre (ms). */
  cooldown?: number;
}

export interface GazeTrackerOptions {
  /** Kendi <video> elemanını verebilirsin; verilmezse gizli bir tane oluşturulur. */
  video?: HTMLVideoElement;
  /** MediaPipe WASM dosyalarının kök yolu (CDN varsayılan). */
  wasmBasePath?: string;
  /** face_landmarker.task model yolu (CDN varsayılan). */
  modelAssetPath?: string;
  /** GPU tercih; başarısız olursa CPU'ya düşer. */
  delegate?: "GPU" | "CPU";
  /** Göz sinyalini [-1,1] aralığına ölçekleyen kazanç. Varsayılan 2.4. */
  gain?: number;
  /** EMA yumuşatma katsayısı 0..1. Yüksek = daha tepkisel, az yumuşak. Varsayılan 0.35. */
  smoothing?: number;
  /** Kafa pozunun bakışa katkı ağırlığı 0..1. Varsayılan 0 (yalnız göz). */
  headInfluence?: number;
  /** getUserMedia video kısıtları. */
  cameraConstraints?: MediaTrackConstraints;
}

export interface GazeLabels {
  up: string;
  down: string;
  back: string;
  forward: string;
  /** Durum çipi metinleri. */
  statusOn: string;
  statusSearching: string;
  statusOff: string;
  /** Ana aç/kapa düğmesi. */
  toggleOn: string;
  toggleOff: string;
  cameraDenied: string;
}

export interface GazeNavigatorOptions {
  tracker: import("./GazeTracker.js").GazeTracker;
  /** Overlay'in ekleneceği kök. Varsayılan document.body. */
  root?: HTMLElement;
  /** Hangi hazır bölgeler etkin. Varsayılan hepsi. */
  zones?: {
    up?: boolean;
    down?: boolean;
    back?: boolean;
    forward?: boolean;
  };
  /** Hazır bölgelere ek özel bölgeler. */
  customZones?: ZoneDefinition[];
  /** Bir bölgeyi tetiklemek için gereken bakış süresi (ms). Varsayılan 900. */
  dwellTime?: number;
  /** Bir yönün "seçili" sayılması için eşik 0..1. Varsayılan 0.4. */
  threshold?: number;
  /** hold modunda kare başına kaydırma miktarı (px). Varsayılan 16. */
  scrollSpeed?: number;
  /** Kaydırılacak eleman/pencere. Varsayılan window. */
  scrollTarget?: Window | HTMLElement;
  /** Hata ayıklama: canlı bakış noktasını göster. Varsayılan false. */
  showGazeDot?: boolean;
  /** Metin/etiketler (varsayılan Türkçe). */
  labels?: Partial<GazeLabels>;
  /** Bir eylem tetiklendiğinde geri çağrı. */
  onAction?: (zone: ZoneDefinition, ctx: ZoneActionContext) => void;
  /** Tema için CSS değişken override'ları, örn. { "--gk-accent": "#0a84ff" }. */
  theme?: Record<string, string>;
}
