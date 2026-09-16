# GazeKit 👁️

[![Canlı Demo](https://img.shields.io/badge/👁️_Canlı_Demo-gazekit-6f42c1?style=for-the-badge&labelColor=1b1f23)](https://umutyaldiz.github.io/gazekit/)

[![npm](https://img.shields.io/npm/v/gazekit?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/gazekit)
[![CI](https://github.com/umutyaldiz/gazekit/actions/workflows/ci.yml/badge.svg)](https://github.com/umutyaldiz/gazekit/actions/workflows/ci.yml)
[![Pages](https://github.com/umutyaldiz/gazekit/actions/workflows/pages.yml/badge.svg)](https://github.com/umutyaldiz/gazekit/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Kalibrasyonsuz, **cihaz üstü** göz takibiyle web sitelerinde eller serbest gezinme.
Kullanıcının kamerasından yön kestirir; bir kenara bakınca o düğmenin halkası dolar
ve eylem tetiklenir (yukarı/aşağı kaydırma, geri/ileri).

- **Motor:** MediaPipe FaceLandmarker (WASM) — tüm modern tarayıcılarda çalışır.
- **Gizlilik:** Görüntü tamamen tarayıcıda işlenir, hiçbir yere gönderilmez.
- **Kalibrasyonsuz, uyarlamalı:** Kurulum ekranı yok. Kullanıcının göz menzilini
  kullanırken öğrenir; telefonda da laptopta da aynı ayarla kenarlara ulaşılır.
- **Erişilebilir:** Düğmeler gerçek `<button>` — klavye/fare ile de çalışır, ARIA
  etiketleri ve `aria-live` duyuruları var, `prefers-reduced-motion` desteklenir.
- **Framework-bağımsız:** Saf TypeScript. Blade, vanilla, React, Vue farketmez.

## Kurulum

```bash
npm install gazekit
```

`@mediapipe/tasks-vision` bağımlılığı otomatik gelir. WASM ve model dosyaları
varsayılan olarak CDN'den yüklenir (aşağıda kendi kopyana yönlendirme var).

## Hızlı başlangıç

```ts
import { createGazeKit } from "gazekit";

const gk = createGazeKit({
  dwellTime: 800,       // bir yöne bakınca tetiklenene kadar geçen süre (ms)
  scrollSpeed: 16,      // kare başına kaydırma (px)
  showGazeDot: true,    // hata ayıklama noktası
});

// Kamera izni kullanıcı etkileşimi sonrası istenmeli:
document.querySelector("#baslat")!.addEventListener("click", () => gk.start());
```

`gk.start()` kamerayı açar, modeli yükler ve overlay'i etkinleştirir.
`gk.stop()` takibi durdurur, `gk.destroy()` kamerayı ve DOM'u serbest bırakır.

## Ayrık kullanım

Overlay istemiyorsan yalnız veriyi al:

```ts
import { GazeTracker } from "gazekit";

const tracker = new GazeTracker({ smoothing: 0.35 });
tracker.on("gaze", (s) => {
  if (s.hasFace) console.log(s.gaze.x, s.gaze.y); // +x sağ, +y yukarı
});
await tracker.init();
tracker.start();
```

## Özel bölge

Hazır dört bölgeye ek olarak kendi eylemini bağla (bir kenarı geçersiz kılar):

```ts
createGazeKit({
  customZones: [
    {
      id: "menu",
      label: "Menüyü aç",
      announce: "Menü açıldı",
      position: "left",
      mode: "once",
      cooldown: 1500,
      onActivate: () => openMenu(),
    },
  ],
});
```

## React ile

```tsx
import { useEffect, useRef } from "react";
import { createGazeKit, type GazeKitHandle } from "gazekit";

export function useGazeKit(enabled: boolean) {
  const ref = useRef<GazeKitHandle | null>(null);
  useEffect(() => {
    if (!enabled) return;
    ref.current = createGazeKit({ dwellTime: 800 });
    ref.current.start();
    return () => ref.current?.destroy();
  }, [enabled]);
}
```

## Seçenekler

| Seçenek | Varsayılan | Açıklama |
|---|---|---|
| `dwellTime` | `900` | Tetikleme için gereken bakış süresi (ms) |
| `threshold` | `0.4` | Bir yönün "seçili" sayılması için eşik (0–1) |
| `scrollSpeed` | `16` | `hold` bölgelerinde kare başına kaydırma (px) |
| `autoRange` | `true` | Her yönün bakış menzilini öğrenir; kazancı cihaza göre ayarlar |
| `autoCenter` | `true` | Nötr bakış noktasını öğrenip çıkarır |
| `persistCalibration` | `true` | Öğrenilen menzili `localStorage`'a kaydeder (string = anahtar öneki) |
| `gain` | `2.4` | Sabit kazanç. **Yalnızca `autoRange: false` iken** kullanılır |
| `smoothing` | `0.35` | EMA katsayısı; yüksek = daha tepkisel, düşük = daha yumuşak |
| `headInfluence` | `0` | Kafa pozunun bakışa katkısı (0–1); menzili artırır |
| `showGazeDot` | `false` | Canlı bakış noktasını göster |
| `zones` | hepsi açık | `{ up, down, back, forward }` |
| `scrollTarget` | `window` | Kaydırılacak `Window` veya `HTMLElement` |
| `labels` | Türkçe | Etiket ve durum metinleri |
| `theme` | — | CSS değişken override'ları, örn. `{ "--gk-accent": "#0a84ff" }` |

### Hassasiyet ayarı
Tetikleme çok kolay oluyorsa `threshold`'u yükselt. Tepki geç geliyorsa
`dwellTime`'ı düşür, `smoothing`'i yükselt. Varsayılan `autoRange` açıkken
`gain` ile oynamana gerek yok; kazanç her cihaz için otomatik öğrenilir.

### Kalibrasyon nasıl çalışır
Göz menzili cihaza göre çok değişir: telefonda ekran küçük bir açı kapladığı
için göz ~0.2 döner, laptopta ~0.5. Sabit bir kazanç ikisinde birden doğru
olamaz. GazeKit bu yüzden kullanırken şunları öğrenir:

- **Merkez:** Başlat'tan sonraki ~1 sn içinde nötr bakış noktası oturur
  (telefona aşağı bakmak gibi ofsetler silinir). Sonra yalnızca bakış nötre
  yakınken yavaşça güncellenir; bir kenara uzun bakmak merkezi kaydırmaz.
- **Menzil:** Her yön (yukarı/aşağı/sağ/sol) ayrı öğrenilir, çünkü aşağı bakış
  göz kapağı yüzünden genelde daha zayıftır. Göz kırpmaları öğrenmeye alınmaz.
- **Kalıcılık:** Menzil cihaz başına kaydedilir; dikey ve yatay yön için ayrı
  profil tutulur. İkinci ziyarette ısınma gerekmez.

Kullanıcı oturuşunu değiştirirse merkez kendiliğinden yeniden oturur (yüz
kaybolup geri geldiğinde). Elle tetiklemek için:

```ts
gk.tracker.recenter();          // merkezi yeniden öğren, menzili koru
gk.tracker.resetCalibration();  // her şeyi ve kaydı sil
gk.tracker.calibration;         // { cx, cy, up, down, left, right }
```

### Kendi model/WASM barındırma
CDN yerine kendi statiğine yönlendir:

```ts
createGazeKit({
  wasmBasePath: "/assets/mediapipe/wasm",
  modelAssetPath: "/assets/mediapipe/face_landmarker.task",
});
```

## Demo

👉 **[umutyaldiz.github.io/gazekit](https://umutyaldiz.github.io/gazekit/)** — tarayıcıda,
kurulum yapmadan deneyin. Kamera izni istenecek; görüntü cihazınızdan dışarı çıkmaz.

Örnekler: yalnızca kaydırma, tam gezinme, hata ayıklama (canlı x/y), Playground.

Yerelde çalıştırmak için:

```bash
npm install
npm run storybook
```

## Tarayıcı desteği
WebGL2 + `getUserMedia` gerektirir. Chrome, Edge, Firefox, Safari (masaüstü ve
mobil) güncel sürümlerinde çalışır. HTTPS (veya `localhost`) zorunludur.

## Lisans
MIT
