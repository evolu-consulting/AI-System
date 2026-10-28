// CR-102 · C5 · cấu hình build community-web. Dev: `PUBLIC_COMMUNITY_API=mock` (mặc định) chạy end-to-end không cần backend;
// `http` gọi `/pack/community/*` của hub-api (C3) qua proxy cùng origin.
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

const ADMIN_API_URL = process.env.ADMIN_API_URL || "http://localhost:3001";
const HUB_URL = process.env.HUB_URL || "http://localhost:4000";

export const proxy = {
  "/auth": ADMIN_API_URL,
  "/pack": HUB_URL,
  // C10b · Trợ lý giá (dock): hội thoại + SSE + dừng run của Agent Hub (route SPA dùng hash nên không trùng).
  "/conversations": HUB_URL,
  "/runs": HUB_URL,
};

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: { template: "./index.html", title: "Sổ Hợp Tác · Community" },
  server: { port: 3400, strictPort: true, proxy },
  output: {
    distPath: { root: process.env.E2E_DIST_DIR || "dist" },
    overrideBrowserslist: ["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4"],
  },
});
