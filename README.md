# GazeKit 👁️

Kalibrasyonsuz, **cihaz üstü** göz takibiyle web sitelerinde eller serbest gezinme.
Kullanıcının kamerasından yön kestirir; bir kenara bakınca o düğmenin halkası dolar
ve eylem tetiklenir (yukarı/aşağı kaydırma, geri/ileri).

- **Motor:** MediaPipe FaceLandmarker (WASM) — tüm modern tarayıcılarda çalışır.
- **Gizlilik:** Görüntü tamamen tarayıcıda işlenir, hiçbir yere gönderilmez.
- **Kalibrasyonsuz:** Göz blendshape'lerinden yön çıkarır; kurulum ekranı yok.
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
| `gain` | `2.4` | Göz sinyalini [-1,1]'e ölçekleyen kazanç (hassasiyet) |
| `smoothing` | `0.35` | EMA katsayısı; yüksek = daha tepkisel, düşük = daha yumuşak |
| `headInfluence` | `0` | Kafa pozunun bakışa katkısı (0–1); menzili artırır |
| `showGazeDot` | `false` | Canlı bakış noktasını göster |
| `zones` | hepsi açık | `{ up, down, back, forward }` |
| `scrollTarget` | `window` | Kaydırılacak `Window` veya `HTMLElement` |
| `labels` | Türkçe | Etiket ve durum metinleri |
| `theme` | — | CSS değişken override'ları, örn. `{ "--gk-accent": "#0a84ff" }` |

### Hassasiyet ayarı
Tetikleme çok kolay oluyorsa `threshold`'u yükselt veya `gain`'i düşür.
Tepki geç geliyorsa `dwellTime`'ı düşür, `smoothing`'i yükselt. Kafasını çok
oynatan kullanıcılar için `headInfluence: 0.3` menzili genişletir.

### Kendi model/WASM barındırma
CDN yerine kendi statiğine yönlendir:

```ts
createGazeKit({
  wasmBasePath: "/assets/mediapipe/wasm",
  modelAssetPath: "/assets/mediapipe/face_landmarker.task",
});
```

## Storybook

```bash
npm install
npm run storybook
```

Örnekler: yalnızca kaydırma, tam gezinme, hata ayıklama (canlı x/y), Playground.

## Tarayıcı desteği
WebGL2 + `getUserMedia` gerektirir. Chrome, Edge, Firefox, Safari (masaüstü ve
mobil) güncel sürümlerinde çalışır. HTTPS (veya `localhost`) zorunludur.

## Lisans
MIT
