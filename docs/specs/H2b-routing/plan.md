# Plan · H2b-routing (BE TS + contract + DB)

Python: `plan-runtime.md`. SQL nguyên văn: `plan-db.md`. Chữ ký hàm thuần: `plan-rules.md`. Câu chữ lỗi/trace: `plan-errors.md`. Luật: spec §2 (R01–R30). Nền: H1 `plan.md` (ghi `H1 §x`), H2a `plan.md` (ghi `H2a §x`).

## 1. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| P1 | **Q1 = B**: `responder{key, name}` chốt lúc tạo run vào `runs.responder_key`/`responder_name` (chỉ `direct`); `run.started` lấy từ writer, E10/E11 đọc từ hàng `runs` (join sẵn có). `GET /runs/:id` (E14) **không** có trường | R10 "chốt lúc tạo run": agent đổi tên/bị thu hồi sau đó vẫn hiện tên lúc hỏi; ảnh cấu hình cũ không giữ lại được |
| P2 | Contract chat **chỉ thêm**: `chat/agents.ts` mới; hằng **riêng** `CHAT_ROUTING_ERRORS`; `responder` là khoá **vắng** (`.optional()`, không `null`) ở run không `direct` | `entities.test.ts:142` + H2a A71 đếm đúng 6 mã `CHAT_API_ERRORS`; `tools/mocks/src/chat/http.ts:9` `Record<ChatErrorCode>`; `FORBIDDEN_KEYS` (`tests/contract/chat/_client.ts:234`) so khoá `agent/provider/model/usage` — `responder`/`key`/`name` không trùng; tin không tag giữ đúng hình cũ (`toEqual` không đổi) |
| P3 | Contract hub: `AgentCliJob.stream: z.boolean().optional()` (vắng = `false`); `JobDeltaEventSchema` vào `RunEventSchema`; `JOB_FAIL_REASONS` + `refused` | Fixture cũ (`JobPayload.agent.json`…) phải còn hợp lệ (test khoá H1 R14, H2a R73); luật H1 §2 cấm `default` (pydantic sinh khớp) |
| P4 | Router: hàm mới `routeMessage(content)` bọc `classifyMessage` (giữ nguyên — test khoá H2a `command-parse`): `/`,`//` → như H2a; `@@` → text bỏ một `@`; `@` → `parseMention` | `classifyMessage("@a x")` đang là `text` trong test khoá — không đổi hàm cũ |
| P5 | AU: `VisibleAgentsInput` **thêm trường tuỳ chọn** `excludeIds?: ReadonlySet<string>` (mọi Orchestrator, R15) và `onlyKeys?: ReadonlySet<string>` (thu hẹp R09); `orchestratorId` giữ nguyên. `accessInput(s, who, opts?)` điền `excludeIds = orchestratorIds(s)` | Test khoá H1 `agent-access.test.ts:89` dựng input có `orchestratorId` — không đổi hình bắt buộc |
| P6 | `orchestrator_settings`: giữ cột `id smallint`, hàng mặc định **luôn `id=1`**, hàng tenant lấy `id` từ sequence (≥ 2); CHECK `(id = 1) = (tenant_id IS NULL)`; unique partial `tenant_id`. Ảnh cấu hình: `orchestrator` (mặc định, như H1) + `orchestratorTenants: ReadonlyMap<tenantId, OrchestratorConfig>` | Test khoá H1 (`_hub.ts:73` `insert … values (1, …)` không `tenant_id`; `seed.int` đếm 1 hàng) và `config.repo` đọc `id=1` không đổi |
| P7 | Chọn Orchestrator ở `RunService.start` bằng `pickOrchestrator(snapshot, tenantId)` (thuần) → ghi `runs.orchestrator_tenant_id` trong `createRunTx` và truyền `RunContext.orchestrator` cho driver (driver **không** chọn lại) | R14: chốt lúc tạo run; seed lại giữa run không ảnh hưởng (ảnh của run bất biến) |
| P8 | Giới hạn run (R16–R18): `createRunTx` mở bằng `pg_advisory_xact_lock(hashtext('hub.runs.user'), hashtext(user_id))` (dạng **2 khoá**, khác không gian `K_CLAIM` 1 khoá) → conversations → flows → **kiểm `flowRunning` tường minh** (409) → `countRunning` (429) → INSERT runs. Unique `runs_flow_running_uq` giữ làm chốt chặn | FLOW_BUSY phải thắng 429 (R18) mà 23505 chỉ xảy ra ở INSERT; dưới khoá user hai câu đếm/kiểm ổn định. Thứ tự khoá H1 §3.5 thêm **đầu** `[advisory user]` — chỉ E12 lấy, luôn đầu tiên ⇒ không chu trình với E9/kết thúc/huỷ |
| P9 | 429: `AppError` thêm `headers?`; `app.onError` chép header; `Retry-After: 5`; CORS `exposeHeaders` thêm `Retry-After` | Body vẫn `ErrorResponse`; `Retry-After` không thuộc header CORS-safelisted (Chat khác origin không đọc được) |
| P10 | Run `direct` = driver mới `directDriver`: **một** `runJob` vai `agent` (job `agent.cli` qua `RoutingRunner` hoặc `DifyAgentRunner`), `prompt` = nội dung R04, `history` = `flowHistory(historyN)`, `historyN` lấy từ `pickOrchestrator(snapshot, tenantId)` (gọi cả cho `direct`, **không** ghi `orchestrator_tenant_id`), `stream=true`. Không job/step Orchestrator | R06; dùng lại runner H1/H2a, không nhánh SQL mới |
| P11 | Chuyển tiếp delta (R19, R22): `AgentTask.stream?: DeltaSink` (`accept: DeltaKind[]`, `onDelta`); `runJob` gọi `onDelta` cho `job.delta` khi `kind ∈ accept` **và** `seq` liền mạch (sự kiện đầu của job phải `seq=1`, mỗi sự kiện sau = trước + 1); thấy hở → ngừng chuyển tiếp job đó, trace `delta_gap` (kể cả job bị requeue sau khi đã phát: `seq` lại từ 1 — chấp nhận). `LoopJobOutcome` + `streamed: string` (S) | Runtime XADD lỗi chỉ log (`job_events._publish`) ⇒ một chunk mất làm S sai giữa chừng; `seq` đã có trong mọi `RunEvent`, không đổi contract |
| P12 | Đối chiếu R23 `reconcileStream(S, F)`. Job agent đã phát mà `job.failed reason=invalid_output` (JSON cuối hỏng) → coi như `stream_unparsed`: kết thúc `content=S` (không `run.failed`). Orchestrator đã phát mà `parseDecision` hỏng → **không** thử lại, `content=S`. Lỗi khác (`cancelled`/`timed_out`/`crash`…) → `run.failed` như H1 | Gộp hai vế R23: "JSON cuối hỏng → S" và "job failed → run.failed"; không rút lại chữ đã gửi (bất biến C1 §2.5) |
| P13 | Trace = `run_steps.detail` của step đã stream: `stream ∈ {delta_mismatch, stream_unparsed, delta_gap}` + log `warn` (`plan-errors` §3). R09: mọi step `orchestrator` của run thu hẹp có `detail.scope = [keys]` | Không thêm cột; E14 không lộ |
| P14 | `DifyAgentRunner` khi `task.stream` → phát `job.delta{kind:"done"}` tổng hợp (seq liền mạch như `job.started`/`job.result` tổng hợp H2a §5.4) cho mỗi chunk Dify, ≤ 4 000 | R24, một đường chuyển tiếp chung với P11 |
| P15 | F4 hint: hàm mới `runErrorTextFor(code, locale, reason)` (`refused` → hint riêng); `runErrorText` **giữ nguyên** (test khoá H1 `run-errors`). `LoopJobOutcome.failed` + `reason` | Không thêm mã `run.failed` (T14) |
| P16 | TD #44: tách thư mục con **giữ nguyên** mọi file test khoá import (`runner/runner.rules.ts`, `dify/dify.rules.ts`, `commands/{catalog.types,suggest.rules,menu.rules,command-parse.rules,command-input.rules,command-access.rules}.ts`) — bảng §4 | Test khoá import theo đường dẫn |
| P17 | `@a /dich` → agent nhận "/dich" là chữ (không chạy lệnh). Tin user lưu **nguyên văn** (kể cả tag); `@@` lưu đã bỏ một `@` (R01) | R01: `@` thắng khi đứng đầu |
| P18 | **Không ADR**: không thư viện mới (TS: không; Python: bộ phân tích JSON tăng dần tự viết, `include_partial_messages` có sẵn ở `claude-agent-sdk==0.2.163`) | WORKFLOW "Đề xuất công nghệ" |

