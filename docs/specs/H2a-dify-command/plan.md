# Plan · H2a-dify-command (BE TS + contract + DB)

Python: `plan-runtime.md` (backend-lead khác). SQL nguyên văn + bảng: `plan-db.md`. Câu chữ lỗi/MCP: `plan-errors.md`. Luật: spec §2 (R01–R25). Nền: H1 `plan.md` (§ ghi `H1 §x`).

## 1. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| P1 | **Q1 thực hiện bằng hàm** `hub.workflow_secret(workflow_id)` SECURITY DEFINER (trả `secret_id, ciphertext, iv, key_version` của secret **gắn workflow**), EXECUTE chỉ `hub_ro`; **không** GRANT cột `admin.secrets` | Test khoá M2 `db-rls` (`hub_ro` → 42501) và M3 `hub-view` vẫn đúng **cả trên DB đã chạy migration Hub**; hẹp hơn GRANT cột. Mẫu `hub.tenant_sub_limit` (H1) |
| P2 | Usage `billing='dify'` của Hub ghi qua hàm `hub.log_dify_usage(...)` SECURITY DEFINER, EXECUTE `hub_rw`; **không** GRANT INSERT `usage_logs` | Test khoá H1 A51 assert `hub_api` INSERT `usage_logs` = false. Hàm cố định `billing='dify'`, `provider_key='dify'`, `model=NULL` |
| P3 | **Q3:** sửa `packages/contracts/src/chat` **chỉ thêm**: file mới `chat/commands.ts` + trường tuỳ chọn `context` của `SendMessageRequestSchema`. Mã `CMD_*` ở hằng **riêng** `CHAT_COMMAND_ERRORS`, **không** thêm vào `CHAT_API_ERRORS` | Thêm vào `CHAT_API_ERRORS` làm đỏ `chat/entities.test.ts:142` (đúng 6 mã) và typecheck `tools/mocks/src/chat/http.ts:9` (`Record<ChatErrorCode,…>`). §2.1: không test khoá C1 nào đỏ |
| P4 | Token job (MCP + Q5): **Runtime sinh lúc claim** (32 byte CSPRNG, base64url), lưu `jobs.token_hash = sha256` trong cùng câu UPDATE claim; Hub tra `token_hash` + `status='running'`. Bản rõ không vào DB/payload/log | R18 nói "tạo lúc enqueue, lưu hash" — nhưng payload nằm trong `hub.jobs` nên token rõ trong payload = token trong DB. Sinh ở claim: không bên nào lưu bản rõ; requeue → claim mới → token mới |
| P5 | Quyền command: **chép** hàm thuần (tập con `visible` của `computeEffectiveAccess` Admin) vào `commands/command-access.rules.ts`, cùng kiểu đầu vào; **test đối chiếu** ở `tests/acceptance/H2a/` import cả hai (tests không phải app, không vi phạm depcruise) — như JWT H1 P4. TECH-DEBT: gộp `packages/access` khi combine | Package chung buộc sửa `apps/admin-api` (ngoài phạm vi); import chéo app vi phạm depcruise |
| P6 | Giải mã secret: **chép** `decryptSecret` + `parseMasterKey` (≈ 35 dòng, `node:crypto`) vào `apps/hub-api/src/lib/secret-crypto.ts`; test vector sinh bằng `encryptSecret` Admin (rand cố định) commit thành JSON trong test | Định dạng = contract với Hub (`secret-crypto.ts` Admin); không import chéo |
| P7 | MCP **tự viết** (Q8 mặc định): POST JSON-RPC, trả `application/json` (không SSE), không session. Hỗ trợ `initialize` (≤ 2025-11) **và** `server/discover` (bản 2026-07-28, stateless), `tools/list`, `tools/call`, `ping`, notification → 202. Không ADR | Tập con nhỏ (~200 dòng); spec MCP vừa đổi sang stateless (2026-07-28) — SDK đuổi theo cũng phải nâng; smoke I2 với `claude-sub` thật là cửa xác nhận |
| P8 | Dify client: `fetch` + `createSseParser` có sẵn (`@ai/contracts/chat` rules) — không thư viện mới | Đủ cho SSE `data:` |
| P9 | `workflow.async` dùng provider seed **`dify`** (`kind=api`, `vendor=dify`, `max_concurrency` 5, WRK-NFR-05): claim H1 giữ nguyên (không đếm slot subscription). `jobs.agent_id` nullable khi `type='workflow.async'` | Tái dụng claim/slot/huỷ H1, không nhánh SQL mới |
| P10 | Requeue `workflow.async` (R13): cột `jobs.queued_at` (hết hạn `queued` của Hub tính từ đây, không từ `created_at`) + `jobs.dispatched_at` (Runtime đặt **trước** khi gửi request Dify nếu `side_effect`); quét orphan đưa về `queued` khi `attempts < 3` ∧ ¬(`side_effect` ∧ đã gửi) | AC-W06; Q6 không chạy hai lần |
| P11 | Mọi INSERT `run_steps` cấp `seq` = `max(seq)+1` trong DB (thử lại khi 23505 `run_steps_run_seq_uq`, ≤ 3 lần) — vòng Orchestrator thôi đếm trong bộ nhớ | Bước `tool` do `/mcp` ghi (có thể ở instance khác) xen giữa bước vòng |
| P12 | Bước `tool` **không** phát SSE live (chỉ hàng `run_steps`, thấy ở E11/E14) | `/mcp` có thể ở instance không giữ `SseWriter` |
| P13 | Async: Hub tạo **đúng 1** step `workflow` (như sync, sửa R12); Runtime trả `job.result{kind:"text"}` cuối (đệm như H1 P6); Hub cắt `delta`; `job.progress` chỉ là nhịp sống, **không** phát SSE, không đổi `RunEvent` | R12 + R09 (nhãn tĩnh, không tên node) |
| P14 | Cờ `side_effect` dự phòng (Q2): bảng `hub.workflow_flags` do `hub:seed` ghi; nạp cache cùng catalog | Cần lưu cho runtime; xoá khi combine CR-034 |
| P15 | Mock Dify Hub (Q9): `tools/hub-dev/src/dify-mock.ts` (Hono, chạy trong tiến trình test hoặc `bun run hub:dify-mock` cho Python int); `tools/mocks` không đổi | Có test khoá Admin dùng `tools/mocks/src/dify.ts` |

