# CODEMAP — module → file chính

Chỉ để **định vị**; mở file thật trước khi dùng API. Code thắng khi mâu thuẫn. Do `docs-architect` cập nhật sau mỗi mốc. Trạng thái: M0 (khung, chưa có nghiệp vụ).

| Đường dẫn | Vai trò · điểm vào | FR |
|---|---|---|
| `apps/admin-api` | Hono API; `src/app.ts`, `server.ts`, `config/env.ts`, `lib/{errors,logger}.ts`, `modules/health/` | ADM-NFR-06 |
| `apps/admin-web` | Rsbuild + React + TanStack Router; `src/main.tsx`, `app/`, `routes/`, `features/home/`; `scripts/` check bundle | ADM-NFR-06 |
| `packages/config` | tsconfig dùng chung (`tsconfig/`) | ADM-NFR-06 |
| `packages/contracts` | zod contract; `src/{health,errors,index}.ts` | ADM-NFR-06 |
| `packages/db` | Drizzle; `src/{client,migrate,env,test-db}.ts`, `schema/{admin,hub-readonly}.ts`, `migrations/`, `migrations-dev/` | ADM-NFR-06 |
| `packages/i18n` | locale vi/en + key; `src/index.ts`, `locales/` | ADM-NFR-06 |
| `tools/mocks` | mock Dify + Hub (`bun run mocks`); `src/{server,dify,hub,scenario,fixtures}.ts` | ADM-NFR-06 |
| `tools/scripts` | `check-size`, `depcruise`, `i18n-check`, `keys-dev`, `test-lock`, `trace` (`src/*.ts`) | ADM-NFR-06 |
| `tests/acceptance/ADM-NFR-06` | test nghiệm thu M0 (khoá), gồm `ac07.check.ts`, `*.int.test.ts` | ADM-NFR-06 |
| `e2e` | Playwright (`smoke.spec.ts`, cấu hình `playwright.config.ts` ở gốc; khoá) | ADM-NFR-06 |
