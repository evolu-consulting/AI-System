# Plan · M0-bootstrap · Frontend (frontend-lead)

Chế độ PLAN · 2026-10-01 · Bổ sung cho `spec.md` §5 và `plan.md` (backend-lead sở hữu hai file đó — file này **không** sửa chúng).
Nguồn: `CONVENTIONS.md` §2, §4, §6 · `adr/0001-stack.md` · `design/admin/ui-admin.md` §5, §14, §15 · canvas đã duyệt hướng (token dưới đây) · `spec.md` M0 (cổng, scope `@ai/*`, T-I18N-1, T-SIZE-3, T-DEP-5/6, AC07, AC16).
Chỉ dùng API đã thấy trong tài liệu chính thức; mọi tên export ghi "xác minh khi cài" phải Grep trong `node_modules/**/*.d.ts` trước khi dùng.
Vá readiness lần 1 (`readiness.md`, 2026-10-01): #8 (§3 tsconfig), #9 (§3 package.json admin-web + `packages/i18n`), #10 (§3 `i18n.ts`), #16 (§3 `check-bundle.ts`, §6). Linker Bun `isolated` (plan.md R8) → mỗi workspace tự khai mọi dep nó import/chạy, kể cả `typescript`, `@types/bun`, `@ai/config`.

## 1. Phạm vi

