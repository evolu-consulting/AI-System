# CODEMAP — module → file chính

Chỉ để **định vị**; mở file thật trước khi dùng API. Code thắng khi mâu thuẫn. Do `docs-architect` cập nhật sau mỗi mốc. Trạng thái: M2 xong (thêm Secrets, Workflows, Commands, Features + entitlement).

| Đường dẫn | Vai trò · điểm vào | FR |
|---|---|---|
| `apps/admin-api` | Hono API; `src/app.ts` (`createApp(cfg, deps?)`), `server.ts`, `config/env.ts`; `lib/{jwt,cookie,http,errors,auth-middleware,db-guard,pg-errors,logger,sql,json,secret-crypto,test-hooks}.ts` | ADM-FR-01, ADM-NFR-07 |
| `apps/admin-api/src/modules/auth` | login, refresh xoay vòng, logout, change-password, `/auth/me`; `auth.routes.ts`, `auth.service.ts`, `auth.rules.ts` | ADM-FR-01, 02, 03, 06, 07 |
| `apps/admin-api/src/modules/tenants` | CRUD + khoá/mở khoá, tạo kèm admin đầu; `tenants.routes.ts`, `tenants.service.ts` | ADM-FR-60, 61 |
| `apps/admin-api/src/modules/users` | list/tạo/sửa/khoá/reset/logout-all, BR-08/09; `users.routes.ts`, `users.service.ts` | ADM-FR-04, 05, 63 |
| `apps/admin-api/src/modules/secrets` | list/tạo/`PUT` thay giá trị/ghi chú/xoá; mã hoá AES-256-GCM (`lib/secret-crypto.ts`), không trả giá trị; `secrets.{routes,service,repo,rules}.ts` | ADM-FR-50, BR-04 |
| `apps/admin-api/src/modules/workflows` | CRUD catalog, input schema, `usages` (đọc `hub.agent_workflows` qua `workflows.hub.ts`), "Chưa gắn", chặn xoá/tắt; `workflows.{routes,service,repo,hub,rules}.ts` | ADM-FR-10, 11, 13, 14, 15 |
| `apps/admin-api/src/modules/commands` | CRUD, `command_names` (tên/alias chung), input map + validate, "Ai dùng được" (`commands.access.ts`); `commands.{routes,service,repo,access,rules}.ts` | ADM-FR-20, 21, 22, 24, BR-01, 02 |
| `apps/admin-api/src/modules/features` | CRUD, entitlement (`features.entitlements.ts`), thành viên command (`features.members.ts`), `core` được bảo vệ; `features.{routes,service,repo}.ts` | ADM-FR-30, 31, 33, 34, BR-10 |
| `apps/admin-api/src/modules/health` | `/health`; `health.routes.ts` | ADM-NFR-06 |
| `apps/admin-web` | Rsbuild + React + TanStack Router; `src/main.tsx`, `app/`, `routes/` (login, change-password, `_authed/*`), `lib/` (http, session, errors); `scripts/` check bundle | ADM-FR-01, ADM-NFR-01 |
| `apps/admin-web/src/features/{auth,shell,tenants,users}` | màn Đăng nhập/Đổi mật khẩu · shell (Sidebar, Topbar, guard) · Tenants · Users; mỗi feature có `README.md`, `pages/` | ADM-FR-01, 04, 06, 60 |
| `apps/admin-web/src/features/{secrets,workflows,commands,features}` | màn M2: `pages/`, `components/` (workflows, commands chia `list/`, `editor/`; commands thêm `editor-parts/`), `hooks/`, `lib/`; mỗi feature có `README.md` | ADM-FR-10, 20, 30, 31, 50 |
| `apps/admin-web/src/components/shared` | DataTable, ConfirmDialog, TempPasswordPanel, TenantPicker, states…; M2: DependencyList, BlockedDialog, RefPicker, LocalizedInput, EditorSaveBar, PlatformOnly, `form/` | ADM-FR-04, 10, 20, 60 |
| `packages/config` | tsconfig dùng chung (`tsconfig/`) | ADM-NFR-06 |
| `packages/contracts` | zod contract; `src/{common,auth,tenants,users,secrets,workflows,commands,features,errors,version-conflict,index}.ts` | ADM-FR-01 |
| `packages/db` | Drizzle; `src/{client,migrate,scope,password,seed,env,test-db}.ts`, `schema/{admin,hub-readonly}.ts`, `migrations/` (0000–0004; 0003 catalog, 0004 RLS/REVOKE catalog), `migrations-dev/` | ADM-NFR-06, ADM-NFR-07 |
| `packages/i18n` | locale vi/en + key; `src/index.ts`, `locales/` | ADM-NFR-01 |
| `tools/mocks` | mock Dify + Hub (`bun run mocks`); `src/{server,dify,hub,scenario,fixtures}.ts` | ADM-NFR-06 |
| `tools/scripts` | `check-size`, `depcruise`, `i18n-check`, `keys-dev`, `test-lock`, `trace` (`src/*.ts`) | ADM-NFR-06 |
| `tests/acceptance/{ADM-NFR-06,M1,M2}` | test nghiệm thu (khoá); `rules/`, `*.int.test.ts` | ADM-FR-01…07, 10…50, 60, 61, 63 |
| `e2e` | Playwright: `smoke`, `auth`, `tenants`, `users`, `secrets`, `workflows`, `commands`, `features`, `m1-flow`, `m2-flow` `.spec.ts`; `support/{helpers,prepare-db}.ts`; config `playwright.config.ts` ở gốc (khoá) | ADM-FR-01, 04, 60 |
