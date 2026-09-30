# ADR-0001 · Stack nền

Trạng thái: **Accepted** (Gate M0, 2026-10-01) · Ngày: 2026-10-01

## Bối cảnh
Nền tảng multi-tenant gồm Admin, Agent Hub, Worker, Chat App/Extension. Worker chạy Claude Agent SDK (TypeScript). Cần chia sẻ schema validate giữa form, API, DB; một ngôn ngữ cho toàn monorepo.

## Quyết định

| Lớp | Chọn | Trạng thái | Lý do |
|---|---|---|---|
| Ngôn ngữ | TypeScript strict | Accepted | Agent SDK là TS; chia sẻ contract |
| Package manager, script, test runner | Bun | Accepted | Cài nhanh, workspace, test nhanh |
| Monorepo | Turborepo | Accepted | Cache build/test theo package |
| Frontend build | Rsbuild | Accepted | Build nhanh (Rspack) |
| UI | React 18, Tailwind CSS, shadcn/ui | Accepted | Người dùng chọn |
| Router / data | TanStack Router, TanStack Query | Accepted (Gate M0) | Type-safe route, cache query; M0 đã cài và dùng |
| Form | react-hook-form + zod | Accepted (Gate M0) | Dùng chung schema với API |
| Bảng | TanStack Table | Accepted (Gate M0) | Sort/filter/virtualize |
| i18n | react-i18next | Accepted (Gate M0) | Không phụ thuộc Next.js; M0 đã cài và dùng — không thuộc ADR-0002 |
| Biểu đồ | shadcn chart (Recharts) | Accepted (Gate M0) | Theo ui-operations §7 |
| API | Hono | Accepted (Gate M0) | Chạy cả Bun và Node, nhẹ |
| Runtime API | Bun (admin-api); Hub thử Bun; Worker Node LTS | Accepted (Gate M0) | Worker cần Agent SDK, BullMQ ổn định |
| DB / ORM | Postgres 16 + Drizzle ORM + drizzle-kit | Accepted (Gate M0) | SQL-first, nhiều schema, RLS |
| Validate | zod | Accepted (Gate M0) | Contract chung |
| Auth | `jose` (JWT **EdDSA Ed25519**), argon2id qua `Bun.password` | Accepted (EdDSA, 2026-10-01) | Hub verify bằng public key |
| Queue / cache | Redis 7 (ioredis), BullMQ ở Worker | Accepted (Gate M0) | Đã chốt trong design |
| Format/lint | Biome, lefthook | Accepted (Gate M0) | Một công cụ, chạy trên file thay đổi |
| Kiến trúc import | dependency-cruiser | Accepted (Gate M0) | Chặn import sai chiều |
| Test | `bun test` (unit/integration), Playwright (e2e) | Accepted (Gate M0) | |
| Email dev | Mailpit (SMTP) | Accepted (Gate M0) | Offline |
| Hạ tầng dev | Docker Compose | Accepted (Gate M0) | Compose chỉ Postgres, Redis, Mailpit (dịch vụ có trạng thái); mock Dify/Hub chạy bằng bun script (`tools/mocks`, `bun run mocks`) |

Phiên bản cụ thể: backend-lead/frontend-lead chốt ở M0 và ghi vào bảng dưới (dùng bản stable mới nhất tại thời điểm cài, khoá bằng `bun.lock`).

Tra ngày 2026-10-01 bằng `npm view <pkg> version` (dist-tag `latest`). Ghim chính xác (không `^`) trong `package.json`. Cột "Latest" ghi khi bản chọn khác bản mới nhất.

