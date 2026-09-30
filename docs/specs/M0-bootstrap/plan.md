# Plan · M0-bootstrap

Chỉ dùng symbol đã thấy trong file thật (Grep xác minh). M0 chưa có code → **mọi symbol dưới đây đều "mới"**. API thư viện bên ngoài (Hono, Drizzle, postgres.js, dependency-cruiser, Biome, lefthook, Turbo) phải đối chiếu `node_modules/<pkg>` sau `bun install` trước khi gọi.
Phần frontend: `plan-frontend.md` (frontend-lead). File này không lặp lại.

## Phiên bản (chốt 2026-10-01 bằng `npm view <pkg> version`, ghi ở ADR-0001)
Ghim **chính xác** (không `^`) trong `package.json`; `bun.lock` commit.

| Package | Bản | Dùng ở |
|---|---|---|
| bun (runtime, `packageManager`) | 1.3.14 | toàn repo, CI |
| @types/bun | 1.3.14 | mọi workspace TS |
| typescript | 6.0.3 | gốc (ADR-0003: không dùng 7.0.2) |
| turbo | 2.11.5 | gốc |
| @biomejs/biome | 2.5.15 | gốc |
| lefthook | 2.1.15 | gốc |
| dependency-cruiser | 18.5.0 | gốc |
| hono | 4.13.12 | admin-api, mocks |
| zod | 4.6.5 | contracts, admin-api, db, mocks |
| drizzle-orm | 0.45.3 | db |
| drizzle-kit | 0.31.11 | db (dev) |
| postgres | 3.4.9 | db (ADR-0003); gốc (dev, cho `tests/acceptance/**/migrate.int.test.ts`) |
| @playwright/test | 1.63.0 | gốc (dev) — theo `plan-frontend.md` §2 |

## Cấu trúc sau M0
```
.
├─ .github/workflows/ci.yml
├─ .gitignore · .gitattributes · .env.example · .dependency-cruiser.cjs
├─ biome.json · lefthook.yml · turbo.json · bunfig.toml · bunfig.int.toml · tsconfig.json · tsconfig.tests.json
├─ playwright.config.ts       # frontend-lead (plan-frontend.md §7)
├─ package.json · bun.lock · compose.yaml
├─ infra/postgres/init/01-create-test-db.sql
├─ apps/admin-api/            # Hono
├─ apps/admin-web/            # frontend-lead — plan-frontend.md
├─ packages/config/tsconfig/{base.json,bun.json,web.json}   # web.json: frontend-lead
├─ packages/i18n/{package.json,tsconfig.json,src/,locales/}  # frontend-lead
├─ packages/contracts/src/{index,health,errors}.ts
├─ packages/db/{drizzle.config.ts,migrations/,migrations-dev/,src/}
├─ tools/mocks/src/
├─ tools/scripts/src/
├─ tests/{acceptance/,.lock}  # qc
└─ e2e/                       # qc
```

## Backend (backend-lead)

### Gốc repo & công cụ

