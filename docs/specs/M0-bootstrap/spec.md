---
id: M0-bootstrap
title: Khung repo, công cụ và hạ tầng dev
milestone: M0
status: approved         # draft → ready → approved → in-progress → done
requirements: [ADM-NFR-06]
design: [docs/ROADMAP.md#M0, docs/adr/0001-stack.md, docs/CONVENTIONS.md, docs/WORKFLOW.md, docs/design/agent-hub/ba-agent-hub.md#8-mô-hình-dữ-liệu-schema-hub, docs/readiness/2026-10-01-admin-m1-m4.md]
owner: backend-lead + frontend-lead
---

# M0 Bootstrap — khung repo, công cụ và hạ tầng dev

Phần web scaffold (`apps/admin-web`, `packages/config/tsconfig/web.json`, `packages/i18n`, Playwright) do frontend-lead viết ở `plan-frontend.md`. File này và `plan.md` chỉ phủ phần backend + hạ tầng.

## 1. Phạm vi

**Làm:**
- Git: `git init -b main`, `.gitignore`, `.gitattributes` (`* text=auto eol=lf`), commit đầu trên `main`, làm việc trên `feat/M0-bootstrap`.
- Monorepo Bun workspaces + Turborepo: `apps/admin-api`, `apps/admin-web` (FE), `packages/contracts`, `packages/db`, `packages/config`, `tools/mocks`, `tools/scripts`, `tests/`, `e2e/`.
- TypeScript strict dùng chung (`packages/config/tsconfig/base.json`), Biome (`biome.json`), lefthook (pre-commit), dependency-cruiser (`.dependency-cruiser.cjs`).
- Script gốc: `dev`, `build`, `typecheck`, `test`, `test:int`, `check`, `check:size`, `check:bundle`, `depcruise`, `trace`, `test:lock:verify`, `test:lock:write`, `i18n:check`, `keys:dev`, `db:generate`, `db:migrate`, `mocks`, `e2e`.
- File gốc phục vụ frontend (nội dung theo `plan-frontend.md` §12, backend-lead tạo): devDependency `@playwright/test`, task Turbo `check:bundle`, `.gitignore` cho `dist/`/Playwright, Biome bỏ qua `routeTree.gen.ts` + `css.parser.tailwindDirectives`, bước e2e trong CI. `playwright.config.ts` do frontend-lead tạo.
- `tsconfig.tests.json` (gốc) để `bun run typecheck` phủ cả `tests/**`, `e2e/**`, `playwright.config.ts`.

**Phạm vi yêu cầu:** M0 chỉ phủ vế "schema được quản lý bằng migration có version" của `ADM-NFR-06`. Vế "seed tenant `platform`, feature `core`, `platform_admin` đầu tiên từ env" thuộc **M1** (cần bảng `admin.*`); spec M1 phải liệt kê lại `ADM-NFR-06` trong `requirements:` và có test seed. Trạng thái `có test` của `ADM-NFR-06` trong `docs/TRACE.md` sau M0 **không** có nghĩa NFR đã xong.
- `apps/admin-api`: Hono, chỉ `GET /health`.
- `packages/contracts`: `HealthResponseSchema`, `ErrorResponseSchema`.
- `packages/db`: Drizzle, kết nối, migration `0000_init_schemas` (schema `admin`, `hub`, role `admin_rw`, `hub_ro`) + migration dev/test `hub-stub` (3 bảng `hub.*`).
- Docker Compose: Postgres 16, Redis 7, Mailpit, healthcheck, volume.
- `tools/mocks`: mock Dify và mock Hub (Hono) với 3 kịch bản cố định: `ok`, `unauthorized`, `timeout`.
- CI GitHub Actions (chỉ file, không push).
- Chốt phiên bản package trong `docs/adr/0001-stack.md`; ADR-0003 (driver Postgres, bản TypeScript).

**Không làm:** bảng nghiệp vụ `admin.*` (M1), RLS policy (M1), auth/JWT verify (M1), Redis client trong code (chưa có chỗ dùng), seed tenant/user (M1), seed usage mẫu `hub.usage_logs` (M4, cần id tenant/feature), deploy, push, secret thật.

## 2. Nghiệp vụ (luật công cụ, cụ thể hoá `CONVENTIONS.md`)

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| T-SIZE-1 | File code = đuôi `.ts .tsx .js .jsx .mjs .cjs`. Số dòng = số ký tự `\n` + 1 nếu ký tự cuối không phải `\n` (file rỗng = 0). File code thường: `> 400` → vi phạm | CONVENTIONS §4 |
| T-SIZE-2 | File test (`*.test.ts(x)`, `*.spec.ts(x)`, mọi file dưới `tests/`, `e2e/`): `> 600` → vi phạm | CONVENTIONS §4 |
| T-SIZE-3 | Miễn trừ: `**/components/ui/**`, `**/migrations/**`, `**/migrations-dev/**`, `**/*.gen.ts`, `**/*.generated.ts`, `bun.lock`, `docs/TRACE.md`, mọi file bị `.gitignore` | CONVENTIONS §4 |
| T-SIZE-4 | Tập file kiểm (mặc định): hợp của `git diff --name-only --diff-filter=ACMR main...HEAD`, `git diff --name-only --diff-filter=ACMR HEAD`, `git ls-files --others --exclude-standard`. Không có nhánh `main` hoặc chưa có commit → mọi file tracked + untracked. `--all` → toàn repo. `--files <a> <b>…` → đúng các file đó (lefthook) | CONVENTIONS §1, §4 |
| T-SIZE-5 | Có vi phạm → in từng dòng `<path>: <n> dòng > <giới hạn>`, exit 1. Không vi phạm → in `check:size OK (<k> file)`, exit 0 | — |
| T-DEP-1 | `*.routes.ts` không import `*.repo.ts` (`no-routes-to-repo`) | CONVENTIONS §2 |
| T-DEP-2 | File trong `modules/<A>/` không import `modules/<B>/*.repo.ts` với B ≠ A (`no-cross-module-repo`) | CONVENTIONS §2 |
| T-DEP-3 | `*.rules.ts` không import `*.repo.ts`, `*.service.ts`, `*.routes.ts`, `packages/db`, `drizzle-orm`, `postgres`, `ioredis`, `hono`, module core Node/Bun (`rules-must-be-pure`) | CONVENTIONS §2 |
| T-DEP-4 | `*.service.ts` không import `hono` hay `*.routes.ts` (`service-no-http`) | CONVENTIONS §2 |
| T-DEP-5 | `apps/*-web/src/features/*/components/**` không import `api.ts` của feature, `src/lib/http*` (`component-no-fetch`) | CONVENTIONS §2 |
| T-DEP-6 | `apps/*-web/**` không import `packages/db`, `apps/*-api/**` (`web-no-db-or-api`); `apps/*-api/**` không import `apps/*-web/**` (`api-no-web`); `packages/contracts/**` không import `packages/db`, `apps/**` (`contracts-pure`) | CONVENTIONS §2 |
| T-DEP-7 | Không vòng import (`no-circular`); không import không resolve được (`not-to-unresolvable`, trừ module khớp `^bun(:\|$)`). `bun`, `bun:test`, `bun:sqlite`, `bun:ffi` khai là module core (`options.builtInModules.add`) → `rules-must-be-pure` chặn chúng như `node:*`. Tổng **10 luật** (T-DEP-1…7), mọi luật mức `error` | — |
| T-DEP-8 | Tập file quét của `bun run depcruise`: có nhánh `main` → các file `.ts .tsx .js .mjs .cjs` dưới `apps/`, `packages/`, `tools/` trong tập T-SIZE-4 (gồm cả untracked), truyền làm điểm vào cho `depcruise` (theo import đi ra); tập rỗng → in `depcruise: không có file đổi`, exit 0. Không có `main`/chưa commit hoặc cờ `--all` → quét `apps packages tools`. Không dùng `--affected` (không thấy file untracked) | test-plan §6 #5 |
| T-CLI-1 | Mọi CLI trong `tools/scripts` lấy gốc repo = `git rev-parse --show-toplevel` chạy tại `cwd` (không theo vị trí file script). Dòng OK in ra stdout; vi phạm/lỗi in ra stderr; exit 0 = sạch, 1 = vi phạm/lỗi | test-plan §6 #6 |
| T-LOCK-1 | Tập khoá = file tracked + untracked-không-ignore dưới `tests/acceptance/**` và `e2e/**`. Hash = sha256 hex của nội dung sau khi đổi `\r\n` → `\n` | WORKFLOW "Luật khoá test" |
| T-LOCK-2 | `tests/.lock`: dòng đầu `# tests/.lock — sinh bởi bun run test:lock:write (chỉ qc). Không sửa tay.`, sau đó mỗi file một dòng `<sha256>  <path posix>`, sắp theo path tăng dần, kết thúc `\n`. Tập rỗng → chỉ dòng đầu | — |
| T-LOCK-3 | `verify`: thiếu file `tests/.lock` → exit 1 `tests/.lock không tồn tại`. Lệch → in từng dòng `CHANGED <path>` / `MISSING <path>` (có trong lock, không có trên đĩa) / `UNLOCKED <path>` (có trên đĩa, không có trong lock), exit 1. Khớp → `test:lock OK (<n> file)`, exit 0 | — |
| T-TRACE-1 | Mã yêu cầu: regex `\b(ADM\|HUB\|WRK)-(FR\|NFR\|BR)-\d{2,3}\b`. Danh mục + ưu tiên lấy từ bảng trong `docs/design/**/ba-*.md` (dòng bắt đầu `\| <mã> \|`, ưu tiên = `MUST\|SHOULD\|COULD\|WON'T` trong `**…**` cuối dòng; không có → `—`) | Luật 5 |
| T-TRACE-2 | Spec = `docs/specs/*/spec.md` (trừ `_template`) có mã trong `requirements:` của frontmatter. Code = file không phải test, đuôi code theo T-SIZE-1 (không tính `.md`, `.json`), dưới `apps/`, `packages/`, `tools/` chứa mã. Test = file dưới `tests/`, `e2e/` hoặc `*.test.ts(x)` / `*.spec.ts(x)` mà (a) path chứa mã, hoặc (b) nội dung có tên test/describe bắt đầu bằng mã — regex `(it\|test\|describe)\(\s*["'`]<mã>\b` (quy ước tên `"<mã> · …"`). Mã chỉ nằm ở chỗ khác trong file test (dữ liệu mẫu, comment) **không** tính. Bỏ qua mọi file dưới `**/__fixtures__/**` ở cả code lẫn test | Luật 5 |
| T-TRACE-3 | Trạng thái một mã: `chưa spec` · `có spec` · `có code` · `có test` (mức cao nhất đạt được, test cần có spec). `--check`: exit 1 khi có mã **MUST** thuộc spec `status ∈ {approved, in-progress, done}` mà không có test; in danh sách | TRACE.md |
| T-TRACE-4 | `bun run trace` (không đối số) ghi lại toàn bộ `docs/TRACE.md`, giữ nguyên từng byte phần mở đầu = mọi dòng đứng trước dòng tiêu đề bảng đầu tiên (dòng bắt đầu `\| FR \|`); không có dòng đó → giữ 3 dòng đầu. `bun run trace <mã>` chỉ in ra stdout: ưu tiên, spec, code, test, trạng thái; không ghi file; mã không có trong danh mục → exit 1 `Không tìm thấy <mã>` | — |
| T-I18N-1 | `i18n:check`: nếu chưa có `packages/i18n/locales/vi.json` và `en.json` → in `i18n:check: chưa có locale, bỏ qua`, exit 0. Có cả hai → so tập key phẳng (`a.b.c`), key thiếu ở bên nào in `MISSING_<lang> <key>`, exit 1. Chỉ có một trong hai → in `i18n:check: thiếu packages/i18n/locales/<lang>.json`, exit 1 | readiness #52, test-plan §6 #10 |
| T-KEYS-1 | `keys:dev`: đọc `APP_ENV` từ **cả** `process.env` và `.env.local` (nếu có); nguồn nào bằng `production` → exit 1 `keys:dev: không chạy khi APP_ENV=production`, không ghi. Chưa có `.env.local` → chép từ `.env.example`. Key vắng hẳn trong file → thêm dòng `KEY=value` ở cuối file (giữ kiểu xuống dòng hiện có). Điền nếu đang rỗng: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` (cặp Ed25519, PEM PKCS8/SPKI), `JWT_KID` (`dev-<YYYYMMDD>`), `SECRET_MASTER_KEY` (32 byte ngẫu nhiên, base64), `SEED_ADMIN_PASSWORD` (20 ký tự `[A-Za-z0-9]`). Đã có giá trị → giữ nguyên, trừ khi `--force`. Không in giá trị khoá ra stdout | readiness #39, ADR-0001 |
| T-MOCK-1 | Chọn kịch bản mock, theo thứ tự: (1) header `X-Mock-Scenario` có và giá trị ∈ `{ok, unauthorized, timeout}` (khớp chính xác) → dùng giá trị đó; giá trị khác (lạ, rỗng) → bỏ qua header. (2) Không có header `Authorization`, hoặc không có dạng `Bearer <token>` (tiền tố `Bearer ` không phân biệt hoa thường) → `unauthorized`. (3) Theo token (bảng §3.3); token không có trong bảng → `ok` | — |

## 3. Contract (backend-lead)

### 3.1 admin-api
File: `packages/contracts/src/health.ts`, `packages/contracts/src/errors.ts`

| Method | Path | Role | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|---|
| GET | `/health` | công khai | — | 200 `HealthResponse` | 500 · `INTERNAL_ERROR` |
| * | đường dẫn không tồn tại | — | — | — | 404 · `NOT_FOUND` |

- `HealthResponseSchema = z.object({ status: z.literal("ok"), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/) }).strict()` — `version` = trường `version` trong `apps/admin-api/package.json` (M0: `0.0.0`).
- `ErrorResponseSchema = z.object({ error: z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/), message: z.string().min(1).max(500), details: z.unknown().optional() }).strict() }).strict()` — định dạng chung CONVENTIONS §5, readiness #4.
- M0 chỉ có 2 mã: `NOT_FOUND` (404, message `Not found`), `INTERNAL_ERROR` (500, message `Internal server error`, không lộ stack).
- `GET /health` dựng body rồi `HealthResponseSchema.parse(...)` (ném lỗi, không `safeParse` im lặng) trước khi trả. Hệ quả có chủ đích, được test khoá: `createApp({ version })` với `version` sai định dạng (vd `"x"`) → `GET /health` trả 500 body đúng `{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}`. Đây là cách duy nhất ở M0 để kiểm nhánh 500 mà không thêm tham số test vào `createApp`.
- Mọi response có header `X-Request-Id` (nhận từ request nếu có và khớp `^[A-Za-z0-9._-]{1,128}$`, không thì sinh mới).
- CORS: cho các origin trong `CORS_ORIGINS` (phân tách bằng dấu phẩy, bỏ khoảng trắng hai đầu), `credentials: true`, `exposeHeaders: ["X-Request-Id"]` (admin-web đọc được id khi báo lỗi).
- Lỗi có chủ đích ném `new AppError(code: string, status: ContentfulStatusCode, message: string, details?: unknown)` (`apps/admin-api/src/lib/errors.ts`); `onError` trả đúng `status` + `{error:{code, message, details?}}` (`details` vắng thì không có key).
- Không có NOTIFY / sự kiện ở M0.

### 3.2 Mock Dify (`tools/mocks`, cổng `4010`, base `http://localhost:4010/v1`)
Theo Dify Service API (blocking mode). Giá trị cố định để test so khớp tuyệt đối.

| Method | Path | Request | 200 (kịch bản `ok`) |
|---|---|---|---|
| POST | `/v1/workflows/run` | `{inputs: object, response_mode: "blocking", user: string}` | `{workflow_run_id:"mock-wfr-0001", task_id:"mock-task-0001", data:{id:"mock-wfr-0001", workflow_id:"mock-wf-0001", status:"succeeded", outputs:{text:"mock:"+JSON.stringify(inputs)}, error:null, elapsed_time:0.12, total_tokens:42, total_steps:3, created_at:1767225600, finished_at:1767225601}}` |
| POST | `/v1/chat-messages` | `{query: string, inputs: object, response_mode: "blocking", user: string, conversation_id?: string}` | `{event:"message", message_id:"mock-msg-0001", conversation_id:"mock-conv-0001", mode:"chat", answer:"mock answer: "+query, metadata:{usage:{prompt_tokens:30, completion_tokens:12, total_tokens:42, total_price:"0.000100", currency:"USD", latency:0.12}}, created_at:1767225600}` |
| GET | `/v1/parameters` | — | `{user_input_form:[{"text-input":{label:"text",variable:"text",required:true,max_length:256,default:""}},{"select":{label:"lang",variable:"lang",required:true,options:["vi","en"],default:"vi"}}], system_parameters:{}}` |

Lỗi: 401 `{code:"unauthorized", message:"Access token is invalid", status:401}` · body sai → 400 `{code:"invalid_param", message:…, status:400}`.
Thứ tự: kịch bản (401) kiểm **trước** body; kịch bản `timeout` **chờ trước** `timeoutMs` rồi mới validate body (body sai → 400 sau khi chờ). Body kiểm theo thứ tự cố định, báo **trường đầu tiên** sai: `query` (chỉ `/v1/chat-messages`) → `inputs` → `user` → `response_mode`. "object" = giá trị JSON kiểu object, khác `null`, không phải mảng. Thiếu trường hoặc sai kiểu → message `<trường> is required`; `response_mode` có nhưng ≠ `"blocking"` → message `response_mode must be blocking`. Body không phải JSON → như `{}`.

### 3.3 Mock Hub (`tools/mocks`, cổng `4020`, base `http://localhost:4020`)
Theo `ba-agent-hub.md` §9.1 — chỉ các endpoint Admin sẽ gọi.

| Method | Path | Request | 200 (kịch bản `ok`) |
|---|---|---|---|
| GET | `/health` | — (không cần token) | `{status:"ok", version:"mock"}` |
| POST | `/internal/test-run` | `{command: object, inputs: object}` — chỉ kiểm **kiểu** object, không kiểm trường bên trong `command` | `{run_id:"00000000-0000-7000-8000-000000000001", status:"succeeded", output:{text:"mock:"+JSON.stringify(inputs)}, ms:120, trace:[]}` |
| GET | `/agent-grants/effective/:user_id` | `user_id` uuid | `{items:[{agent_id:"00000000-0000-7000-8000-0000000000a1", key:"invoice-checker", name:{vi:"Kiểm tra hoá đơn", en:"Invoice checker"}, reasons:["group:mock-group"]}]}` |

`/internal/test-run` là **hình tạm** cho Admin dev/test: HUB-FR-51 (`ba-agent-hub.md`) chỉ nói "chạy thử *command* bản nháp gửi trong body, trả kết quả và trace"; body/response chính thức chốt ở spec M2 theo HUB-FR-51, khi đó sửa mock theo.

Lỗi: 401 `{error:{code:"UNAUTHORIZED", message:"Invalid token"}}` · body/param sai → 400 `{error:{code:"VALIDATION_FAILED", message:"<trường> không hợp lệ"}}`.
Thứ tự giống Dify: kịch bản trước (401 ngay; `timeout` chờ rồi mới validate); body không phải JSON → như `{}`; kiểm `command` → `inputs` ("object" như §3.2), báo trường đầu tiên sai. `user_id` của `/agent-grants/effective/:user_id` phải khớp `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`, sai → 400 `user_id không hợp lệ`.

**Chọn kịch bản theo token** (cả hai mock, trừ `GET /health` của Hub):

| Bearer token | Kịch bản | Hành vi |
|---|---|---|
| `app-mock-ok` (Dify) · `mock-ok` (Hub) · mọi token khác không nằm dưới | `ok` | 200 như bảng trên |
| `app-mock-401` · `mock-401` · thiếu `Authorization` | `unauthorized` | 401 ngay |
| `app-mock-timeout` · `mock-timeout` | `timeout` | chờ `MOCK_TIMEOUT_MS` (mặc định 30000) rồi trả 200 như `ok` — client phải tự huỷ |

### 3.4 Mock: đường dẫn / method không tồn tại
Cả mock Dify và mock Hub: path hoặc method không có → **404** `{"error":{"code":"NOT_FOUND","message":"Not found"}}`, xét **sau** khi đã chọn kịch bản (401/timeout của kịch bản vẫn áp dụng trước).

## 4. Dữ liệu (backend-lead)

### 4.1 Migration chính `packages/db/migrations/0000_init_schemas.sql` (mọi môi trường)
- `CREATE SCHEMA IF NOT EXISTS admin; CREATE SCHEMA IF NOT EXISTS hub;`
- Role (idempotent `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = …) … $$`): `admin_rw NOLOGIN`, `hub_ro NOLOGIN`.
- Quyền:
  - `admin_rw`: `USAGE ON SCHEMA admin`; `ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO admin_rw`; `… GRANT USAGE, SELECT ON SEQUENCES TO admin_rw`; `USAGE ON SCHEMA hub`.
  - `hub_ro`: `USAGE ON SCHEMA admin`; `ALTER DEFAULT PRIVILEGES IN SCHEMA admin GRANT SELECT ON TABLES TO hub_ro`.
- Không tạo bảng. Default privileges áp cho bảng do role chạy migration tạo (owner) — M1 tạo bảng bằng cùng owner.
- Bảng theo dõi: `drizzle.__drizzle_migrations` (mặc định Drizzle).

### 4.2 Migration dev/test `packages/db/migrations-dev/0000_hub_stub.sql`
Chạy **chỉ khi** `APP_ENV ∈ {development, test}`, sau migration chính, bảng theo dõi `drizzle.__drizzle_migrations_dev`. Hub thật sẽ sở hữu các bảng này bằng migration của Hub; stub chỉ cho Admin dev/test đọc (`ba-agent-hub.md` §8, readiness #11, mâu thuẫn 1: Admin đọc 3 bảng).

| Bảng | Cột | Kiểu | Null | Default | Ràng buộc / index | RLS |
|---|---|---|---|---|---|---|
| `hub.agent_workflows` | `agent_id` | uuid | NOT NULL | — | PK (`agent_id`, `workflow_id`) | không (stub) |
| | `workflow_id` | uuid | NOT NULL | — | index `agent_workflows_workflow_id_idx` (Admin FR-13 kiểm "workflow đang được agent dùng"); không FK (bảng đích ở M2) | |
| | `created_by` | uuid | NULL | — | | |
| | `created_at` | timestamptz | NOT NULL | `now()` | | |
| `hub.agent_grants` | `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | không (stub) |
| | `agent_id` | uuid | NOT NULL | — | unique `agent_grants_uq` (`agent_id`, `tenant_id`, `subject_type`, `subject_id`) | |
| | `tenant_id` | uuid | NOT NULL | — | index `agent_grants_subject_idx` (`tenant_id`, `subject_type`, `subject_id`) | |
| | `subject_type` | text | NOT NULL | — | CHECK `subject_type IN ('group','user')` | |
| | `subject_id` | uuid | NOT NULL | — | | |
| | `granted_by` | uuid | NULL | — | | |
| | `granted_at` | timestamptz | NOT NULL | `now()` | | |
| `hub.usage_logs` | `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | không (stub) |
| | `tenant_id` | uuid | NOT NULL | — | index `usage_logs_tenant_at_idx` (`tenant_id`, `at`) | |
| | `run_id`, `step_id`, `user_id`, `feature_id`, `agent_id` | uuid | NULL | — | index `usage_logs_tenant_feature_at_idx` (`tenant_id`, `feature_id`, `at`) | |
| | `provider_key`, `model` | text | NULL | — | | |
| | `billing` | text | NOT NULL | — | CHECK `billing IN ('api','subscription','dify')` | |
| | `input_tokens`, `output_tokens` | integer | NOT NULL | `0` | CHECK `>= 0` | |
| | `cost_usd`, `billable_usd` | numeric(14,6) | NULL | — | NULL = "Chưa định giá" (readiness #32) | |
| | `overage` | boolean | NOT NULL | `false` | | |
| | `latency_ms` | integer | NULL | — | | |
| | `at` | timestamptz | NOT NULL | `now()` | | |

Quyền trong `hub_stub`: `GRANT SELECT ON hub.agent_workflows, hub.agent_grants, hub.usage_logs TO admin_rw`.
`gen_random_uuid()` chỉ dùng cho stub; bảng admin M1 dùng uuid v7 sinh ở app (readiness #16, Postgres 16 chưa có `uuidv7()`).

Seed: không có ở M0. Drizzle schema cho `admin` (`packages/db/src/schema/admin.ts`) chỉ khai `pgSchema("admin")`, chưa có bảng.

## 5. UI (frontend-lead)
Xem `plan-frontend.md`.

## 6. Hiệu năng
- `GET /health` không chạm DB/Redis; p95 < 20 ms trên máy dev (đo bằng 200 request tuần tự `app.request`).
- `bun run check` < 30 s trên repo M0; `bun test` toàn bộ < 30 s, unit (`bun test apps packages tools`) < 10 s; `docker compose up -d` tới healthy < 60 s (sau khi đã pull image).
- Không có query nghiệp vụ; index stub nêu ở §4.2.

## 7. Phụ thuộc & giả lập

| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Dify | `tools/mocks` cổng 4010 (`bun run mocks`, cũng chạy trong `bun run dev`); test dùng in-process `createDifyMock({ timeoutMs }).request(...)` (`timeoutMs` bắt buộc; test dùng `50`, server đọc `MOCK_TIMEOUT_MS`) |
| Agent Hub | `tools/mocks` cổng 4020, in-process `createHubMock({ timeoutMs }).request(...)`; bảng `hub.*` bằng migration `hub-stub` |
| Postgres 16 | compose `postgres` cổng `${POSTGRES_PORT:-5432}`, DB `ai_system` + `ai_system_test` (init script) |
| Redis 7 | compose `redis` cổng `${REDIS_PORT:-6379}` (M0 chưa dùng trong code) |
| SMTP | compose `mailpit` SMTP `1025`, UI `8025` |

Env (`.env.example`; `.env.local` không commit). Nhóm A = đúng danh sách readiness #39 (8 biến); nhóm B = bổ sung (10 biến, xem Câu hỏi 1).

| Nhóm | Tên | Giá trị dev |
|---|---|---|
| A | `DATABASE_URL` | `postgres://ai:ai_dev_pw@localhost:5432/ai_system` |
| A | `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | rỗng — `bun run keys:dev` điền (PEM, xuống dòng viết `\n` trong chuỗi `"…"`) |
| A | `SECRET_MASTER_KEY` | rỗng — `keys:dev` điền (32 byte base64) |
| A | `SMTP_URL` | `smtp://localhost:1025` |
| A | `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | `admin` / rỗng — `keys:dev` điền |
| A | `CORS_ORIGINS` | `http://localhost:3000` (khớp cổng dev của admin-web trong `plan-frontend.md`) |
| B | `APP_ENV` | `development` (`development` \| `test` \| `production`) |
| B | `PORT` | `3001` (admin-api) |
| B | `TEST_DATABASE_URL` | `postgres://ai:ai_dev_pw@localhost:5432/ai_system_test` |
| B | `REDIS_URL` | `redis://localhost:6379` |
| B | `JWT_KID` | rỗng — `keys:dev` điền `dev-<YYYYMMDD>` (readiness #5) |
| B | `DIFY_BASE_URL` | `http://localhost:4010/v1` |
| B | `HUB_BASE_URL` | `http://localhost:4020` |
| B | `MOCK_TIMEOUT_MS` | `30000` (chỉ mock; số nguyên ≥ 0) |
| B | `DIFY_MOCK_PORT` | `4010` (chỉ mock; 1–65535) |
| B | `HUB_MOCK_PORT` | `4020` (chỉ mock; 1–65535) |

`.env.example` = đúng **18 biến** trên (8 nhóm A + 10 nhóm B; `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` và `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` mỗi cặp là 2 biến), cùng thứ tự bảng. `POSTGRES_PORT`, `REDIS_PORT` chỉ có dạng comment (`# POSTGRES_PORT=5432`, `# REDIS_PORT=6379` — compose đọc biến này từ shell/`.env`, không từ `.env.local`). `turbo.json` `globalPassThroughEnv` = đúng 18 biến này. `tools/mocks/src/server.ts` validate `DIFY_MOCK_PORT`, `HUB_MOCK_PORT`, `MOCK_TIMEOUT_MS` (vắng → mặc định; sai → exit 1, in tên biến, không in giá trị).

`apps/admin-api/src/config/env.ts` ở M0 chỉ validate biến nó dùng: `APP_ENV`, `PORT` (1–65535), `CORS_ORIGINS` (danh sách URL). Biến khác validate ở mốc dùng tới.

## 8. Tiêu chí nghiệm thu (qc)
Máy: Windows 11 + Git Bash, bun 1.3.14, Docker 29.6.1. Chạy tuần tự từ gốc repo, sau `bun run keys:dev`.

| AC | Lệnh | Kết quả mong đợi | Test |
|---|---|---|---|
| M0-AC01 | `bun install` (repo sạch, không có `node_modules`) rồi `bun install --frozen-lockfile` | exit 0 cả hai; gộp stdout+stderr của cả hai lần **không** có dòng khớp `/warn.*peer\|peer.*(missing\|warn)/i`; sha256 `bun.lock` giống nhau trước/sau lần 2 | CI step + test-plan §4 `ac01` |
| M0-AC02 | `docker compose up -d --wait --wait-timeout 60` (image đã pull sẵn) rồi `docker compose ps --format json` | lệnh 1 exit 0 và thời gian đồng hồ ≤ 60 s; đúng 3 service `postgres`, `redis`, `mailpit`, cả 3 `Health = "healthy"` (đầu ra `ps` có thể là mảng JSON hoặc NDJSON) | test-plan §4 `ac02` + CI (service postgres) |
| M0-AC03 | `bun run db:migrate` (APP_ENV=development) rồi `docker compose exec -T postgres psql -U ai -d ai_system -Atc "select table_schema\|\|'.'\|\|table_name from information_schema.tables where table_schema in ('admin','hub') order by 1"` | exit 0; in đúng 3 dòng `hub.agent_grants`, `hub.agent_workflows`, `hub.usage_logs`; schema `admin` tồn tại (`select 1 from pg_namespace where nspname='admin'` → `1`); role `admin_rw`, `hub_ro` tồn tại; chạy `db:migrate` lần 2 exit 0, không đổi gì; `runMigrations` lần 2 trả `{ main: 0, dev: 0 }` (= số migration **vừa áp** trong lần gọi đó, không phải tổng) | `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` (qc) + test-plan §4 `ac03` |
| M0-AC04 | `runMigrations({ url: TEST_DATABASE_URL, appEnv: "production" })` trên DB test vừa `resetTestDb` | schema `admin`, `hub` có; **không** có bảng `hub.*`; không có bảng `drizzle.__drizzle_migrations_dev`; trả `{ main: 1, dev: 0 }` | `migrate.int.test.ts` (qc) |
| M0-AC05 | `bun run check` | exit 0 | CI step |
| M0-AC06 | `bun run typecheck` | exit 0: mọi workspace (`turbo run typecheck`) **và** `tsc -p tsconfig.tests.json` (phủ `tests/**`, `e2e/**`, `playwright.config.ts`) | CI step |
| M0-AC07 | `bun test` rồi `bun tests/acceptance/ADM-NFR-06/ac07.check.ts` | `bun test` exit 0 trong < 30 s (unit riêng `bun test apps packages tools` < 10 s), đầu ra không có đường dẫn dưới `e2e/` hay `*.int.test.ts`; `ac07.check.ts` exit 0 (mỗi workspace có code, trừ `packages/config`, có ≥ 1 `*.test.ts(x)`) | CI step + test-plan §4 `ac07` |
| M0-AC08 | `bun run dev` (hoặc `bun run --filter @ai/admin-api dev`) rồi `curl -s -i localhost:3001/health` | `HTTP/1.1 200`; body khớp `{"status":"ok","version":"0.0.0"}`; có header `X-Request-Id` | `tests/acceptance/ADM-NFR-06/health.test.ts` (in-process) + `server.int.test.ts` (server thật, cổng 3091) (qc) |
| M0-AC09 | `curl -s -i localhost:3001/khong-co` | 404, body `{"error":{"code":"NOT_FOUND","message":"Not found"}}`; nhánh 500 theo §3.1 (version sai định dạng) | như trên |
| M0-AC10 | Tạo `tmp-bad.ts` chứa `const  a=1` (sai format), `git add tmp-bad.ts && git commit -m "test"` | commit bị từ chối (exit ≠ 0), Biome báo lỗi format; HEAD không đổi; xoá file sau khi thử | test-plan §4 `ac10` |
| M0-AC11 | Tạo `apps/admin-api/src/tmp-401.ts` gồm 401 dòng `export const x = 1;`, chạy `bun run check:size` | exit 1, in `apps/admin-api/src/tmp-401.ts: 401 dòng > 400`; đổi thành 400 dòng → exit 0; xoá file | `tests/acceptance/ADM-NFR-06/check-size.test.ts` (qc) + `tools/scripts/src/check-size.test.ts` (unit) + test-plan §4 `ac11` |
| M0-AC12 | Thêm vào `apps/admin-api/src/modules/health/` cặp `x.routes.ts` import `./x.repo.ts`, chạy `bun run depcruise` | exit 1, báo `no-routes-to-repo` (file untracked vẫn bị bắt, T-DEP-8); xoá file → exit 0 | `tools/scripts/src/depcruise.test.ts` (fixture) + test-plan §4 `ac12` |
| M0-AC13 | `bun run test:lock:verify` với `tests/.lock` vừa ghi | exit 0 `test:lock OK (<n> file)`; sửa 1 byte một file trong `tests/acceptance/` → exit 1 `CHANGED <path>` | `tests/acceptance/ADM-NFR-06/test-lock.test.ts` (qc) + `tools/scripts/src/test-lock.test.ts` |
| M0-AC14 | `bun run trace` rồi `bun run trace ADM-NFR-06` | ghi `docs/TRACE.md` có dòng `ADM-NFR-06`; lệnh 2 in spec `docs/specs/M0-bootstrap/spec.md` và exit 0; `bun run trace ADM-FR-999` exit 1 | `tests/acceptance/ADM-NFR-06/trace.test.ts` (qc) + `tools/scripts/src/trace.test.ts` |
| M0-AC15 | `bun run mocks` rồi `curl -s -X POST localhost:4010/v1/workflows/run -H "Authorization: Bearer app-mock-401" -d '{}'` | 401 body Dify §3.2; token `app-mock-ok` + body hợp lệ → 200 `data.status = "succeeded"` | `tests/acceptance/ADM-NFR-06/mocks.test.ts` (qc) + `tools/mocks/src/*.test.ts` |
| M0-AC16 | `bun run i18n:check` | exit 0 trên repo thật (locale `vi`/`en` của `packages/i18n` khớp key); hành vi đủ nhánh theo T-I18N-1 | `tests/acceptance/ADM-NFR-06/i18n-check.test.ts` (qc) |
| M0-AC17 | `.github/workflows/ci.yml` | YAML hợp lệ (`bun -e "Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text())"` exit 0); có đủ step install → check → typecheck → test → db:migrate → test:int → test:lock:verify → trace --check (được xen step khác, gồm các step e2e của AC18/19), dùng bun 1.3.14; `on` gồm `pull_request` và `push` nhánh `main`; `permissions: contents: read` | `tests/acceptance/ADM-NFR-06/ci-workflow.test.ts` (qc) |
| M0-AC18 | `bunx playwright install chromium && bunx playwright test e2e/smoke.spec.ts` (webServer = build + preview admin-web cổng 3000, `playwright.config.ts`) | exit 0: `/` status 200; landmark `main`; heading level 1 `Admin Console`; text `Bảng quản trị nền tảng AI`; img `EvoluConsulting` hiện, `naturalWidth > 0`; title `Admin Console`; `html[lang="vi"]`; không có console error / pageerror | `e2e/smoke.spec.ts` (qc) |
| M0-AC19 | `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle` | exit 0; JS ban đầu ≤ 150 KB gzip, CSS ban đầu ≤ 25 KB gzip (ngân sách `plan-frontend.md` §6); vượt → exit 1, in từng dòng vượt | lệnh kiểm (test-plan §4 FE) + CI step |

Lệnh xong M0: `bun install --frozen-lockfile && docker compose up -d --wait && bun run db:migrate && bun run check && bun run typecheck && bun test && bun tests/acceptance/ADM-NFR-06/ac07.check.ts && bun run test:int && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check`

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Chấp nhận mọi mặc định trong `docs/readiness/2026-10-01-admin-m1-m4.md` (2026-10-01), áp dụng ở M0: #2 (tasks.md có đường dẫn), #11 (**chỉ phần migration** `hub-stub`; seed usage mẫu `hub.usage_logs` dời M4 vì cần id tenant/feature), #12 (lệnh xong dạng lệnh), #39 (env), #40 (chốt version — phần backend ở ADR-0001/0003), #16/#17 (uuid v7 ở app, role `admin_rw`/`hub_ro`).
- JWT EdDSA Ed25519 (ADR-0001).
### Đề xuất của backend-lead (duyệt cùng Gate)
- Driver Postgres `postgres` (postgres.js); TypeScript ghim 6.0.3 thay vì 7.0.2 — ADR-0003.
- Bun ghim 1.3.14 (bản đang cài), `@types/bun` 1.3.14 — xem Câu hỏi 2.
- Test tích hợp đặt tên `*.int.test.ts`, chạy bằng `bun run test:int`, không nằm trong `bun test` — docs-architect ghi vào CONVENTIONS §2.
- Workspace công cụ ở `tools/*` (`tools/mocks`, `tools/scripts`), scope package `@ai/*`.
- Mock chạy bằng bun script (`bun run mocks`, nằm trong `turbo dev`), không đưa vào compose — compose chỉ giữ dịch vụ có trạng thái.
### Đề xuất chờ Gate M0
Nguồn: `qc#n` = `test-plan.md` §6 mục n; `fe#n` = `plan-frontend.md` §12 mục n. Duyệt cùng Gate; không trả lời → áp dụng như ghi.

| Nguồn | Quyết định |
|---|---|
| qc#1 | AC01: "không cảnh báo peer" = gộp stdout+stderr hai lần `bun install` không có dòng khớp `/warn.*peer\|peer.*(missing\|warn)/i`; sha256 `bun.lock` giống trước/sau lần 2 (§8 AC01). |
| qc#2 | AC02: đo thời gian đồng hồ của `docker compose up -d --wait --wait-timeout 60` sau khi image đã pull; `ps --format json` chấp nhận mảng hoặc NDJSON (§8 AC02). |
| qc#3 | `runMigrations` trả `{ main, dev }` = số migration **vừa áp** trong lần gọi (đếm dòng bảng theo dõi trước/sau vì `migrate()` của Drizzle trả `void`); lần 2 → `{0,0}`; production trên DB trống → `{1,0}` (§8 AC03/AC04, plan.md). |
| qc#4 | Đổi so với mặc định qc: **không** đặt `tests/tsconfig.json` (thư mục `tests/**` thuộc qc, backend-lead không được sửa) mà tạo `tsconfig.tests.json` ở **gốc** (extends `packages/config/tsconfig/bun.json`, `include: ["tests/**/*.ts","e2e/**/*.ts","playwright.config.ts"]`, `types: ["bun"]`; `@playwright/test` tự mang kiểu qua import). Script `typecheck` gốc = `turbo run typecheck && tsc -p tsconfig.tests.json`. devDependency gốc thêm `postgres` 3.4.9, `@ai/contracts`/`@ai/db` (`workspace:*`), `@playwright/test` 1.63.0 — bắt buộc vì Bun 1.3 dùng linker `isolated` mặc định cho monorepo mới (root chỉ thấy dep khai ở root); ghi tường minh `[install] linker = "isolated"` trong `bunfig.toml`. |
| qc#5 | `depcruise` không dùng `--affected` (bỏ sót file untracked); wrapper `tools/scripts/src/depcruise.ts` truyền tập file T-SIZE-4 làm điểm vào (T-DEP-8). `git add -N` trong runbook chỉ là dự phòng. |
| qc#6 | CLI lấy gốc repo theo `cwd` (`git rev-parse --show-toplevel`); OK ra stdout, vi phạm/lỗi ra stderr; test gộp hai kênh (T-CLI-1). |
| qc#7 | Chấp nhận: nhánh 500 kiểm bằng `createApp({ version: "x", … })` → `GET /health` 500 `INTERNAL_ERROR` (health parse qua schema bằng `.parse`, §3.1). Không thêm `extraRoutes`/cờ test vào `createApp`. |
| qc#8 | §7 sửa thành `createDifyMock({ timeoutMs })` / `createHubMock({ timeoutMs })`, `timeoutMs` bắt buộc. |
| qc#9 | Dify mock báo **trường đầu tiên** sai theo thứ tự `query` → `inputs` → `user` → `response_mode`; `response_mode` ≠ `blocking` → message `response_mode must be blocking` (§3.2). qc giữ cách kiểm (message chỉ ở ca thiếu đúng một trường). |
| qc#10 | Chỉ có một trong `vi.json`/`en.json` → exit 1, in `i18n:check: thiếu packages/i18n/locales/<lang>.json` (T-I18N-1). qc có thể thêm ca này trước LOCK. |
| qc#11 | `trace` giữ nguyên toàn bộ phần mở đầu trước dòng `\| FR \|` của `docs/TRACE.md` (hiện là: tiêu đề, dòng trống, 2 dòng mô tả, dòng trống), bao trùm kiểm "3 dòng đầu không đổi" của qc (T-TRACE-4). |
| qc#12 | Giữ cách kiểm AC07. Nếu `bunfig.toml [test] pathIgnorePatterns` không có hiệu lực (R3), script `test` gốc thêm cờ `--path-ignore-patterns` tương ứng; `bun test` trần vẫn phải loại `e2e/**` — nếu không đạt được bằng bunfig thì ghi blocked và đề nghị docs-architect đổi đuôi e2e. |
| qc#13 | tasks.md Q2/Q3 liệt kê đủ 12 file khoá theo `test-plan.md` §5 (11 file `tests/acceptance/ADM-NFR-06/**` + `e2e/smoke.spec.ts`); lệnh xong Q3 = `test:lock OK (<n> file)` với n = số file thực có lúc LOCK (dự kiến 12). |
| qc#14 | Thêm M0-AC18 (e2e smoke) và M0-AC19 (`check:bundle`) vào §8; T17 và "Lệnh xong M0" chạy thêm build + `check:bundle` + `bunx playwright test`. |
| qc#15 | M0 chỉ phủ vế "migration có version" của `ADM-NFR-06`; seed (tenant `platform`, feature `core`, `platform_admin` đầu tiên) thuộc M1 (§1 "Phạm vi yêu cầu"). Đề nghị BA ghi chú phạm vi hoặc tách mã khi làm spec M1 — không chặn M0. |
| qc#16 | Thuộc frontend-lead: nhãn/role e2e theo `plan-frontend.md` §5; lệch thì báo qc trước khi sửa UI. Backend không có việc. |
| fe#1 | `package.json` gốc: `workspaces: ["apps/*","packages/*","tools/*"]` (gồm `packages/i18n`); devDeps thêm `@playwright/test` 1.63.0 (typescript 6.0.3 đã có); script `e2e` = `playwright test`, `check:bundle` = `turbo run check:bundle`. |
| fe#2 | `turbo.json`: `build` (`dependsOn ["^build"]`, `outputs ["dist/**"]`), `typecheck` (`outputs []`), `test` (`outputs []`), `check:bundle` (`dependsOn ["build"]`, `outputs []`), `dev` (`cache:false`, `persistent:true`). |
| fe#3 | `.gitignore` thêm `blob-report/`; `dist/`, `playwright-report/`, `test-results/` đã có (bao `apps/admin-web/dist`). |
| fe#4 | `biome.json`: `files.includes` thêm `!**/routeTree.gen.ts`; `css.parser.tailwindDirectives: true` (xác minh key trong `configuration_schema.json` của Biome 2.5.15 lúc cài; không có → ghi blocked cho T2, không tắt lint CSS toàn repo). |
| fe#5 | `bun test` gốc loại `e2e/**` qua `bunfig.toml [test] pathIgnorePatterns` (xem qc#12). |
| fe#6 | Giữ nguyên T-DEP-5. |
| fe#7 | CI: `actions/setup-node` (Node 22 LTS, cho Rsbuild CLI) ngay sau `setup-bun` (theo plan.md); sau `bun test` → `bunx playwright install --with-deps chromium` → `bun run --filter @ai/admin-web build` → `bun run --filter @ai/admin-web check:bundle` → `bunx playwright test` (env `CI=true`); upload `playwright-report/` khi lỗi. Thứ tự 8 step của AC17 giữ nguyên. |
| fe#8 | `base.json` bật `strict` (đã có); `web.json` của frontend-lead chỉ ghi đè `lib` và thêm `jsx`; **không** ghi đè `module`/`types`. Kiểu Bun cho admin-web nằm ở `apps/admin-web/tsconfig.node.json` (tách tsconfig browser/node). `packages/config/package.json` `exports` thêm `"./tsconfig/web.json"`. |
| fe §3 (ownership `playwright.config.ts`) | `playwright.config.ts` ở gốc do **frontend-lead** tạo và sở hữu (nội dung §7 của họ); backend-lead không sửa. |