## 2. Contract
### 2.1 `@ai/contracts/chat` — chỉ thêm (Q3)
| Thay đổi | Định nghĩa | Kiểm với test khoá C1 |
|---|---|---|
| `entities.ts` `MessageContextSchema` (mới) | `strictObject{selection?: string 1–16 000, page_url?: string ≤ 2 048 regex ^https?://, page_text?: string 1–50 000}` (không trim) | — |
| `SendMessageRequestSchema` + `context: MessageContextSchema.optional()` | trường tuỳ chọn; thừa trường khác vẫn 400 | `messages.contract K-M5` (`la:1` → 400) ✓; `entities.test.ts:134` (`{content}` → `{content}`) ✓ |
| `chat/commands.ts` (mới, export từ `chat/index.ts`) | `CommandMenuArgSchema{name: ARG_NAME_RE, description:{vi: 1–200, en: 1–200\|null}, required: boolean, has_fallback: boolean, rest: boolean}` · `CommandMenuItemSchema{name: CATALOG_KEY_RE, aliases: ≤ 5, description:{vi, en\|null}, args: ≤ 20}` · `CommandMenuResponseSchema{items: CommandMenuItem[] ≤ 500}` (sắp `name`) | file mới |
| `CHAT_COMMAND_ERRORS` (mới) | `{CMD_NOT_FOUND: 404, CMD_MISSING_ARG: 422}` + `ChatCommandErrorCode` · `CmdNotFoundDetailsSchema{suggestions: string[] ≤ 3}` · `CmdMissingArgDetailsSchema{missing: string[] ≤ 50, invalid: string[] ≤ 50}` | `CHAT_API_ERRORS` không đổi ✓ |
| Sự kiện SSE | **không đổi** | `stream.contract:181` (`seen` = `CHAT_EVENT_NAMES`) ✓ |
| `RunSummary`/`Run`/`StepSummary` | không đổi; bước `workflow`/`tool` hiện như step thường (nhãn tĩnh) | ✓ |

Hành vi mới với client C1: tin bắt đầu `/` (không `//`) → JSON 404/422 thay vì SSE (R07). Bộ `tests/contract/chat` không gửi `/` (đã grep). **CR-impact Chat:** menu `/`, gửi `context`, hiện lỗi `CMD_*` (chat-web chưa biết mã → hiện lỗi chung).

