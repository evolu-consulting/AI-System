# Plan backend · X1-combine (B1–B4, S1, ST1)

Người viết: backend-lead (PLAN, 2026-10-07). Đối chiếu code thật tại `66299a0`/`fd73acc`. Phần FE: `plan-frontend.md` (không sửa ở đây); trả lời BL1–BL6 ở §8. **Q10 hết hiệu lực**: 4 file phiên khác đã commit (`66299a0`), không còn chặn task nào.

## 0. Phát hiện chính (đọc trước khi BUILD)
| # | Phát hiện | Hệ quả / xử lý |
|---|---|---|
| K1 | Hub **đã** có nhánh R23 (`catalog.repo.ts` `readSideEffectColumn` qua `information_schema`; `catalog.rules.ts` `sideEffectMap`: cột có ⇒ **thắng hoàn toàn**, không thì `hub.workflow_flags`) | Ngay khi B1 thêm cột (default `false`), cờ trong `workflow_flags` **mất tác dụng** dù chưa làm B3 ⇒ test khoá dựa trên `workflow_flags` đỏ **do B1**, không do B3 |
| K2 | Test khoá đặt cờ bằng `insert into hub.workflow_flags`: `tests/acceptance/H2a/_h2a.ts:414` (trello, dùng chung H2a+H2b), `H2a/confirm.int.test.ts:63`, `H2c/mcp-file.int.test.ts:37`; A67 (`H2a/confirm.int.test.ts:260-300`) `expect(col.n).toBe(0)` rồi `alter table … add column` | **QC phải sửa trước/cùng B1** (§7 "Cho QC"): thay insert bằng `update admin.workflows set side_effect = true where id = …` (owner); viết lại A67 = "cột quyết định; đổi cột + reload ⇒ đổi hành vi". Không sửa ⇒ `done:h2a/h2b/h2c` đỏ |
| K3 | Test khoá đếm migration Admin `{main: 9, …}`: `ADM-NFR-06/migrate.int.test.ts` (53,152,170), `H1/db.int.test.ts:128`, `M1/db-schema.int.test.ts:70,284`, `M2/db-schema`, `M3/db-schema` | QC đổi 9 → 10 (tiền lệ 0008 M4). Test của backend (`packages/db/src/migrate*.int.test.ts`, comment `migrate-hub.ts:2`) B1 tự sửa |
| K4 | `API_ERRORS` admin bị khoá đếm **48** (`M4/rules/contracts-cd.test.ts:137`) | Mã lỗi mới của Test command **không** thêm vào `API_ERRORS`; registry riêng `COMMAND_TEST_ERRORS` (mẫu `HUB_ADMIN_ERRORS`) — trả lời BL3 |
| K5 | Cú pháp input map **không phải chuỗi `$args.x`**: `InputMapEntrySchema` = `{source:"arg",value}` · `{source:"const",value}` · `{source:"selection"\|"page_url"\|"page_text"\|"attachment"\|"user_id"\|"tenant_id"}`. Không có `$text`: "phần còn lại của dòng" = arg `rest:true` (cuối danh sách); arg có `default`, `fallback` (`selection`\|`page_url`\|`page_text`); gán theo **vị trí** (`command-parse.rules.ts` R05) | Bảng seed §5.3 viết lại theo cú pháp thật; spec §6 "`$args.subject`" bỏ (arg vị trí sẽ ăn từ đầu tiên của email) |
| K6 | Tên secret Admin `^[A-Z0-9_]{2,64}$` ⇒ `dify-<app>` không hợp lệ | Secret = đúng tên biến env: `DIFY_KEY_TRANSLATE`… |
| K7 | Studio H4a **không có** API entitlement agent; `POST /agent-grants` đòi entitlement chưa thu hồi (H3b-R04 ⇒ 409 `NOT_ENTITLED`); entitlement agent chỉ ghi qua `hub:seed` (`access.yaml`) | Agent `dify-chatbot` + entitlement `acme` tạo bằng **Hub seed CLI** với thư mục seed overlay (§5.4), grant bằng `POST /agent-grants`. Lệch mặc định Q4 ("Studio API") — lý do: không có đường khác hợp lệ |
| K8 | CORS: admin-api đã đọc `CORS_ORIGINS` (env, `credentials:true`); Hub `HUB_CORS_ORIGINS` đã có 3 origin trong `.env.example` | Không sửa code CORS; chỉ `.env.example` (`CORS_ORIGINS`) + `combine:dev` đặt tường minh + int AC14 |
| K9 | Hub `POST /internal/test-run` **không** kiểm `side_effect` và **không** kiểm quyền của `actor_user_id` | Admin chặn `side_effect` bằng cờ xác nhận (§2.2); "chạy với tư cách user" chỉ đặt actor (gán `user_id`/`tenant_id`); quyền hiển thị qua endpoint có sẵn `GET /admin/users/:id/effective-access` |
| K10 | `hub.workflow_secret`, `hub.log_dify_usage` (`migrations-hub/0003`) không đọc/ghi `side_effect` | X1-R10 "rà": **không đổi** |
| K11 | Key auto-pilot nằm ở `apps/copilot-hub/.env` (và `apps/control-plane/.env`), **không** ở gốc. Tên biến (chỉ tên): `DIFY_API_URL`, `DIFY_KEY_{CHATBOT,TRANSLATE,GMAIL,EMAILREPLY,SCREENSHOTASK,WEBCONTEXT,AUTOFILL,SEMANTICFIND}`, `DIFY_AGENT_API_KEY`, `DIFY_EXTRACT_API_KEY`. File khác có `DIFY_EMAIL/PASSWORD/CONSOLE_*` (console) | Seed đọc **danh sách trắng** tên biến; không bao giờ đọc biến console. Ví dụ `DIFY_SEED_ENV_FILE=D:\AI\evoluconsulting\auto-pilot\apps\copilot-hub\.env` |

