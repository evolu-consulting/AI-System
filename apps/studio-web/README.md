# @ai/studio-web

Agent Studio (H4a, HUB-FR-72, 60, 62, 64): UI cấu hình Agent Hub cho `platform_admin` — đăng nhập (+ TOTP), Agents (danh sách, editor 5 bước theo runtime), Orchestrator (mặc định + theo tenant). Rsbuild + React + Tailwind + shadcn + TanStack Router/Query + react-hook-form/zod + react-i18next (ADR-0001). Spec: `docs/specs/H4a-studio-shell-agents/`.

## Lệnh (chạy ở gốc repo)
- `bun run --cwd apps/studio-web dev` — `http://localhost:3200/studio/`; proxy `/auth` → admin-api, `/studio/api` → Hub (cùng origin, cookie refresh không cần CORS)
- `bun run --cwd apps/studio-web build` → `dist/`; Hub phục vụ bản build khi `HUB_STUDIO_DIST=<tuyệt đối>/apps/studio-web/dist` (`docs/guides/hub-dev.md` "Studio dev")
- `bun run --cwd apps/studio-web typecheck` · `bun run --cwd apps/studio-web test` (unit) · `bun run --cwd apps/studio-web check:bundle` (JS đầu ≤ 160 KB, CSS ≤ 25 KB, mỗi chunk route ≤ 50 KB gzip)
- `bun run e2e:studio` — e2e `e2e/studio/*` (build + Hub + admin-api e2e); `bun run done:h4a` — lệnh xong mốc

## Env (build-time, `.env.example` gốc)
`PUBLIC_ADMIN_WEB_URL` (link "⇄ Admin", "Admin › Workflows ↗"; vắng ⇒ ẩn) · `PUBLIC_CHAT_WEB_URL` (nút "Về Chat" ở trang không quyền; vắng ⇒ ẩn) · `PUBLIC_AUTH_URL` (vắng = `/auth` tương đối; prod cần reverse proxy `/auth` cùng origin Hub, khác origin ⇒ không refresh — U4, CR-044).

## Cấu trúc
- `src/app/` — providers, router (basepath `/studio`), query client (403 giữa phiên ⇒ xoá cache + `/forbidden`), i18n (`packages/i18n` khoá `studio.*`)
- `src/routes/` — file route mỏng (`_authed` = guard + `me`); `routeTree.gen.ts` sinh tự động
- `src/features/{shell,auth,agents,orchestrator}/` — mỗi feature có README; `api.ts` là nơi duy nhất gọi API
- `src/lib/` — `http` (Bearer, 401 → refresh 1 lần), `auth/` (token trong bộ nhớ, `next` chống open redirect), `api-error`, `conflict`, `env`
- `src/components/shared/` — ConfirmDialog, UnsavedGuard, `conflict/` (ConflictDialog: Tải bản mới / Xem khác biệt / Ghi đè), trạng thái rỗng/lỗi
- `src/components/ui/` — shadcn copy từ admin-web (TD #76)

Bẫy: không import code `apps/admin-web`/`apps/chat-web` (depcruise); mã lỗi theo `@ai/contracts/studio`; nợ FE: TECH-DEBT #81–#87.