## 2. Contract
### 2.1 `@ai/contracts/chat` — chỉ thêm (P2)
| Thay đổi | Định nghĩa | Kiểm với test khoá C1/H2a |
|---|---|---|
| `chat/agents.ts` (mới, export ở `chat/index.ts`) | `AGENT_MENU_MAX = 500` · `AgentMenuItemSchema = strictObject{key: string regex AGENT_KEY_PATTERN (chép `^[a-z][a-z0-9-]{1,47}$` vào `../common` nếu chưa có — không import `../hub`), name: strictObject{vi: 1–100, en: 1–100}, description: string 20–400}` · `AgentMenuResponseSchema = strictObject{items: AgentMenuItem[] ≤ 500}` | file mới |
| `errors.ts` + | `CHAT_ROUTING_ERRORS = {AGENT_NOT_FOUND: 404, TOO_MANY_RUNS: 429} as const` · `ChatRoutingErrorCode` · `CHAT_ROUTING_ERROR_CODES` · `AgentNotFoundDetailsSchema = strictObject{suggestions: string[] ≤ 3}` · `RETRY_AFTER_HEADER = "Retry-After"` · `TOO_MANY_RUNS_RETRY_AFTER_S = 5` | `CHAT_API_ERRORS`, `CHAT_RUN_ERROR_CODES`, `CHAT_COMMAND_ERRORS` không đổi ✓ (`entities.test.ts:142`, H2a A71) |
| `entities.ts` + | `RESPONDER_NAME_MAX = 100` · `ResponderSchema = strictObject{key: AgentKey, name: string 1–100}` · `MessageSchema` + `responder: ResponderSchema.optional()`; `superRefine`: `role='user'` ∧ có `responder` → lỗi | Tin không `responder` parse như cũ ✓; `messages.contract`/`conversations.contract` không gửi `@` (đã grep) ✓ |
| `events.ts` + | `RunStartedDataSchema` + `responder: ResponderSchema.optional()` | `stream.contract:144` so `quota` ✓; `CHAT_EVENT_NAMES` không đổi (H2a A71) ✓ |
| `SendMessageRequest`, `Run`, `RunSummary`, `StepSummary` | không đổi | ✓ |