## 1. Dữ liệu (B1)
| Mục | Chi tiết |
|---|---|
| Migration | `packages/db/migrations/0009_x1_workflow_side_effect.sql` sinh bằng `bun run db:generate -- --name x1_workflow_side_effect` (snapshot `meta/0009_snapshot.json` + `_journal.json` idx 9). Nội dung đúng 1 câu: `ALTER TABLE "admin"."workflows" ADD COLUMN "side_effect" boolean DEFAULT false NOT NULL;` (PG ≥ 11: chỉ metadata, khoá ngắn). Role chạy = owner (như mọi migration Admin). Không backfill từ `hub.workflow_flags` (bảng Hub, Admin không phụ thuộc; dev DB chỉ có cờ mẫu) |
| Drizzle | `packages/db/src/schema/admin.ts` `workflows`: `sideEffect: boolean("side_effect").notNull().default(false)` (sau `enabled`). Không index (không lọc theo cột) |
| RLS / quyền | `admin.workflows` không RLS (catalog chung). `hub_ro` có `SELECT` cấp bảng (`0000` default privileges) ⇒ cột mới đọc được, không cần GRANT. Test backend: `has_column_privilege('hub_ro','admin.workflows','side_effect','SELECT') = true`, `admin_rw` UPDATE được |
| `hub.workflow_flags` | Giữ bảng + ghi của `hub:seed` (X1-R09). Sau B3 Hub không đọc. Dọn = CR sau |
| Hàm SECURITY DEFINER | `hub.workflow_secret`, `hub.log_dify_usage`: không đổi (K10) |

## 2. Contract

### 2.1 Workflows (B1) — `packages/contracts/src/workflows.ts`, `transfer.ts`
| Schema | Thay đổi | Lý do tương thích |
|---|---|---|
| `listItemShape` (→ `WorkflowListItemSchema`, `WorkflowSchema`) | `side_effect: z.boolean()` (bắt buộc ở response) | Test khoá parse response thật của server ⇒ có trường |
| `WorkflowCreateRequestSchema` | `side_effect: z.boolean().optional()` — **không** `.default` (service: vắng ⇒ `false`) | Không đổi output parse của test khoá M2 |
| `WorkflowUpdateRequestSchema` | `side_effect: z.boolean().optional()` (vắng = giữ) | như trường khác |
| `WorkflowElSchema` (transfer) | `side_effect: z.boolean().optional()` | File export cũ (v1, không có trường) vẫn import được |
| Export | luôn ghi `side_effect` | round-trip đủ |
| Import | tạo mới: vắng ⇒ `false`; cập nhật: vắng ⇒ **không so/không đổi**; có ⇒ so như trường khác (diff field `side_effect`) | không âm thầm tắt cờ khi nhập file cũ |
| Audit | `AUDIT_FIELDS.workflow` thêm `side_effect` (`lib/audit/audit.rules.ts`); `workflows.restore.ts` thêm trường (snapshot cũ thiếu ⇒ giữ giá trị hiện tại) | test khoá M4 audit-snapshot chỉ so khoá có trong input ⇒ xanh |
| Bump config | PUT đổi `side_effect` đi qua service hiện có ⇒ bump `config_version` + NOTIFY ⇒ Hub reload ≤ 5 s | không thêm đường ghi |

File code: `apps/admin-api/src/modules/workflows/{workflows.repo,workflows.rules,workflows.service,workflows.restore}.ts`, `modules/transfer/{transfer.repo,transfer.write,transfer.norm,transfer.plan}.ts` (chỗ đang liệt kê `output_field`/`outputField`).

### 2.2 Test command (B2) — `POST /admin/commands/test` (BL1: **không id**)
Chỉ `platform_admin` (router `commands` đã `requireRole("platform_admin")` cho `*`; spec §3 ghi tenant_admin nhưng tenant_admin không có màn command — Q-B1). Route đặt trong `commands.routes.ts`; không xung đột `POST /` hay `GET /:id`.

