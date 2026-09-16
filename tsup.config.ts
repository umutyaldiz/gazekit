import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // @mediapipe/tasks-vision runtime'da (ve CDN'den WASM/model) yüklenir; bundle etmiyoruz.
  external: ["@mediapipe/tasks-vision"],
});