Hành vi mới với client C1: tin bắt đầu `@` (không `@@`) → có thể JSON 404/422; vượt giới hạn → JSON 429 + `Retry-After`. Bộ `tests/contract/chat` không gửi `@`; có ca để run chạy dở (huỷ/resume) → có thể chạm 429 với limit 2: B5 chạy 41 ca với Hub thật; đỏ do 429 → `tools/hub-dev` đặt `HUB_MAX_CONCURRENT_RUNS=20` cho stack contract (không sửa test; rủi ro K4b `tasks.md`). **CR-impact Chat (I3):** menu `@`, hiện `responder.name`, lỗi `AGENT_NOT_FOUND`/`TOO_MANY_RUNS`, `delta` đến khi step còn mở.

### 2.2 `@ai/contracts/hub` (luật H1 §2: không `refine/transform/default`)
| Tên | Định nghĩa |
|---|---|
| `DELTA_KINDS` | `["answer", "done", "partial"] as const` · `DeltaKindSchema` |
| `JOB_DELTA_TEXT_MAX` | `4000` (đơn vị UTF-16 như zod `max`; Runtime cắt theo đơn vị này — `plan-runtime` §3.3) |
| `JobDeltaEventSchema` | `strictObject{...base (v, job_id, seq, at), type: literal("job.delta"), kind: DeltaKind, text: string 1–4000}` → thêm vào `RunEventSchema` (union `type`) |
| `AgentCliJobSchema` | + `stream: z.boolean().optional()` (P3) |
| `JOB_FAIL_REASONS` | + `refused` (F4, R27) |
| Fixture | valid `RunEvent.delta-answer.json`, `RunEvent.delta-partial.json`, `JobPayload.agent-stream.json` (`stream:true`); invalid `RunEvent.delta-4001.json`, `RunEvent.delta-bad-kind.json`, `RunEvent.delta-empty.json`, `JobPayload.stream-string.json`. Fixture cũ không sửa ✓ |
| Sinh | `bun run contracts:gen` → `hub.schema.json` + `contracts/hub.py` (`JobPayload1.stream: bool \| None = None`, model `RunEvent` thêm biến thể); `contracts:check` xanh; `test_contracts_hub.py` (khoá) so pydantic ↔ zod cho fixture mới ✓ |