### 2.2 `@ai/contracts/hub` (Hub↔Runtime, quy tắc H1 §2: không `refine/transform/default`)
| Tên | Định nghĩa |
|---|---|
| `WorkflowKeySchema` | string regex `CATALOG_KEY_RE` |
| `McpConfigSchema` | `{url: string 1–2 048 regex ^https?://, tools: WorkflowKey[] 1–20}` |
| `AgentCliJob.mcp` | `null` → `McpConfigSchema.nullable()` (token **không** ở payload, P4) |
| `WorkflowAsyncJobSchema` | `v`, `type:"workflow.async"`, `provider_key:"dify"` · `job_id, run_id, step_id, tenant_id, user_id, conversation_id, flow_id, workflow_id`: uuid · `feature_id`, `command_id`: uuid nullable · `workflow_key`: WorkflowKey · `app_type`: enum[workflow, chat, agent] · `inputs`: record<INPUT_NAME_RE, string ≤ 64 000 \| number \| boolean> (≤ 50 khoá) · `query`: string 1–16 000 \| null (bắt buộc khi chat/agent — luật Hub) · `output_field`: 1–128 \| null (`commands.output.field`) · `dify_user`: 1–200 · `side_effect`: boolean · `timeout_s`: int 1–600. **Không** `base_url`, key, token, URL Hub (Runtime lấy URL Hub từ env `AGENT_RT_HUB_URL`) |
| `JobPayloadSchema` | `discriminatedUnion("type", [AgentCliJob, WorkflowAsyncJob])` |
| `HUB_JOB_ERROR_CODES` | + `NOT_CONFIGURED` (vẫn ⊂ `CHAT_RUN_ERROR_CODES` — test khoá H1 R14 ✓) |
| `JOB_FAIL_REASONS` | + `credential` (lấy key lỗi), `upstream` (Dify HTTP/`failed`) |
| `RunEvent` | không đổi (P13) |
| Fixture | valid `JobPayload.workflow-async.json`, `JobPayload.workflow-chat.json`, `JobPayload.agent-mcp.json`; invalid `JobPayload.workflow-bad-app.json`, `JobPayload.mcp-empty-tools.json` (luật chat → `query` bắt buộc là luật Hub, không ở schema). Fixture cũ (`mcp: null`, code `NOPE`) vẫn đúng ✓ |
| Sinh | `bun run contracts:gen` → `hub.schema.json` + `hub.py`; `contracts:check` xanh |