File contract mới `packages/contracts/src/command-test.ts` (export qua `index.ts`):
| Tên | Định nghĩa |
|---|---|
| `CommandTestRequestSchema` | `z.strictObject({ command: TestRunRequestSchema.shape.command, text: z.string().max(TEST_RUN_TEXT_MAX), context: MessageContextSchema.optional(), run_as_user_id: UuidSchema.optional(), confirm_side_effect: z.boolean().optional() })` — `command` = `{workflow_id, args=[], input_map={}, output, timeout_s=30}` (tái dùng `hub-internal/test-run.ts`) |
| `CommandTestResponseSchema` | `= TestRunResponseSchema` (200 cả khi `ok:false`; `ms`, `steps`, `usage`; **không** đổi thành `duration_ms` — BL2) |
| `COMMAND_TEST_ERRORS` | `{ CMD_MISSING_ARG: 422, NOT_CONFIGURED: 409, SIDE_EFFECT_CONFIRM_REQUIRED: 409, HUB_UNAVAILABLE: 502, HUB_NOT_CONFIGURED: 503 }` + `CommandTestErrorCodeSchema`. Body lỗi = `ErrorResponseSchema` M0 |
| `SideEffectConfirmDetailsSchema` | `z.strictObject({ workflow_id: UuidSchema })` |

Luồng (`apps/admin-api/src/modules/commands/commands.test-run.ts` service + `commands.hub-client.ts`), dừng ở bước đầu trượt:
| Bước | Điều kiện | Kết quả |
|---|---|---|
| 1 | role ≠ platform_admin | 403 `FORBIDDEN` (trước parse body) |
| 2 | body sai | 400 `VALIDATION_ERROR` (issues zod, không echo text) |
| 3 | `ADMIN_HUB_URL` hoặc `HUB_INTERNAL_TOKEN` vắng | 503 `HUB_NOT_CONFIGURED` |
| 4 | `workflow_id` không có trong `admin.workflows` | 400 `INVALID_REFERENCE {field:"workflow_id", ids:[id]}` (shape M2) |
| 5 | `workflow.side_effect = true` ∧ `confirm_side_effect !== true` | 409 `SIDE_EFFECT_CONFIRM_REQUIRED {workflow_id}` — FE hỏi Đồng ý rồi gửi lại `confirm_side_effect:true` |
| 6 | `run_as_user_id` có mà không tồn tại (mọi tenant) | 400 `INVALID_REFERENCE {field:"run_as_user_id", ids:[id]}` |
| 7 | Gọi Hub `POST {ADMIN_HUB_URL}/internal/test-run`, header `Authorization: Bearer <HUB_INTERNAL_TOKEN>`, body `{command, text, context, actor_user_id: run_as_user_id ?? jwt.sub}`; `signal = AbortSignal.any([req.signal, AbortSignal.timeout((min(timeout_s,300)+35)*1000)])`; `server.timeout(req, min(timeout_s,300)+40)` (Bun idle mặc định 10 s — mẫu `testRunIdleS` Hub) | — |
| 8a | Hub 200 ∧ `TestRunResponseSchema.safeParse` ok | 200 nguyên văn |
| 8b | Hub 200 nhưng schema sai | 502 `HUB_UNAVAILABLE` |
| 8c | Hub 400 `VALIDATION_ERROR` | 400 chuyển tiếp `details` (đổi path `actor_user_id` → `run_as_user_id`) |
| 8d | Hub 422 `CMD_MISSING_ARG` / 409 `NOT_CONFIGURED` | cùng mã + status, chuyển `message`/`details` |
| 8e | Hub 401 / 503 (token lệch hoặc Hub thiếu token) | 503 `HUB_NOT_CONFIGURED`; log `warn` `command-test.hub-auth` (chỉ status) |
| 8f | mạng lỗi / timeout / 5xx khác | 502 `HUB_UNAVAILABLE` |
| 8g | client huỷ (nút "Dừng") | huỷ fetch Hub, không trả body |

Không ghi DB, không audit (không đổi dữ liệu). Log 1 dòng `info` `command-test` `{workflow_id, ok, ms, hub_status}` — **không** log `text`, `output`, header, token. Token không bao giờ vào response/lỗi (AC11; reviewer Blocker).

Env admin-api (`apps/admin-api/src/config/env.ts`, `.env.example`): `ADMIN_HUB_URL: z.url({protocol:/^https?$/}).optional()` (dev `http://localhost:4000`; **không** dùng tên `HUB_URL` — đã dành cho bộ contract chat, trống = mock); `HUB_INTERNAL_TOKEN: z.string().min(32).optional()` (chung giá trị với hub-api trong `.env.local`). `CORS_ORIGINS` mẫu = `http://localhost:3000,http://localhost:3100,http://localhost:3200` (K8).

