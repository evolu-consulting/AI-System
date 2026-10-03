# @ai/chat-web

Giao diện Chat C1 (CHAT-AC-*). Rsbuild + React 18 + Tailwind v4 + shadcn/ui + TanStack Router/Query. Kế hoạch: `docs/specs/C1-chat-ui/plan-frontend.md`.

## Lệnh (chạy ở gốc repo)
- `bun run --filter @ai/chat-web dev` — `http://localhost:3100` (cổng cố định `strictPort`)
- `bun run --filter @ai/chat-web build` → `dist/`; `preview` phục vụ bản build ở cổng 3100
- `bun run --filter @ai/chat-web typecheck` — `tsconfig.json` (trình duyệt) + `tsconfig.node.json` (script, config, test)
- `bun test apps/chat-web` — unit test
- `bun run --filter @ai/chat-web check:bundle` — JS ban đầu ≤ 150 KB, CSS ≤ 25 KB, chunk async ≤ 50 KB (gzip), đọc `dist/index.html`

## Proxy (dev và preview)
Client gọi đường dẫn tương đối; `rsbuild.config.ts` proxy cùng origin (cookie `ai_rt` không cần CORS):

| Đường dẫn | Đích | Mặc định |
|---|---|---|
| `/auth` | `AUTH_URL` (trống = `HUB_URL`) | `http://localhost:4020` |
| `/conversations` `/runs` `/health` | `HUB_URL` | `http://localhost:4020` |

Chạy với mock: `bun run mocks` rồi `bun run --filter @ai/chat-web dev`. Đổi Hub: `HUB_URL=http://host:port bun run --filter @ai/chat-web dev`.

## Quy ước
- Alias import `~/*` → `src/*` (không dùng `@/`, vì `tsconfig.depcruise.json` gắn `@/` cho admin-web).
- `src/components/ui/` — shadcn (`components.json`), chép từ admin-web, không import chéo giữa hai app.
- Màu/cỡ chữ lấy từ token CSS trong `src/styles/globals.css` (Sáng; Tối ở F14), không hard-code hex.
- Chuỗi giao diện: `packages/i18n/locales/chat/{vi,en}.json` (F2).
- Feature-first: `src/features/<f>/{api.ts,pages,components}`; gọi API chỉ trong `api.ts`.
- `public/brand/` — logo EvoluConsulting.