| File | Tạo/Sửa | Symbol / nội dung | Ghi chú |
|---|---|---|---|
| `.gitignore` | Tạo | `node_modules/`, `.turbo/`, `dist/`, `coverage/`, `.env.local`, `.env.*.local`, `*.log`, `test-results/`, `playwright-report/`, `blob-report/`, `.DS_Store`, `Thumbs.db` | `.env.example` được commit; `dist/` bao `apps/admin-web/dist` (fe#3) |
| `.gitattributes` | Tạo | `* text=auto eol=lf` · `*.png binary` · `*.jpg binary` | Hash `tests/.lock` và Biome giống nhau giữa Windows và CI Linux |
| `package.json` (gốc) | Tạo | `name: "ai-system"`, `private: true`, `packageManager: "bun@1.3.14"`, `workspaces: ["apps/*","packages/*","tools/*"]`, `scripts` (bảng dưới), `postinstall: "lefthook install"` | devDeps: typescript, turbo, @biomejs/biome, lefthook, dependency-cruiser, @types/bun, `@playwright/test` 1.63.0 (fe#1), `postgres` 3.4.9, `@ai/contracts` + `@ai/db` (`workspace:*`) — mọi package mà `tests/**`, `e2e/**`, `playwright.config.ts` import phải khai ở đây vì linker `isolated` (qc#4, R8) |
| `turbo.json` | Tạo | tasks `build` (`dependsOn:["^build"]`, `outputs:["dist/**"]`), `typecheck` (`outputs:[]`), `test` (`outputs:[]`), `check:bundle` (`dependsOn:["build"]`, `outputs:[]`; chỉ `@ai/admin-web` có script này), `dev` (`cache:false`, `persistent:true`); `globalPassThroughEnv`: đúng 18 biến spec §7 (`DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `SECRET_MASTER_KEY`, `SMTP_URL`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `CORS_ORIGINS`, `APP_ENV`, `PORT`, `TEST_DATABASE_URL`, `REDIS_URL`, `JWT_KID`, `DIFY_BASE_URL`, `HUB_BASE_URL`, `MOCK_TIMEOUT_MS`, `DIFY_MOCK_PORT`, `HUB_MOCK_PORT`) | Turbo 2 mặc định env strict — thiếu khai báo thì task không thấy env |
| `bunfig.toml` | Tạo | `[install] linker = "isolated"` (ghi tường minh — Bun 1.3.2+ mặc định isolated cho monorepo mới) · `[test] pathIgnorePatterns = ["e2e/**", "**/*.int.test.ts", "**/node_modules/**"]` | BUILD xác minh key bằng một file `e2e/x.spec.ts` tạm; key không nhận → Câu hỏi đã có mặc định (xem Rủi ro R3) |
| `bunfig.int.toml` | Tạo | `[test] pathIgnorePatterns = ["e2e/**"]`, `timeout = 30000` | Dùng qua `bun --config=bunfig.int.toml test …` |
| `tsconfig.json` (gốc) | Tạo | `extends: "./packages/config/tsconfig/bun.json"`, `include: []`, `files: []` | Chỉ cho editor; typecheck chạy theo workspace |
| `tsconfig.tests.json` (gốc) | Tạo | `extends: "./packages/config/tsconfig/bun.json"`, `include: ["tests/**/*.ts", "e2e/**/*.ts", "playwright.config.ts"]` | qc#4: typecheck test của qc. Đặt ở gốc (không `tests/tsconfig.json`) vì `tests/**` thuộc qc. Test import `../../../apps/admin-api/package.json` → cần `resolveJsonModule` (đã có ở base) |
| `biome.json` | Tạo | `vcs {enabled, clientKind:"git", useIgnoreFile:true, defaultBranch:"main"}`; `formatter {indentStyle:"space", indentWidth:2, lineWidth:100, lineEnding:"lf"}`; `javascript.formatter {quoteStyle:"double", semicolons:"always", trailingCommas:"all"}`; `linter.rules.recommended:true` + `suspicious.noExplicitAny:"error"`, `complexity.noExcessiveCognitiveComplexity {level:"error", options:{maxAllowedComplexity:15}}`, `style.noNonNullAssertion:"error"`, `suspicious.noConsole:"off"`; `files.includes` loại `**/migrations/meta/**`, `docs/**`, `**/components/ui/**`, `**/routeTree.gen.ts` (fe#4); `css.parser.tailwindDirectives: true` (fe#4) | Cú pháp theo schema Biome 2.5 (`$schema` trỏ `./node_modules/@biomejs/biome/configuration_schema.json`); `biome check` phải nhận cấu hình không cảnh báo |
| `lefthook.yml` | Tạo | `pre-commit.jobs`: (1) `bunx biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}` (không `--write` → **chặn** commit sai format); (2) `bun tools/scripts/src/check-size.ts --files {staged_files}` | Không `stage_fixed` |
| `.dependency-cruiser.cjs` | Tạo | 10 luật spec T-DEP-1…7 mức `error`, tên: `no-routes-to-repo`, `no-cross-module-repo`, `rules-must-be-pure`, `service-no-http`, `component-no-fetch`, `web-no-db-or-api`, `api-no-web`, `contracts-pure`, `no-circular`, `not-to-unresolvable` (`to: {couldNotResolve:true, pathNot:"^bun(:|$)"}`); `rules-must-be-pure` chặn `to.dependencyTypes:["core"]`; `options {doNotFollow:{path:"node_modules"}, tsPreCompilationDeps:true, builtInModules:{add:["bun","bun:test","bun:sqlite","bun:ffi"]}, exclude:{path:"(^|/)__fixtures__/"}, enhancedResolveOptions:{exportsFields:["exports"], conditionNames:["bun","import","types","default"]}}` | Regex path không neo `^` cho phần `apps/…` để dùng lại trên fixture; T-DEP-2 dùng nhóm `$1` trong `to.pathNot`. Xác minh `builtInModules` trong `node_modules/dependency-cruiser/types/options.d.mts` lúc BUILD |
| `compose.yaml` | Tạo | xem mục Compose | |
| `infra/postgres/init/01-create-test-db.sql` | Tạo | `CREATE DATABASE ai_system_test OWNER ai;` | Chạy 1 lần khi volume trống |
| `.env.example` | Tạo | đúng 18 biến spec §7 (8 nhóm A + 10 nhóm B, thứ tự bảng §7), giá trị dev, khoá để rỗng; thêm 2 dòng comment `# POSTGRES_PORT=5432`, `# REDIS_PORT=6379` (biến shell cho compose) | |
| `.github/workflows/ci.yml` | Tạo | xem mục CI | Không push |

Script gốc (`package.json`):

| Script | Lệnh |
|---|---|
| `dev` | `turbo run dev` (admin-api, mocks, admin-web) |
| `build` | `turbo run build` |
| `typecheck` | `turbo run typecheck && tsc -p tsconfig.tests.json` (mỗi workspace `tsc -p . --noEmit`; lệnh sau phủ `tests/**`, `e2e/**`) |
| `test` | `bun test` |
| `test:int` | `bun --env-file=.env.local --config=bunfig.int.toml test .int.test` (đối số `.int.test` = lọc theo chuỗi con của đường dẫn → chỉ file `*.int.test.ts` ở mọi workspace + `tests/acceptance`) |
| `check` | `biome ci --changed --no-errors-on-unmatched && bun run check:size && bun run depcruise && bun run i18n:check` |
| `check:size` | `bun tools/scripts/src/check-size.ts` |
| `check:bundle` | `turbo run check:bundle` (build admin-web rồi đo, fe#2) |
| `e2e` | `playwright test` (fe#1) |
| `depcruise` | `bun tools/scripts/src/depcruise.ts` (T-DEP-8; `--all` quét toàn bộ) |
| `trace` | `bun tools/scripts/src/trace.ts` |
| `test:lock:verify` | `bun tools/scripts/src/test-lock.ts verify` |
| `test:lock:write` | `bun tools/scripts/src/test-lock.ts write` |
| `i18n:check` | `bun tools/scripts/src/i18n-check.ts` |
| `keys:dev` | `bun tools/scripts/src/keys-dev.ts` |
| `db:generate` | `bun run --cwd packages/db generate` (script workspace `generate` = `bun --env-file=../../.env.local drizzle-kit generate`) |
| `db:migrate` | `bun --env-file=.env.local packages/db/src/migrate.ts` |
| `mocks` | `bun tools/mocks/src/server.ts` |

Mọi script chạy từ gốc repo nên Bun tự nạp `.env.local` ở gốc. Task `dev` của workspace (cwd = thư mục package) dùng `bun --env-file=../../.env.local`.

### packages/config

| File | Tạo/Sửa | Nội dung | Ghi chú |
|---|---|---|---|
| `packages/config/package.json` | Tạo | `@ai/config`, `exports: {"./tsconfig/base.json": "./tsconfig/base.json", "./tsconfig/bun.json": "./tsconfig/bun.json", "./tsconfig/web.json": "./tsconfig/web.json"}` (`web.json` do frontend-lead tạo, fe#8) | Không có code |
| `packages/config/tsconfig/base.json` | Tạo | `strict:true`, `noUncheckedIndexedAccess:true`, `noImplicitOverride:true`, `noFallthroughCasesInSwitch:true`, `verbatimModuleSyntax:true`, `isolatedModules:true`, `moduleDetection:"force"`, `resolveJsonModule:true`, `skipLibCheck:true`, `noEmit:true`, `target:"ES2023"`, `lib:["ES2023"]`, `module:"Preserve"`, `moduleResolution:"bundler"`, `types:[]` | TS 6 đổi vài mặc định → ghi tường minh mọi tuỳ chọn, không dựa mặc định |
| `packages/config/tsconfig/bun.json` | Tạo | `extends: ./base.json`, `types:["bun"]` | api, db, contracts, tools. `web.json` do frontend-lead |

**Workspace TS phía backend (readiness r#2, linker isolated).** Mỗi workspace dưới đây khai devDeps `"@ai/config": "workspace:*"`, `"@types/bun": "1.3.14"`, `"typescript": "6.0.3"` (`types:["bun"]` được resolve từ `node_modules/@types` của chính workspace; bin `tsc` của script `typecheck` lấy từ workspace). `tsconfig.json` extends bằng đường dẫn tương đối:

| Workspace | `tsconfig.json` `extends` | `include` |
|---|---|---|
| `apps/admin-api` | `../../packages/config/tsconfig/bun.json` | `["src"]` |
| `packages/contracts` | `../config/tsconfig/bun.json` | `["src"]` |
| `packages/db` | `../config/tsconfig/bun.json` | `["src", "drizzle.config.ts"]` |
| `tools/mocks` | `../../packages/config/tsconfig/bun.json` | `["src"]` |
| `tools/scripts` | `../../packages/config/tsconfig/bun.json` | `["src"]`, `exclude: ["src/__fixtures__"]` (fixture cố ý vi phạm luật import, không typecheck) |
| gốc `tsconfig.json`, `tsconfig.tests.json` | `./packages/config/tsconfig/bun.json` | như bảng Gốc repo |

### packages/contracts

| File | Tạo/Sửa | Symbol | Ghi chú |
|---|---|---|---|
| `packages/contracts/package.json` | Tạo | `@ai/contracts`, `exports: {".": "./src/index.ts"}`, dep `zod`; devDeps chung (bảng workspace TS); script `typecheck: "tsc -p . --noEmit"` | Package nội bộ dạng source (không build) |
| `packages/contracts/tsconfig.json` | Tạo | `extends: "../config/tsconfig/bun.json"`, `include: ["src"]` | |
| `packages/contracts/src/health.ts` | Tạo | `HealthResponseSchema`, `type HealthResponse` | spec §3.1 |
| `packages/contracts/src/errors.ts` | Tạo | `ErrorResponseSchema`, `type ErrorResponse`, `BASE_ERROR_CODES = ["NOT_FOUND","INTERNAL_ERROR"] as const`, `type BaseErrorCode` | spec §3.1 |
| `packages/contracts/src/index.ts` | Tạo | re-export | |
| `packages/contracts/src/contracts.test.ts` | Tạo | parse hợp lệ / không hợp lệ (version `1.0`, code thường, thừa trường → lỗi `.strict()`) | unit |

### apps/admin-api

| File | Tạo/Sửa | Symbol | Ghi chú |
|---|---|---|---|
| `apps/admin-api/package.json` | Tạo | `@ai/admin-api`, `version: "0.0.0"`, scripts `dev: "bun --env-file=../../.env.local --watch src/server.ts"`, `typecheck: "tsc -p . --noEmit"`; deps `hono`, `zod`, `@ai/contracts: "workspace:*"`; devDeps chung (bảng workspace TS) | |
| `apps/admin-api/tsconfig.json` | Tạo | `extends: "../../packages/config/tsconfig/bun.json"`, `include: ["src"]` | |
| `apps/admin-api/src/config/env.ts` | Tạo | `EnvSchema`, `type Env`, `loadEnv(source: Record<string, string \| undefined>): Env` — ném `Error` liệt kê tên biến sai (không in giá trị) | Chỉ `APP_ENV`, `PORT`, `CORS_ORIGINS` |
| `apps/admin-api/src/lib/errors.ts` | Tạo | `class AppError extends Error { constructor(readonly code: string, readonly status: ContentfulStatusCode, message: string, readonly details?: unknown) }` (gọi `new AppError(code, status, message, details?)`; `ContentfulStatusCode` từ `hono/utils/http-status` — xác minh export lúc BUILD), `toErrorBody(code, message, details?): ErrorResponse` (không thêm key `details` khi `undefined`) | CONVENTIONS §5, spec §3.1 |
| `apps/admin-api/src/lib/logger.ts` | Tạo | `logger.info/warn/error(msg, fields)` → 1 dòng JSON `{level, time, msg, request_id?, module?, …}`; `redact(fields)` thay giá trị key khớp `/pass|secret|token|key|authorization|cookie/i` bằng `"[redacted]"` | Không log body |
| `apps/admin-api/src/app.ts` | Tạo | `type AppConfig = { version: string; corsOrigins: string[] }`; `createApp(cfg: AppConfig): Hono` — middleware `requestId` (hono/request-id, validator theo regex spec §3.1), `cors({ origin: cfg.corsOrigins, credentials: true, exposeHeaders: ["X-Request-Id"] })`, access log; `app.route("/health", healthRoutes(cfg))`; `notFound` → 404 `NOT_FOUND`; `onError` → `AppError` giữ status/code, lỗi khác → 500 `INTERNAL_ERROR` + log `error` có stack (không trả stack) | Factory để test in-process, không đọc env |
| `apps/admin-api/src/server.ts` | Tạo | đọc `loadEnv(process.env)`, `version` từ `../package.json`, `Bun.serve({ port, fetch: app.fetch })`, log `listening` | Chỉ file này có I/O khởi động |
| `apps/admin-api/src/modules/health/README.md` | Tạo | FR: ADM-NFR-06 (hạ tầng); điểm vào `healthRoutes`; không phụ thuộc DB | ≤ 30 dòng |
| `apps/admin-api/src/modules/health/health.routes.ts` | Tạo | `healthRoutes(cfg: Pick<AppConfig,"version">): Hono` — `GET /` trả `HealthResponseSchema.parse({ status: "ok", version: cfg.version })` (`.parse` ném → `onError` → 500, qc#7) | Không cần service: không nghiệp vụ |
| `apps/admin-api/src/modules/health/health.test.ts` | Tạo | 200 + body + header `X-Request-Id`; request-id hợp lệ được giữ, không hợp lệ bị thay | unit, `app.request()` |
| `apps/admin-api/src/app.test.ts` | Tạo | 404 body; `createApp({ version: "x" })` → `/health` 500 body đúng, không chứa stack; `new AppError("X_Y", 418, "teapot")` → 418 body `{"error":{"code":"X_Y","message":"teapot"}}`, có `details` khi truyền (route gắn tạm trên instance trả về); header `Access-Control-Expose-Headers` chứa `X-Request-Id` | unit |
| `apps/admin-api/src/config/env.test.ts` | Tạo | `PORT=abc` lỗi có tên biến, không có giá trị; `CORS_ORIGINS` tách dấu phẩy | unit |

### packages/db

| File | Tạo/Sửa | Symbol | Ghi chú |
|---|---|---|---|
| `packages/db/package.json` | Tạo | `@ai/db`, `exports: {".": "./src/index.ts", "./test-db": "./src/test-db.ts"}`, deps `drizzle-orm`, `postgres`, `zod`; devDeps `drizzle-kit` + devDeps chung (bảng workspace TS); scripts `typecheck`, `generate: "bun --env-file=../../.env.local drizzle-kit generate"` | |
| `packages/db/tsconfig.json` | Tạo | `extends: "../config/tsconfig/bun.json"`, `include: ["src", "drizzle.config.ts"]` | |
| `packages/db/drizzle.config.ts` | Tạo | `defineConfig({ dialect:"postgresql", schema:"./src/schema/admin.ts", out:"./migrations", schemaFilter:["admin"], dbCredentials:{ url: loadDbEnv(process.env).DATABASE_URL } })` | `hub` không do Admin sinh migration; `loadDbEnv` cho kiểu `string` (r#18) |
| `packages/db/src/env.ts` | Tạo | `DbEnvSchema` (`DATABASE_URL` url `postgres://…`, `APP_ENV` enum), `loadDbEnv(source)` | |
| `packages/db/src/client.ts` | Tạo | `createDb(url: string, opts?: { max?: number }): { db: PostgresJsDatabase; close(): Promise<void> }` — `postgres(url, { max: opts.max ?? 10, onnotice: () => {} })` + `drizzle(sql)` | Import `drizzle-orm/postgres-js` — xác minh đường dẫn trong `node_modules/drizzle-orm/postgres-js` |
| `packages/db/src/schema/admin.ts` | Tạo | `export const admin = pgSchema("admin")` — chưa có bảng | M1 thêm bảng vào đây hoặc `schema/admin/*.ts` |
| `packages/db/src/schema/hub-readonly.ts` | Tạo | `hub = pgSchema("hub")`; `agentWorkflows`, `agentGrants`, `usageLogs` khớp spec §4.2 | Chỉ để Admin đọc có kiểu; **không** nằm trong `drizzle.config.ts` |
| `packages/db/src/migrate.ts` | Tạo | `runMigrations(opts: { url: string; appEnv: AppEnv }): Promise<{ main: number; dev: number }>` — `main`/`dev` = số migration **vừa áp** trong lần gọi (đếm `count(*)` bảng theo dõi trước/sau mỗi `migrate()`, bảng chưa tồn tại = 0; qc#3); `migrate(db, { migrationsFolder: <abs>/migrations })` rồi, nếu `appEnv !== "production"`, `migrate(db, { migrationsFolder: <abs>/migrations-dev, migrationsTable: "__drizzle_migrations_dev" })`; `if (import.meta.main)` → `const env = loadDbEnv(process.env)`; `runMigrations({ url: env.DATABASE_URL, appEnv: env.APP_ENV })`, log số migration, exit 0/1 (r#18) | `migrate` từ `drizzle-orm/postgres-js/migrator` (xác minh chữ ký `migrationsTable`, `migrationsSchema` trong d.ts) |
| `packages/db/src/index.ts` | Tạo | re-export `createDb`, `admin`, bảng hub-readonly, `runMigrations` | |
| `packages/db/migrations/0000_init_schemas.sql` + `meta/_journal.json`, `meta/0000_snapshot.json` | Tạo | sinh bằng `bunx drizzle-kit generate --custom --name=init_schemas`, rồi điền SQL spec §4.1 | Không sửa tay journal |
| `packages/db/migrations-dev/0000_hub_stub.sql` + `meta/` | Tạo | sinh bằng `drizzle-kit generate --custom --name=hub_stub --out=./migrations-dev` (hoặc config riêng `drizzle.dev.config.ts` nếu CLI không nhận `--out` cùng `--custom`), điền DDL spec §4.2 | |
| `packages/db/src/test-db.ts` | Tạo | `resetTestDb(url: string \| undefined): Promise<void>` — `url` rỗng/vắng → ném `Error("TEST_DATABASE_URL chưa đặt")`; **từ chối** nếu tên DB không kết thúc `_test` → ném `Error("resetTestDb: tên DB phải kết thúc _test")`; `DROP SCHEMA IF EXISTS admin, hub, drizzle CASCADE` | Dùng chung cho test tích hợp (qc được import) |
| `packages/db/src/migrate.int.test.ts` | Tạo | trên `TEST_DATABASE_URL`: reset → migrate(test) → 3 bảng hub, role, `has_table_privilege('admin_rw','hub.usage_logs','SELECT')`; chạy lại → `{main:0, dev:0}`; reset → migrate(production) → không có bảng hub | Unit/integration của backend; AC chính thức do qc |
| `packages/db/src/env.test.ts` | Tạo | url sai giao thức → lỗi | unit |

### Compose (`compose.yaml`)

| Service | Image | Cổng host | Env | Healthcheck | Volume |
|---|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `${POSTGRES_PORT:-5432}:5432` | `POSTGRES_USER=ai`, `POSTGRES_PASSWORD=ai_dev_pw`, `POSTGRES_DB=ai_system` | `pg_isready -h 127.0.0.1 -U ai -d ai_system`, interval 5s, timeout 3s, retries 12 | `pgdata:/var/lib/postgresql/data`, `./infra/postgres/init:/docker-entrypoint-initdb.d:ro` |
| `redis` | `redis:7-alpine` | `${REDIS_PORT:-6379}:6379` | — | `redis-cli ping` (mong `PONG`), 5s/3s/12 | `redisdata:/data`, command `redis-server --appendonly yes` |
| `mailpit` | `axllent/mailpit:<tag>` | `1025:1025`, `8025:8025` | `MP_SMTP_AUTH_ACCEPT_ANY=1`, `MP_SMTP_AUTH_ALLOW_INSECURE=1` | `["CMD","/mailpit","readyz"]`, 5s/3s/12 | không (thư dev không cần giữ) |

`name: ai-system`. Tag image: `postgres:16-alpine` và `redis:7-alpine` theo major đã chốt ở ADR-0001; tag Mailpit cụ thể = tag release mới nhất tại lúc BUILD (tra trang release/Docker Hub), ghi vào ADR-0001 — không dùng `latest`. `docker compose up -d --wait` là lệnh chuẩn (chờ healthy).

### tools/mocks

| File | Tạo/Sửa | Symbol | Ghi chú |
|---|---|---|---|
| `tools/mocks/package.json` | Tạo | `@ai/mocks`, deps `hono`, `zod`; devDeps chung (bảng workspace TS); scripts `dev: "bun --env-file=../../.env.local src/server.ts"`, `typecheck` | |
| `tools/mocks/src/scenario.ts` | Tạo | `type Scenario = "ok" \| "unauthorized" \| "timeout"`; `type ScenarioTokens = { ok: string; unauthorized: string; timeout: string }`; `pickScenario(input: { header?: string; authorization?: string; tokens: ScenarioTokens }): Scenario` — hàm thuần theo spec T-MOCK-1 (header lạ → bỏ qua; `authorization` không khớp `/^bearer (.+)$/i` → `unauthorized`); `isPlainObject(v: unknown): v is Record<string, unknown>` (object, khác `null`, không phải mảng) | |
| `tools/mocks/src/fixtures.ts` | Tạo | hằng body cố định spec §3.2/§3.3 (`DIFY_WORKFLOW_RUN_OK(inputs)`, `DIFY_CHAT_OK(query)`, `DIFY_PARAMETERS`, `HUB_TEST_RUN_OK(inputs)` (có `trace: []`), `HUB_EFFECTIVE_OK`, lỗi) | |
| `tools/mocks/src/dify.ts` | Tạo | `createDifyMock(opts: { timeoutMs: number }): Hono` | Middleware chọn kịch bản chạy trước; `unauthorized` → 401 ngay; `timeout` → `await Bun.sleep(timeoutMs)` rồi mới validate; body không phải JSON → `{}`; kiểm `query` → `inputs` → `user` → `response_mode`, báo trường đầu tiên sai (spec §3.2, qc#9) |
| `tools/mocks/src/hub.ts` | Tạo | `createHubMock(opts: { timeoutMs: number }): Hono` | `GET /health` không qua middleware kịch bản; còn lại cùng thứ tự như Dify; `/internal/test-run` kiểm `command` → `inputs` bằng `isPlainObject`; `user_id` theo regex uuid spec §3.3 |
| `tools/mocks/src/env.ts` | Tạo | `loadMockEnv(source): { difyPort: number; hubPort: number; timeoutMs: number }` — zod: `DIFY_MOCK_PORT`/`HUB_MOCK_PORT` số nguyên 1–65535 (mặc định 4010/4020), `MOCK_TIMEOUT_MS` số nguyên ≥ 0 (mặc định 30000); sai → ném `Error` nêu tên biến | |
| `tools/mocks/src/server.ts` | Tạo | `loadMockEnv(process.env)` → `Bun.serve` 2 cổng (Dify, Hub) | Chỉ file này có I/O khởi động |
| `tools/mocks/src/scenario.test.ts`, `dify.test.ts`, `hub.test.ts`, `env.test.ts` | Tạo | mỗi endpoint × 3 kịch bản; header `X-Mock-Scenario` lạ bị bỏ qua; `Authorization: Basic x` → 401; mảng không phải object; timeout test dùng `timeoutMs: 50` và `AbortSignal.timeout(20)` phía client → abort; timeout + body sai → 400 sau ≥ 50 ms; env sai → lỗi có tên biến | unit, in-process |

### tools/scripts

| File | Tạo/Sửa | Symbol | Ghi chú |
|---|---|---|---|
| `tools/scripts/package.json` | Tạo | `@ai/scripts`, script `typecheck`; devDeps chung (bảng workspace TS); không dep runtime (dùng `Bun.Glob`, `Bun.CryptoHasher`, `Bun.spawnSync`, `node:crypto`). dependency-cruiser **không** khai ở đây: gọi bản ở gốc qua `Bun.resolveSync("dependency-cruiser/package.json", <gốc repo>)` (lỗi → dự phòng `<gốc repo>/node_modules/dependency-cruiser/package.json`) → đọc `bin.depcruise` → `Bun.spawnSync([process.execPath, <bin tuyệt đối>, …])` | |
| `tools/scripts/src/lib/git.ts` | Tạo | `changedFiles(cwd): string[]` (spec T-SIZE-4), `hasRef(ref): boolean`, `listFiles(globs): string[]` (tracked + untracked không ignore, qua `git ls-files -co --exclude-standard`) | Dùng chung check-size, test-lock, depcruise |
| `tools/scripts/src/check-size.ts` | Tạo | `countLines(text): number`, `limitFor(path): number \| null` (null = miễn trừ/không phải code), `checkFiles(files: {path, text}[]): Violation[]`, CLI `--all` / `--files` | spec T-SIZE-1…5 |
| `tools/scripts/src/check-size.test.ts` | Tạo | 400 → OK, 401 → vi phạm, test 600/601, `components/ui` miễn, `.md` bỏ qua, file rỗng 0 dòng, có/không `\n` cuối | unit |
| `tools/scripts/src/depcruise.ts` | Tạo | `pickEntries(files: string[]): string[]` (lọc đuôi code dưới `apps/ packages/ tools/`, bỏ `__fixtures__`); CLI: có `main` và không `--all` → `depcruise <entries…> --config .dependency-cruiser.cjs --output-type err` với entries từ `changedFiles()` (gồm untracked); entries rỗng → `depcruise: không có file đổi`, exit 0; không có `main` hoặc `--all` → `depcruise apps packages tools …`; trả exit code của depcruise | spec T-DEP-8, qc#5. Danh sách dài → chia lô ≤ 200 file/lần gọi (giới hạn độ dài dòng lệnh Windows) |
| `tools/scripts/src/depcruise.test.ts` + `src/__fixtures__/depcruise/apps/x-api/src/modules/{a,b}/…` | Tạo | fixture vi phạm T-DEP-1, T-DEP-2, T-DEP-3 (gồm `x.rules.ts` import `bun:sqlite` → `rules-must-be-pure`, **không** `not-to-unresolvable`) → mỗi luật xuất hiện trong output JSON; fixture sạch (có import `bun:test`) → 0 vi phạm | Chạy bin dependency-cruiser (resolve như `package.json` ở trên) với `cwd = tools/scripts/src/__fixtures__/depcruise`, đối số `apps --config <gốc repo tuyệt đối>/.dependency-cruiser.cjs --output-type json` (r#4: path trong kết quả là `apps/...`, `exclude` `__fixtures__` không áp) |
| `tools/scripts/src/trace.ts` | Tạo | `parseCatalog(mdFiles): Req[]`, `parseSpecs(files): SpecRef[]`, `scanRefs(files, kind): Map<id, path[]>` (bỏ `**/__fixtures__/**`; `kind: "test"` → `testRefs(path, text): string[]` = mã trong path ∪ mã khớp `(it|test|describe)\(\s*["'`]<mã>\b`, spec T-TRACE-2), `buildTrace(...): TraceRow[]`, `splitPrelude(md): string` (phần trước dòng `\| FR \|`, qc#11), `renderTraceMd(prelude, rows): string`, `checkGaps(rows): TraceRow[]`; CLI `[<mã>] [--check]` | spec T-TRACE-1…4 |
| `tools/scripts/src/trace.test.ts` | Tạo | catalog từ md mẫu (MUST/SHOULD/không ưu tiên), spec approved thiếu test → gap, mã không tồn tại; file test chứa mã chỉ trong chuỗi dữ liệu → **không** tính, trong `it("<mã> · …")` → tính; file dưới `__fixtures__/` bị bỏ. **Luật:** dữ liệu mẫu trong file test không viết nguyên văn `it("<mã>`; dựng tên qua biến `IT`/`TEST`/`DESCRIBE` (test-plan §1) | unit, dữ liệu inline |
| `tools/scripts/src/test-lock.ts` | Tạo | `hashFile(text): string` (CRLF→LF, sha256 hex), `buildLock(files): string`, `parseLock(text): Map<path, hash>`, `diffLock(expected, actual): LockDiff[]`; CLI `verify` / `write` | spec T-LOCK-1…3; `write` in cảnh báo "chỉ qc chạy" |
| `tools/scripts/src/test-lock.test.ts` | Tạo | CHANGED / MISSING / UNLOCKED, CRLF = LF, lock rỗng + không file → OK, thiếu lock → lỗi | unit, thư mục tạm |
| `tools/scripts/src/i18n-check.ts` | Tạo | `flattenKeys(obj): string[]`, `diffKeys(vi, en)`; CLI (0 file → bỏ qua, 1 file → lỗi thiếu file, 2 file → so key) | spec T-I18N-1 |
| `tools/scripts/src/i18n-check.test.ts` | Tạo | lồng 3 cấp, thiếu key 1 bên, chỉ có 1 file locale | unit |
| `tools/scripts/src/keys-dev.ts` | Tạo | `generateDevSecrets(): DevSecrets` (`generateKeyPairSync("ed25519")` → PEM PKCS8/SPKI; `randomBytes(32).toString("base64")`), `mergeEnv(text, values, force): string` (chỉ điền key rỗng; key vắng → thêm `KEY=value` cuối file; giữ comment/thứ tự/kiểu xuống dòng), `readEnvValue(text, key): string \| undefined`, `isProduction(procEnv, envLocalText?): boolean` (true nếu `procEnv.APP_ENV` **hoặc** `APP_ENV` trong `.env.local` = `production`), CLI | spec T-KEYS-1; không in giá trị |
| `tools/scripts/src/keys-dev.test.ts` | Tạo | `mergeEnv` không ghi đè giá trị có sẵn, ghi đè khi `force`, thêm key vắng ở cuối, giữ CRLF; PEM ký/verify được bằng `node:crypto` `sign(null, …)`; `isProduction` đúng với từng nguồn | unit |

### CI (`.github/workflows/ci.yml`)
- `on: pull_request` + `push: branches: [main]`; `concurrency` theo ref; `permissions: contents: read`.
- Job `ci` trên `ubuntu-latest`, `services.postgres` = `postgres:16-alpine` (env như compose, `options: --health-cmd "pg_isready -U ai" --health-interval 5s --health-retries 12`, port 5432), tạo DB test bằng `psql` step (không mount init script được trong service).
- Env job: `APP_ENV=test`, `DATABASE_URL`, `TEST_DATABASE_URL`, `CORS_ORIGINS`, `PORT` (giá trị như `.env.example`).
- Steps: `actions/checkout` (`fetch-depth: 0` để `--changed` và T-DEP-8 so với `main`) → `git fetch origin main:main` (`if: github.ref != 'refs/heads/main'`; PR checkout ở HEAD tách rời, không có nhánh local `main` — r#7) → `oven-sh/setup-bun` (`bun-version: 1.3.14`) → `actions/setup-node` (`node-version: 22`, Rsbuild CLI chạy bằng Node) → `bun install --frozen-lockfile` → `bun run check` → `bun run typecheck` → `bun test` → `bunx playwright install --with-deps chromium` → `bun run --filter @ai/admin-web build` → `bun run --filter @ai/admin-web check:bundle` → `bunx playwright test` → `bun run db:migrate` → `bun run test:int` → `bun run test:lock:verify` → `bun run trace --check`; cuối: `actions/upload-artifact` `playwright-report/` với `if: failure()`.
- 8 step AC17 giữ đúng thứ tự; 4 step e2e (fe#7) xen giữa `bun test` và `db:migrate` (ci-workflow.test.ts cho phép xen).
- Bản action: major mới nhất của `actions/checkout`, `oven-sh/setup-bun`, `actions/setup-node`, `actions/upload-artifact` tại lúc BUILD (tra trang release), ghim theo major và ghi vào ADR-0001.
- `db:migrate` và `test:int` trong CI dùng env job (không có `.env.local`): script dùng `--env-file` phải không lỗi khi file không tồn tại — BUILD xác minh; nếu Bun lỗi, script bọc kiểm tồn tại trước.

## Frontend (frontend-lead)
Xem `plan-frontend.md`. Điểm backend cần khớp: scope `@ai/*`; admin-web dùng `packages/config/tsconfig/web.json` (FE tạo, chỉ ghi đè `lib` + thêm `jsx`, fe#8) cho mã browser và `apps/admin-web/tsconfig.node.json` (kiểu Bun) cho script/test node — đường dẫn cụ thể theo `plan-frontend.md`; backend-lead thêm `"./tsconfig/web.json"` vào `exports` của `@ai/config`; cổng dev admin-web = origin trong `CORS_ORIGINS` (`http://localhost:3000`); admin-api `http://localhost:3001`.

## Edge case xử lý
- Repo chưa có commit / chưa có nhánh `main` → `check:size`, `depcruise` quét toàn bộ thay vì lỗi; `biome ci --changed --no-errors-on-unmatched` không lỗi khi không có file đổi.
- Push lên `main` trong CI: `--changed` so `main` với chính nó → 0 file → exit 0 (chấp nhận; PR mới là nơi kiểm).
- `.env.local` có CRLF (Windows) → `mergeEnv` giữ nguyên kiểu xuống dòng hiện có.
- Cổng 5432/6379 bị Postgres/Redis cài sẵn chiếm → đổi `POSTGRES_PORT`/`REDIS_PORT` trong shell và `DATABASE_URL` tương ứng.
- `db:migrate` khi Postgres chưa healthy → lỗi kết nối rõ ràng (`ECONNREFUSED` + gợi ý `docker compose up -d --wait`), exit 1, không retry vô hạn.
- `resetTestDb` gọi trên DB không có hậu tố `_test` → ném lỗi, không xoá.
- Role đã tồn tại (dev DB và test DB chung cluster) → migration idempotent, không lỗi.
- Hub mock `timeout`: server vẫn trả 200 sau `MOCK_TIMEOUT_MS`; test không được chờ 30 s (truyền `timeoutMs` nhỏ).

## Rủi ro regression
- R1 · TypeScript 6.0.3 thay vì 7.0.2 (dependency-cruiser 18.5.0 chỉ nhận `typescript >=2 <7` — `src/meta.cjs`). Nâng TS 7 khi depcruise hỗ trợ → ADR mới.
- R2 · Bun 1.3.14 < bản mới nhất 1.4.2 → Câu hỏi 2.
- R3 · `bunfig.toml [test] pathIgnorePatterns` chưa kiểm trên máy (cờ CLI `--path-ignore-patterns` có trong `bun test --help` 1.3.14). Không nhận → script `test` gốc thêm cờ CLI; `bun test` trần sẽ nạp `e2e/*.spec.ts` → hỏi docs-architect đổi đuôi e2e (CONVENTIONS §2).
- R4 · `ioredis` 6.0.0 là major mới — chưa cài ở M0; M1+ đánh giá lại.
- R5 · Turbo env strict: quên khai biến → task `dev` không thấy env → lỗi `loadEnv` rõ tên biến.
- R6 · `drizzle-kit generate --custom` cho thư mục thứ hai: nếu CLI không hỗ trợ → `drizzle.dev.config.ts` riêng.
- R8 · Linker `isolated` (Bun 1.3.2+ mặc định cho monorepo mới, nguồn: https://bun.com/blog/bun-v1.3.2): gốc chỉ thấy dep khai ở gốc → test của qc import `postgres`/`@ai/*` phải có ở devDeps gốc (đã khai). Công cụ nào không resolve được peer (drizzle-kit, router-plugin, dependency-cruiser ↔ typescript) → **trước tiên** khai peer đó làm dep trực tiếp của workspace dùng nó (vd `@tanstack/router-plugin` không thấy `@rsbuild/core`/`@rspack/core` → frontend-lead khai trực tiếp trong `apps/admin-web`); vẫn không được mới đổi `linker = "hoisted"` theo Luật 2, ghi "Quyết định trong lúc làm".
- R7 · git 2.34.1 trên máy: `git init -b` có từ 2.28 — ổn; lefthook 2.x cần git ≥ 2.31 (xác minh khi `lefthook install`).

## ADR mới (nếu có)
- `docs/adr/0003-postgres-driver-typescript-pin.md` — Proposed (driver `postgres`; ghim TypeScript 6.0.3). Số 0002 để trống cho ADR thư viện M1 theo readiness #40 (recharts, jose, argon2id). react-i18next **không** thuộc ADR-0002: cùng TanStack Router/Query chuyển Accepted trong ADR-0001 khi duyệt Gate M0 (M0 đã cài và dùng).
- `docs/adr/0001-stack.md` — điền bảng phiên bản phần backend/hạ tầng (không đổi dòng Accepted); dòng "Hạ tầng dev" sửa: mock chạy bằng bun script (`tools/mocks`), không trong compose.