### Câu hỏi cho người dùng (không trả lời → áp dụng mặc định)
1. Env nhóm B (§7) ngoài danh sách #39 — mặc định: **thêm** cả 10 biến (thiếu `APP_ENV`, `PORT`, `REDIS_URL`, `TEST_DATABASE_URL` thì không chạy được migrate dev/test và admin-api; `DIFY_MOCK_PORT`/`HUB_MOCK_PORT` để đổi cổng mock khi bị chiếm).
2. Bun: giữ 1.3.14 (đang cài) hay nâng 1.4.2 (bản mới nhất, 2026-09-08)? — mặc định: **giữ 1.3.14** ở M0 (không đổi máy người dùng khi chưa được phép); nâng bằng một task riêng sau Gate nếu người dùng đồng ý (`bun upgrade`, đổi `packageManager`, `@types/bun`, CI).
3. TypeScript 6.0.3 thay vì 7.0.2 — mặc định: **6.0.3** (ADR-0003).
4. Commit đầu tiên buộc phải nằm trên `main` (repo rỗng) — mặc định: điều phối tạo **một** commit `chore: nhập docs thiết kế v0.4` trên `main` (T0), mọi task còn lại trên `feat/M0-bootstrap`.
5. App kết nối DB bằng user owner `ai` (M0) — mặc định: giữ ở M0; M1 (khi bật RLS) dùng `SET LOCAL ROLE admin_rw` trong transaction hoặc user login riêng thuộc `admin_rw`, quyết trong spec M1.

