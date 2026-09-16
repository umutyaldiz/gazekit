import type { Meta, StoryObj } from "@storybook/html-vite";
import { createGazeKit, type GazeKitHandle } from "../src/index.js";
import "./demo.css";

// Storybook html renderer'ında render arası temizlik için tek örnek tutuyoruz.
let handle: GazeKitHandle | null = null;
function teardown(): void {
  handle?.destroy();
  handle = null;
}

interface Args {
  dwellTime: number;
  threshold: number;
  scrollSpeed: number;
  gain: number;
  headInfluence: number;
  autoCenter: boolean;
  showGazeDot: boolean;
  enableBack: boolean;
  enableForward: boolean;
}

const LOREM = [
  "GazeKit, kullanıcının kamerasını kullanarak göz yönünü kestirir ve bir kenara baktığınızda o düğmenin halkasını doldurur. Halka dolunca eylem tetiklenir.",
  "Yukarı bakın: sayfa yukarı kayar. Aşağı bakın: sayfa aşağı kayar. Bu bölgeler basılı-tut mantığıyla, baktığınız sürece kaydırmaya devam eder.",
  "Sola bakınca tarayıcıda geri, sağa bakınca ileri gidilir. Bu bölgeler tek-seferliktir; tekrar tetiklemek için bakışı bölgeden çıkarıp geri getirin.",
  "Tüm işlem cihaz üstünde (MediaPipe WASM) çalışır; hiçbir görüntü sunucuya gönderilmez. Kalibrasyon gerektirmez.",
  "Düğmeler gerçek <button> öğeleridir: klavye (Tab + Enter) ve fare ile de çalışır. Böylece göz takibi mümkün olmasa bile arayüz erişilebilir kalır.",
];

function buildDemo(
  args: Args,
  overrides: Partial<Parameters<typeof createGazeKit>[0]> = {},
  withReadout = false
): HTMLElement {
  teardown();

  const root = document.createElement("div");
  root.className = "gkd";
  const wrap = document.createElement("div");
  wrap.className = "gkd-wrap";
  root.appendChild(wrap);

  wrap.innerHTML = `
    <h1>GazeKit demo</h1>
    <p class="gkd-lede">Başlat'a basıp kamera iznini verin. Sonra ekranın
      kenarlarına bakarak sayfada gezinin.</p>
    <button class="gkd-start" type="button">Başlat</button>
    <p class="gkd-note">Kamera izni tarayıcı tarafından, kullanıcı etkileşimi
      sonrası istenir. Sağ üstteki düğmeden göz kontrolünü kapatabilirsiniz.</p>
  `;
  LOREM.forEach((t) => {
    const s = document.createElement("p");
    s.className = "gkd-section";
    s.textContent = t;
    wrap.appendChild(s);
  });
  // kaydırmayı görebilmek için sayfayı uzat
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("p");
    s.className = "gkd-section";
    s.textContent = `Bölüm ${i + 1}. ` + LOREM[i % LOREM.length];
    wrap.appendChild(s);
  }

  const startBtn = wrap.querySelector<HTMLButtonElement>(".gkd-start")!;
  startBtn.addEventListener("click", async () => {
    startBtn.disabled = true;
    startBtn.textContent = "Yükleniyor…";
    try {
      handle = createGazeKit({
        dwellTime: args.dwellTime,
        threshold: args.threshold,
        scrollSpeed: args.scrollSpeed,
        gain: args.gain,
        headInfluence: args.headInfluence,
        autoCenter: args.autoCenter,
        showGazeDot: args.showGazeDot,
        zones: {
          up: true,
          down: true,
          back: args.enableBack,
          forward: args.enableForward,
        },
        onAction: (zone) => console.log("[gazekit] action:", zone.id),
        ...overrides,
      });
      await handle.start();
      startBtn.textContent = "Çalışıyor";
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = "Tekrar dene";
      console.error(err);
    }
  });

  if (withReadout) {
    const readout = document.createElement("div");
    readout.className = "gkd-readout";
    readout.textContent = "bakış bekleniyor…";
    root.appendChild(readout);
    const iv = setInterval(() => {
      if (!handle) return;
      handle.tracker.on("gaze", (s) => {
        readout.textContent =
          `yüz: ${s.hasFace ? "var" : "yok"}\n` +
          `x: ${s.gaze.x.toFixed(2)}  y: ${s.gaze.y.toFixed(2)}`;
      });
      clearInterval(iv);
    }, 300);
  }

  return root;
}

const meta: Meta<Args> = {
  title: "GazeKit/Göz ile Gezinme",
  argTypes: {
    dwellTime: { control: { type: "range", min: 300, max: 2000, step: 50 } },
    threshold: { control: { type: "range", min: 0.15, max: 0.7, step: 0.05 } },
    scrollSpeed: { control: { type: "range", min: 4, max: 40, step: 2 } },
    gain: { control: { type: "range", min: 1, max: 6, step: 0.2 } },
    headInfluence: { control: { type: "range", min: 0, max: 1, step: 0.1 } },
    autoCenter: { control: "boolean" },
    showGazeDot: { control: "boolean" },
    enableBack: { control: "boolean" },
    enableForward: { control: "boolean" },
  },
  args: {
    dwellTime: 900,
    threshold: 0.4,
    scrollSpeed: 16,
    gain: 2.4,
    headInfluence: 0,
    autoCenter: true,
    showGazeDot: false,
    enableBack: true,
    enableForward: true,
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Yalnızca yukarı/aşağı kaydırma bölgeleri. */
export const YalnizKaydirma: Story = {
  name: "Yalnızca kaydırma",
  render: (args) =>
    buildDemo({ ...args, enableBack: false, enableForward: false }),
};

/** Kaydırma + geri/ileri gezinme. */
export const TamGezinme: Story = {
  name: "Tam gezinme",
  render: (args) => buildDemo(args),
};

/** Canlı bakış noktası ve x/y okuması ile hata ayıklama. */
export const HataAyiklama: Story = {
  name: "Hata ayıklama",
  args: { showGazeDot: true },
  render: (args) => buildDemo({ ...args, showGazeDot: true }, {}, true),
};

/** Tüm parametreleri Controls panelinden ayarla. */
export const Playground: Story = {
  render: (args) => buildDemo(args),
};

/**
 * Telefon icin on ayar. Cihaz goz hizasinin altinda tutuldugu ve ekran kucuk
 * bir gorme acisi kapladigi icin goz donusu masaustune gore cok daha kucuk
 * kalir; bu yuzden kazanc yuksek ve kafa katkisi acik.
 */
export const Mobil: Story = {
  name: "Mobil",
  args: {
    gain: 5,
    headInfluence: 0.4,
    threshold: 0.35,
    dwellTime: 1000,
    autoCenter: true,
    showGazeDot: true,
  },
  render: (args) => buildDemo(args, {}, true),
};