Hàm thuần (QC viết test trước) — `commands.test-run.rules.ts`:
```ts
export function testRunPrecheck(i: { hubConfigured: boolean; workflow: { id: string; sideEffect: boolean } | null;
  workflowId: string; confirm: boolean | undefined; runAs: { requested?: string; exists: boolean } }):
  | { ok: true } | { ok: false; code: "HUB_NOT_CONFIGURED" | "INVALID_REFERENCE" | "SIDE_EFFECT_CONFIRM_REQUIRED"; details?: unknown };
export function mapHubTestRun(status: number | "network" | "timeout", body: unknown):
  { status: number; body: unknown };   // bảng 8a–8f
```

### 2.3 Hub (B3)
| Mục | Thay đổi |
|---|---|
| Kiểm schema lúc khởi động | `apps/hub-api/src/modules/config/schema-check.ts`: `export const REQUIRED_ADMIN_COLUMNS = [["workflows","side_effect"]] as const; export async function missingAdminColumns(db: Db): Promise<string[]>` (trả `["admin.workflows.side_effect"]` khi thiếu). `server.ts` gọi sau `openDb` (cạnh `checkMasterKey`): thiếu ⇒ `log.error("admin-schema-missing", {columns, hint:"bun run db:migrate"})`, `process.exit(1)` |
| Catalog | `catalog.repo.ts`: bỏ `readSideEffectColumn`, bỏ đọc `workflowFlags`; `readWorkflows` chọn `sideEffect: workflows.sideEffect`. `catalog.rules.ts`: bỏ `sideEffectColumn`, `flags`, `sideEffectMap`, `sideEffectSource`; `sideEffect` lấy từ hàng workflow. `commands/catalog.types.ts` sửa comment |
| Test backend | `catalog.int.test.ts` "H2a-R23 · nguồn side_effect" viết lại: đổi cột + `reloadAdmin` ⇒ cờ đổi; `catalog.test.ts` bỏ ca `flags` |
| CORS | Không đổi code (K8); mặc định `env.ts` giữ chỉ `:3100` (X1-R12) |
| Điều kiện hoãn (X1-R09) | Nếu sau khi QC sửa fixture (K2) mà int H2a/H2b/H2c vẫn đỏ vì B3 ⇒ revert riêng commit B3, TECH-DEBT, không chặn `done:x1` (B1 vẫn giữ: Hub cũ đã ưu tiên cột) |

### 2.4 `GroupDto.agent_count` (B4, trả BL5)
admin_rw đã `SELECT hub.agent_grants` (`migrations-hub/0000:476`), stub Drizzle `agentGrants` có ở `hub-readonly.ts`, index `agent_grants_subject_idx (tenant_id, subject_type, subject_id)`. ⇒ `groups.repo` tính thật: `hubGrantsReadable(tx)` (mẫu `workflows.hub.ts` `hubAgentsReadable`: `has_table_privilege(to_regclass('hub.agent_grants'),'SELECT')`, không cache) → `(select count(distinct agent_id)::int from hub.agent_grants where tenant_id = g.tenant_id and subject_type='group' and subject_id = g.id)`; không đọc được ⇒ `0`. Áp cho list + detail. Đếm cả agent đã bị thu hồi entitlement (số grant đang giữ). Test khoá M3 (`agent_count` 0 khi không có grant) vẫn xanh.

## 3. CORS và env tổng hợp
| Biến | App | Giá trị dev (`combine:dev` đặt tường minh) |
|---|---|---|
| `CORS_ORIGINS` | admin-api | `http://localhost:3000,http://localhost:3100,http://localhost:3200` |
| `HUB_CORS_ORIGINS` | hub-api | `http://localhost:3100,http://localhost:3000,http://localhost:3200` |
| `ADMIN_HUB_URL` | admin-api | `http://localhost:4000` |
| `HUB_INTERNAL_TOKEN` | admin-api + hub-api | từ `.env.local`; vắng ⇒ `combine:dev` sinh ngẫu nhiên 48 ký tự (`crypto.randomBytes(36).toString("base64url")`) cho **cả hai** tiến trình, không in |
| `HUB_URL` / `AUTH_URL` | chat-web (proxy) | `http://localhost:4000` / `http://localhost:3001` |
| `ADMIN_API_URL` | admin-web, studio-web | `http://localhost:3001` |
| `HUB_URL` | studio-web | `http://localhost:4000` |
| `PUBLIC_HUB_URL` · `PUBLIC_STUDIO_URL` · `PUBLIC_ADMIN_WEB_URL` · `PUBLIC_CHAT_WEB_URL` | web (build-time) | `http://localhost:4000` · `http://localhost:3200/studio/` · `http://localhost:3000` · `http://localhost:3100` |

