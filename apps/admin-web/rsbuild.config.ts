// ADM-NFR-06 · cấu hình build admin-web (plan-frontend M0 §3).
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

// Backend admin-api: dev server và preview proxy `/auth`, `/admin` (cùng origin → cookie refresh không cần CORS).
const ADMIN_API_URL = process.env.ADMIN_API_URL ?? "http://localhost:3001";
const HUB_URL = process.env.HUB_URL || "http://localhost:4020";

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: {
    // Rsbuild không có option `lang` → template riêng đặt `<html lang="vi">`.
    template: "./index.html",
    title: "Evolu Control",
    favicon: "./public/brand/evoluconsulting-icon.svg",
  },
  // Lazy compilation + autoCodeSplitting của router → chunk route thiếu module ("reading 'call'") ở dev.
  dev: { lazyCompilation: false },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      "/auth": ADMIN_API_URL,
      "/admin": ADMIN_API_URL,
      // gap-c #35: chuông thông báo dùng chung gọi /notifications của hub-api.
      "/notifications": HUB_URL,
    },
  },
  tools: {
    rspack: {
      optimization: {
        splitChunks: {
          cacheGroups: {
            // ADR-0013 #2: xyflow + phụ thuộc gom vào chunk async tên `canvas-vendor` (chỉ nạp cùng chunk `canvas`),
            // ngân sách riêng 80 KB ở scripts/check-bundle.ts; không lọt vào bundle tải ban đầu.
            canvasVendor: {
              test: /node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?(?:@xyflow|classcat|zustand)[\\/]/,
              name: "canvas-vendor",
              chunks: "async",
              priority: 40,
              enforce: true,
            },
          },
        },
      },
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
    // TS1: e2e song song build vào thư mục riêng của từng cấu hình (E2E_DIST_DIR), không đè thư mục dist chung.
    distPath: { root: process.env.E2E_DIST_DIR || "dist" },
    // Mức tối thiểu Tailwind v4 hỗ trợ.
    overrideBrowserslist: ["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4"],
  },
});
