# GazeKit 👁️

[![Canlı Demo](https://img.shields.io/badge/👁️_Canlı_Demo-gazekit-6f42c1?style=for-the-badge&labelColor=1b1f23)](https://umutyaldiz.github.io/gazekit/)

[![npm](https://img.shields.io/npm/v/gazekit?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/gazekit)
[![CI](https://github.com/umutyaldiz/gazekit/actions/workflows/ci.yml/badge.svg)](https://github.com/umutyaldiz/gazekit/actions/workflows/ci.yml)
[![Pages](https://github.com/umutyaldiz/gazekit/actions/workflows/pages.yml/badge.svg)](https://github.com/umutyaldiz/gazekit/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Cihaz üstü** göz takibiyle web sitelerinde eller serbest gezinme.
Kullanıcının kamerasından yön kestirir; bir kenara bakınca o düğmenin halkası dolar
ve eylem tetiklenir (yukarı/aşağı kaydırma, geri/ileri).

- **Motor:** MediaPipe FaceLandmarker (WASM) — tüm modern tarayıcılarda çalışır.
- **Gizlilik:** Görüntü tamamen tarayıcıda işlenir, hiçbir yere gönderilmez.
- **Tek seferlik kalibrasyon:** İlk kullanımda ~10 saniyelik, 5 adımlı zorunlu
  kalibrasyon; cihaz başına kaydedilir. Sonrasında kullanırken kendini uyarlar;
  telefonda da laptopta da aynı ayarla kenarlara ulaşılır.
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

`gk.start()` kamerayı açar, modeli yükler; bu cihazda henüz kalibrasyon
yapılmadıysa kalibrasyon ekranı tamamlanana kadar bekler, sonra overlay'i
etkinleştirir. Kullanıcı kalibrasyondan vazgeçerse `start()` `AbortError` ile
reddedilir ve göz kontrolü açılmaz. `gk.stop()` takibi durdurur, `gk.destroy()`
kamerayı ve DOM'u serbest bırakır.

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
| `requireCalibration` | `true` | Göz kontrolü açılmadan önce 5 adımlı kalibrasyon zorunlu |
| `autoRange` | `true` | Her yönün bakış menzilini öğrenir; kazancı cihaza göre ayarlar |
| `autoCenter` | `true` | Nötr bakış noktasını öğrenip çıkarır |
| `persistCalibration` | `true` | Kalibrasyonu `localStorage`'a kaydeder; `false` ise her sayfa açılışında yeniden yapılır (string = anahtar öneki) |
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

## Kalibrasyon

Göz menzili cihaza ve kişiye göre çok değişir: telefonda ekran küçük bir açı
kapladığı için göz ~0.2 döner, laptopta ~0.5. Bu yüzden göz kontrolü ilk kez
açılırken **zorunlu bir kalibrasyon** yapılır.

### Adımlar
Ekranda sırayla beş nokta belirir: **merkez → yukarı → aşağı → sağ → sol**.
Her adım ~1.2 sn geçerli bakış ister; toplam ~10 saniye sürer.

Bir adım yalnızca şu koşullar sağlanınca geçilir; **atlama düğmesi yoktur**:
- Yüz kamerada görünüyor,
- bakış doğru yönde ve yeterince güçlü (çapraz ya da yarım bakış sayılmaz),
- bakış sabit (merkez adımında gözler gezinirse ölçüm kabul edilmez).

Kalibrasyon sırasında ekranda **canlı bir bakış noktası** gözünün nereye
gittiğini gösterir: yeşilse o an sayılıyor, sarıysa sayılmıyor (ipucu metni
nedenini söyler).

Kısa sapmalar (<200 ms) affedilir; daha uzun sapmalar ilerlemeyi sıfırlamaz,
kademeli geri alır. Böylece bakışı arada kaçan ama çoğunlukla hedefte tutan
kullanıcı da geçer, çoğunlukla başka yere bakan geçemez. Geçilmiş adımlar
korunur. Göz kırpmak ilerlemeyi yalnızca duraklatır. Aşağı bakınca göz kapağının
inmesi (ve doğal olarak düşük göz kapakları) kırpma sayılmaz; gözler tamamen
kapalıysa kare sayılmaz. Geçme eşiği cihazın ölçülen gürültüsüne göre ayarlanır
ve kaydedilen menziller gürültünün altında kalmaz; zayıf bakışlı kullanıcılar da
kalibre olur ama düz bakarken bölge kendiliğinden tetiklenmez. Adım uzun sürerse
ek yönlendirme çıkar. Kamera görüntüsü aynalıysa bu da algılanıp düzeltilir.

`showGazeDot: true` iken kalibrasyon ekranında ham ölçümler de (sapma, eşik,
çapraz sapma, kırpma skoru, kafa açısı) gösterilir; bir adımda takılan cihazı
teşhis etmek için.

"Vazgeç" (ya da Escape) kalibrasyonu tamamen iptal eder: hiçbir ölçüm
uygulanmaz ve göz kontrolü açılmaz. Sayfa, düğmeler üzerinden klavye/fare ile
kullanılabilir kalır.

### Ne zaman tekrarlanır
- Kalibrasyon cihaz başına ve **dikey/yatay yön için ayrı** kaydedilir. Telefon
  kullanım sırasında hiç kalibre edilmemiş yöne çevrilirse yeniden istenir.
- Overlay'deki **"Yeniden kalibre et"** düğmesiyle her an tekrarlanabilir.
  Yeniden kalibrasyondan vazgeçilirse önceki kalibrasyon geçerli kalır.

```ts
await gk.calibrate();           // kendi düğmen için: yeniden kalibre et
gk.tracker.isCalibrated;        // bu cihaz yönü için kalibre mi
gk.tracker.resetCalibration();  // kaydı sil (bir sonraki açılışta yine zorunlu)
gk.tracker.calibration;         // { cx, cy, up, down, left, right }
```

### Kalibrasyondan sonra
Kalibrasyon başlangıç noktasıdır; kullanım sırasında ince ayar sürer:
merkez yalnızca bakış nötre yakınken yavaşça güncellenir (bir kenara uzun bakmak
merkezi kaydırmaz), menziller her yön için ayrı uyarlanır, kırpmalar öğrenmeye
alınmaz. Kullanıcı yer değiştirirse (yüz kaybolup geri gelince) merkez
kendiliğinden yeniden oturur; elle tetiklemek için `gk.tracker.recenter()`.

Kütüphaneyi kendi akışında kullanıyorsan zorunluluğu `requireCalibration: false`
ile kapatabilirsin; o zaman yalnızca kullanım sırasındaki uyarlama çalışır.

## Kendi model/WASM barındırma
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