## 4. Bảng rủi ro
| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | B1 làm đỏ test khoá H2a/H2b/H2c + đếm migration (K1–K3) | cao | QC sửa fixture + số đếm **trước** B1 (B1 phụ thuộc QC1-a); B1 chạy int H2a/H2b/H2c trong Lệnh xong |
| R2 | Lộ `HUB_INTERNAL_TOKEN` (response, log, bundle) | cao | chỉ admin-api đọc; không `PUBLIC_*`; mapHubTestRun không chép header; AC11 quét bundle + response |
| R3 | Test command chạy workflow `side_effect` thật (gửi mail…) | cao | bước 5 (409 + xác nhận); 5 app Dify chọn đều `side_effect=false` |
| R4 | Seed lộ key Dify (log, lỗi, dump, stack trace) | cao | §5.5; key chỉ trong biến cục bộ tới khi `POST/PUT /admin/secrets`; lỗi chỉ nêu tên biến; AC16/AC18 quét |
| R5 | Seed đọc nhầm biến console Dify hoặc gọi console API (X1-R01) | cao | danh sách trắng tên biến; URL gọi chỉ admin-api/Hub; test tĩnh AC18 grep `/console/api` |
| R6 | `hub:seed` overlay ghi đè sửa đổi Studio của agent mặc định | thường | giống `hub:dev` (mỗi lần khởi động cũng chạy seed); ghi trong `combine-test.md`; overlay chỉ thêm `dify-chatbot` |
| R7 | Request Test dài bị Bun idle 10 s cắt | thường | `server.timeout(req, …)` (bước 7) |
| R8 | `output_field` app Dify chưa biết chắc (không được gọi `/parameters`) | thường | Hub ưu tiên text stream (`finalText`); mặc định §5.3, sửa trong Admin sau S10 |
| R9 | Agent `dify-chatbot` cần Runtime có provider `dify` (smoke H2a chạy `AGENT_RT_PROVIDERS=…,dify`) | thường | lệnh WSL in ra có `AGENT_RT_PROVIDERS=claude-sub,dify` + `AGENT_RT_HUB_URL` (§6) |
| R10 | Bun `--env-file=.env.local` vs env truyền từ `combine:dev` (thứ tự ưu tiên) | thường | ST1 kiểm bằng test `/health` + preflight CORS; nếu `.env.local` thắng ⇒ truyền qua tham số riêng (`hubApiEnv`) như hub-dev |

## 5. Seed Dify thật (S1)

### 5.1 CLI
`bun run seed:dify -- [--apply] [--apps a,b] [--tenant acme] [--group dify-demo] [--rotate-secrets]` (script `"seed:dify": "bun --env-file=.env.local tools/scripts/src/seed-dify-live.ts"`). Mặc định `--dry-run`. Đầu vào: `DIFY_SEED_ENV_FILE` (bắt buộc, không mặc định), `SEED_ADMIN_USERNAME/PASSWORD` (platform_admin dev), `ADMIN_API_URL` (mặc định `http://localhost:3001`), `HUB_URL_SEED` (mặc định `http://localhost:4000`). Không gọi Dify (kể cả `/info`, `/parameters`) — X1-R01/R02.

### 5.2 File (≤ 400 dòng/file)
| File | Nội dung |
|---|---|
| `tools/scripts/src/seed-dify-live.ts` | CLI: parse cờ, đọc env file, đăng nhập, chạy plan, in tóm tắt |
| `seed-dify-live.apps.ts` | bảng app §5.3 (thuần, không key) |
| `seed-dify-live.rules.ts` | hàm thuần (dưới) |
| `seed-dify-live.api.ts` | client admin-api/Hub (fetch, Bearer JWT; không log body) |
| `seed-dify-live.hub-seed.ts` | tạo thư mục overlay tạm + chạy Hub seed CLI |
| `seed-dify-live.test.ts` | unit với `.env` giả trong thư mục tạm + admin/Hub giả (`Bun.serve`) |

Hàm thuần (QC test trước):
```ts
export const SEED_APPS = ["chatbot","translate","gmail-summary","email-reply","screenshot-ask"] as const;
export const ENV_KEY: Record<SeedApp, string>; // chatbot→DIFY_KEY_CHATBOT, translate→DIFY_KEY_TRANSLATE,
  // gmail-summary→DIFY_KEY_GMAIL, email-reply→DIFY_KEY_EMAILREPLY, screenshot-ask→DIFY_KEY_SCREENSHOTASK
export function parseSeedEnv(text: string, apps: readonly SeedApp[]):
  | { ok: true; apiUrl: string; keys: ReadonlyMap<SeedApp, string> }
  | { ok: false; missing: string[] };          // chỉ tên biến; chỉ đọc DIFY_API_URL + ENV_KEY[app]
export function parseSeedArgs(argv: string[]): SeedArgs | { error: string }; // --apps lạ ⇒ error nêu tên
export function buildSeedPlan(a: SeedArgs, apiUrl: string): SeedPlan;  // không chứa key
export function workflowPatch(cur: WorkflowLite, want: WorkflowWant): Partial<WorkflowUpdateRequest> | null;
export function commandPatch(cur: CommandLite, want: CommandWant): Partial<CommandUpdateRequest> | null;
export function formatPlan(p: SeedPlan): string;   // dry-run; không key
```

