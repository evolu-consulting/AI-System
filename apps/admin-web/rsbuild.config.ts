// ADM-NFR-06 · cấu hình build admin-web (plan-frontend M0 §3).
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

// Backend admin-api: dev server và preview proxy `/auth`, `/admin` (cùng origin → cookie refresh không cần CORS).
const ADMIN_API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3001";

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: {
    // Rsbuild không có option `lang` → template riêng đặt `<html lang="vi">`.
    template: "./index.html",
    title: "Admin Console",
    favicon: "./public/brand/evoluconsulting-icon.svg",
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: { "/auth": ADMIN_API_URL, "/admin": ADMIN_API_URL },
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
    // Mức tối thiểu Tailwind v4 hỗ trợ.
    overrideBrowserslist: ["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4"],
  },
});