### 2.3 `@ai/contracts/hub-internal` (subpath mới, Hub↔Admin/Runtime HTTP; được dùng zod đủ)
| Tên | Định nghĩa |
|---|---|
| `HUB_INTERNAL_ERRORS` | `{VALIDATION_ERROR: 400, UNAUTHORIZED: 401, CMD_MISSING_ARG: 422, NOT_CONFIGURED: 409, INTERNAL_ERROR: 500, UNAVAILABLE: 503}`; body `ErrorResponseSchema` |
| `TestRunRequestSchema` | `strictObject{command: strictObject{workflow_id: UuidSchema, args: ArgsSchema.default([]), input_map: InputMapSchema.default({}), output: CommandOutputSchema, timeout_s: TimeoutSchema.default(30)}` (ghép từ schema M2 có sẵn, không `pick` trên schema có `refine`; luôn chạy sync), text: string 0–16 000 (phần sau tên lệnh), context?: MessageContext, actor_user_id: uuid}` |
| `TestRunResponseSchema` | `discriminatedUnion("ok")`: `{ok:true, output: string ≤ 64 000, steps: TestRunStep[] ≤ 10, usage, ms}` · `{ok:false, error:{code: ChatRunErrorCode, message: 1–500, detail: string ≤ 300 \| null}, steps, usage, ms}`; `TestRunStep{label: 1–64, status: enum[ok, failed], ms: int ≥ 0}`; `usage{input_tokens, output_tokens: int ≥ 0, cost_usd: number ≥ 0}` |
| `DifyCredentialResponseSchema` | `strictObject{base_url: 1–2 048 ^https?://, api_key: 1–2 048, app_type: enum[workflow, chat, agent]}` (giá trị hiện hành của workflow; header `Cache-Control: no-store`) |
| `MCP_PROTOCOL_VERSIONS` | `["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"]` (đầu = ưu tiên) |
| `ToolConfirmationRequiredSchema` | `{code:"CONFIRMATION_REQUIRED", question: 1–2 000, choices: [string, string]}`. Kết quả `tools/call`: `isError:true`, `content[0].text` = **JSON.stringify** đúng object này (Runtime parse, plan-runtime §5), `content[1].text` = câu chỉ dẫn (`plan-errors` §5), `structuredContent` = cùng object |

### 2.4 Endpoint
| Method · Path | Auth | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|
| GET `/commands` | JWT (mọi role) | — | `CommandMenuResponse` | 401 `AUTH_EXPIRED` |
| POST `/conversations/:id/messages` (E12) | JWT, chủ hội thoại | `SendMessageRequest` (+`context`) | SSE C1 | như C1 + 404 `CMD_NOT_FOUND{suggestions}` · 422 `CMD_MISSING_ARG{missing, invalid}` (JSON, trước khi tạo run) |
| POST `/mcp` | `Bearer <token job>` | JSON-RPC 2.0 (§6) | JSON-RPC / 202 | 401 (không body JSON-RPC) · GET/DELETE `/mcp` → 405 |
| POST `/internal/test-run` | `Bearer HUB_INTERNAL_TOKEN` (so `timingSafeEqual` trên sha256) | `TestRunRequest` | `TestRunResponse` (200 cả khi run lỗi) | 401 · 400 · 422 `CMD_MISSING_ARG` · 409 `NOT_CONFIGURED` (secret thiếu/giải mã lỗi, workflow không có) · 503 `UNAVAILABLE` (vắng `HUB_INTERNAL_TOKEN`) · 500 |
| POST `/internal/jobs/:job_id/dify-credential` (Q5) | `Bearer <token job>` | — | `DifyCredentialResponse` | 401 (mọi sai: token, job khác, không `running`, không `workflow.async`) · 409 `NOT_CONFIGURED` **chỉ** khi secret thiếu/giải mã lỗi — **không** xét `workflows.enabled` (job đã nhận chạy tới cùng, R08) |

`/internal/*` và `/mcp` không qua middleware JWT/CORS; có request_id + log (không log header `Authorization`, không body).

## 3. Dữ liệu (`migrations-hub/0002_h2a_dify.sql`, SQL: `plan-db.md` §1)
| Đối tượng | Thay đổi |
|---|---|
| `runs` | + `command_id uuid null`, `feature_id uuid null` (không FK admin, H1 P3); CHECK `kind IN ('orchestrated','command')`, `(kind='command') = (command_id IS NOT NULL)` |
| `run_steps` | `type` + `workflow`, `tool`; + `workflow_id uuid null`; CHECK `(type IN ('workflow','tool')) = (workflow_id IS NOT NULL)` |
| `jobs` | `type` + `workflow.async`; `agent_id` DROP NOT NULL + CHECK `type='workflow.async' OR agent_id IS NOT NULL`; + `token_hash bytea null` (32 byte), `queued_at timestamptz NOT NULL DEFAULT now()`, `dispatched_at timestamptz null`; index `jobs_token_hash_uq UNIQUE (token_hash) WHERE token_hash IS NOT NULL` |
| `providers` | CHECK `vendor` + `dify` |
| `tool_confirmations` (mới) | `id, tenant_id, user_id, flow_id FK flows CASCADE, run_id FK runs CASCADE (run yêu cầu), agent_id uuid, workflow_id uuid, status (pending\|confirmed\|declined\|consumed\|expired), decided_run_id uuid null, created_at, decided_at null, consumed_at null`; `UNIQUE (flow_id, agent_id, workflow_id) WHERE status IN ('pending','confirmed')` (tiền tố `flow_id` phục vụ E12); RLS như 5 bảng hội thoại (H1 §3.4) |
| `workflow_flags` (mới, P14) | `workflow_id uuid PK, side_effect boolean NOT NULL DEFAULT false, updated_at` — `hub_rw` SELECT, owner ghi (seed) |
| Hàm | `hub.workflow_secret(uuid)` (P1) · `hub.log_dify_usage(...)` (P2) |
| GRANT | `hub_rw`: CRUD `tool_confirmations`; SELECT `workflow_flags`; SELECT/INSERT/UPDATE `cli_sessions` (agent `dify-agent`, R14, mọi câu lọc `tenant_id`); EXECUTE `log_dify_usage`. `hub_ro`: EXECUTE `workflow_secret`. `agent_runtime`: không đổi (UPDATE `jobs` đã có) |
| Thứ tự khoá (H1 §3.5) | `… runs → run_steps → messages → tool_confirmations → jobs → usage_logs → cli_sessions …` |

Đọc `admin.*` (đã có từ M2/M3, kiểm bằng test D2): `features, feature_commands, feature_entitlements, feature_grants, commands, command_names, workflows, groups, group_members, tenants(key)`. `admin.workflows.side_effect` (R23): kiểm `information_schema.columns` lúc nạp cache.

## 4. hub-api — module
| Module / file | Việc |
|---|---|
| `config/catalog.repo.ts` · `config/catalog.rules.ts` | Nạp catalog Admin (bảng trên + `workflow_flags`) trong `reloadAdmin` (cùng `config_changed`/poll H1) → `CatalogSnapshot` bất biến; `ConfigCache.catalog()` |
| `commands/` | `commands.routes.ts` (GET `/commands`), `commands.service.ts` (`menu(u)`, `prepare(u, req) → PreparedCommand` ném `CMD_*`), `command-access.rules.ts`, `command-parse.rules.ts`, `command-input.rules.ts`, `suggest.rules.ts`, `command-driver.ts` (`RunDriver` sync/async), README |
| `runs/` | E12 route: `classifyMessage` → text: như H1 (content đã bỏ một `/` nếu `//`) · command: `prepare` rồi `RunService.start(u, conv, req, {kind:"command", driver, meta})` (tham số mới tuỳ chọn); `createRunTx` + bước quyết định xác nhận (`plan-db` §3) |
| `dify/` | `dify.client.ts` (`runStreaming`, `stop`), `dify.rules.ts`, `dify-agent-runner.ts` (`AgentRunner` cho `dify-*`), `dify.usage.ts` (gọi `log_dify_usage`), `credential.service.ts` (hàm `workflow_secret` + giải mã, R17) |
| `runner/` | `workflow-job-runner.ts` (INSERT job `workflow.async` + đợi sự kiện, dùng `RunStreamReader`), `routing-runner.ts` (`AgentRunner` chọn theo `agent.runtime`), `orphan-sweep.ts` (+ câu requeue), `buildJobPayload` thêm `mcp`, `insertStep` (P11) |
| `mcp/` | `mcp.routes.ts`, `mcp.service.ts`, `mcp.rules.ts`, `mcp.repo.ts` (token → job, bước `tool`, xác nhận), `confirm.rules.ts`, README |
| `internal/` | `internal.routes.ts` (test-run, credential), `internal-auth.ts`, `test-run.service.ts` |
| `lib/` | `secret-crypto.ts` (P6), `job-token.ts` (`hashJobToken(token): Buffer` sha256), `errors.ts` (+ `CHAT_COMMAND_ERRORS`, `HUB_INTERNAL_ERRORS` vào `appError`/`ERROR_MESSAGES`) |

`app.ts` (217 dòng): mount `/commands`, `/mcp`, `/internal` qua hàm `mountH2a(app, deps)` ở `app.h2a.ts` để giữ ≤ 250 dòng.

## 5. Luồng
### 5.1 E12 command (R01–R08, R16)
1. zod body (400) → `classifyMessage(content)`: `text` → luồng H1 (content mới). `command` → 2.
2. `prepare`: tra `command_names` (lower) trong catalog; `usableCommands(access)` không chứa → `CMD_NOT_FOUND{suggestions: suggestCommands(name, usable)}` (tên rỗng → `[]`). Có → `bindArgs` → `buildInputs` (lỗi → `CMD_MISSING_ARG`). Đầu ra `PreparedCommand{command, workflow, featureId, inputs, query, sideEffect}` (snapshot, R08).
3. `RunService.start` (kind `command`, `command_id`, `feature_id`) — 404/409 như H1 (sau bước 2, không ghi gì trước đó).
4. Driver: `insertStep(type='workflow', workflow_id, label tĩnh)` → sync §5.2 / async §5.3.

### 5.2 Sync (R09–R11, R15, R17)
`AbortSignal.any([writer.signal, timeout(commands.timeout_s)])` → `credential.get(workflow_id)` (lỗi → `NOT_CONFIGURED`) → `dify.runStreaming({appType, baseUrl, apiKey, inputs, query, user, conversationId: null}, signal, onDelta)` → mỗi text → `chunkText(…,40)` → `delta`. Kết thúc: `finalText(acc, outputs, output_field)`; `null` → `UPSTREAM_ERROR`. Abort do timeout → `stop(taskId)` (best-effort, ≤ 2 s) → `TIMEOUT`; do cancel → `stop` → (run đã `cancelled` bởi E15). `log_dify_usage` (cả khi lỗi sau khi có `task_id`, token 0 nếu không có số). Lỗi HTTP/SSE → `mapDifyHttpError`/`interpretDifyEvent` → `run.failed` qua `runErrorText` (H1 P11); thân lỗi đã che (`maskSecret`) chỉ vào `run_steps.detail.upstream` (≤ 300).

### 5.3 Async (R12, R13, P9–P10)
`WorkflowJobRunner`: `buildWorkflowJobPayload(...)` → transaction `system`: `INSERT hub.jobs (type='workflow.async', provider_key='dify', agent_id NULL, …)` + `pg_notify('job_enqueued')` (provider `dify` thiếu/`enabled=false` → `NOT_CONFIGURED`, không job). Theo dõi như H1 §5.6 bước 3–4; hết hạn `queued` sau `HUB_JOB_MAX_WAIT_S` tính từ `queued_at`. `job.result.output.text` → delta; `job.failed.code` → `run.failed`. Hạn của run = `commands.timeout_s` tính từ lúc tạo run, giữ qua các lần requeue (Runtime chỉ áp `payload.timeout_s` mỗi lần claim): hết hạn → huỷ job như E15 (`job_cancel`) → `run.failed TIMEOUT`. `job.started` có thể lặp (requeue) — Hub không lọc theo `seq`.

### 5.4 Agent `dify-*` (R14)
`RoutingRunner.run(task)`: `agentic-cli` → `JobAgentRunner`; `dify-workflow`/`dify-agent` → `DifyAgentRunner`: workflow theo `runtime_options.workflow_key` (cache; tắt/thiếu → `job.failed NOT_CONFIGURED`), `difyAgentInput(workflow.input_schema)` → input; `dify-agent` đọc/ghi `cli_sessions(conversation_id, agent_id, 'dify', tenant_id)`; phát `RunEvent` tổng hợp (`job_id` = id step, không hàng `jobs`): `job.started` → `job.result{agent_result: done{text}}` / `job.failed`. Timeout `agents.timeout_s`. Usage `agent_id`, `feature_id=null`.

### 5.5 Xác nhận `side_effect` (R21–R22): `plan-db.md` §3.

## 6. MCP `/mcp` (R18–R20, P7)
| Bước | Luật |
|---|---|
| Auth | `Authorization: Bearer <43 ký tự base64url>`; `hashJobToken` → `SELECT … FROM hub.jobs WHERE token_hash=$1 AND status='running' AND type='agent.cli'` (`plan-db` §2) → không dòng → 401. Ngữ cảnh = `{tenant, user, run, step, flow, agent, tools: payload.mcp.tools}` |
| Body | JSON object `{jsonrpc:"2.0", id?, method, params?}`; mảng (batch) → `-32600`; parse lỗi → `-32700`; method lạ → `-32601`. Không `id` = notification → 202 rỗng |
| `initialize` | `{protocolVersion: negotiateProtocol(params.protocolVersion), capabilities:{tools:{listChanged:false}}, serverInfo:{name:"ai-hub", version:"1"}}`; không cấp `Mcp-Session-Id` |
| `server/discover` | cùng thân như `initialize` + `supportedVersions: MCP_PROTOCOL_VERSIONS` |
| `ping` | `{}` |
| `tools/list` | `mcpToolsFor(...)` (R19): `agent_workflows(agent)` ∩ `workflow.enabled` ∩ `payload.mcp.tools`; bỏ workflow có input `file` bắt buộc (H2c); `{name: key, description, inputSchema: toolInputSchema(input_schema)}`, sắp `name`. Không phân trang (≤ 20) |
| `tools/call` | tên ∉ danh sách → `-32602` "Unknown tool" (không nói lý do). `validateToolArgs` lỗi → result `isError` + câu tĩnh. `side_effect` → §5.5. Gọi Dify gom (không stream) timeout `min(agents.timeout_s, HUB_DIFY_TIMEOUT_MAX_S)`, `user` R15 → `{content:[{type:"text", text}], isError:false}`; lỗi → `isError:true` + câu tĩnh theo mã (`plan-errors`). `insertStep(type='tool', workflow_id, detail:{inputs: maskInputs, code})` + `log_dify_usage(feature_id NULL)` |
| Header | Bỏ qua `Mcp-Method`/`Mcp-Name`/`MCP-Protocol-Version` (không bắt buộc với server stateless); trả `Content-Type: application/json` |

## 7. Hàm thuần — chữ ký chốt (qc viết test trước)
| File | Chữ ký |
|---|---|
| `commands/command-parse.rules.ts` | `classifyMessage(content: string): {kind:"text"; content: string} \| {kind:"command"; name: string; rest: string}` (trim đầu; `//`→ text bỏ 1 `/`; `name` lower, có thể `""`) · `tokenize(rest: string): string[]` (khoảng trắng; `"…"` một token; `\"`) · `bindArgs(args: readonly CommandArg[], rest: string, ctx: MessageContext): {values: Record<string, string \| null>; extra: number}` (R05; `rest=true` nguyên văn phần còn lại từ token đó, trim hai đầu) |
| `commands/command-input.rules.ts` | `buildInputs(i: {inputMap: InputMap; inputSchema: readonly WorkflowInput[]; args: readonly CommandArg[]; values: Record<string, string \| null>; ctx: MessageContext; userId: string; tenantId: string}): {ok:true; inputs: Record<string, string \| number \| boolean>; query: string \| null} \| {ok:false; missing: string[]; invalid: string[]}` (R06: number = `Number()` hữu hạn; boolean ∈ {true,false,1,0,yes,no} không phân biệt hoa; select ∉ options → invalid; `query` = input tên `query`) · `appNeedsQuery(appType): boolean` |
| `commands/command-access.rules.ts` | Kiểu đầu vào **trùng** Admin `AccessInput` · `usableCommands(i: CommandAccessInput): {commandId: string; featureId: string}[]` (= `visible` của Admin; `featureId` = feature hiệu lực có `key` nhỏ nhất, Q4) |
| `commands/suggest.rules.ts` | `levenshtein(a: string, b: string): number` (trên `normalize("NFC")`, theo code point) · `suggestCommands(typed: string, usable: readonly {name: string; aliases: readonly string[]}[]): string[]` (R04) |
| `commands/menu.rules.ts` | `toMenuItem(c: CatalogCommand, w: CatalogWorkflow): CommandMenuItem` (`required` = arg map vào input `required` ∧ `default=null` ∧ `fallback=null`) |
| `dify/dify.rules.ts` | `difyRunUrl(appType, baseUrl): string` · `difyStopUrl(appType, baseUrl, taskId): string` · `difyRunBody(i: {appType; inputs; query; user; conversationId: string \| null}): Record<string, unknown>` (`response_mode:"streaming"`) · `interpretDifyEvent(e: unknown): DifyEvent` (`delta{text}` · `meta{taskId?, conversationId?}` · `finished{status, outputs, usage}` · `error` · `ignore`) · `mapDifyHttpError(status: number): "NOT_CONFIGURED" \| "UPSTREAM_ERROR"` · `finalText(acc: string, outputs: Record<string, unknown> \| null, field: string \| null): string \| null` · `difyUsage(u: unknown): {input_tokens; output_tokens; cost_usd: number}` (R15) · `maskSecret(text: string, secret: string, max = 300): string` (thô/base64/hex → `***`) · `maskInputs(inputs: Record<string, unknown>, secret: string): Record<string, string>` (mỗi giá trị `String(v)`, cắt ≤ 200 ký tự, rồi `maskSecret`; R20) · `difyUser(tenantKey: string, userId: string): string` · `difyAgentInput(inputs: readonly WorkflowInput[]): string \| null` (R14) |
| `mcp/mcp.rules.ts` | `parseRpc(body: unknown): RpcRequest \| RpcError` · `negotiateProtocol(v: unknown): string` · `toolInputSchema(inputs: readonly WorkflowInput[]): JsonSchemaObject` · `mcpToolsFor(i: {agentWorkflowIds: ReadonlySet<string>; workflows: readonly CatalogWorkflow[]; allowed: readonly string[]}): McpTool[]` · `validateToolArgs(inputs: readonly WorkflowInput[], args: unknown): {ok:true; inputs; query} \| {ok:false}` · `toolTimeoutS(agentTimeoutS: number, maxS: number): number` |
| `mcp/confirm.rules.ts` | `isAgreeReply(content: string): boolean` (NFC, trim, lower ∈ {"đồng ý","agree"}) · `confirmationPrompt(locale): {question: string; choices: [string, string]}` · `confirmationInstruction(locale): string` (`plan-errors`) |
| `runner/runner.rules.ts` (+) | `buildWorkflowJobPayload(i: WorkflowJobInput): WorkflowAsyncJob` · `mcpConfigFor(agent: AgentConfig, toolKeys: readonly string[], url: string): McpConfig \| null` (rỗng → null) · `orphanAction(j: {type; attempts; sideEffect; dispatched: boolean}): "requeue" \| "fail"` |
| `commands/catalog.types.ts` | `CatalogWorkflow{id; key; name; description: string \| null; appType: "workflow" \| "chat" \| "agent"; baseUrl; secretId: string \| null; inputSchema: readonly WorkflowInput[]; outputField: string \| null; enabled; sideEffect}` (`admin.workflows` + `workflow_flags`) · `CatalogCommand{id; name; aliases: readonly string[]; description; workflowId; args: readonly CommandArg[]; inputMap: InputMap; output: CommandOutput; mode: "sync" \| "async"; timeoutS; enabled}` (`admin.commands`) · `WorkflowJobInput{jobId, runId, stepId, tenantId, userId, conversationId, flowId: string; featureId, commandId: string \| null; workflow: CatalogWorkflow; inputs; query: string \| null; outputField: string \| null; difyUser; timeoutS}` |
| `lib/secret-crypto.ts` | `parseMasterKey(b64: string, version?: number): SecretKey` · `decryptSecret(k, id, s): string` (như Admin) |

## 8. Hiệu năng · env
| Chỉ tiêu | Ngưỡng · cách |
|---|---|
| `GET /commands`, `tools/list` | ≤ 50 ms p95 từ cache, 0 query DB (đếm query trong test) |
| E12 command trước Dify | ≤ 200 ms p95: 1 transaction H1 + 1 gọi `workflow_secret` (PK `workflows`, `secrets`) |
| Auth `/mcp` / credential | 1 query, index `jobs_token_hash_uq` |
| `insertStep` | `max(seq)` theo `run_steps_run_seq_uq` (run_id tiền tố) |
| Xác nhận | unique partial `tool_confirmations_open_uq` (tiền tố `flow_id`) |
| Cache catalog | nạp lại toàn bộ khi `config_changed` (đo: 5 000 grant < 200 ms); tra quyền O(feature của lệnh) |

Env mới (hub-api): `SECRET_MASTER_KEY` (cùng admin-api; khởi động: `parseMasterKey` + tự kiểm, sai → fatal) · `HUB_INTERNAL_TOKEN` (≥ 32 ký tự; vắng → `/internal/test-run` 503) · `HUB_PUBLIC_INTERNAL_URL=http://localhost:4000` (dựng `mcp.url` = `<url>/mcp`) · `HUB_DIFY_TIMEOUT_MAX_S=300` · test: `DIFY_LIVE`. Mock: `HUB_DIFY_MOCK_PORT=4030`. `.env.example` thêm, không giá trị secret.

## 9. Mock Dify Hub (P15, task MK)
`tools/hub-dev/src/dify-mock.ts`: `startDifyMock({port?}) → {url, calls(): MockCall[], reset(), close()}`; `MockCall{path, auth, body, at}`. Kịch bản theo **api key** (`Authorization: Bearer <key>`): `mk-ok` (5 `text_chunk`/`message` + `workflow_finished`/`message_end`, `metadata.usage`), `mk-outputs` (không chunk, `outputs`), `mk-empty`, `mk-failed` (200 + `status=failed`), `mk-error-event`, `mk-401`, `mk-404`, `mk-400`, `mk-503x<n>` (503 n lần đầu rồi ok, đếm theo key), `mk-slow-<ms>` (chunk cách ms, nghe stop), `mk-agent` (`agent_thought` + `agent_message`, trả `conversation_id`), `LEAK_KEY_*` (= ok). Endpoint: `POST /v1/workflows/run`, `POST /v1/chat-messages`, `POST /v1/workflows/tasks/:id/stop`, `POST /v1/chat-messages/:id/stop`; SSE có `ping` và `event:` chuẩn Dify; từ chối `response_mode≠streaming` (400). Script `bun run hub:dify-mock`.

## 10. Ràng buộc gửi plan-runtime · trả lời plan-runtime §9
| # | Chốt | Chỗ |
|---|---|---|
| R1 | ✓ nhận tên trường phẳng; **sửa**: `timeout_s` 1–600 (= `commands.timeout_s`), `workflow_key` = `CATALOG_KEY_RE` (`^[a-z0-9-]{2,32}$`), thêm `provider_key:"dify"`; **từ chối** `job_token` trong payload (→ RT1) | §2.2, P4 |
| R2 | ✓ `NOT_CONFIGURED`; **thêm** reason `credential`, `upstream` (bảng `plan-errors` §2) | §2.2 |
| R3 | `mcp = {url, tools}`; **từ chối** `token` trong payload (→ RT1) | §2.2 |
| R4 | ✓ (CHECK chặt hơn: `type='workflow.async' OR agent_id IS NOT NULL`); `max_concurrency` = 5 (WRK-NFR-05) | `plan-db` §1, §4 |
| R5 | ✓ nhận nguyên (`{base_url, api_key, app_type}`, 401, 409) | §2.3–2.4 |
| R6 | ✓ `content[0].text` = JSON đúng hình; thêm `content[1]` câu chỉ dẫn + `structuredContent` (bỏ qua được) | §2.3 |
| R7 | Điều kiện requeue: `attempts < 3 ∧ ¬(side_effect ∧ dispatched_at IS NOT NULL)` (AC-W06 cần requeue cả job không `side_effect` đã gửi); hai câu (requeue trước, `failed` H1 sau) thay cho cột `requeued` — câu requeue không XADD | `plan-db` §2 |
| R8 | ✓ SQL `mark_dispatched` như cột trái (đặt khi `side_effect`; đặt cho mọi job cũng vô hại); usage theo RT7 | — |
| R9 | ✓ nhận: hạn run giữ qua requeue | §5.3 |
| R10 | ✓ | §5.1 |
| RQ3 | Không thêm kiểm phía Hub khi nhận `job.result` (Hub đã chặn gọi Dify) | — |

| # | Ràng buộc gửi Runtime |
|---|---|
| RT1 | Claim (H1 `plan-db` §5.4): UPDATE claim thêm `token_hash = $4` (sha256 32 byte) của token 32 byte CSPRNG base64url không padding, cho **mọi** job; token rõ chỉ trong bộ nhớ worker (+ file MCP 0600 theo plan-runtime §4.2), không log. Requeue xoá `token_hash` |
| RT2 | Credential: `POST {AGENT_RT_HUB_URL}/internal/jobs/{job_id}/dify-credential` (Bearer token RT1) |
| RT3 | Ánh xạ lỗi Dify đúng `plan-errors` §2 (chung với `dify.rules.ts`) |
| RT4 | Requeue/khởi động lại: câu `plan-db` §2 (chạy trước câu `failed` H1) |
| RT5 | Usage: `billing='dify'`, `provider_key='dify'`, `model NULL`, `agent_id NULL`, `feature_id = payload.feature_id`, `cost_usd` R15, `job_id` ON CONFLICT |
| RT6 | Không đụng `provider_state` của `dify`; chỉ claim job `dify` khi `dify` ∈ `AGENT_RT_PROVIDERS` |
| RT7 | `job.result.output = {kind:"text"}`; `job.progress.message` không tên node/workflow |
| RT8 | MCP: server `hub`, tool `mcp__hub__<workflow_key>` (key có `-`); `fake-cli` dùng `tools/call` thẳng hoặc `initialize` trước — Hub chấp nhận cả hai (§6) |
| RT9 | Mock Dify Python và mock Hub (§9) cùng hình sự kiện; key thử `LEAK_KEY_*` |