### 2.3 Endpoint
| Method · Path | Auth | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|
| GET `/agents` | JWT (mọi role) | — | `AgentMenuResponse` (AU sắp `key`, R11) | 401 `AUTH_EXPIRED` |
| POST `/conversations/:id/messages` (E12) | JWT, chủ hội thoại | `SendMessageRequest` (không đổi) | SSE C1 (+ `responder` ở `run.started` khi `direct`) | như H2a + 404 `AGENT_NOT_FOUND{suggestions}` · 422 `CMD_MISSING_ARG{missing:["content"], invalid:[]}` · 429 `TOO_MANY_RUNS` + `Retry-After: 5` — JSON, trước khi tạo run; thứ tự R18 |

## 3. Dữ liệu (`migrations-hub/0006_h2b_routing.sql`, SQL: `plan-db.md` §1)
| Đối tượng | Thay đổi |
|---|---|
| `runs` | + `agent_id uuid`, `orchestrator_tenant_id uuid`, `responder_key text`, `responder_name text` (NULL, không FK — H1 P3); CHECK `kind` + `direct` (tên giữ `runs_kind_check` — test khoá H2a `db.int:92`); `runs_direct_ck`, `runs_responder_ck`, `runs_orch_tenant_ck`; index `runs_user_running_idx (tenant_id, user_id) WHERE status='running'` |
| `orchestrator_settings` | + `tenant_id uuid`; sequence `orchestrator_settings_id_seq` (smallint, START 2) làm DEFAULT `id`; bỏ `orchestrator_settings_id_check`, thêm `orchestrator_settings_scope_ck (id = 1) = (tenant_id IS NULL)`; `orchestrator_settings_tenant_uq UNIQUE (tenant_id) WHERE tenant_id IS NOT NULL` |
| `jobs` | `jobs_error_reason_check` + `refused` |
| RLS / GRANT | Không đổi (cột mới của bảng đã GRANT mức bảng; `hub_rw` SELECT `orchestrator_settings` có sẵn; seed chạy bằng owner) |
| Thứ tự khoá | `[advisory user (E12)] → [K_CLAIM] → conversations → flows → runs → run_steps → messages → tool_confirmations → jobs → usage_logs → cli_sessions → provider_state` |

