import type { StorybookConfig } from "@storybook/html-vite";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.@(ts|js)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/html-vite",
    options: {},
  },
  // GitHub Pages'te alt dizinden (/gazekit/) servis edildiği için
  // asset yolları göreli olmalı.
  viteFinal: async (cfg) => {
    cfg.base = "./";
    return cfg;
  },
};

export default config;
