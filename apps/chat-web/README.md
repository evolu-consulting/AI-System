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
- Màu/cỡ chữ lấy từ token CSS trong `src/styles/globals.css` (Sáng + `.dark`; chọn ở Cài đặt, `src/lib/theme.ts`), không hard-code hex.
- Chuỗi giao diện: `packages/i18n/locales/chat/{vi,en}.json` (F2).
- Feature-first: `src/features/<f>/{api.ts,pages,components}`; gọi API chỉ trong `api.ts`.
- `public/brand/` — logo EvoluConsulting.
- `localStorage`/`sessionStorage` chỉ đọc/ghi qua `src/lib/storage.ts` (try/catch): storage bị chặn thì app vẫn chạy, chỉ mất phần nhớ (theme, `ai.locale`, `chat:tenant_key`, nháp).
- A11y: luồng tin `role=log`, đọc câu trả lời khi xong run; `prefers-reduced-motion` tắt animation (globals.css + `motion-reduce:`).

## Feature
| Thư mục | Phụ trách |
|---|---|
| `features/auth` | đăng nhập, phiên, khoá tài khoản |
| `features/shell` | khung app, sidebar, cài đặt, banner kết nối |
| `features/conversations` | API + query danh sách hội thoại |
| `features/thread` | trang chào `/c/new`, trang hội thoại `/c/:id`, khối flow |
| `features/composer` | ô nhập, nháp, nhắc quota |
| `features/run` | gửi tin, stream SSE, run-store, nối lại |
| `features/answer` | thân câu trả lời (markdown, bước, hỏi lại, lỗi) |
| `features/flow-panel` | khung flow `?flow=` |

Nợ kỹ thuật (chép từ admin-web, chưa có `packages/ui-chat`): `docs/TECH-DEBT.md`.