**Làm:**
- Scaffold `apps/admin-web` (`@ai/admin-web`): Rsbuild + React 18 + TypeScript strict + Tailwind v4 + shadcn/ui (init, chưa add component) + TanStack Router (file-based, tách chunk tự động) + TanStack Query + react-i18next (khung vi/en).
- `packages/i18n` (`@ai/i18n`): `locales/vi.json`, `locales/en.json` — đúng đường dẫn mà `bun run i18n:check` của backend-lead đọc (spec T-I18N-1).
- Theme: bảng token canvas → CSS variable shadcn trong `src/styles/globals.css` (`:root`, `.dark`, `@theme inline`).
- Trang tạm `/`: logo ngang + H1 "Admin Console" + một dòng mô tả qua i18n — chỉ để kiểm toolchain.
- Logo: chép 3 file từ `D:\AI\logo\` vào `apps/admin-web/public/brand/`; icon làm favicon.
- Playwright: `playwright.config.ts` ở gốc repo + mô tả e2e smoke cho qc viết `e2e/smoke.spec.ts`.
- Script đo ngân sách bundle `check:bundle`.

**Không làm:** app shell/sidebar/topbar (M1), gọi API, `src/lib/http.ts` (M1), auth, dark mode toggle UI (token dark có sẵn, chưa có nút), component shadcn cụ thể (thêm theo mốc dùng tới), devtools TanStack.

## 2. Phiên bản — tra bằng `npm view <pkg> version` ngày 2026-10-01

| Package | Phiên bản | Đặt ở | Ghi chú |
|---|---|---|---|
| `@rsbuild/core` | 2.2.11 | admin-web dev | |
| `@rsbuild/plugin-react` | 2.1.1 | admin-web dev | peer `@rsbuild/core ^2.0.0` ✓ |
| `react` / `react-dom` | 18.3.1 | admin-web | ADR-0001 chốt React 18 (latest là 19.3.0 — **không** dùng) |
| `@types/react` / `@types/react-dom` | 18.3.31 / 18.3.7 | admin-web dev | nhánh 18 |
| `typescript` | **6.0.3** | gốc (backend-lead) | latest là 7.0.2; ghim 6.0.3 cho cả monorepo vì dependency-cruiser 18.5.0 chỉ nhận `>=2 <7` (ADR-0003). Peer của i18next/react-i18next `^5 \|\| ^6 \|\| ^7` ✓ |
| `tailwindcss` / `@tailwindcss/postcss` | 4.3.3 / 4.3.3 | admin-web dev | Tailwind v4: cấu hình bằng CSS, không có `tailwind.config.js` |
| `postcss` | 8.5.28 | admin-web dev | Rsbuild tự nạp `postcss.config.mjs` |
| `shadcn` (CLI) | 4.21.0 | chạy bằng `bunx`, không cài | engines node ≥ 20.18.1 |
| `class-variance-authority` | 0.7.1 | admin-web | shadcn yêu cầu |
| `clsx` | 2.1.1 | admin-web | shadcn yêu cầu |
| `tailwind-merge` | 3.7.0 | admin-web | shadcn yêu cầu (bản 3 cho Tailwind v4) |
| `tw-animate-css` | 1.4.0 | admin-web | shadcn v4 thay `tailwindcss-animate` |
| `lucide-react` | 1.49.0 | admin-web | icon mặc định của shadcn; peer React 18 ✓ |
| `radix-ui` | 1.6.7 | admin-web | gói Radix hợp nhất mà shadcn hiện sinh; peer React 18 ✓. M0 chưa import (cài khi `shadcn add` đầu tiên ở M1) |
| `@tanstack/react-router` | 1.170.41 | admin-web | peer react ≥ 18 ✓; engines node ≥ 20.19 |
| `@tanstack/router-plugin` | 1.168.42 | admin-web dev | có export `./rspack`; peer `@rsbuild/core >=1.0.2 \|\| ^2.0.0` ✓ |
| `@tanstack/react-query` | 5.104.0 | admin-web | peer react ^18 ✓ |
| `i18next` | 26.4.2 | admin-web | |
| `react-i18next` | 17.0.15 | admin-web | peer `i18next >= 26.2.0` ✓ |
| `@fontsource/be-vietnam-pro` | 5.3.0 | admin-web | tự host font (không CDN, dev offline) |
| `@fontsource-variable/jetbrains-mono` | 5.3.0 | admin-web | mono variable |
| `@playwright/test` | 1.63.0 | gốc dev | `bunx playwright test` chạy ở gốc (CLAUDE.md) |
| `typescript` | 6.0.3 | admin-web dev, i18n dev | cùng bản gốc; khai lại từng workspace vì linker isolated (`tsc` trong script workspace) |
| `@types/bun` | 1.3.14 | admin-web dev, i18n dev | khớp Bun 1.3.14 (spec Câu hỏi 2) |
| `@ai/config` | `workspace:*` | admin-web dev, i18n dev | để Turbo thấy phụ thuộc và bỏ cache khi tsconfig chung đổi; `extends` dùng **đường dẫn tương đối** (theo r#2), không qua tên package |
| `@ai/i18n` | `workspace:*` | admin-web (dependencies) | `src/app/i18n.ts` import |

Tất cả ghim chính xác (không `^`), khoá bằng `bun.lock`. Đã ghi vào bảng phiên bản của `docs/adr/0001-stack.md` (2026-10-01).
Các gói đi kèm shadcn (cva, clsx, tailwind-merge, tw-animate-css, lucide-react, radix-ui) và font là phụ thuộc của lựa chọn đã Accepted (shadcn/ui, design canvas) → **không cần ADR mới**.

## 3. File sẽ tạo

| File | Tạo/Sửa | Symbol / component | Ghi chú |
|---|---|---|---|
| `apps/admin-web/package.json` | Tạo | — | `name: "@ai/admin-web"`, `private`, `type: "module"`, `version: "0.0.0"`. Scripts: `dev` = `rsbuild dev`, `build` = `rsbuild build`, `preview` = `rsbuild preview`, `typecheck` = `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json`, `test` = `bun test src scripts`, `check:bundle` = `bun scripts/check-bundle.ts`. `dependencies`: `"@ai/i18n": "workspace:*"` + các gói runtime §2 (react, react-dom, router, query, i18next, react-i18next, cva, clsx, tailwind-merge, tw-animate-css, lucide-react, font). `devDependencies`: `"@ai/config": "workspace:*"`, `"typescript": "6.0.3"`, `"@types/bun": "1.3.14"` + các gói dev §2 (rsbuild, plugin-react, router-plugin, tailwind, postcss, @types/react*). Tất cả ghim chính xác |
| `apps/admin-web/rsbuild.config.ts` | Tạo | `defineConfig` (mới) | `plugins: [pluginReact()]`; `source.entry.index = "./src/main.tsx"`; `html.title = "Admin Console"`, `html.favicon = "./public/brand/evoluconsulting-icon.svg"`, `html.lang`: không có option → đặt `lang="vi"` qua `html.template` nhỏ hoặc `html.htmlAttrs` (xác minh tên option trong `@rsbuild/core` types khi cài); `server.port = 3000`, `server.strictPort = true` (khớp `CORS_ORIGINS`); `tools.rspack.plugins = [tanstackRouter({ target: "react", autoCodeSplitting: true })]` — tên export `tanstackRouter` từ `@tanstack/router-plugin/rspack`, xác minh trong `dist/esm/rspack.d.ts`; `output.overrideBrowserslist = ["chrome >= 111", "edge >= 111", "firefox >= 128", "safari >= 16.4"]` (mức tối thiểu của Tailwind v4); `performance.chunkSplit` giữ mặc định |
| `apps/admin-web/postcss.config.mjs` | Tạo | — | `plugins: { "@tailwindcss/postcss": {} }` |
| `apps/admin-web/tsconfig.json` | Tạo | — | Code chạy trên trình duyệt. `extends: "../../packages/config/tsconfig/web.json"`; `compilerOptions.paths: { "@/*": ["./src/*"] }` (không dùng `baseUrl` — TS 6 đã deprecate); `include: ["src"]`, `exclude: ["src/**/*.test.ts", "src/**/*.test.tsx"]`; kế thừa `types: []` → code `src` dùng `Bun.*`/`process`/`bun:test` là lỗi typecheck. Rsbuild tự đọc `paths` làm alias |
| `apps/admin-web/tsconfig.node.json` | Tạo | — | #8 — code chạy bằng Bun/Node: `extends: "./tsconfig.json"` (giữ `paths`, DOM lib); `compilerOptions.types: ["bun"]`; `include: ["scripts", "rsbuild.config.ts", "src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.d.ts"]`; `exclude: []`. Bao `scripts/check-bundle.ts` (`Bun.gzipSync`), `rsbuild.config.ts`, unit test (`bun:test`). `src/**/*.d.ts` để test thấy augmentation `i18n.d.ts` + `env.d.ts` |
| `packages/config/tsconfig/web.json` | Tạo | — | spec §1 giao frontend-lead. `extends: "./base.json"` (backend-lead tạo; đã có `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `resolveJsonModule`, `noEmit`, `module: "Preserve"`, `moduleResolution: "bundler"`, `target: "ES2023"`, `types: []` — **không** lặp lại). Chỉ thêm `lib: ["ES2023","DOM","DOM.Iterable"]`, `jsx: "react-jsx"`. **Không** đặt `types` (giữ `[]` của base) — xem "Quyết định #8" dưới bảng. `verbatimModuleSyntax` → import kiểu phải viết `import type` |
| `apps/admin-web/components.json` | Tạo | — | shadcn: `style: "new-york"`, `rsc: false`, `tsx: true`, `tailwind: { config: "", css: "src/styles/globals.css", baseColor: "neutral", cssVariables: true }`, `iconLibrary: "lucide"`, `aliases: { components: "@/components", ui: "@/components/ui", utils: "@/lib/utils", lib: "@/lib", hooks: "@/hooks" }`. Sinh bằng `bunx shadcn@4.21.0 init` trong `apps/admin-web`; CLI không nhận diện Rsbuild → tạo tay theo trang "Manual installation" của shadcn, nội dung phải đúng như trên |
| `apps/admin-web/src/env.d.ts` | Tạo | — | `/// <reference types="@rsbuild/core/types" />` (kiểu cho import asset/CSS) |
| `apps/admin-web/src/main.tsx` | Tạo | — (mới) | import `./styles/globals.css`, `./app/i18n`; `createRoot(#root).render(<StrictMode><Providers/></StrictMode>)` |
| `apps/admin-web/src/app/providers.tsx` | Tạo | `Providers` (mới) | `QueryClientProvider` → `RouterProvider`. i18n dùng instance toàn cục của `initReactI18next`, không cần `I18nextProvider` |
| `apps/admin-web/src/app/router.ts` | Tạo | `router` (mới) | `createRouter({ routeTree, defaultPreload: "intent" })` + `declare module "@tanstack/react-router" { interface Register { router: typeof router } }` |
| `apps/admin-web/src/app/query-client.ts` | Tạo | `queryClient` (mới) | `new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })` |
| `apps/admin-web/src/app/i18n.ts` | Tạo | `i18n` (mới) | `i18next.use(initReactI18next).init({ resources, lng: DEFAULT_LOCALE, fallbackLng: DEFAULT_LOCALE, supportedLngs: SUPPORTED_LOCALES, interpolation: { escapeValue: false } })`; lắng `languageChanged` → `(lng) => { if (typeof document !== "undefined") document.documentElement.lang = lng; }` (#10: `bun test` không có `document`; không thêm DOM giả lập như happy-dom). Đăng ký listener **trước** `init` để lần init đầu cũng đặt `lang` |
| `apps/admin-web/src/app/i18n.d.ts` | Tạo | — | `declare module "i18next" { interface CustomTypeOptions { defaultNS: "translation"; resources: { translation: typeof vi } } }` → key sai là lỗi typecheck |
| `apps/admin-web/src/app/i18n.test.ts` | Tạo | — | unit: mặc định `vi` → `t("home.page.title") === "Admin Console"`; `changeLanguage("en")` → `t("home.page.subtitle") === "AI platform administration"` |
| `apps/admin-web/src/routes/__root.tsx` | Tạo | `Route` (`createRootRoute`) | chỉ `<Outlet />` |
| `apps/admin-web/src/routes/index.tsx` | Tạo | `Route` (`createFileRoute("/")`) | route mỏng: `component: HomePage` |
| `apps/admin-web/src/routeTree.gen.ts` | Sinh | — | do router-plugin sinh; **commit** (typecheck CI không cần chạy build trước); miễn `check:size` (T-SIZE-3 `*.gen.ts`); cần Biome bỏ qua |
| `apps/admin-web/src/features/home/pages/HomePage.tsx` | Tạo | `HomePage` (mới) | xem §5. Feature tạm, M1 thay bằng Tổng quan |
| `apps/admin-web/src/features/home/README.md` | Tạo | — | 3 dòng: trang tạm M0, xoá ở M1 |
| `apps/admin-web/src/lib/utils.ts` | Tạo | `cn()` (shadcn) | `twMerge(clsx(inputs))` |
| `apps/admin-web/src/lib/utils.test.ts` | Tạo | — | unit: `cn("px-2", "px-4") === "px-4"`; `cn("a", false && "b") === "a"` (AC07: ≥ 1 test mỗi workspace) |
| `apps/admin-web/src/styles/globals.css` | Tạo | — | xem §4 |
| `apps/admin-web/public/brand/evoluconsulting-icon.svg` | Chép | — | từ `D:\AI\logo\` (favicon) |
| `apps/admin-web/public/brand/evoluconsulting-logo-horizontal.svg` | Chép | — | trang `/`, sau này topbar/login |
| `apps/admin-web/public/brand/evoluconsulting-logo-vertical.svg` | Chép | — | dự phòng cho màn đăng nhập hẹp |
| `apps/admin-web/scripts/check-bundle.ts` | Tạo | `checkBundle(distDir): { jsKb, cssKb, errors: string[] }` (mới) + phần chạy CLI | #16. Đọc `dist/index.html`; lấy **mọi** `<script src="…">` và `<link rel="stylesheet" href="…">` (tải ban đầu; bỏ qua `rel="preload"`/`"prefetch"` và chunk async không có trong HTML); đường dẫn bỏ `/` đầu, resolve theo `dist/`. Mỗi file: `Bun.gzipSync(bytes)` (mức mặc định) → cộng **tổng** theo loại. **1 KB = 1024 byte**; `<x>` = tổng/1024 làm tròn 1 chữ số (`toFixed(1)`). Đạt khi tổng JS ≤ 150 KB **và** tổng CSS ≤ 25 KB (so trên số byte: ≤ 153600 / ≤ 25600; bằng ngưỡng vẫn đạt) → stdout `check:bundle OK · js <x> KB · css <y> KB`, exit 0. Vượt → stderr mỗi loại vượt một dòng, nguyên văn `check:bundle js <x> KB > 150 KB` / `check:bundle css <x> KB > 25 KB` (JS trước CSS), exit 1. Thiếu `dist/index.html` hoặc file được tham chiếu → stderr `check:bundle: thiếu <đường dẫn tương đối từ apps/admin-web>` (vd `dist/index.html`), exit 1 |
| `apps/admin-web/scripts/check-bundle.test.ts` | Tạo | — | unit trên thư mục tạm (`mkdtemp`) với `index.html` + asset giả: dưới ngưỡng → `errors` rỗng; JS vượt → `errors[0]` khớp `/^check:bundle js \d+\.\d KB > 150 KB$/`; 2 script cộng dồn vượt dù từng file dưới ngưỡng; thiếu file → lỗi `thiếu`. Chạy qua script `test` = `bun test src scripts` |
| `apps/admin-web/README.md` | Tạo | — | ≤ 30 dòng: lệnh, cổng 3000, cấu trúc thư mục |
| `packages/i18n/package.json` | Tạo | — | #9. `name: "@ai/i18n"`, `private: true`, `type: "module"`, `version: "0.0.0"`, `exports: { ".": "./src/index.ts" }`; scripts `test` = `bun test`, `typecheck` = `tsc --noEmit`; `devDependencies`: `"@ai/config": "workspace:*"`, `"@types/bun": "1.3.14"`, `"typescript": "6.0.3"`; không có `dependencies` |
| `packages/i18n/tsconfig.json` | Tạo | — | #9. `extends: "../config/tsconfig/bun.json"` (có `types: ["bun"]`, `resolveJsonModule`); `include: ["src"]` (JSON trong `locales/` vào theo import) |
| `packages/i18n/locales/vi.json` · `en.json` | Tạo | — | đúng đường dẫn T-I18N-1; nội dung §5 |
| `packages/i18n/src/index.ts` | Tạo | `resources`, `DEFAULT_LOCALE = "vi"`, `SUPPORTED_LOCALES = ["vi","en"] as const`, kiểu `Locale` (mới) | `import vi from "../locales/vi.json"` / `en` (default import JSON — hợp lệ với `module: "Preserve"` + `resolveJsonModule`; Bun và Rsbuild đều nạp được). `resources = { vi: { translation: vi }, en: { translation: en } } as const` |
| `packages/i18n/src/index.test.ts` | Tạo | — | unit: `DEFAULT_LOCALE === "vi"`; tập key phẳng vi = en |
| `playwright.config.ts` (gốc) | Tạo | — | xem §7; frontend-lead tạo và sở hữu (spec §9, tasks.md) |

Tổng: ~23 file tay viết, mọi file < 100 dòng (trừ `globals.css` ~150).

**Quyết định #8 — chọn tách `tsconfig.node.json`, không thêm `types: ["bun"]` vào `web.json`.** Lý do: `web.json` là preset cho code chạy trên trình duyệt; nếu có kiểu Bun thì `Bun.*`, `process`, `require` trong `src/**` vẫn typecheck xanh rồi vỡ lúc chạy. Tách hai config giữ lỗi đó ở mức typecheck, còn script/config/test vẫn có `Bun.gzipSync` và `bun:test`. Chi phí: thêm 1 file, `typecheck` chạy `tsc` 2 lần (M0 vài giây). Rủi ro: kiểu `@types/bun` 1.3.14 xung đột `lib.dom` trong `tsconfig.node.json` (test cần cả hai) → BUILD chạy `typecheck`; nếu có lỗi mà `skipLibCheck` không che được thì bỏ `DOM` khỏi `lib` của `tsconfig.node.json` và để unit test chỉ import module không đụng DOM, ghi "Quyết định trong lúc làm".

## 4. Theme — token canvas → CSS variable shadcn

Canvas thắng `ui-admin.md` §5 khi khác (ui-admin ghi primary `#4f46e5`, card bo 8px, font System UI, sidebar 240px — docs-architect cần cập nhật). Giá trị có dấu † là **Đề xuất** (canvas chưa cho số) — đối chiếu khi vẽ artboard, chỉ đổi hex trong file này, không đổi tên biến.

### 4.1 Màu (light — `:root`)
| Token canvas | CSS variable | Giá trị | Dùng cho |
|---|---|---|---|
| nền | `--background` | `#F7F6FA` | nền trang |
| chữ đậm | `--foreground` | `#2E2150` | chữ chính, tiêu đề |
| card | `--card` / `--card-foreground` | `#FFFFFF` / `#2E2150` | card, bảng |
| popover | `--popover` / `--popover-foreground` | `#FFFFFF` / `#2E2150` | dropdown, combobox |
| primary | `--primary` / `--primary-foreground` | `#6B4FA0` / `#FFFFFF` | nút chính, link, focus (tương phản ≈ 6.5:1 ✓) |
| đậm | `--brand-strong` (mới) | `#2E2150` | hover nút chính, H1, item sidebar đang chọn |
| secondary† | `--secondary` / `--secondary-foreground` | `#F0EDF6` / `#2E2150` | nút phụ |
| muted† | `--muted` / `--muted-foreground` | `#F0EDF6` / `#6E6882` | nền phụ, chữ mô tả (≈ 5.2:1 trên trắng, ≈ 4.8:1 trên nền ✓) |
| accent† | `--accent` / `--accent-foreground` | `#EDE8F6` / `#2E2150` | hover hàng/menu |
| err | `--destructive` / `--destructive-foreground`† | `#B42318` / `#FFFFFF` | nút xoá |
| viền | `--border` / `--input` | `#E6E3EE` / `#E6E3EE` | viền card, ô nhập |
| focus | `--ring` | `#6B4FA0` | focus ring 2px (ui-admin §11) |
| sidebar† | `--sidebar` / `--sidebar-foreground` / `--sidebar-primary` / `--sidebar-primary-foreground` / `--sidebar-accent` / `--sidebar-accent-foreground` / `--sidebar-border` / `--sidebar-ring` | `#FFFFFF` / `#2E2150` / `#6B4FA0` / `#FFFFFF` / `#F0EDF6` / `#2E2150` / `#E6E3EE` / `#6B4FA0` | nếu canvas dùng sidebar nền `#2E2150` thì chỉ đổi khối này |
| chart† | `--chart-1..5` | `#6B4FA0`, `#9C84C9`, `#2E2150`, `#C9B8FF`, `#E08BB4` | M4 (Chi phí) — lấy từ gradient logo |

### 4.2 Badge trạng thái (biến mới, dùng cho biến thể `Badge` ở M1)
| Biến thể | `--status-<v>-bg` | `--status-<v>-fg` | Nhãn mẫu |
|---|---|---|---|
| ok† | `#E7F5EE` | `#1E6B45` | Bật, Đang hoạt động |
| off† | `#EFEEF3` | `#5B566B` | Tắt, Chưa dùng |
| warn† | `#FDF1E1` | `#8A4B08` | Beta, 80% quota |
| info† | `#EFEBF8` | `#4B3780` | Mặc định, Nền tảng |
| err† | `#FCE8E8` | `#B42318` | Đã khoá, Vượt quota |
Mọi cặp fg/bg ước ≥ 5.5:1; BUILD kiểm lại bằng công cụ đo tương phản và ghi kết quả vào "Quyết định trong lúc làm".

### 4.3 Dark (`.dark`) — Đề xuất, chưa có nút bật ở M0
`--background #15111F` · `--foreground #ECE8F5` · `--card #1E1830` · `--border #342C49` · `--primary #A58BDB` / `--primary-foreground #15111F` · `--muted-foreground #A9A2BD` · `--destructive #F97066` · `--ring #A58BDB`; status: bg = màu fg light ở độ mờ 20%, fg = bản sáng (vd ok `#6FCF97`). Chờ canvas có artboard dark.

### 4.4 Chữ, bo góc, khoảng cách, bố cục (`@theme inline`)
| Nhóm | Biến Tailwind v4 | Giá trị | Utility |
|---|---|---|---|
| Font | `--font-sans` | `"Be Vietnam Pro", system-ui, "Segoe UI", sans-serif` | `font-sans` (mặc định body) |
| | `--font-mono` | `"JetBrains Mono Variable", ui-monospace, Consolas, monospace` | `font-mono` — command, key, secret, tiền, version |
| Cỡ chữ (ui-admin §5, thêm tên ngữ nghĩa, **không** ghi đè thang mặc định để component shadcn giữ nguyên) | `--text-caption` / `--text-table` / `--text-body` / `--text-card-title` / `--text-page-title` / `--text-kpi`† | 12/16 · 13/20 · 14/20 · 16/24 · 20/28 · 28/36 (px, cỡ/line-height) | `text-caption` … `text-kpi` |
| Độ đậm | dùng thang mặc định | 400 thân · 500 nhãn · 600 tiêu đề · 700 KPI | `font-medium` … |
| Bo góc | `--radius` = `12px`; `--radius-sm` = `calc(var(--radius) - 4px)` (8, ô nhập/nút†) · `--radius-md` = `calc(var(--radius) - 2px)` (10) · `--radius-lg` = `var(--radius)` (12, card/modal) · `--radius-xl` = `calc(var(--radius) + 4px)` (16) · badge `rounded-full` | | `rounded-lg` cho card |
| Khoảng cách | giữ thang Tailwind (bội 4px) — chỉ dùng 1 · 2 · 3 · 4 · 6 · 8 (4–32px) theo ui-admin §5 | | `p-6` = 24px padding nội dung |
| Bố cục | `--sidebar-width` = `248px` · `--sidebar-width-icon` = `64px` · `--topbar-height`† = `56px` · `--content-max` = `1280px` · `--row-height` = `40px` · `--row-height-compact` = `32px` | | dùng ở M1 |
| Chuyển động | `--duration-overlay` = `150ms`, ease-out; `@media (prefers-reduced-motion: reduce)` tắt | | |

Nạp font trong `globals.css`: `@import "@fontsource/be-vietnam-pro/400.css"`, `/500.css`, `/600.css`, `/700.css`, `@import "@fontsource-variable/jetbrains-mono"` — mỗi file có `unicode-range` cho subset `vietnamese`/`latin`/`latin-ext`, trình duyệt chỉ tải subset cần; `font-display: swap` (mặc định fontsource). Thứ tự file: `@import "tailwindcss"` → `@import "tw-animate-css"` → font → `@custom-variant dark (&:is(.dark *))` → `:root` → `.dark` → `@theme inline` → `@layer base { * { @apply border-border outline-ring/50 } body { @apply bg-background text-foreground font-sans } }`.

Luật BUILD (CONVENTIONS, frontend-lead.md): component không hard-code hex — chỉ dùng utility từ các biến trên.

## 5. Trang tạm `/`

- Bố cục: `<main>` chiếm toàn màn, nền `bg-background`, nội dung giữa màn (flex cột, `gap-4`): logo ngang (`img`, rộng 260px, cao 80px, có `width`/`height` để không nhảy bố cục) → H1 → dòng mô tả.
- H1: `text-page-title font-semibold text-brand-strong` — chuỗi `home.page.title`.
- Mô tả: `text-body text-muted-foreground` — chuỗi `home.page.subtitle`.
- `<html lang="vi">`, `<title>Admin Console</title>`, favicon = icon.

| Key i18n | vi | en |
|---|---|---|
| `app.meta.title` | Admin Console | Admin Console |
| `home.page.title` | Admin Console | Admin Console |
| `home.page.subtitle` | Bảng quản trị nền tảng AI | AI platform administration |
| `home.page.logoAlt` | EvoluConsulting | EvoluConsulting |

Không có trạng thái tải/lỗi/rỗng (trang tĩnh). Route không tồn tại: dùng `notFoundComponent` mặc định của TanStack Router ở M0; M1 thay bằng trạng thái 404 chung (`specs/_design/admin-missing-screens.md` §12.4).

**Role + nhãn cho e2e:** `heading "Admin Console"` (level 1) · `img "EvoluConsulting"` · landmark `main`.

## 6. Ngân sách hiệu năng (đo bằng `bun run --filter @ai/admin-web check:bundle` sau `build`)

KB = 1024 byte trong toàn bảng; câu chữ và exit code của `check:bundle` xem §3.

| Chỉ số | Ngân sách M0 | Trần toàn app (CONVENTIONS §6) |
|---|---|---|
| JS ban đầu (**tổng** gzip mọi `<script src>` trong `dist/index.html`) | **≤ 150 KB** (153 600 byte) — `check:bundle` chặn | < 250 KB |
| CSS ban đầu (**tổng** gzip mọi `<link rel="stylesheet">` trong `dist/index.html`) | **≤ 25 KB** (25 600 byte) — `check:bundle` chặn | — |
| Mỗi chunk route tách riêng (gzip) | ≤ 50 KB — kiểm tay ở BUILD (`rsbuild build` in kích thước gzip), **không** nằm trong `check:bundle` (AC19 chỉ chặn JS/CSS ban đầu) | — |
| Font tải khi mở `/` (woff2) | ≤ 150 KB, ≤ 6 file | — |
| `rsbuild build` | < 15 s trên máy dev | — |

Ước lượng (chưa đo): react + react-dom ≈ 45 KB, router ≈ 30 KB, query ≈ 12 KB, i18next + react-i18next ≈ 16 KB, app < 5 KB → ≈ 110 KB. Số thật đo ở BUILD, ghi vào "Quyết định trong lúc làm". Vượt 150 KB → xem lại import trước khi nới ngân sách.
Cách giữ: `autoCodeSplitting` của router-plugin tách mỗi route thành chunk; không import `radix-ui` gốc (chỉ subpath component); locale `en` hiện nạp cùng bundle (< 1 KB) — khi `en.json` > 20 KB thì chuyển sang nạp lười theo ngôn ngữ (ghi TECH-DEBT lúc đó).

## 7. Playwright

`playwright.config.ts` (gốc repo):
- `testDir: "./e2e"`, `fullyParallel: true`, `forbidOnly: !!process.env.CI`, `retries: process.env.CI ? 1 : 0`.
- `reporter`: CI → `[["github"], ["html", { open: "never" }]]`, local → `"list"`.
- `use: { baseURL: "http://localhost:3000", locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", trace: "on-first-retry" }` (múi giờ khớp R#31).
- `projects`: chỉ `chromium` (`devices["Desktop Chrome"]`, viewport 1280×800) ở M0.
- `webServer: { command: "bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web preview", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 120_000 }` — e2e chạy trên bản build thật (bắt lỗi build + đúng bundle); đang `bun run dev` ở cổng 3000 thì dùng lại server đó.
- Cài trình duyệt: local `bunx playwright install chromium`; CI `bunx playwright install --with-deps chromium`.

**E2E smoke (qc viết `e2e/smoke.spec.ts` — frontend không sửa `e2e/**`)**, test `"[M0] mở / thấy Admin Console"`:
1. `page.goto("/")` → status 200.
2. `getByRole("heading", { level: 1, name: "Admin Console" })` hiện.
3. `getByRole("img", { name: "EvoluConsulting" })` hiện và ảnh đã tải (`naturalWidth > 0`).
4. `page` có title `Admin Console`; `html[lang="vi"]`.
5. Không có `console` error / `pageerror` trong lúc tải.

## 8. Lệnh xong (phần frontend)

```
bun install --frozen-lockfile
bun run --filter @ai/admin-web typecheck
bun run --filter @ai/i18n typecheck
bun test apps/admin-web packages/i18n
bun run i18n:check                          # script gốc của backend-lead (T-I18N-1) → exit 0
bun run --filter @ai/admin-web build
bun run --filter @ai/admin-web check:bundle # ≤ ngân sách §6
bunx playwright install chromium
bunx playwright test e2e/smoke.spec.ts      # xanh
bunx biome check --changed                  # sạch trên file mới
bun run check:size && bun run depcruise     # sạch
```
Kiểm tay 1 lần: `bun run --filter @ai/admin-web dev` → mở `http://localhost:3000` thấy logo, "Admin Console", chữ Be Vietnam Pro có dấu hiển thị đúng ("Bảng quản trị nền tảng AI"); sửa chữ trong `HomePage.tsx` → HMR cập nhật không tải lại trang.

## 9. Việc frontend (đề xuất để điều phối gộp vào `tasks.md`)
- [ ] FE-1 · Scaffold `apps/admin-web` (package.json đủ dep §3) + `packages/config/tsconfig/web.json` + `tsconfig.json`/`tsconfig.node.json`, Rsbuild + React chạy trang trắng · `bun run --filter @ai/admin-web typecheck` xanh
- [ ] FE-2 · Tailwind v4 + shadcn init + `globals.css` token §4 + font
- [ ] FE-3 · TanStack Router (file-based, `routeTree.gen.ts`) + Query provider
- [ ] FE-4 · `packages/i18n` (package.json + tsconfig) + i18n init (listener chặn `document`) + `HomePage` + logo/favicon + unit test · `bun run --filter @ai/i18n typecheck && bun test packages/i18n apps/admin-web` xanh
- [ ] FE-5 · `playwright.config.ts` + `check:bundle` (+ unit test); chạy smoke của qc tới xanh

## 10. Edge case / rủi ro
- **Rsbuild CLI chạy bằng Node**: bin của `@rsbuild/core` dùng shebang node; router-plugin cần node ≥ 20.19. Máy dev/CI phải có Node LTS (ADR-0001 đã có Node cho Worker). Không có Node → thử `bun --bun rsbuild`; lỗi thì ghi blocked.
- **shadcn CLI không nhận Rsbuild** → làm theo manual install (§3), kết quả so khớp `components.json` ở trên.
- **Biome và cú pháp Tailwind v4** (`@theme`, `@custom-variant`, `@apply`) có thể báo lỗi parse CSS → cần `css.parser.tailwindDirectives: true` trong `biome.json` (Biome ghim 2.5.15; tuỳ chọn này có từ 2.3 — xác minh trong schema lúc cài).
- **`bun test` nạp nhầm `e2e/*.spec.ts`** (Bun khớp cả `*.spec.*`) → vi phạm AC07; cần cấu hình gốc loại `e2e/` (bunfig `[test]` hoặc script `test` chỉ định thư mục).
- **`routeTree.gen.ts` lệch** khi thêm route mà chưa chạy dev/build → `routeTree.gen.ts` được **commit** vào repo; CI typecheck (chạy trước build) dùng bản đã commit. Lệch → `bun run --filter @ai/admin-web build` sinh lại rồi commit. Không thêm `tsr generate` ở M0.
- **TypeScript 6.0.3** (ADR-0003, do dependency-cruiser): frontend không có ràng buộc riêng; không dùng `baseUrl` (deprecated ở TS 6).
- **Linker isolated** (plan.md R8): `@tanstack/router-plugin` cần thấy `@rsbuild/core`/`@rspack/core` qua peer; `tsc` của workspace cần `typescript` khai tại chỗ. Thiếu peer lúc build → khai thêm dep trực tiếp ở `apps/admin-web` trước; vẫn lỗi → theo R8 đổi `linker = "hoisted"` (việc của backend-lead), ghi "Quyết định trong lúc làm".
- **`document` trong `bun test`** (#10): mọi truy cập DOM ở module mà unit test import phải chặn `typeof document !== "undefined"`; không thêm DOM giả lập ở M0.

## 11. Artboard / ADR
- Không có ADR mới cho M0 (mọi thư viện thuộc lựa chọn đã có trong ADR-0001). Đề xuất: TanStack Router/Query, react-i18next chuyển Accepted cùng Gate M0 vì M0 dùng thật.
- Artboard các màn thiếu: `docs/specs/_design/admin-missing-screens.md` §13.

## 12. Cần backend-lead / điều phối (file gốc repo không thuộc frontend)
1. `package.json` gốc: workspaces gồm `apps/*`, `packages/*`, `tools/*`; devDependency `@playwright/test` 1.63.0, `typescript` 6.0.3; script `e2e` = `playwright test`.
2. `turbo.json`: task `build` (outputs `dist/**`), `typecheck`, `test`, `check:bundle` (dependsOn `build`) cho `@ai/admin-web`; `dev` persistent.
3. `.gitignore`: `apps/admin-web/dist`, `playwright-report/`, `test-results/`, `blob-report/`.
4. `biome.json`: bỏ qua `**/routeTree.gen.ts`; bật `css.parser.tailwindDirectives`.
5. `bun test` gốc không nạp `e2e/**`.
6. `.dependency-cruiser.cjs`: T-DEP-5 đã khớp cấu trúc `src/features/*/components/**`, `src/lib/http*` — giữ nguyên.
7. CI: sau `test` thêm `bunx playwright install --with-deps chromium` → `bun run --filter @ai/admin-web build` → `check:bundle` → `bunx playwright test`.
8. `packages/config/tsconfig/base.json` bật `strict` (đã có). `web.json` chỉ ghi đè `lib` + thêm `jsx`; **không** ghi đè `module` (giữ `Preserve`) và `types` (giữ `[]`) — kiểu Bun cho admin-web nằm ở `apps/admin-web/tsconfig.node.json` (Quyết định #8, §3). Đề nghị sửa dòng fe#8 trong `spec.md` cho khớp.
9. `packages/config/package.json`: `exports` thêm `"./tsconfig/web.json": "./tsconfig/web.json"` (để Turbo/tooling resolve được; `extends` dùng đường dẫn tương đối). Nội dung `web.json` do frontend-lead tạo.
10. `tasks.md`: FE-1 gồm `tsconfig.node.json`; FE-4 gồm `packages/i18n/tsconfig.json`; FE-5 gồm `scripts/check-bundle.test.ts`. Lệnh xong FE-4: `bun run --filter @ai/i18n typecheck && bun test packages/i18n`.
