// HUB-FR-72 · cấu hình build studio-web (plan-frontend D2, D3).
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

// Dev/preview proxy cùng origin → cookie refresh `ai_rt` không cần CORS.
// `/auth` → admin-api (như admin-web); `/studio/api` → Hub (prod: Hub serve cả `/studio/*` lẫn `/studio/api/*`).
const ADMIN_API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3001";
const HUB_URL = process.env.HUB_URL ?? "http://localhost:4020";

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: {
    template: "./index.html",
    title: "Agent Studio",
    favicon: "./public/brand/evoluconsulting-icon.svg",
  },
  // Lazy compilation + autoCodeSplitting của router → chunk route thiếu module ("reading 'call'") ở dev.
  dev: { lazyCompilation: false },
  server: {
    base: "/studio",
    port: 3200,
    strictPort: true,
    proxy: { "/auth": ADMIN_API_URL, "/studio/api": HUB_URL },
  },
  tools: {
    rspack: {
      plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true })],
      module: {
        rules: [
          {
            // Router đọc `React["use"]` (có ở React 19) và tự lùi khi React 18 không có;
            // Rspack 2 mặc định coi export vắng là lỗi → chỉ nới cho gói này.
            test: /[\\/]@tanstack[\\/]react-router[\\/]/,
            parser: { exportsPresence: false },
          },
        ],
      },
    },
  },
  output: {
    assetPrefix: "/studio/",
    // Mức tối thiểu Tailwind v4 hỗ trợ.
    overrideBrowserslist: ["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4"],
  },
});
