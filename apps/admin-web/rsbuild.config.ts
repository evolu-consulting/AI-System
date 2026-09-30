// ADM-NFR-06 · cấu hình build admin-web (plan-frontend M0 §3).
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: {
    // Rsbuild không có option `lang` → template riêng đặt `<html lang="vi">`.
    template: "./index.html",
    title: "Admin Console",
    favicon: "./public/brand/evoluconsulting-icon.svg",
  },
  server: { port: 3000, strictPort: true },
  output: {
    // Mức tối thiểu Tailwind v4 hỗ trợ.
    overrideBrowserslist: ["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4"],
  },
});