## 4. hub-api — module
**TD #44 (task B0, không đổi hành vi):**
| Thư mục | Chuyển vào thư mục con | Giữ tại chỗ (test khoá import / điểm vào) |
|---|---|---|
| `runner/` (13 → 7) | `job/{job-agent-runner.ts, runner.repo.ts, runner.test.ts, runner.int.test.ts}` · `workflow/{workflow-job-runner.ts, workflow-job-runner.test.ts, workflow-job.repo.ts}` | `runner.rules.ts`, `routing-runner(.test).ts`, `run-stream-reader(.test).ts`, `orphan-sweep.ts`, README |
| `dify/` (11 → 7) | `agent/{dify-agent-runner.ts, dify-agent-runner.int.test.ts, dify-agent.repo.ts, dify-agent.rules.ts, dify-agent.rules.test.ts}` | `dify.rules.ts`, `dify.client(.test).ts`, `credential.service.ts`, `credential.int.test.ts`, `dify.usage.ts`, README |
| `commands/` (11 → 9) | `driver/{command-driver.ts, command-async-driver.ts, command-run.repo.ts}` | 6 file `*.rules`/`catalog.types` + `commands.routes/service`, README |

**H2b:**
| Module / file | Việc |
|---|---|
| `mention/` (mới) | `mention-parse.rules.ts` (`routeMessage`, `parseMention`), `mention.rules.ts` (`suggestAgents`, `directText`, `responderOf`), `mention.service.ts` (`prepareMention(u, parsed, snapshot) → RunPlan` ném `AGENT_NOT_FOUND`/`CMD_MISSING_ARG`), `direct-driver.ts` (P10), README |
| `agents/` | `agent-access.rules.ts` (+ `excludeIds`, `onlyKeys`, `orchestratorIds`), `agent-menu.rules.ts` (`toAgentMenuItem`), `agents.service.ts` (`menu(u)` từ cache, 0 query), `agents.routes.ts` |
| `stream/` (mới) | `delta.rules.ts` (`streamAccept`, `reconcileStream`, `nextSeqOk`), `delta-sink.ts` (S + `chunkText` 40 → `writer.emit delta`, đếm `seq`), README |
| `config/` | `config.repo.ts` đọc mọi hàng `orchestrator_settings` → `orchestrator` (id=1) + `orchestratorTenants`; `config.rules.ts` + `pickOrchestrator`; `orchestratorProblem` chỉ xét bản mặc định (R15) |
| `runs/` | `create-run.ts` (mới: `createRunTx` chuyển từ `runs.service.ts` + advisory/`flowRunning`/`countRunning`, P8) · `runs.service.ts` `start(u, conv, req, plan?: RunPlan)` (`RunPlan = CommandRunStart \| DirectRunStart \| OrchestratedRunStart`) · `runs.repo.ts` `insertRun` thêm `agentId/orchestratorTenantId/responder` · `confirm.repo.ts` `decideConfirmations` + `tag` (§5.6) · `run-errors.ts` + `runErrorTextFor` · `run-limit.rules.ts` (`overLimit`, `parseMaxConcurrentRuns`) |
| `runs.routes.ts` | `routeMessage` → `command` (H2a) · `mention` → `prepareMention` · `text` → orchestrated |
| `orchestrator/` | `orchestrator.service.ts` dùng `ctx.orchestrator`, `onlyKeys`, stream (P11–P12); `orchestrator.loop.ts`: `LoopInput` + trường **tuỳ chọn** `stream?`, `scope?` (test khoá H1 `orchestrator.test` dựng input cũ) |
| `runner/job/job-agent-runner.ts` | `buildJobPayload` + `stream`; `runJob` xử lý `job.delta` (P11), trả `streamed`, `reason`; file 344 dòng (trần 400) ⇒ logic `seq`/S ở `stream/delta-sink.ts` |
| `dify/agent/dify-agent-runner.ts` | P14 |
| `conversations/` | `toMessage` + `responder` khi run `direct` (E10/E11) |
| `seed/` | `orchestrator_tenants` (§5.3) |
| `lib/errors.ts` | `HubErrorCode` + `ChatRoutingErrorCode`; `AppError.headers?` (P9) |
| `config/{env,env-deps}.ts` | `HUB_MAX_CONCURRENT_RUNS` (`z.string().optional()`); `envAppDeps` → `maxConcurrentRuns = parseMaxConcurrentRuns(raw)` (ném ⇒ server thoát ≠ 0). `AppDeps.maxConcurrentRuns?: number` — **vắng ⇒ không giới hạn** (`createApp` không đọc env; test khoá H1/H2a dựng app không truyền) |
| `app.h2b.ts` (mới) | `mountH2b(app, deps)`: `/agents`; `app.ts` (240 dòng) chỉ gọi hàm này + `onError` chép header + `/agents` vào `PROTECTED_PREFIXES` (401 trước 404) + `Retry-After` vào `exposeHeaders` |

