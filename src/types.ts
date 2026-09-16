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
  /** Kalibre edilmiş, yumuşatma öncesi bakış vektörü ([-1,1]). */
  raw: GazeVector;
  /** Kalibrasyon ve ayna düzeltmesi öncesi birleşik ham bakış (yüz varsa). */
  input?: GazeVector;
  /** İki gözün kırpma skorunun büyüğü 0..1 (yüz varsa). */
  blink?: number;
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
  /**
   * Sabit kazanç. YALNIZCA `autoRange: false` iken kullanılır.
   * `autoRange` açıkken yok sayılır: kazanç her cihaz için öğrenilir.
   * Varsayılan 2.4.
   */
  gain?: number;
  /** EMA yumuşatma katsayısı 0..1. Yüksek = daha tepkisel, az yumuşak. Varsayılan 0.35. */
  smoothing?: number;
  /** Kafa pozunun bakışa katkı ağırlığı 0..1. Varsayılan 0 (yalnız göz). */
  headInfluence?: number;
  /**
   * Nötr bakış noktasını otomatik izleyip çıkarır. Cihaz göz hizasının
   * altındayken (özellikle telefon) işaretçinin alt yarıda takılı kalmasını
   * önler. Varsayılan true.
   */
  autoCenter?: boolean;
  /**
   * Her yönün (sağ/sol/yukarı/aşağı) gerçek bakış menzilini öğrenip [-1,1]'e
   * normalize eder. Göz menzili telefon ile laptop arasında ~2.5 kat
   * değiştiği için sabit `gain` her cihazda doğru olamaz; bu seçenek aynı
   * ayarın her cihazda aynı davranmasını sağlar. Varsayılan true.
   */
  autoRange?: boolean;
  /**
   * Öğrenilen menzili localStorage'a kaydeder; sonraki ziyarette ısınma
   * gerekmez. Dikey/yatay yön için ayrı profil tutulur. string verilirse
   * anahtar öneki olarak kullanılır. Varsayılan true.
   */
  persistCalibration?: boolean | string;
  /**
   * @deprecated Yok sayılır. Merkez uyumu artık menzile oranla otomatik
   * ayarlanıyor (bkz. `autoRange`).
   */
  autoCenterRate?: number;
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
  /** Overlay'deki yeniden kalibrasyon düğmesi. */
  recalibrate: string;
  /** Kalibrasyon yapılmadan göz kontrolü açılamadığında durum metni. */
  calibrationRequired: string;
  /** Kalibrasyon ekranı. `{n}` ve `{total}` yer tutucudur. */
  calibTitle: string;
  calibStep: string;
  calibCenter: string;
  calibUp: string;
  calibDown: string;
  calibLeft: string;
  calibRight: string;
  calibHold: string;
  calibNoFace: string;
  calibWeak: string;
  calibWrongDir: string;
  calibUnstable: string;
  calibStruggle: string;
  calibDone: string;
  calibCancel: string;
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
  /**
   * Göz kontrolü açılmadan önce adım adım kalibrasyon zorunlu. Cihaz yönü
   * başına bir kez yapılır ve kaydedilir; overlay'deki düğmeyle tekrarlanır.
   * Varsayılan true.
   */
  requireCalibration?: boolean;
}
