# CODEMAP — module → file chính

Chỉ để **định vị**; mở file thật trước khi dùng API. Code thắng khi mâu thuẫn. Do `docs-architect` cập nhật sau mỗi mốc. Trạng thái: M4 xong (thêm Quota, Usage, Overview, Audit + khôi phục, Import/Export, 2FA, mailer).

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
| `apps/admin-api/src/modules/groups` | Groups + thành viên (`beta-testers` bảo vệ, `version`/409); `groups.{routes,service,members,repo,rules}.ts` | ADM-FR-62, 55 |
| `apps/admin-api/src/modules/grants` | grant feature cho group/user, ma trận (REPEATABLE READ read only), batch; `grants.{routes,service,batch,matrix,read,repo,rules}.ts` | ADM-FR-32, 35, BR-12 |
| `apps/admin-api/src/modules/access` | Quyền hiệu lực của user (`computeEffectiveAccess`, SQL tham chiếu Hub); `access.{routes,service,repo,rules}.ts` | ADM-FR-36, BR-11, 24 |
| `apps/admin-api/src/modules/{quotas,usage,overview}` | quota + cảnh báo (mail/banner); chi phí & quota đọc `hub.usage_logs`; tổng quan 2 role; mỗi module có `README.md` | ADM-FR-40, 41, 42, 52 |
| `apps/admin-api/src/modules/{audit,transfer}` | nhật ký + khôi phục (`audit.*`); export/import dry-run→áp dụng (`transfer.*`, trần 5000/loại) | ADM-FR-51, 54 |
| `apps/admin-api/src/modules/auth/totp` | 2FA TOTP: bật/tắt/mã dự phòng, xác minh khi đăng nhập; `totp.{routes,service,repo,rules,verify}.ts`, `lib/totp.ts` | ADM-FR-08, BR-04 |
| `apps/admin-api/src/lib/{audit,mailer}` | `audit/audit.write.ts` ghi audit cùng transaction + `audit.rules.ts`; `mailer/index.ts` SMTP (`SMTP_URL`) | ADM-FR-51, 40 |
| `apps/admin-api/src/lib/config` | `config-write.ts`: bump `config_version` + NOTIFY `config_changed` sau commit; `packages/db/src/config-meta.ts` đọc | ADM-FR-53 |
| `apps/admin-api/src/modules/health` | `/health`; `health.routes.ts` | ADM-NFR-06 |
| `apps/admin-web` | Rsbuild + React + TanStack Router; `src/main.tsx`, `app/`, `routes/` (login, change-password, `_authed/*`), `lib/` (http, session, errors); `scripts/` check bundle | ADM-FR-01, ADM-NFR-01 |
| `apps/admin-web/src/features/{auth,shell,tenants,users}` | màn Đăng nhập/Đổi mật khẩu · shell (Sidebar, Topbar, guard) · Tenants · Users; mỗi feature có `README.md`, `pages/` | ADM-FR-01, 04, 06, 60 |
| `apps/admin-web/src/features/{secrets,workflows,commands,features}` | màn M2: `pages/`, `components/` (workflows, commands chia `list/`, `editor/`; commands thêm `editor-parts/`), `hooks/`, `lib/`; mỗi feature có `README.md` | ADM-FR-10, 20, 30, 31, 50 |
| `apps/admin-web/src/features/{groups,access}` | màn M3: Groups (list, editor, thành viên, grant), Phân quyền (ma trận ảo hoá, Kiểm tra quyền, tab quyền của user, "Ai dùng được"); mỗi feature có `README.md` | ADM-FR-32, 35, 36, 62 |
| `apps/admin-web/src/features/{usage,overview,audit,transfer}` + `auth` (2FA) | màn M4: Chi phí & quota, Tổng quan (+QuotaBanner ở shell), Nhật ký + khôi phục, Import/Export, trang 2FA (`auth/components/totp`); mỗi feature có `README.md` | ADM-FR-08, 40, 41, 42, 51, 52, 54 |
| `apps/admin-web/src/components/shared/{diff,kpi,quota,chart,form,panel,conflict}` | DiffTable, KpiCard, QuotaBar, DailyBars (SVG), OtpInput/PeriodFilter, Panel, ConflictDialog | ADM-FR-51, 52 |
| `apps/admin-web/src/components/shared` | DataTable, ConfirmDialog, TempPasswordPanel, TenantPicker, states…; M2: DependencyList, BlockedDialog, RefPicker, LocalizedInput, EditorSaveBar, PlatformOnly, `form/` | ADM-FR-04, 10, 20, 60 |
| `packages/contracts/src/chat` | contract Chat↔Hub: `entities`, `events` (SSE), `errors`, `rules` (parser SSE, `deriveTitle`); import `@ai/contracts/chat` | HUB-FR-40…43, 45 |
| `tools/mocks/src/chat` | mock Hub chat (`index.ts`): `auth`/`sessions`, `conversations.routes`, `messages.routes`, `runs`+`sse` (Last-Event-ID), `scenarios` (`#scn:`), `control`, `store`/`seed` | CHAT-AC-01…36 |
| `apps/chat-web` | Rsbuild + React; `src/routes` (login, `_authed/c/*`), `lib/{http,auth}`, `scripts/check-bundle.ts`. Feature: `auth` · `shell` (sidebar, theme, ConnectionBanner) · `conversations` · `thread` (ConversationPage) · `composer` (`use-draft`) · `run` (`run-driver.ts`, `run-store.ts`: SSE, nối lại) · `answer` (markdown lazy, StepList, AskCard) · `flow-panel` (`?flow=`) | CHAT-AC-01…36 |
| `tests/contract/chat` | test contract dùng chung: `bun run test:contract:chat` (mock mặc định; Hub thật qua `HUB_URL`, `AUTH_URL`) | CHAT-AC-32 |
| `apps/hub-api` | Hono API Hub (H1); `src/app.ts` (`createApp`), `server.ts`; `lib/{auth.middleware,jwt,db,redis,errors,http,logger,loop}.ts` (JWT EdDSA, cách ly tenant qua `hub-scope`); `seed/*.yaml` | HUB-FR-01–03, 40–43, 45, HUB-NFR-04 |
| `apps/hub-api/src/modules/{config,agents,seed}` | `config` cache cấu hình + poll/NOTIFY `hub_config_changed`; `agents` quyền agent theo group (`agent-access.rules.ts`); `seed` nạp yaml (`runHubSeed`) | HUB-FR-60–62, 74, 75, 77 |
| `apps/hub-api/src/modules/conversations` | E5–E11: hội thoại/flow/tin nhắn, cursor, xoá mềm; `conversations.{routes,service,repo,rules}.ts`, `flows.repo.ts` | HUB-FR-40, 41, 43 |
| `apps/hub-api/src/modules/runs` (+ `sse/`, `close/`) | E12 gửi tin/chạy run (`runs.*`, `run-errors.ts`); `sse/` writer + reader `Last-Event-ID` (Redis Streams); `close/` E15 huỷ (`cancel.*`), lease 10 s, sweeper | HUB-FR-20, 21, 25, 42, 45; R11–R14, R20 |
| `apps/hub-api/src/modules/{runner,orchestrator}` | `runner`: `JobAgentRunner` (INSERT `hub.jobs`, đọc `run:<id>`, orphan sweep); `orchestrator`: vòng lặp định tuyến/`answer`/`delegate` (`orchestrator.{loop,prompt,service,rules}.ts`) | HUB-FR-27–29, 31–33, 83, 86 |
| `apps/agent-runtime` | Agent Runtime Python (WSL2/container); `src/agent_runtime/{main,__main__,config,log}.py` (`python -m agent_runtime`); `contracts/hub.py` (pydantic sinh từ zod) | WRK-FR-01–05, WRK-NFR-04 |
| `apps/agent-runtime/src/agent_runtime/{queue,db,events}` | `queue/` claimer `SKIP LOCKED` + slot, listener, heartbeat, sweeper, orphans; `db/` pool + SQL job/session/usage/finish; `events/` XADD `run:<id>` | WRK-FR-10–12, 14, 24 |
| `apps/agent-runtime/src/agent_runtime/{runtimes/cli,providers,sandbox,agents}` | `runtimes/cli/runner.py` (`CliJobHost`) + `job_run.py`; `providers/{claude,fake}` (`claude-sub`, `fake-cli` chỉ dev/test) + `registry.py`; `sandbox/` (paths, hook, env, process group); `agents/` manifest + `agentic_cli.py` | WRK-FR-15, 17, 20, 23, 25; WRK-BR-07 |
| `packages/contracts/src/hub` | contract Hub↔Runtime (zod): `job`, `events`, `result`, `decision`, `manifest`, `notify`, `errors`, `export` (JSON Schema → pydantic); import `@ai/contracts/hub` | HUB-FR-27–29, 83; WRK-FR-03 |
| `packages/db` (Hub) | `migrations-hub/` (0000 core, 0001 RLS, role `hub_api`/`agent_runtime`), `src/{migrate-hub,hub-scope}.ts` (`hub-scope`: tenant GUC cho `hub_api`), schema `hub` | HUB-FR-20, 74; HUB-NFR-02 |
| `tools/contracts-gen` | `hub.ts`: sinh JSON Schema từ zod → pydantic Runtime; `bun run contracts:check` | HUB-NFR-03 |
| `tools/hub-dev` | `src/dev.ts` (`bun run hub:dev`: migrate → admin-api :3001 → fixture → seed → hub-api :4000 → Runtime container), `fixture.ts` (user `lan/hoa`); dùng bởi `done:h1` | HUB-FR-40–45 |
| `packages/config` | tsconfig dùng chung (`tsconfig/`) | ADM-NFR-06 |
| `packages/contracts` | zod contract; `src/{common,auth,totp,quotas,usage,overview,audit,transfer,tenants,users,secrets,workflows,commands,features,groups,grants,access,config,errors,version-conflict,index}.ts` | ADM-FR-01 |
| `packages/db` | Drizzle; `src/{client,migrate,scope,config-meta,password,seed,env,test-db}.ts`, `schema/{admin,hub-readonly,ops,permissions,totp}.ts`, `migrations/` (0000–0008; 0007 ops M4, 0008 `user_totp`/`user_backup_codes`; 0003 catalog, 0004 RLS/REVOKE catalog, 0005 permissions, 0006 RLS + trigger beta-testers + `config_meta`), `migrations-dev/` | ADM-NFR-06, ADM-NFR-07 |
| `packages/i18n` | locale vi/en + key; `src/index.ts`, `locales/` | ADM-NFR-01 |
| `tools/mocks` | mock Dify + Hub (`bun run mocks`); `src/{server,dify,hub,scenario,fixtures}.ts` | ADM-NFR-06 |
| `tools/scripts` | `check-size`, `depcruise`, `i18n-check`, `keys-dev`, `test-lock`, `trace` (`src/*.ts`) | ADM-NFR-06 |
| `tests/acceptance/{ADM-NFR-06,M1,M2,M3,M4}` | test nghiệm thu (khoá); `rules/`, `*.int.test.ts` | ADM-FR-01…07, 10…50, 60, 61, 63 |
| `e2e` | Playwright: `smoke`, `auth`, `tenants`, `users`, `secrets`, `workflows`, `commands`, `features`, `groups-*`, `access-*`, `conflict-*`, `users-groups`, `m1-flow`, `m2-flow`, `m3-flow`, `m4-{2fa,audit,conflict,overview,quota,transfer,usage}` `.spec.ts`; `support/{helpers,prepare-db}.ts`; config `playwright.config.ts` ở gốc (khoá) | ADM-FR-01, 04, 60 |