### 5.3 Bảng app (khớp registry auto-pilot `extension-hub/src/core/dify/registry.ts`, chỉ đọc cấu trúc)
`base_url` = `DIFY_API_URL` (vd `…/v1`). Workflow key tiền tố `dify-` (tránh trùng fixture dev `dich`, `translate`…). Tất cả `side_effect=false` (Q3).

| App | Workflow (`key`, `app_type`, `input_schema`, `output_field`) | Command (`name`, `args`, `input_map`, `output`) |
|---|---|---|
| chatbot | `dify-chatbot`, `agent`, `[]`, null | — (agent `dify-chatbot` §5.4) |
| translate | `dify-translate`, `workflow`, `text` (text, bắt buộc), `target_lang` (text, bắt buộc), `text` | `translate`: args `[lang default "vi"; text rest, fallback selection]`; map `text←{arg text}`, `target_lang←{arg lang}`; output `{field:"text", render:"markdown"}`. Cú pháp `/translate en Xin chào` (vị trí: từ đầu = ngôn ngữ) |
| gmail-summary | `dify-gmail-summary`, `workflow`, `subject`, `sender`, `email_body` (text, bắt buộc), `summary` | `summary`: args `[text rest, fallback selection]`; map `email_body←{arg text}`, `subject←{const "(không tiêu đề)"}`, `sender←{const "(dán từ chat)"}`; output `{field:"summary", render:"markdown"}` |
| email-reply | `dify-email-reply`, `workflow`, như gmail-summary, `text` | `reply`: như `summary`, output field `text` |
| screenshot-ask | `dify-screenshot-ask`, `workflow`, `image` (file, bắt buộc), `question` (text, bắt buộc), `text` | `ask-image`: args `[question rest, default "Mô tả nội dung ảnh này"]`; map `image←{source:"attachment"}`, `question←{arg question}`; output `{field:"text", render:"markdown"}` |

Mô tả (≥ 20 ký tự VI) cố định trong `apps.ts`. `mode:"sync"`, `timeout_s` 60 (translate/summary/reply), 90 (ask-image).

### 5.4 Thứ tự ghi (`--apply`), mọi bước qua API (Q4), idempotent (X1-R14), không bao giờ xoá
| # | Bước | API | Idempotent |
|---|---|---|---|
| 1 | Đăng nhập `platform_admin` | `POST /auth/login {tenant_key:"platform",…}` | — |
| 2 | Tenant + user | `GET /admin/tenants?q=acme`; group: `GET/POST /admin/groups?tenant_id=` `{key:"dify-demo",name,description}`; thành viên `POST /admin/groups/:id/members {usernames:["lan"]}` | tìm theo `key`; member trùng = bỏ qua |
| 3 | Secret | `GET /admin/secrets?q=<NAME>` → vắng: `POST /admin/secrets {name, value, note:"seed:dify X1"}`; có ∧ `--rotate-secrets`: `PUT /admin/secrets/:name {value}`; có ∧ không cờ: bỏ qua | theo tên |
| 4 | Feature | `POST /admin/features {key:"dify-demo", name:{vi:"Dify demo",en:"Dify demo"}, status:"on", command_ids:[]}` (tồn tại ⇒ dùng lại) | theo `key` |
| 5 | Workflow | `GET /admin/workflows?q=<key>` → vắng: POST; khác (`workflowPatch`) ⇒ PUT kèm `version`; 409 `VERSION_CONFLICT` ⇒ đọc lại 1 lần | theo `key` |
| 6 | Command | theo `name`: vắng ⇒ POST với `feature_ids:[dify-demo]` (**không** để mặc định core); có ∧ `workflow_id` khác workflow của seed ⇒ **bỏ qua + cảnh báo** (không chiếm lệnh người khác); khác ⇒ PUT | theo `name` |
| 7 | Entitlement + grant feature | `PUT /admin/features/:id/entitlements/:tenant_id`; `POST /admin/grants?tenant_id= {feature_id, group_id}` (trùng ⇒ coi là đã có) | — |
| 8 | Agent chatbot (K7) | thư mục tạm = chép `apps/hub-api/seed/*.yaml` + thêm vào `agents.yaml`: `{key:dify-chatbot, name:{vi:"Chatbot (Dify)",en:"Chatbot (Dify)"}, description ≥20, runtime:dify-agent, profile:$HUB_SEED_PROFILE, runtime_options:{workflow_key:dify-chatbot}}`; `access.yaml` thêm `entitlements: {agent:dify-chatbot, tenant_key:acme}` (không thêm `grants:`) → `bun --env-file=.env.local apps/hub-api/src/modules/seed/seed.ts` với `HUB_SEED_DIR=<tmp>` (`HUB_SEED_PROFILE` như `hub:dev`; DB = `DATABASE_URL` của hub-api, truyền cho script — test trỏ DB qc qua env); xoá thư mục tạm | seed upsert |
| 9 | Grant agent | `GET /agent-grants?tenant_id=&subject_type=group&subject_id=` lấy `agent.id` của `dify-chatbot` → `POST /agent-grants?tenant_id=` `{agent_id, subject_type:"group", subject_id}` (201/200 đều ok) | Hub `on conflict do nothing` |