## 5. Luồng
### 5.1 E12 (R01–R05, R17, R18)
1. zod body (400) → `routeMessage(body.content)`:
   - `command` → H2a §5.1 (không đổi).
   - `mention` → `parseMention` lỗi `empty_tag` → `AGENT_NOT_FOUND{suggestions:[]}`; ok → `prepareMention`: AU = `visibleAgents(accessInput(snapshot, who))`; tag đầu tiên ∉ AU (so lower) → `AGENT_NOT_FOUND{suggestions: suggestAgents(tag, AU keys)}`; `content` rỗng → `CMD_MISSING_ARG{missing:["content"], invalid:[]}`; 1 agent → `DirectRunStart{agent, responder: responderOf(agent, locale), content}`; ≥ 2 → `OrchestratedRunStart{onlyKeys, content}`.
   - `text` → `OrchestratedRunStart{content}` (`@@` đã bỏ một `@`).
2. `RunService.start`: `pickOrchestrator` (`orchestrated`: cấu hình + `orchestrator_tenant_id`; `direct`: chỉ `historyN`, P10) → `createRunTx` (`plan-db` §2): advisory user → conversation (404) → flow (404) → `flowRunning` (409 `FLOW_BUSY`) → `countRunning ≥ limit` (429) → INSERT runs (+ `kind`, `agent_id`, `orchestrator_tenant_id`, `responder_*`) → INSERT messages (user, nguyên văn / `@@` đã bỏ) → `decideConfirmations` (flow có sẵn).
3. `run.started{run_id, flow_id, quota, responder?}` → driver theo `plan.kind`.

### 5.2 Run `direct` (R06–R08, R10)
`directDriver.start(ctx)`: `insert step delegate` qua `runJob(runner, {role:"agent", agent, prompt: content, history, stream: {accept:["done","partial"], sink}})`. Kết quả: `done` → `deliver(text)`; `partial` → `directText(result, locale)`; `need_input` → `ask` (agentId = agent → `pending_ask`); `failed` → `run.failed` (`runErrorTextFor`). Mọi `finished` → `agentId = agent.id` (`flows.agent_id`). Có `streamed` → §5.5. Tin kế không tag → Orchestrator thường (`hint.last_agent` = key, `waiting_for` khi `pending_ask` — H1 không đổi).

### 5.3 Orchestrator theo tenant + thu hẹp (R09, R13–R15)
- **Seed** (`seed.schema.ts` + `seed.rules.ts` + `seed.repo.ts`): `orchestrator_tenants?: Array<{tenant_key, agent, max_steps?, token_budget?, history_n?, on_no_match?} | {tenant_key, remove: true}>` (strictObject, ≤ 1 000). Kiểm trước khi ghi (một transaction như H1-R16): `tenant_key` trùng → lỗi; agent ∉ seed / `enabled=false` / runtime ≠ `agentic-cli` / không profile → lỗi; tenant không có trong `admin.tenants` → bỏ + `warn seed-orchestrator-tenant-unknown`. Trường thiếu → giá trị bản mặc định cùng yaml. Upsert `ON CONFLICT (tenant_id) WHERE tenant_id IS NOT NULL`; `remove` → `DELETE … WHERE tenant_id=$1`; tăng `hub_config_version` khi có đổi (như H1).
- **Chọn** `pickOrchestrator(s, tenantId)`: bản tenant có ∧ agent ∈ `s.agents` ∧ `enabled` → `{config, tenantScoped:true}`; có nhưng hỏng → mặc định + `invalid:true` (service log `warn orchestrator_tenant_invalid`, `tenant_id`, `agent_id`); không → mặc định.
- **Thu hẹp:** `OrchestratedRunStart.onlyKeys` → `accessInput(…, {onlyKeys})` → `visible` (prompt `<agents>`) và `canDelegate` cùng tập; agent ngoài → `skipped(not_allowed)` (H1-R06). Step Orchestrator `detail.scope` (P13).