### Vá spec-readiness lần 1 (backend-lead, PLAN vòng 3, 2026-10-01)
Nguồn `r#n` = `readiness.md` lần 1 mục n. Áp mặc định; chỗ khác mặc định có ghi lý do.

| Nguồn | Quyết định |
|---|---|
| r#1 | T7 lệnh xong viết đủ: `resetTestDb(TEST_DATABASE_URL)` qua `bun -e`, rồi `APP_ENV=production DATABASE_URL=$TEST_DATABASE_URL bun packages/db/src/migrate.ts`; mọi `psql` dạng `docker compose exec -T postgres psql -U ai -d ai_system_test -Atc "<SQL đầy đủ>"`. Biến đặt trên dòng lệnh thắng `.env.local` (Bun không ghi đè biến đã có trong `process.env`); lệnh `export TEST_DATABASE_URL=${TEST_DATABASE_URL:-…}` đứng đầu để `$TEST_DATABASE_URL` luôn có giá trị trong shell. |
| r#2 | Mỗi workspace TS phía backend (`apps/admin-api`, `packages/contracts`, `packages/db`, `tools/mocks`, `tools/scripts`) khai devDeps `@ai/config: "workspace:*"`, `@types/bun: "1.3.14"`, `typescript: "6.0.3"`. `extends` chọn **đường dẫn tương đối** (không qua tên package): không phụ thuộc cách `tsc` resolve `exports` của `@ai/config` dưới linker isolated; `@ai/config` vẫn khai để Turbo thấy phụ thuộc (đổi tsconfig chung → mất cache `typecheck`). Đường dẫn đầy đủ ở `plan.md` mục packages/config. |
| r#3 | `.dependency-cruiser.cjs`: `options.builtInModules.add = ["bun","bun:test","bun:sqlite","bun:ffi"]`; luật `not-to-unresolvable` có `to.pathNot: "^bun(:\|$)"` (T-DEP-7). BUILD xác minh key `builtInModules` trong `node_modules/dependency-cruiser/types/options.d.mts`. |
| r#4 | `depcruise.test.ts` chạy dependency-cruiser với `cwd = tools/scripts/src/__fixtures__/depcruise`, đối số `apps`, `--config <gốc repo tuyệt đối>/.dependency-cruiser.cjs` → path trong kết quả là `apps/...`, không bị `exclude` `__fixtures__` loại. |
| r#5 | T-TRACE-2: file test chỉ tính khi mã nằm trong path hoặc tên `it/test/describe` bắt đầu bằng mã; bỏ qua `**/__fixtures__/**`. |
| r#6 | Env = 18 biến (§7), `globalPassThroughEnv` = 18 biến đó; `POSTGRES_PORT`/`REDIS_PORT` chỉ là comment trong `.env.example`. |
| r#7 | CI: step `git fetch origin main:main` ngay sau checkout, `if: github.ref != 'refs/heads/main'` (PR checkout ở HEAD tách rời, không có nhánh local `main` → T-SIZE-4, T-DEP-8, `biome ci --changed` cần ref này). |
| r#11 | Hub mock `/internal/test-run`: body `{command, inputs}` (chỉ kiểm kiểu object), response thêm `trace: []`; hình tạm, M2 chốt theo HUB-FR-51 (§3.3). qc cập nhật ca mock Hub trong `test-plan.md`/`mocks.test.ts` trước LOCK. |
| r#12 | T9–T14 phụ thuộc thêm Q2 (lệnh xong chạy file acceptance của qc). |
| r#14 | 10 luật depcruise có tên: `no-routes-to-repo`, `no-cross-module-repo`, `rules-must-be-pure`, `service-no-http`, `component-no-fetch`, `web-no-db-or-api`, `api-no-web`, `contracts-pure`, `no-circular`, `not-to-unresolvable` (T-DEP-1…7). |
| r#15 | Mock: `X-Mock-Scenario` lạ → bỏ qua, chọn theo token (T-MOCK-1); body Hub không phải JSON → `{}`; Hub kiểm `command` → `inputs`; `timeout` chờ trước rồi mới validate (cả Dify và Hub). Thêm: `Authorization` không có dạng `Bearer <token>` → `unauthorized` (lấp chỗ trống, Luật 2). |
| r#17 | T13: `! git diff docs/TRACE.md \| grep -q '^-Sinh tự động'`; T4: chạy server nền, `timeout 10 bash -c 'until curl -sf …; do sleep 0.2; done'`, so body, rồi `kill` server. |
| r#18 | `drizzle.config.ts` và CLI của `migrate.ts` lấy URL bằng `loadDbEnv(process.env).DATABASE_URL` (kiểu `string`; thiếu/sai → lỗi nêu tên biến, không in giá trị). |
| r#19 | `keys:dev`: key vắng → thêm cuối file; `APP_ENV` kiểm cả `process.env` và `.env.local`, nguồn nào `production` → exit 1 (T-KEYS-1). |
| r#20 | CORS `exposeHeaders: ["X-Request-Id"]`; chữ ký `new AppError(code, status, message, details?)` (§3.1). |
| mâu thuẫn ADR-0001 | Dòng "Hạ tầng dev" sửa: compose chỉ Postgres, Redis, Mailpit; mock chạy bằng bun script (`tools/mocks`) — khớp quyết định "Mock chạy bằng bun script" ở trên. |
| mâu thuẫn readiness #11 | Readiness #11 chỉ áp phần migration `hub-stub`; seed usage dời M4 (§1 "Không làm"). |
| mâu thuẫn ADR-0002 | ADR-0002 (dành cho thư viện M1: recharts, jose, argon2id) **không** gồm react-i18next; react-i18next và TanStack Router/Query chuyển Accepted trong ADR-0001 khi duyệt Gate M0 (M0 đã cài và dùng). |
| mâu thuẫn BA Hub §8 | Task D1: docs-architect sửa `ba-agent-hub.md` §8 ghi Admin được **đọc** 3 bảng `hub.agent_workflows`, `hub.agent_grants`, `hub.usage_logs` (khớp `GRANT SELECT … TO admin_rw` ở §4.2). |