Dry-run in: từng bước "tạo/cập nhật/giữ nguyên" + tên app, loại, input map, **không** URL đầy đủ có query, không key. Thiếu `DIFY_SEED_ENV_FILE` / thiếu key của app chọn ⇒ exit 1 **trước** bước 1, nêu tên biến (AC17).

### 5.5 Chống lộ key (X1-R04)
Đọc file bằng `readFileSync`, tách dòng, chỉ giữ dòng có tên trong danh sách trắng; không `dotenv` toàn file, không gán `process.env`. Key chỉ là đối số `value` của bước 3. Mọi `catch` in `code` + tên bước, không in `err.message` của fetch có body. Không in độ dài/tiền tố/hash. Test AC16: chạy với key giả dạng `app-XXXXXXXX…` rồi quét stdout/stderr + log admin-api giả (thô/base64/base64url/hex, mẫu `leakForms`).

## 6. Stack (ST1) — `bun run combine:dev`
File `tools/hub-dev/src/combine.ts` (≤ 400 dòng; tái dùng `startHubDev`, `healthy`, `hubApiEnv` của `dev.ts`; không sửa hành vi `hub:dev`) + hàm thuần `tools/scripts/src/combine.rules.ts` (QC khoá, AC19): `buildCombineEnv(base, opts: {token?, wsl?, mock?}): Record<ProcName, env>` (env §3; token chung); `stopOrder(started: readonly ProcName[]): ProcName[]` (ngược thứ bật). Script `"combine:dev": "bun --env-file=.env.local tools/hub-dev/src/combine.ts"`.

| Bước | Việc | Kiểm |
|---|---|---|
| 0 | `docker compose up -d --wait` (Postgres, Redis, Mailpit) | exit 0 |
| 1 | `HUB_INTERNAL_TOKEN` (§3), đặt `CORS_ORIGINS`, `HUB_CORS_ORIGINS`, `ADMIN_HUB_URL` vào env truyền cho tiến trình con | — |
| 2 | `startHubDev()` với `HUB_DEV_RUNTIME=none` mặc định: migrate → admin-api `:3001` → fixture user → `hub:seed` → hub-api `:4000` | `/health` 2 cổng |
| 3 | chat-web `bun run --cwd apps/chat-web dev` (`HUB_URL`, `AUTH_URL`) · admin-web (`ADMIN_API_URL`, `PUBLIC_HUB_URL`, `PUBLIC_STUDIO_URL`, `PUBLIC_CHAT_WEB_URL`) · studio-web (`ADMIN_API_URL`, `HUB_URL`, `PUBLIC_ADMIN_WEB_URL`, `PUBLIC_CHAT_WEB_URL`) | `GET /` 200 ở 3100/3000/3200 (studio `/studio/`), chờ ≤ 60 s |
| 4 | Runtime: in lệnh WSL (hub-dev.md "Runtime trong WSL") với `AGENT_RT_PROVIDERS=claude-sub,dify`, `AGENT_RT_HUB_URL=<url Hub nhìn từ WSL>`; `COMBINE_WSL=1` ⇒ tự `wsl.exe -d Ubuntu -u worker -- bash -l -s` (stdin = script) | log `runtime.ready` (không chặn) |
| 2b | Dify mock: `startDifyMock()` (`tools/hub-dev/src/dify-mock.ts`) cổng 5001 nếu trống (bận ⇒ dùng lại + ghi chú); `docs/guides/combine-test.md` S7 (D1): tạo workflow `mock-send` qua Admin (base_url `http://localhost:5001/v1`, secret `mk-ok`) rồi bật cờ `side_effect` | `GET :5001` phản hồi |
| 5 | In bảng URL + user mẫu; nhắc `bun run seed:dify` (dry-run) | — |
| Dừng | Ctrl+C/SIGTERM: dừng theo thứ tự ngược đúng các tiến trình script đã bật (không giết tiến trình dùng lại) | AC19 |

Cổng bận ⇒ dùng lại (như `hub:dev`) + ghi chú; web bận ⇒ lỗi rõ (`strictPort`).

