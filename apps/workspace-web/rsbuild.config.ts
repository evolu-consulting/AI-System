// PK-FR-10 · TF1 · cấu hình build contracts-web (plan-frontend §0, §1; D-18: route/proxy).
import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import { pluginReact } from "@rsbuild/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/rspack";

// Client gọi đường dẫn tương đối; dev/preview proxy cùng origin ⇒ cookie refresh `Path=/auth` chạy không cần CORS.
// `/auth` → admin-api (đăng nhập, refresh); `/pack` → hub-api (`/pack/contracts/*`, không trùng route SPA);
// `/notifications` → hub-api (N3 chuông; route SPA không dùng tiền tố này).
const ADMIN_API_URL = process.env.ADMIN_API_URL || "http://localhost:3001";
const HUB_URL = process.env.HUB_URL || "http://localhost:4000";

// gap-c #13: `/notifications` vừa là API vừa là route SPA (trang "Tất cả thông báo") ⇒ tải trang bằng trình duyệt
// (GET, Accept text/html) phải nhận index.html chứ không chuyển sang hub-api.
const spaNavigation = {
  target: HUB_URL,
  bypass: (req: { method?: string; headers: Record<string, string | string[] | undefined> }) =>
    req.method === "GET" && String(req.headers.accept ?? "").includes("text/html")
      ? "/index.html"
      : null,
};

export const proxy = {
  "/auth": ADMIN_API_URL,
  // M1D · Thành viên & phòng ban: `/admin/org*`, `/admin/groups*` (route SPA không dùng tiền tố này).
  "/admin": ADMIN_API_URL,
  "/pack": HUB_URL,
  // CR-125 · cr125-manual-start-ui · «Tạo yêu cầu»: phiếu bắt đầu quy trình, tải tệp đính kèm, việc chờ tôi + quyết định (route SPA không dùng các tiền tố này).
  "/processes": HUB_URL,
  "/attachments": HUB_URL,
  "/review-tasks": HUB_URL,
  "/me/review-tasks": HUB_URL,
  // CR-127 · E3 · uỷ quyền của tôi (`/me/delegations`); `/tenants/:tid/delegations` đã đi qua `/tenants`.
  "/me/delegations": HUB_URL,
  // CR-118 §11.2 · tenant_admin sửa luật chọn quy trình + đọc năng lực của công ty mình (`/hub-admin/tenants/:tid/…`).
  "/hub-admin": HUB_URL,
  "/tenants": HUB_URL,
  // CR-118 N3: SSE `/me/stream` (config.changed) của hub; route SPA không dùng tiền tố này.
  "/me/stream": HUB_URL,
  "/notifications": spaNavigation,
  // M2-chat · trợ lý: hội thoại (E6/E12 SSE) + dừng run (E15) của Agent Hub.
  "/conversations": HUB_URL,
  "/runs": HUB_URL,
};

export default defineConfig({
  plugins: [
    pluginReact(),
    // CR-118 N1: React Compiler 1.0 (bản Babel) chỉ cho code của app; React 19 ⇒ không cần react-compiler-runtime.
    pluginBabel({
      include: /\.(?:jsx|tsx)$/,
      exclude: /[\\/]node_modules[\\/]/,
      babelLoaderOptions(opts) {
        opts.plugins?.unshift("babel-plugin-react-compiler");
      },
    }),
  ],
  source: {
    entry: { index: "./src/main.tsx" },
    // CR-118: adapter mock của module Community (dev/e2e không backend) chỉ có trong bản dựng khi PUBLIC_COMMUNITY_API=mock;
    // hằng lúc build ⇒ nhánh `import("./mock")` bị bỏ hẳn khỏi bản production.
    define: { __COMMUNITY_MOCK__: JSON.stringify(process.env.PUBLIC_COMMUNITY_API === "mock") },
  },
  html: { template: "./index.html", title: "Sổ Hợp Tác" },
  // Lazy compilation + autoCodeSplitting của router → chunk route thiếu module ("reading 'call'") ở dev.
  dev: { lazyCompilation: false },
  server: { port: 3300, strictPort: true, proxy },
  tools: {
    rspack: {
      // CR-106: xyflow (canvas chỉ đọc, lazy) gom vào một chunk tên `canvas-*` để có ngân sách riêng ở check:bundle.
      optimization: {
        splitChunks: {
          cacheGroups: {
            xyflow: {
              test: /[\\/]node_modules[\\/](@xyflow|d3-[a-z-]+|zustand|classcat)[\\/]/,
              name: "canvas-xyflow",
              chunks: "async",
              enforce: true,
            },
            // CR-118 bundle: React Compiler làm chunk route chi tiết HĐ > 50 KB gz ⇒ tách phần duyệt/mốc/ký số/phiên bản ra chunk song song (tải cùng lúc, không đổi thời điểm render).
            contractDetailParts: {
              test: /[\\/]src[\\/]features[\\/](contract-approval|contract-milestones|contract-esign|contract-versions)[\\/]/,
              name: "contract-detail-parts",
              chunks: "async",
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