### Trong lúc làm (agent tự quyết theo Luật 2)
- T1 · `turbo.json` thêm `"agentGuidance": false`: Turbo 2.11.5 tự ghi `AGENTS.md` ở gốc khi phát hiện agent (key có trong `node_modules/turbo/schema.json`); luật agent đã nằm ở `CLAUDE.md`, tránh file untracked sinh lại mỗi lần chạy.
- T1 · `bunfig.int.toml` lặp `[install] linker = "isolated"`: `--config` thay hẳn `bunfig.toml`, giữ cùng linker nếu ai đó chạy `bun install` với file này.
- T2 · `biome.json` dùng `linter.rules.preset: "recommended"` thay `recommended: true` (Biome 2.5.15 báo DEPRECATED, sẽ bỏ ở major sau; giá trị enum `recommended|all|none` trong `configuration_schema.json`). Thư mục bỏ qua viết dạng `!docs`, `!**/migrations/meta`, `!**/components/ui` (không hậu tố `/**`, cú pháp thư mục của Biome 2).
- T19 · Làm trước T4/T8/T9/Q2/FE-5 theo lệnh điều phối; devDep gốc `@ai/contracts: "workspace:*"` thêm ở T19 (thay vì T4) vì `tsc -p tsconfig.tests.json` cần resolve nó từ gốc. Chưa có file nào dưới `tests/**`, `e2e/**`, `playwright.config.ts` → `bun run typecheck` hiện exit 2 (`TS18003 No inputs were found`); hết khi Q2 tạo file khoá. Không thêm file giả để che lỗi.
- T4 · Middleware request-id tự viết trong `app.ts` thay `hono/request-id`: bản Hono 4.13.12 thay id chứa ký tự ngoài `[\w\-=]` (từ chối `.` mà §3.1 cho phép, nhận `=` mà §3.1 cấm). Header `X-Request-Id` gắn **sau** `next()` nên có cả trên 404/500.
- T4 · `healthRoutes(cfg: { version: string })` thay `Pick<AppConfig, "version">`: cùng kiểu, tránh `health.routes.ts` import ngược `app.ts` (vòng import, luật `no-circular`).
- T4 · Logger bỏ mức `info` khi `NODE_ENV=test` (bun test tự đặt) để đầu ra test gọn; `warn`/`error` vẫn in. Không thêm biến env mới.
- T4 · `server.ts` gặp env sai → log `error` một dòng `Env không hợp lệ: <tên biến>` rồi `exit 1` (không in giá trị, không stack).
- T5 · Mailpit ghim `axllent/mailpit:v1.31.3` (release mới nhất 2026-09-27, GitHub `axllent/mailpit`). Healthcheck redis viết `CMD-SHELL redis-cli ping | grep -q PONG` để kiểm đúng chuỗi `PONG` như plan.
- T5 · Ghi nhận cho qc (không sửa test): trên Windows, `docker compose ps --format json | bun -e '…Bun.stdin.text()…'` (test-plan §4 `ac02`) lỗi `EUNKNOWN … read` (Bun 1.3.14 đọc pipe từ tiến trình native); chuyển hướng qua file (`> f; bun -e … < f`) hoặc `new Response(Bun.stdin.stream()).text()` thì chạy. Kết quả AC02 xanh khi chạy qua file.
- T7 · `runMigrations` mở kết nối riêng `max: 1` và luôn `end()` trong `finally`; đếm bảng theo dõi bằng `to_regclass` rồi `count(*)`. Hai lần `migrate()` truyền tường minh `migrationsTable` (`__drizzle_migrations` / `__drizzle_migrations_dev`, schema mặc định `drizzle`).
- T7 · SQL `0000_init_schemas` tách từng câu bằng `--> statement-breakpoint` (migrator Drizzle chạy từng đoạn qua extended protocol, không nhận nhiều câu một lần); khối `DO $$…$$` tạo hai role là một đoạn.
- T7 · Lỗi CLI `migrate.ts`: `db:migrate lỗi: <code>: <message>` + gợi ý `docker compose up -d --wait` khi `ECONNREFUSED`; message của postgres.js chỉ có host:cổng, không có mật khẩu. Script gốc `db:migrate`/`db:generate` thêm ở T7 (cần cho lệnh T8). Đã kiểm: `bun --env-file=<file vắng>` không lỗi → CI không cần bọc.
- T8 · `migrations-dev` sinh bằng `drizzle-kit generate --custom --name=hub_stub --dialect=postgresql --schema=./src/schema/admin.ts --out=./migrations-dev` (truyền `--out` thì drizzle-kit bỏ qua `drizzle.config.ts`, phải khai `--dialect`/`--schema`; không cần `drizzle.dev.config.ts`). `biome.json` thêm `!**/migrations-dev/meta` (file sinh ra, cùng lý do như `migrations/meta`).
- T8 · Ràng buộc stub đặt tên tường minh (`agent_grants_subject_type_check`, `usage_logs_billing_check`, `usage_logs_input_tokens_check`, `usage_logs_output_tokens_check`, `*_pkey`) để lỗi dễ đọc; DDL dùng `IF NOT EXISTS`.
- T8 · `bunfig.int.toml` bỏ `timeout = 30000`: Bun 1.3.14 không đọc key này (test vẫn hết hạn ở 5000 ms). Script `test:int` thêm cờ `--timeout 30000`.
- T9 · Middleware kịch bản dùng chung (`scenarioMiddleware`, `readJsonObject` trong `tools/mocks/src/scenario.ts`); Hub đăng ký `GET /health` **trước** middleware nên không qua kịch bản. Method không có (vd `DELETE /internal/test-run`) → 404 như §3.4 (Hono không trả 405).
- T9 · `Authorization: Bearer ` (token toàn khoảng trắng) coi như không có token → `unauthorized` (cùng nhánh với `Bearer`, test-plan §6.2 #2).
- T9 · `server.ts` của mock đặt `idleTimeout: 0` cho `Bun.serve`: mặc định Bun cắt kết nối rảnh sau 10 s, ngắn hơn `MOCK_TIMEOUT_MS` mặc định 30000 → kịch bản `timeout` sẽ bị server tự đóng thay vì trả 200. `loadMockEnv` coi chuỗi rỗng là vắng (dòng `KEY=`).
- T10 · `lib/git.ts` thêm `toRepoPath(cwd, root, p)` (ghép `git rev-parse --show-prefix`) và `notIgnored` (`git check-ignore --stdin`): trên Windows `os.tmpdir()` có thể là tên 8.3 (`MSIVN~1`) còn `--show-toplevel` trả tên dài, `path.relative` sẽ ra `../..`. `--files` cũng bỏ file bị `.gitignore` (T-SIZE-3). `listFiles(cwd, pathspecs)` nhận pathspec git thay cho glob. `k` trong `check:size OK (<k> file)` = số file code thực sự bị kiểm (sau miễn trừ, còn tồn tại).
- T11 · `rules-must-be-pure` gồm **hai** mục cùng tên trong `forbidden` (một theo `to.path`, một theo `to.dependencyTypes: ["core"]`): trong một luật, `path` và `dependencyTypes` là điều kiện AND. Regex gói npm viết `(^|/)node_modules/(<tên>)/` — dạng có nhóm tuỳ chọn `(\.bun/[^/]+/node_modules/)?` bị dependency-cruiser từ chối là "unsafe regular expression".
- T11 · `options.exclude` = `(^|/)__fixtures__/|^(apps|packages|tools)/[^/]+/dist/` (bỏ fixture và bản build của workspace, vd `apps/admin-web/dist/`). `dist` **phải** neo vào `^(apps|packages|tools)/<ws>/`: dạng cũ `(^|/)(__fixtures__|dist)/` khớp cả đường dẫn gói npm đã resolve (`node_modules/.bun/hono@4.13.12/node_modules/hono/dist/…`) → exclude bỏ cạnh đó, `service-no-http` và nhánh npm của `rules-must-be-pure` mất tác dụng (review M0 vòng 1 #1). **Không** exclude `node_modules` (cùng lý do); `doNotFollow` đủ để không quét vào trong.
- T11 · Fixture sạch đặt ở thư mục riêng `__fixtures__/depcruise-clean/` (cwd riêng); `bunfig.toml`/`bunfig.int.toml` thêm `**/__fixtures__/**` vào `pathIgnorePatterns` để `bun test` không chạy `c.test.ts` của fixture. Wrapper in đầu ra depcruise ra stdout khi sạch, stderr khi vi phạm (T-CLI-1).
- T11 (review vòng 1 #4) · Alias `@/` cho admin-web: `options.tsConfig.fileName` = `tsconfig.depcruise.json` ở gốc (đường dẫn tuyệt đối qua `__dirname`, chạy được từ cwd bất kỳ, kể cả fixture). Không trỏ thẳng `apps/admin-web/tsconfig.json`: tsconfig đó không có `baseUrl` nên dependency-cruiser 18.5.0 truyền `baseUrl: "./"` (= cwd) cho `tsconfig-paths-webpack-plugin` → `@/*` resolve thành `<cwd>/src/*`, vẫn `not-to-unresolvable` (đã thử). File riêng khai `baseUrl: "."` + `ignoreDeprecations: "6.0"` + `paths: {"@/*": ["apps/admin-web/src/*"]}`; chỉ dependency-cruiser đọc, không nằm trong `typecheck`. Hệ quả của `baseUrl`: import trần kiểu `apps/…` cũng resolve từ gốc — không ai dùng, chấp nhận. Web app mới cùng alias `@/` sẽ đụng nhau → khi đó tách cấu hình depcruise theo app.
- T11 (review vòng 1 #2) · Fixture `__fixtures__/depcruise/` có ca vi phạm cho cả 10 luật (quét `apps packages`); `@ai/scripts` khai devDep `hono` 4.13.12 để `hono` trong fixture resolve qua store thật `node_modules/.bun/hono@4.13.12/node_modules/hono/dist/…` (tái hiện lỗi exclude `dist`).
- T13 · `docs/TRACE.md`: cột Code/Test ghi **số file** (`29 file`), không liệt kê path (ADM-NFR-06 có ~30 file mỗi cột); danh sách path xem bằng `bun run trace <mã>`. Cột Spec liệt kê path, nối `<br>`. Thứ tự dòng = thứ tự xuất hiện trong `ba-*.md` (file sắp theo path); mã trùng trong danh mục lấy dòng đầu. Không có `docs/TRACE.md` → dùng phần mở đầu mặc định.
- T13 · Regex tên test thêm lookbehind `(?<![\w$.])` trước `it|test|describe` để `submit(`/`x.it(` không bị tính (siết T-TRACE-2, không nới).
- T15 · Action ghim major mới nhất tại 2026-10-01 (GitHub releases): `actions/checkout@v7` (v7.0.1), `oven-sh/setup-bun@v2` (v2.2.0), `actions/setup-node@v7` (v7.0.0), `actions/upload-artifact@v7` (v7.0.1). Step tạo DB test (`psql … CREATE DATABASE ai_system_test`) đặt trước `bun install`; thêm `concurrency` huỷ lần chạy cũ cùng ref, `timeout-minutes: 30`.
- T17 · Nghiệm thu chạy trên máy dev (Windows 11, Git Bash). AC13 chỉ chạy `test:lock:verify` trên repo thật; bước "sửa 1 byte file khoá" của test-plan §4 `ac13` sửa file thuộc qc nên để qc chạy (hành vi CHANGED đã được `test-lock.test.ts` kiểm trên repo tạm). AC02 chạy qua file tạm thay pipe (xem T5).
- FE-1 · `<html lang="vi">` đặt bằng `apps/admin-web/index.html` (`html.template`): `HtmlConfig` của Rsbuild 2.2.11 không có option `lang`/`htmlAttrs`. Dep `@ai/i18n` thêm ở FE-4 (workspace chưa có ở FE-1); `evoluconsulting-icon.svg` commit ở FE-1 vì `html.favicon` cần file để build, hai logo còn lại ở FE-4.
- FE-2 · Theme theo `docs/design/canvas/tokens-map.md`, lệch `plan-frontend.md` §4 (canvas thắng): `--foreground` `#1D1733` (plan `#2E2150`), `--muted-foreground` `#635C78`, `--input` `#D9D5E3`, `--muted` `#EFEDF3`, `--accent` `#EDE6FB`/`#4A3278`, `--secondary` `#EFEDF3`/`#3B3450` (canvas không cho nền nút phụ → dùng `--muted`); `--brand-strong` bỏ, thay bằng `--primary-strong` `#4A3278` + `--ink-strong` `#2E2150`; badge dùng `--success/--success-bg`, `--warning/--warning-bg/--warning-solid`, `--danger/--danger-bg` (không phải `--status-*`); thêm `--subtle-foreground`, `--placeholder`, `--row-divider`, `--error-border`, `--on-ink`, `--on-ink-link`, `--overage-hatch-from/to`, bóng `shadow-toast/dialog/drawer`; sidebar nền `#FCFBFE`, chữ `#3B3450` (Sidebar.dc.html).
- FE-2 · Bo góc: `--radius` = 8px (canvas: 8px là chính) → `rounded-sm` 4 · `rounded-md` 8 (nút, ô nhập) · `rounded-lg` 10 (toast, khung kết quả) · `rounded-xl` 12 (card; shadcn v4 Card dùng `rounded-xl`) — plan ghi `--radius` 12px.
- FE-2 · Cỡ chữ theo canvas: `text-micro` 11/16 · `text-caption` 12/16 · `text-label` 13/20 · `text-body` 14/20 (cả bảng; plan ghi bảng 13) · `text-card-title` 16/24 · `text-dialog-title` 18/28 · `text-page-title` **24/32, đậm 700** (plan 20/28, 600) · `text-kpi` 28/36 · `text-display` 40/48. Bố cục: `--spacing-sidebar` 248px, `--spacing-topbar` **60px** (plan 56†), `--spacing-control` 36px, `--spacing-page` 28px (`p-page`), `--container-content` 1280px. H1 trang `/` dùng `text-page-title font-bold text-foreground`.
- FE-2 · Tương phản đo (WCAG): chữ/nền 15.96 · muted-fg/nền 5.86 · muted-fg/card 6.30 · trắng/primary 6.46 · accent 8.58 · muted-strong/muted 7.39 · success 6.69 · warning 7.33 · danger 6.94 · trắng/destructive 6.57 · secondary 10.08 — đạt ≥ 4.5. **`--subtle-foreground` `#7A7390` trên trắng = 4.48:1 (< 4.5)**: giữ giá trị canvas (M0 chưa dùng), đề xuất design sẫm lại (vd `#756E8B`) trước M1 khi dựng sidebar.
- FE-2 · Khối `prefers-reduced-motion` dùng `!important` kèm `biome-ignore lint/complexity/noImportantStyles` (phải thắng mọi utility animate). `.dark` chỉ có các biến §4.3 — chờ artboard dark.
- FE-3 · Rspack 2.2.8 mặc định `exportsPresence: "error"` → build lỗi ở `@tanstack/react-router` (`React["use"]`, tự lùi khi React 18 không có). Thêm rule `tools.rspack.module.rules` chỉ cho đường dẫn `@tanstack/react-router` với `parser.exportsPresence: false`; không nới toàn app.
- FE-4 · `src/routes/index.tsx` import page bằng đường dẫn tương đối: `bun run depcruise` không resolve alias `@/` (`not-to-unresolvable`). Đề nghị backend-lead thêm `options.tsConfig` cho `apps/admin-web/tsconfig.json` trong `.dependency-cruiser.cjs` trước M1 để dùng lại `@/`.
- FE-5 · Đo thật: JS ban đầu 95.9 KB, CSS 5.8 KB (gzip, `check:bundle`); chunk route `/` 0.4 KB; `rsbuild build` ≈ 1.3 s; mở `/` tải 3 woff2 (Be Vietnam Pro latin 400/700 + vietnamese 400, ≈ 55 KB). E2E chạy trên Chrome Headless Shell 153 (Playwright 1.63.0). Route lạ dùng `notFoundComponent` mặc định ("Not Found").

## 10. Tranh chấp test
- **TT-1 · `tests/acceptance/ADM-NFR-06/migrate.int.test.ts`, ca "stub hub: index và ràng buộc theo spec §4.2"** (backend-lead, 2026-10-01). Ca này treo tới hết timeout, giữ kết nối `max: 1` nên 3 ca sau (`chạy lần 2…`, `role đã có sẵn…`, `M0-AC04 production`) và hook `afterAll` cũng timeout. Nguyên nhân (tái hiện bằng file tạm `zz-tmp.int.test.ts`, đã xoá): trong Bun 1.3.14, một truy vấn postgres.js thành công rồi **ngay sau đó** `await expect(<truy vấn lỗi>).rejects.toThrow()` thì treo; cùng chuỗi đó dùng `try/catch`, hoặc có trễ giữa hai truy vấn, thì không treo. Bọc `.then(...)` không cứu được (`Query` là lớp con `Promise`, `.then` trả về `Query`). Đây là hành vi của runner, không phải của migration: khi chạy bản sao tạm của file (đã xoá) với 3 chỗ `await expect(sql\`…\`).rejects.toThrow()` đổi thành `expect(await (async () => { try { await sql\`…\`; return false; } catch { return true; } })()).toBe(true)`, cả file **11/11 xanh**. Đề nghị qc sửa 3 dòng đó (hoặc một helper `fails(q)` trong `_helpers.ts`) trước LOCK. Backend không sửa file test.
  - **Quyết định qc (2026-10-01): ĐÓNG — test sai cách viết, ý nghĩa giữ nguyên.** qc tự tái hiện: `bun run test:int` treo đúng như mô tả (ca stub hub + 2 ca sau + hook timeout 30 s). Kiểm độc lập bằng file tạm (đã xoá) không dính code sản phẩm: `await sql\`select 1\`` rồi `await expect(sql\`select 1/0\`).rejects.toThrow()` → treo; cùng chuỗi đó viết `try/catch` → xanh. Vậy đây là lỗi runtime (Bun 1.3.14 + postgres.js), không phải lỗi migration. Sửa: thêm `fails(q): Promise<boolean>` (try/catch) vào `tests/acceptance/ADM-NFR-06/_helpers.ts`; 3 chỗ `await expect(sql\`insert …\`).rejects.toThrow()` trong `migrate.int.test.ts` đổi thành `expect(await fails(sql\`insert …\`)).toBe(true)` — cùng câu SQL, cùng dữ liệu, vẫn kiểm "insert vi phạm ràng buộc bị từ chối". Đã `test:lock:write` lại (12 file) và `test:lock:verify` OK. Kết quả: `bun run test:int` 17/17 xanh; `bun test tests/acceptance` 88/88 xanh.