## 7. Cho QC (cần trước/cùng B1)
| # | Việc | File |
|---|---|---|
| QA | Đặt cờ bằng cột: `update admin.workflows set side_effect = true where id = …` thay `insert into hub.workflow_flags` | `tests/acceptance/H2a/_h2a.ts:414`, `H2a/confirm.int.test.ts:63`, `H2c/mcp-file.int.test.ts:37` |
| QB | Viết lại A67: cột có sẵn; đổi `side_effect` (owner) + `catalogChange` ⇒ hành vi đổi (không `add/drop column`) | `H2a/confirm.int.test.ts:260-300` |
| QC | Đếm migration 9 → 10 | `ADM-NFR-06/migrate.int.test.ts`, `H1/db.int.test.ts`, `M1/M2/M3 db-schema.int.test.ts` |
| QD | AC15: gọi `missingAdminColumns` trên DB tạm drop cột (owner) ⇒ `["admin.workflows.side_effect"]`; server thật thoát 1 | `tests/acceptance/X1/` |
| QE | AC11: stub Hub (`Bun.serve`) cho `POST /admin/commands/test`: 8a–8f, 403, 503 vắng env, 409 side_effect; quét response/log không có token | `tests/acceptance/X1/` |
| QF | Không thêm mã vào `API_ERRORS` (khoá 48) — dùng `COMMAND_TEST_ERRORS` | — |
| QG | Smoke AC20: qc viết, đếm bằng bộ đếm trong script (mỗi app đúng 1, không retry, không DB) | `tests/smoke/X1/dify-live.ts` |

## 8. Cho FE (trả BL1–BL6 của `plan-frontend.md` §5)
| # | Chốt |
|---|---|
| BL1 | **`POST /admin/commands/test`** (không id) — chạy được lệnh chưa lưu; bỏ disable "Lưu lệnh một lần" |
| BL2 | Body `CommandTestRequestSchema` (§2.2): `run_as_user_id` (không phải `run_as`), thêm `confirm_side_effect?`; response `CommandTestResponseSchema` = `TestRunResponseSchema` |
| BL3 | Mã ở `COMMAND_TEST_ERRORS`: 502 `HUB_UNAVAILABLE`, 503 `HUB_NOT_CONFIGURED` ("Chưa cấu hình kết nối Hub (ADMIN_HUB_URL/HUB_INTERNAL_TOKEN)."), 409 `SIDE_EFFECT_CONFIRM_REQUIRED` ⇒ hộp xác nhận "Workflow này có tác dụng phụ thật (gửi/ghi dữ liệu). Vẫn chạy thử?" rồi gửi lại `confirm_side_effect:true`, 409 `NOT_CONFIGURED` ("Workflow chưa sẵn sàng ở Hub (secret/khoá thiếu)."), 422 `CMD_MISSING_ARG` (details như Chat), 400 `INVALID_REFERENCE {field}` |
| BL4 | `side_effect` có ở `WorkflowSchema`/`WorkflowListItemSchema` (bắt buộc), create/update tuỳ chọn |
| BL5 | `agent_count` tính thật từ `hub.agent_grants` (B4); FE hiển thị số như cột khác |
| BL6 | Đúng như FE giả định: `GET /agent-grants?subject_type=group&subject_id=` trả **mọi** agent có entitlement chưa thu hồi của T (trừ Orchestrator); `grants[]` lọc theo subject (H3b-R11, `agent-grants.repo.ts` LIST_AGENTS/LIST_GRANTS) |
| Khác | effective-access khi chạy với tư cách user: **không làm ở X1** (K9, #89) |

## 9. Trả lời Q1–Q10 (phía backend)
| Q | Quyết định | Lý do |
|---|---|---|
| Q1 | Giữ: chatbot, translate, gmail-summary, email-reply, screenshot-ask | khớp registry, không tác dụng phụ |
| Q2 | Đổi cú pháp theo K5 (§5.3): `/translate <lang> <text…>`, `/summary <email…>`, `/reply <email…>`, `/ask-image <câu hỏi…>` + tệp | contract thật là `{source,…}`; arg vị trí |
| Q3 | Giữ `false` cả 5; S7 dùng workflow mock `mock-send` (`side_effect=true`, Dify mock) | an toàn demo |
| Q4 | API Admin cho secret/workflow/command/feature/group/grant; **agent + entitlement qua Hub seed CLI** (K7); grant agent qua `/agent-grants` | Studio không có entitlement |
| Q5 | Giữ: tenant `acme`, group `dify-demo` (`lan`), feature riêng `dify-demo` | không lộ cho core/mọi người |
| Q6 | Giữ có điều kiện (§2.3); QC sửa fixture là điều kiện tiên quyết (K2) | — |
| Q7 | Giữ; thêm `dify` vào `AGENT_RT_PROVIDERS` của lệnh in | R9 |
| Q8 | Giữ | X1-R02 |
| Q9 | Giữ `ai_system` | như `hub:dev` |
| Q10 | **Hết hiệu lực** (`66299a0`) | — |
| Q-B1 (mới) | Test command chỉ `platform_admin` | module commands chỉ platform; tenant_admin không có màn |
| Q-B2 (mới) | Không backfill `workflow_flags` → cột | chỉ dev có cờ mẫu; seed yaml `side_effect` sau X1 không còn tác dụng — ghi `combine-test.md` + CR dọn |