### 5.4 Giới hạn run (R16–R18): `plan-db` §2 · lỗi `plan-errors` §1.

### 5.5 Delta (R19–R23)
| Job | `payload.stream` | `accept` (R22) |
|---|---|---|
| Orchestrator (mọi vòng) | `true` | `["answer"]` |
| Agent run `direct` | `true` | `["done","partial"]` |
| Agent delegate **đầu tiên** (`s.delegates === 0` trước khi chạy) của run `orchestrated` | `true` | `["done"]` |
| Agent delegate sau / lệnh / `workflow.async` | `false`/vắng | `[]` |

`DeltaSink` (một per job): `onDelta(text)` → `chunkText(text, 40)` → `writer.emit({event:"delta"})`, cộng S. Hết job: `reconcileStream(S, F)` → `{rest, content, trace}`; driver phát `rest` (cắt 40) rồi `finish({content})`. Orchestrator: `F` = `decision.text` (`answer`); đã có S mà quyết định ≠ `answer` không thể xảy ra (kind cố định) — nếu xảy ra coi như `delta_mismatch`. Delegate đầu đã chuyển tiếp ≥ 1 delta ⇒ kết thúc pass-through **bất kể** `status` cuối (`done` ⇒ `canPassThrough` sẵn; khác ⇒ `content=S`, `delta_mismatch`). `ask` của Orchestrator, `need_input`: không có S (Runtime không phát) → như H1.

### 5.6 Xác nhận `side_effect` với tag (R12)
`decideConfirmations(tx, o, {flowId, runId, agree, tag})`: `agree = isAgreeReply(nội dung R04)` (tin không tag: cả tin); `tag = {kind:"none"} | {kind:"single"; agentId} | {kind:"multi"}`. SQL `plan-db` §3.

### 5.7 F3/F4/F7 phía Hub
F3: `tools/hub-dev/src/fixture.ts` thêm `lan` vào `beta-testers` (R26). F4: `job.failed reason=refused` → `run.failed UPSTREAM_ERROR` + hint riêng (`runErrorTextFor`, P15). F7: script `test:smoke:live` (`package.json`), sửa `docs/guides/hub-dev.md` (I2).

## 6. Hàm thuần — chữ ký chốt: `plan-rules.md`

## 7. Hiệu năng · env
| Chỉ tiêu | Ngưỡng · cách |
|---|---|
| `GET /agents` | ≤ 50 ms p95, 0 query (cache cấu hình + nhóm user từ cache H1) |
| Router `@` + kiểm 429 | ≤ 10 ms p95 thêm: `parseMention` O(độ dài tin); 2 câu dưới khoá user dùng `runs_flow_running_uq` và `runs_user_running_idx` |
| `job.delta` → SSE | ≤ 150 ms: không chờ DB; `RunStreamReader` XREAD BLOCK có sẵn |
| Khoá user | giữ trong transaction E12 (~vài ms); không chặn user khác |

Env mới (hub-api): `HUB_MAX_CONCURRENT_RUNS` (mặc định 2, 1–20). `.env.example` thêm. Runtime: `plan-runtime` §8.

## 8. Ràng buộc gửi Runtime: `plan-runtime.md` §9 (đã đối chiếu).
