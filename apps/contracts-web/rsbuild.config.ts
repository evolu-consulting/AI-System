// PK-FR-10 · TF1 · cấu hình build contracts-web (plan-frontend §0, §1; D-18: route/proxy).
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

// Client gọi đường dẫn tương đối; dev/preview proxy cùng origin ⇒ cookie refresh `Path=/auth` chạy không cần CORS.
// `/auth` → admin-api (đăng nhập, refresh); `/pack` → hub-api (`/pack/contracts/*`, không trùng route SPA);
// `/notifications` → hub-api (N3 chuông; route SPA không dùng tiền tố này).
const ADMIN_API_URL = process.env.ADMIN_API_URL || "http://localhost:3001";
const HUB_URL = process.env.HUB_URL || "http://localhost:4000";

export const proxy = {
  "/auth": ADMIN_API_URL,
  // M1D · Thành viên & phòng ban: `/admin/org*`, `/admin/groups*` (route SPA không dùng tiền tố này).
  "/admin": ADMIN_API_URL,
  "/pack": HUB_URL,
  "/notifications": HUB_URL,
  // M2-chat · trợ lý: hội thoại (E6/E12 SSE) + dừng run (E15) của Agent Hub.
  "/conversations": HUB_URL,
  "/runs": HUB_URL,
};

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: { template: "./index.html", title: "Sổ Hợp Tác" },
  // Lazy compilation + autoCodeSplitting của router → chunk route thiếu module ("reading 'call'") ở dev.
  dev: { lazyCompilation: false },
  server: { port: 3300, strictPort: true, proxy },
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
    // TS1: e2e song song build vào thư mục riêng của từng cấu hình (E2E_DIST_DIR), không đè thư mục dist chung.
    distPath: { root: process.env.E2E_DIST_DIR || "dist" },
    // Mức tối thiểu Tailwind v4 hỗ trợ.
    overrideBrowserslist: ["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4"],
  },
});
