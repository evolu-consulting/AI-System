# @ai/admin-web

Admin Console (ADM-NFR-06 M0: khung toolchain). Rsbuild + React 18 + Tailwind v4 + shadcn/ui + TanStack Router/Query + react-i18next.

## Lệnh (chạy ở gốc repo)
- `bun run --filter @ai/admin-web dev` — dev server `http://localhost:3000` (cổng cố định, khớp `CORS_ORIGINS`)
- `bun run --filter @ai/admin-web build` → `dist/`; `preview` phục vụ bản build ở cổng 3000
- `bun run --filter @ai/admin-web typecheck` — `tsconfig.json` (code trình duyệt) + `tsconfig.node.json` (script, config, unit test)
- `bun test apps/admin-web` — unit test
- `bun run --filter @ai/admin-web check:bundle` — JS ban đầu ≤ 150 KB, CSS ≤ 25 KB (gzip), đọc `dist/index.html`
- `bunx playwright test` — e2e ở `e2e/` (chạy từ gốc repo): build + preview admin-web (cổng 3000, proxy `/auth` `/admin` → admin-api) và admin-api e2e (cổng 3001, DB `ai_system_test` được reset). **Tắt `bun run dev` của admin-api (cổng 3001) trước khi chạy**; cần `docker compose up -d --wait` và `.env.local` (`bun run keys:dev`)

## Cấu trúc
- `src/app/` — providers, router, query client, i18n
- `src/routes/` — file route mỏng; `src/routeTree.gen.ts` do router-plugin sinh (commit, không sửa tay)
- `src/features/<f>/` — `api.ts` (nơi duy nhất gọi API), `pages/`, `components/`
- `src/components/ui/` — shadcn sinh ra (`components.json`)
- `src/styles/globals.css` — theme; token lấy từ `docs/design/canvas/tokens-map.md`
- `public/brand/` — logo EvoluConsulting
- Chuỗi giao diện: `packages/i18n/locales/{vi,en}.json`