| Package | Phiên bản | Latest | Phần | Ghi chú |
|---|---|---|---|---|
| bun (runtime, `packageManager`) | 1.3.14 | 1.4.2 | toàn repo | Bản đang cài trên máy dev; nâng 1.4.2 chờ Gate M0 (spec M0 Câu hỏi 2) |
| @types/bun | 1.3.14 | 1.4.2 | toàn repo | Khớp runtime |
| typescript | 6.0.3 | 7.0.2 | toàn repo | dependency-cruiser 18.5.0 chỉ nhận `>=2 <7` — ADR-0003 |
| turbo | 2.11.5 | = | gốc | |
| @biomejs/biome | 2.5.15 | = | gốc | |
| lefthook | 2.1.15 | = | gốc | |
| dependency-cruiser | 18.5.0 | = | gốc | |
| hono | 4.13.12 | = | admin-api, mocks | |
| zod | 4.6.5 | = | contracts, admin-api, db, mocks | |
| drizzle-orm | 0.45.3 | = | db | Có `1.0.0-rc.*` — không dùng bản rc |
| drizzle-kit | 0.31.11 | = | db (dev) | |
| postgres (postgres.js) | 3.4.9 | = | db | ADR-0003 |
| jose | 6.2.12 | = | admin-api (M1) | Chưa cài ở M0 |
| @hono/zod-validator | 0.9.1 | = | admin-api (M1) | peer `zod ^3.25 \|\| ^4`, `hono >=4.11.2`; chưa cài ở M0 |
| ioredis | 6.0.0 | = | M1+ | Major mới; đánh giá lại khi cài |
| @playwright/test | 1.63.0 | = | e2e (qc/frontend-lead) | |
| Image `postgres` | `16-alpine` | — | compose, CI | Major theo quyết định Postgres 16 |
| Image `redis` | `7-alpine` | — | compose | Major theo quyết định Redis 7 |
| Image `axllent/mailpit` | _tag release mới nhất, ghi lúc BUILD M0 (task T16)_ | — | compose | Không dùng `latest` |
| Action `actions/checkout`, `oven-sh/setup-bun` | _major mới nhất, ghi lúc BUILD M0 (task T16)_ | — | CI | |
| @rsbuild/core | 2.2.11 | = | admin-web (dev) | Bin chạy bằng Node — cần Node ≥ 20.19 (engines TanStack) |
| @rsbuild/plugin-react | 2.1.1 | = | admin-web (dev) | peer `@rsbuild/core ^2.0.0` |
| react, react-dom | 18.3.1 | 19.3.0 | admin-web | Dòng "UI" ở trên chốt React 18 |
| @types/react / @types/react-dom | 18.3.31 / 18.3.7 | 19.x | admin-web (dev) | Nhánh 18 |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | = | admin-web (dev) | Tailwind v4, cấu hình bằng CSS |
| postcss | 8.5.28 | = | admin-web (dev) | |
| shadcn (CLI) | 4.21.0 | = | admin-web | Chạy bằng `bunx`, không cài |
| class-variance-authority | 0.7.1 | = | admin-web | Đi kèm shadcn |
| clsx | 2.1.1 | = | admin-web | Đi kèm shadcn |
| tailwind-merge | 3.7.0 | = | admin-web | Đi kèm shadcn (bản cho Tailwind v4) |
| tw-animate-css | 1.4.0 | = | admin-web | Đi kèm shadcn v4 |
| lucide-react | 1.49.0 | = | admin-web | Icon mặc định shadcn |
| radix-ui | 1.6.7 | = | admin-web (M1) | Cài khi `shadcn add` đầu tiên |
| @tanstack/react-router | 1.170.41 | = | admin-web | |
| @tanstack/router-plugin | 1.168.42 | = | admin-web (dev) | Plugin Rspack, `autoCodeSplitting` |
| @tanstack/react-query | 5.104.0 | = | admin-web | |
| i18next | 26.4.2 | = | admin-web | |
| react-i18next | 17.0.15 | = | admin-web | peer `i18next >= 26.2.0`, TS `^5 \|\| ^6 \|\| ^7` |
| @fontsource/be-vietnam-pro | 5.3.0 | = | admin-web | Font canvas, tự host |
| @fontsource-variable/jetbrains-mono | 5.3.0 | = | admin-web | Font mono canvas, tự host |

## Hệ quả
- Mọi app/package TypeScript; contract zod ở `packages/contracts` là nguồn chung.
- Đổi một dòng Accepted cần ADR mới thay thế.
