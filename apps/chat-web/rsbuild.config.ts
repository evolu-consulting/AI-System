// C1 FE · cấu hình build chat-web (plan-frontend §0 D4, D5, D9).
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

// Hub (hoặc mock) và dịch vụ đăng nhập: client gọi đường dẫn tương đối, dev/preview proxy cùng origin
// → cookie refresh `SameSite=Strict` chạy không cần CORS. `AUTH_URL` trống = `HUB_URL`.
const HUB_URL = process.env.HUB_URL || "http://localhost:4020";
const AUTH_URL = process.env.AUTH_URL || HUB_URL;

// `/rooms/:id`, `/directory`, `/me` vừa là API vừa là route SPA (`/rooms/$id`): tải trang bằng trình duyệt
// (GET, Accept text/html) phải nhận index.html chứ không được chuyển sang Hub.
const spaNavigation = {
  target: HUB_URL,
  bypass: (req: { method?: string; headers: Record<string, string | string[] | undefined> }) =>
    req.method === "GET" && String(req.headers.accept ?? "").includes("text/html")
      ? "/index.html"
      : null,
};

const proxy = {
  "/auth": AUTH_URL,
  "/conversations": HUB_URL,
  "/runs": HUB_URL,
  "/agents": HUB_URL,
  "/commands": HUB_URL,
  "/attachments": HUB_URL,
  "/directory": spaNavigation,
  "/rooms": spaNavigation,
  "/me": spaNavigation,
  "/health": HUB_URL,
};

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { index: "./src/main.tsx" } },
  html: {
    template: "./index.html",
    title: "Evolu Copilot",
    favicon: "./public/brand/evoluconsulting-icon.svg",
  },
  // Lazy compilation + autoCodeSplitting của router → chunk route thiếu module ("reading 'call'") ở dev.
  dev: { lazyCompilation: false },
  server: { port: 3100, strictPort: true, proxy },
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
