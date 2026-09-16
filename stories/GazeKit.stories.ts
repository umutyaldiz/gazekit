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
  autoRange: boolean;
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
        autoRange: args.autoRange,
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
      if (withReadout) attachReadout(root, handle);
    } catch (err) {
      startBtn.disabled = false;
      startBtn.textContent = "Tekrar dene";
      console.error(err);
    }
  });

  return root;
}

/**
 * Canlı bakış + öğrenilen kalibrasyon göstergesi. Gerçek cihazda
 * uyarlamalı kalibrasyonun nasıl oturduğunu görmek için.
 */
function attachReadout(root: HTMLElement, h: GazeKitHandle): void {
  const box = document.createElement("div");
  box.className = "gkd-readout";
  const text = document.createElement("pre");
  text.textContent = "bakış bekleniyor…";
  const actions = document.createElement("div");
  actions.className = "gkd-readout-actions";
  const recenter = document.createElement("button");
  recenter.type = "button";
  recenter.textContent = "Merkezle";
  recenter.addEventListener("click", () => h.tracker.recenter());
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Kalibrasyonu sıfırla";
  reset.addEventListener("click", () => h.tracker.resetCalibration());
  actions.append(recenter, reset);
  box.append(text, actions);
  root.appendChild(box);

  // 60 fps metin güncellemesi okunmaz; ~10 Hz yeterli.
  let last = 0;
  h.tracker.on("gaze", (s) => {
    if (s.timestamp - last < 100) return;
    last = s.timestamp;
    const c = h.tracker.calibration;
    const f = (n: number) => (n >= 0 ? " " : "") + n.toFixed(2);
    text.textContent =
      `yüz    : ${s.hasFace ? "var" : "yok"}\n` +
      `bakış  : x ${f(s.gaze.x)}  y ${f(s.gaze.y)}\n` +
      `merkez : (${f(c.cx)}, ${f(c.cy)})\n` +
      `menzil : ↑${c.up.toFixed(2)} ↓${c.down.toFixed(2)} ←${c.left.toFixed(2)} →${c.right.toFixed(2)}`;
  });
}

const meta: Meta<Args> = {
  title: "GazeKit/Göz ile Gezinme",
  argTypes: {
    dwellTime: { control: { type: "range", min: 300, max: 2000, step: 50 } },
    threshold: { control: { type: "range", min: 0.15, max: 0.7, step: 0.05 } },
    scrollSpeed: { control: { type: "range", min: 4, max: 40, step: 2 } },
    gain: {
      control: { type: "range", min: 1, max: 6, step: 0.2 },
      description: "Yalnızca autoRange kapalıyken kullanılır.",
    },
    headInfluence: { control: { type: "range", min: 0, max: 1, step: 0.1 } },
    autoCenter: { control: "boolean" },
    autoRange: { control: "boolean" },
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
    autoRange: true,
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
