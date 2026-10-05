# Test plan · H2b-routing · phụ lục ca (qc)

Phụ lục của [`test-plan.md`](test-plan.md): §1 hàm thuần (R) · §2 int hub-api (A) · §3 hub-dev (H) + hồi quy khoá (K) · §4 thủ công (M). Không phủ, fixture `_h2b.ts`: `test-plan.md` §3, §2.1. Python/stack/smoke: [`test-plan-py.md`](test-plan-py.md). AU = agent dùng được (spec §2); `lan` (acme, vi), `hoa` (acme, en).

## 1. R · Hàm thuần (chữ ký `plan-rules.md`)
### 1.1 `mention-parse` (R01–R08) · R01, R04 · HUB-H2b-AC-01
| ID | Đầu vào → kỳ vọng (`routeMessage` trừ khi ghi khác) |
|---|---|
| R01 | `"xin chào"` → `{text, "xin chào"}`; `"  xin"` → `{text, "  xin"}` (nguyên văn); `"x @a"` → text (`@` giữa tin) |
| R02 | Bắt đầu `/`: kết quả = `classifyMessage` nguyên văn — `"/dich en"`, `"//abc"`, `"  /dich x"`, `"/"` (so `toEqual` với `classifyMessage`) |
| R03 | `"@@abc"` → text `"@abc"`; `"  @@a b"` → `"@a b"`; `"@@"` → `"@"`; `"@@@x"` → `"@@x"` |
| R04 | `"@a x"`→`{mention,[a],"x"}` · `"@A x"`→`[a]` · `"@a @b x"`→`[a,b]` · `"@a @a x"`, `"@A @a x"`→`[a]` · `"@b @a @B x"`→`[b,a]` (thứ tự xuất hiện đầu) |
| R05 | `"@a"`, `"@a   "` → `[a]`, `""`; `"@a \t x  "` → `"x"`; `"@a x  y "` → `"x  y"` (giữ khoảng trắng giữa) |
| R06 | `"@"`, `"@ x"`, `"  @"`, `"@\tx"` → `{mention_error, empty_tag}`; `"@a @"` → `[a]`, `"@"`; `"@a @ x"` → `[a]`, `"@ x"` |
| R07 | `"@a /dich en"` → `[a]`, `"/dich en"` (P17); `"@a x @b"` → `[a]`, `"x @b"` (dừng ở token không `@`) |
| R08 | Chỉ khoảng trắng ASCII tách: `"@a x"` → `[a x]`, `""`; `"@Trợ x"` → `["trợ"]`; nội dung dấu/emoji giữ nguyên byte |

### 1.2 `mention` (R10–R14) · R02, R03, R07, R10
| ID | Đầu vào → kỳ vọng |
|---|---|
| R10 | `suggestAgents("asistant", [assistant, helper, writer])` → `["assistant"]`; `"ASISTANT"` → như trên; ngưỡng max(2, ⌊len/3⌋): `"xyz"` → `[]`; 4 key cùng khoảng cách → 3 đầu sắp (khoảng cách, key); `keys=[]` → `[]`; kết quả không có `@` |
| R11 | `firstUnknownTag([a,b], {a,b})` → `null`; `([a,x,y], {a})` → `"x"`; `([x,a], {a})` → `"x"` |
| R12 | `directText({partial,"A","B"}, "vi")` = `"A\n\nPhần chưa làm được: B"`; `"en"` = `"A\n\nNot done yet: B"` (nguyên văn `plan-errors` §2) |
| R13 | `responderOf({key:"assistant", name:{vi:"Trợ lý", en:"Assistant"}}, "vi")` → `{key:"assistant", name:"Trợ lý"}`, `"en"` → `"Assistant"`; tên 99 ký tự + 3 emoji → ≤ 100 code point, không surrogate lẻ; parse `ResponderSchema` |
| R14 | Bất biến: `classifyMessage("@a x")` vẫn `{text}` (test khoá H2a `command-parse` — chạy chung file để ghi rõ) |

### 1.3 `agent-access-h2b` (R15–R19) · R09, R11, R15 · HUB-FR-77, HUB-BR-03
| ID | Đầu vào → kỳ vọng |
|---|---|
| R15 | `visibleAgents` + `excludeIds={writer.id}` → không có `writer`; agent là Orchestrator tenant (trong `excludeIds`) bị loại dù có grant |
| R16 | `onlyKeys={assistant, helper}` → đúng 2 (sắp như H1); `onlyKeys={assistant, hoadon}` với `hoadon` ∉ AU → chỉ `assistant` (thu hẹp không mở rộng) |
| R17 | `canDelegate` trên input có `onlyKeys` → `writer` false, `assistant` true |
| R18 | `orchestratorIds({orchestrator:{agentId:O}, orchestratorTenants: {acme→A, beta→B}})` → `{O,A,B}`; không `orchestratorTenants` → `{O}`; `orchestrator:null` → `{}` |
| R19 | Hồi quy: input H1 (chỉ `orchestratorId`) → kết quả = trước H2b (cùng bảng ca H1 `agent-access.test.ts`); `accessInput(s, who)` có `orchestratorTenants` → `excludeIds` = `orchestratorIds(s)`; `opts.onlyKeys` truyền xuống |

### 1.4 `agent-menu` (R20–R21) · R11
| ID | Đầu vào → kỳ vọng |
|---|---|
| R20 | `toAgentMenuItem(AgentConfig đủ trường)` → `Object.keys` = `{key, name, description}`, `name` = `{vi, en}`; parse `AgentMenuItemSchema` (strict) |
| R21 | `agentMenu(s, lan)` → sắp `key`; không Orchestrator mặc định/tenant; không `llmbot` (runtime `llm`); `who` không grant → `[]` |

### 1.5 `orchestrator-pick` (R22–R24) · R14, R15
| ID | Đầu vào → kỳ vọng |
|---|---|
| R22 | Bản tenant `acme` (agent bật, có trong `s.agents`) → `{config: bản acme, tenantId: acme, invalid:false}`; tenant khác → mặc định, `tenantId:null`, `invalid:false` |
| R23 | Bản `acme` trỏ agent `enabled=false` / agent không có trong `s.agents` → mặc định, `tenantId:null`, `invalid:true`; mặc định thiếu → `null` |
| R24 | `orchestratorProblem(s)` với bản tenant hỏng + mặc định đúng → như H1 (không lỗi); mặc định hỏng → lỗi như H1 |

### 1.6 `delta` (R25–R29) · R19, R22, R23, P11
| ID | Đầu vào → kỳ vọng |
|---|---|
| R25 | `streamAccept`: (orchestrator, orchestrated, *) → `["answer"]`; (agent, direct, *) → `["done","partial"]`; (agent, orchestrated, first=true) → `["done"]`; (agent, orchestrated, false) → `[]`; (agent, command, *) → `[]` |
| R26 | `nextSeqOk(null,1)` true · `(null,2)` false · `(3,4)` true · `(3,5)` false · `(3,3)` false |
| R27 | `reconcileStream("Xin", "Xin chào")` → `{rest:" chào", content:"Xin chào", trace:null}`; `("Xin","Xin")` → `rest:""`; `("Xin","Chào")` → `{rest:"", content:"Xin", trace:"delta_mismatch"}`; `("Xin", null)` → `{rest:"", content:"Xin", trace:"stream_unparsed"}` |
| R28 | `("", "abc")` → `{rest:"abc", content:"abc", trace:null}`; `("", "")` → rỗng, null |
| R29 | Tiền tố theo đơn vị chuỗi JS: `S` kết thúc giữa cặp surrogate của `F` (`"a\uD83D"`, `"a😀"`) → không mismatch, `rest="\uDE00"` (Hub ghép khi cắt 40 — R ở A116) |

### 1.7 `run-errors-h2b` (R30) · R27
`runErrorTextFor("UPSTREAM_ERROR","vi","refused").hint` = `"Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ."`, `en` = `"The request could not be handled — rephrase or split it."`, `message` = `runErrorText("UPSTREAM_ERROR", locale).message`; reason `null`/khác và mọi mã khác (7 mã × 2 locale) → `toEqual(runErrorText(code, locale))`; `("NOT_CONFIGURED", …, "refused")` → như `runErrorText`.

### 1.8 `seed-tenants` (R31–R35) · R13
| ID | Đầu vào → kỳ vọng |
|---|---|
| R31 | `{tenant_key:acme, agent:orch-acme, max_steps:3}` → `upserts[0]` = `{tenantId, agent, maxSteps:3, tokenBudget/historyN/onNoMatch = defaults}` |
| R32 | `{tenant_key:beta, remove:true}` → `removes=[betaId]`; tenant không có trong `tenants` → `unknownTenants=[key]`, không upsert |
| R33 | Lỗi theo thứ tự: trùng `tenant_key` (kể cả 1 upsert + 1 remove) thắng agent lạ ở cùng yaml; agent lạ → agent `enabled=false` → runtime `dify-agent` → không `profile`; mỗi lỗi có `path` chứa `orchestrator_tenants` + chỉ số, `value` = giá trị sai |
| R34 | `entries=[]` → `{upserts:[], removes:[], unknownTenants:[]}` |
| R35 | Tenant lạ + agent lạ cùng mục → `error` (lỗi agent thắng cảnh báo tenant — Q-T10) |

### 1.9 `run-limit` (R36) · R16
`overLimit(1,2)` false, `(2,2)` true, `(3,2)` true, `(0,1)` false. `parseMaxConcurrentRuns(undefined)`=2, `"1"`=1, `"20"`=20; `"0"`, `"21"`, `"2.5"`, `"abc"`, `"-1"` → ném.

### 1.10 `contracts-h2b` (R40–R44) · spec §3
| ID | Ca |
|---|---|
| R40 | `AgentMenuItemSchema`: khoá thừa → lỗi; `description` 19/401 ký tự → lỗi, 20/400 ok; key sai regex → lỗi; `AgentMenuResponseSchema` 501 item → lỗi |
| R41 | `CHAT_ROUTING_ERRORS` = `{AGENT_NOT_FOUND:404, TOO_MANY_RUNS:429}`; `CHAT_API_ERRORS`, `CHAT_RUN_ERROR_CODES`, `CHAT_COMMAND_ERRORS`, `CHAT_EVENT_NAMES` không chứa mã/sự kiện mới; `RETRY_AFTER_HEADER="Retry-After"`, `TOO_MANY_RUNS_RETRY_AFTER_S=5`; `AgentNotFoundDetailsSchema` 4 gợi ý → lỗi |
| R42 | `MessageSchema`: assistant + `responder` ok; user + `responder` → lỗi; vắng ok; `responder:null` → lỗi (`.optional()`, không nullable); `RunStartedDataSchema` có/không `responder` ok |
| R43 | Hub: fixture valid mới (`RunEvent.delta-answer`, `delta-partial`, `JobPayload.agent-stream`) parse; invalid (`delta-4001`, `delta-bad-kind`, `delta-empty`, `JobPayload.stream-string`) lỗi; fixture cũ vẫn valid; `text` 2 000 emoji (4 000 đơn vị) ok, 2 001 → lỗi |
| R44 | `JOB_FAIL_REASONS` ∋ `refused`; `RunEventSchema` nhận `type:"job.delta"`; `AgentCliJob` thiếu `stream` ok |

## 2. A · hub-api int (`tests/acceptance/H2b/`)
Chung: `startHubX` + `maxConcurrentRuns: 2`, `jobMaxWaitS` lớn; `counts()` = số `messages/runs/jobs`; "0 ghi" = `counts()` không đổi + ScriptRuntime không thấy job.

| ID | Mã | Given/When → Then |
|---|---|---|
| A01 | AC-H18 · R02, R03, R05 | `lan`: `@hoadon xin` (grant, không entitlement acme), `@nope xin`, `@orchestrator xin`, `@llmbot xin`, `@writer xin` sau khi tắt `writer` → mỗi ca 404 `{code:"AGENT_NOT_FOUND", details:{suggestions}}`, `suggestions` ⊆ AU (`@orchestratr x` không chứa `orchestrator`; `@hoadonn x` không chứa `hoadon`); `@asistant x` → `["assistant"]`; 0 ghi; MK 0 |
| A02 | R01 | `@ x`, `@` → 404 `suggestions:[]`; `"  @assistant x"` → run `direct` |
| A03 | R04, R05 | `@assistant`, `@assistant   ` → 422 `{code:"CMD_MISSING_ARG", details:{missing:["content"], invalid:[]}}`; `@nope` (không nội dung) → 404 (tag trước); 0 ghi |
| A04 | R02 · T1 | `@assistant @nope x` → 404 gợi ý cho `nope`; `@nope @assistant x` → 404; không run, không job Orchestrator |
| A05 | AC-H18 · R01 | `@@abc` → run `orchestrated`; job Orchestrator `<message>` = `@abc`; `messages.content` = `@abc` |
| A06 | R01 | `x @assistant` → `orchestrated`, `<message>` nguyên văn |
| A07 | R18 | Hội thoại lạ + `@nope x` → 404 `NOT_FOUND`; body sai (`content` rỗng) → 400; `@nope x` + `flow_id` lạ → 404 `AGENT_NOT_FOUND`; `@assistant x` + `flow_id` lạ → 404 `NOT_FOUND`; flow đang chạy + `@nope x` → 404 `AGENT_NOT_FOUND`; đủ 2 run + `@assistant` (rỗng) → 422 |
| A20 | AC-H17 · R06, R10 | Đổi tên `assistant` = `{vi:"Trợ lý", en:"Assistant"}`. `lan` `@assistant Tóm tắt X` → `run.started` có `responder:{key:"assistant", name:"Trợ lý"}`; `runs.kind='direct'`, `agent_id`, `responder_key/name`; đúng 1 job: `role=agent`, key `assistant`, `prompt` chứa `Tóm tắt X`, không chứa `@assistant`; **0** job Orchestrator; `run_steps` đúng 1 `delegate`; `done{text}` → `run.finished.content` = text; `flows.agent_id` = assistant; tin user lưu `@assistant Tóm tắt X` |
| A21 | R10 · CHAT-AC-30 | E11: tin assistant có `responder`; E10 preview có `responder`; E14 không khoá `responder`; run `orchestrated` (cả 2 tag) và `command` (`/dich`, catalog H2a): `"responder" in` = false ở `run.started`, E10, E11; mọi frame/body không khoá `agent/provider/model/usage` |
| A22 | R10 · BR-06 | Sau run xong: đổi tên + thu hồi grant `assistant` → E11 vẫn `name:"Trợ lý"`; `hoa` (en) → `"Assistant"` |
| A23 | R07 | `partial{text:"A", missing:"B"}` → `content` = `"A\n\nPhần chưa làm được: B"` (`lan`), `"A\n\nNot done yet: B"` (`hoa`); 0 job Orchestrator |
| A24 | AC-H17 · R07, R08 | `need_input` → SSE `ask`, run `finished`, `flows.agent_id`=assistant, `pending_ask`; tin kế `Chọn A` (không tag) → job Orchestrator, gợi ý `last_agent:"assistant"`, `waiting_for:"assistant"` (hình như H1 A18) |
| A25 | R07 | `job.failed ALL_PROVIDERS_EXHAUSTED` / `TIMEOUT` → `run.failed` cùng mã, câu `runErrorText`; 0 job Orchestrator |
| A26 | R06 · P10 | `payload.history` = `history_n` tin gần nhất của flow theo Orchestrator **đã chọn** (mặc định 10; bản `acme` `history_n=2` → 2); `payload.stream=true` |
| A27 | R06 · H1-R23 | `cli_sessions(conv, assistant, fake-cli)` có sẵn → job run `direct` mang session resume như H1 |
| A28 | R06 · BR-06 | Job đang `queued` → tắt `assistant` → run vẫn chạy tới `run.finished` |
| A29 | R01, R04 | `"  @Assistant @assistant x"` → `direct` (gộp, không phân biệt hoa) |
| A30 | P17 | Catalog H2a + MK: `@assistant /dich en xin` → `direct`, job `prompt` chứa `/dich en xin`; MK 0 lời gọi; `runs.kind='direct'` |
| A31 | R06 | Step `delegate` nhãn tĩnh H1 (vi/en); SSE `step.*` không chứa `assistant`/`Trợ lý` |
| A40 | AC-H19 · R09 | `lan` (AU = assistant, helper, writer) `@helper @assistant so sánh` → `orchestrated`; `<agents>` đúng `assistant`, `helper` (sắp key); `<message>` = `so sánh`; step `orchestrator` `detail.scope=["assistant","helper"]` |
| A41 | AC-H19 · H1-R06 | Orchestrator giả `delegate writer` → step `skipped`/`not_allowed`, 0 job `writer`; sau đó `delegate assistant` → chạy |
| A42 | R09 | Tin kế không tag cùng flow → `<agents>` đủ 3 |
| A43 | R15 | `@assistant @orchestrator x` → 404 |
| A44 | R04 | `@helper @assistant @Helper x` → `<agents>` 2 agent |
| A50 | HUB-FR-92 · AC-02 | `lan` `GET /agents` → parse `AgentMenuResponseSchema`; `items` key = `[assistant, helper, writer]`; mỗi item đúng 3 khoá; chuỗi JSON không chứa `system_prompt`, `runtime`, `profile`, `workflow`, `orchestrator` |
| A51 | AC-02 | Không JWT / JWT hết hạn → 401 `AUTH_EXPIRED` (L7) |
| A52 | AC-02 · L5 | `tadmin` (0 grant) → `items=[]`; `an` (beta) → `[assistant, helper]` |
| A53 | AC-02 · R11 | Thu hồi grant `writer` (config change + NOTIFY) → mất khỏi menu ≤ 5 000 ms; `@writer x` → 404; thu hồi entitlement `helper` acme → mất ≤ 5 s |
| A54 | R15 · BR-03 | Đặt `helper` làm Orchestrator tenant `beta` → `helper` mất ở menu `lan` (acme) và `an`; `@helper x` → 404; `<agents>` run thường của `lan` không có `helper` |
| A55 | R02, R11 | `llmbot` (runtime `llm`, grant) không trong menu, `@llmbot x` → 404 |
| A56 | R11 | Menu đọc cache: chặn DB (`pg_terminate` các kết nối Hub hoặc đếm `pg_stat_statements` nếu bật) → `GET /agents` vẫn 200 (hoặc 0 câu) — vế đo ở PF1 |
| A60 | AC-H16 · R14 | `orchestrator_settings` tenant `acme` = `orch-acme`, `max_steps=3` (SQL owner + config change) → run `lan`: job Orchestrator key `orch-acme`; `runs.orchestrator_tenant_id = acme`; kịch bản luôn `delegate writer`… (bị bỏ) → dừng sau 3 bước (`an` cùng kịch bản dừng sau 5) |
| A61 | AC-H16 | `an` (beta) → Orchestrator mặc định, `orchestrator_tenant_id` NULL |
| A62 | AC-H16 | Xoá bản `acme` → lượt kế `lan` dùng mặc định |
| A63 | AC-H16 · BR-06 | Run `lan` đang chạy (bước 1) → đổi bản `acme` sang `orch-alt`, `max_steps=5` → các job Orchestrator sau của run đó vẫn `orch-acme`, dừng ở 3; run mới dùng `orch-alt` |
| A64 | R14 · AC-10 | Bản `acme` trỏ agent bị tắt → run `lan` dùng mặc định, `orchestrator_tenant_id` NULL, log `warn orchestrator_tenant_invalid {run_id, tenant_id, agent_id}` |
| A65 | R15 | Hub khởi động khi bản tenant hỏng, mặc định đúng → `/health` ok |
| A66 | R15 | `orch-acme` không trong menu `an`/`lan`, `@orch-acme x` → 404 |
| A67 | R14 | Run `direct`/`command` → `orchestrator_tenant_id` NULL |
| A70 | AC-10 · R13 | `runHubSeed` thư mục tạm: `orchestrator_tenants:[{tenant_key:acme, agent:orch-acme, max_steps:3}]` → 1 hàng `tenant_id=acme`, `id ≥ 2`, trường thiếu = mặc định cùng yaml; hàng `id=1` không đổi; `hub_config_version` +1 |
| A71 | R13 | Seed lại y hệt → version không tăng, không hàng trùng; đổi `max_steps` → version +1, `orchestrator_settings.version` +1 |
| A72 | AC-10 | `tenant_key: zzz` → bỏ, `warn seed-orchestrator-tenant-unknown {tenant_key:"zzz"}`, mục khác vẫn ghi |
| A73 | AC-10 | Agent lạ / `enabled:false` / runtime `dify-agent` / không profile / `tenant_key` trùng → ném + CLI `hub:seed` exit 1; DB không đổi (số hàng, version) |
| A74 | R13 | `{tenant_key:acme, remove:true}` → xoá; bản `beta` không nhắc → giữ |
| A75 | R13 | yaml không có `orchestrator_tenants` → hàng tenant giữ nguyên |
| A76 | R13 | Seed đặt bản `beta` = agent đang là Orchestrator mặc định → hợp lệ (cùng agent); menu không đổi |
| A80 | AC-H21 · R17 | 2 run `lan` `running` (ScriptRuntime không trả) → tin thứ 3 (flow mới) → 429, header `Retry-After: 5`, body `{error:{code:"TOO_MANY_RUNS", message:"Too many running requests"}}` không khoá `details`; 0 ghi; trả kết quả 1 run → gửi được |
| A81 | HUB-H2b-AC-03 | 5 vòng: 0 đang chạy, 10 POST song song (flow mới) → đúng 2 run + 8 × 429; vòng có sẵn 1 → đúng 1; `pgDeadlocks` không tăng |
| A82 | AC-03 · R18 | Đủ 2 run, POST vào flow có run `running` → 409 `FLOW_BUSY` (không 429); song song 5 POST cùng flow + đủ ngưỡng → chỉ 409 |
| A83 | R16 | 1 run `orchestrated` + 1 `command` (`/dich`, `mk-slow-2000`) → `@assistant x` → 429; 1 `direct` + 1 `orchestrated` → 429 |
| A84 | R16 | Run đã `ask` (finished) không tính; `/internal/test-run` đang chạy không tính; `hoa` gửi được khi `lan` đủ ngưỡng |
| A85 | R17 | `info run-limit {tenant_id, user_id, running:2, limit:2}`, không nội dung tin |
| A86 | R17 | 429 không lưu message user, không tạo flow mới (đếm `flows`) |
| A87 | R16 | Spawn `apps/hub-api/src/server.ts` với `HUB_MAX_CONCURRENT_RUNS=0`/`21`/`abc` → thoát ≠ 0 trong 10 s; `=1` → ngưỡng 1 (một ca) |
| A88 | R17 · K3 | Song song E12 (đủ ngưỡng) + huỷ run + `job.result` → không deadlock, mọi request trả trong 5 s |

| ID | Mã | Given/When → Then |
|---|---|---|
| A90 | AC-H22 · R12 | Catalog H2a + MK. `lan` `@trello Tạo thẻ` → run `direct`; claim có token (`claimWithToken`) → `tools/call create-trello-card` → `CONFIRMATION_REQUIRED`, MK 0 (lời gọi có input `title`); agent `need_input` → SSE `ask`; `tool_confirmations` 1 `pending` |
| A91 | AC-H22 | `Đồng ý` (không tag) → run `orchestrated`, xác nhận `confirmed`, `decided_run_id`; job `trello` (Orchestrator giả delegate) gọi tool → MK đúng 1 |
| A92 | AC-H22 · T4 | (flow mới) `@trello Đồng ý` → run `direct`, `confirmed`; tool → MK 1; gọi lần 2 → `CONFIRMATION_REQUIRED` |
| A93 | R12 | `@helper Đồng ý`, `@trello @helper Đồng ý`, `@trello Huỷ` → `declined`; tool sau đó → `CONFIRMATION_REQUIRED`, MK 0 |
| A94 | R05, R12 | `@nope Đồng ý` → 404, xác nhận vẫn `pending`; rồi `Đồng ý` → `confirmed` |
| A95 | R12 | `hoa`: `@Trello  agree ` → `confirmed` |
| A96 | H2a-R22 | `confirmed` qua `@trello Đồng ý` → 5 `tools/call` song song → MK 1 |
| A100 | R19 | `payload.stream`: Orchestrator `true`; agent run `direct` `true`; delegate đầu `true`; delegate thứ 2 vắng/`false`; job `workflow.async` không có |
| A101 | AC-04 · R22 | Orchestrator: 5 × `job.delta{answer}` 60 ký tự cách 100 ms rồi `answer` cùng text (300) → ≥ 1 `delta` trước `step.finished` của step Orchestrator; mọi `delta` ≤ 40; nối = `run.finished.content` = E11; delta đầu trước `run.finished` ≥ 200 ms |
| A102 | R22 | Orchestrator phát `kind=done` / run `direct` phát `answer` → 0 `delta` trước `job.result`; `content` = kết quả cuối |
| A103 | AC-05 | `direct` `done` stream → delta sớm; `partial` stream `"A"` rồi `partial{A,B}` → nối delta = `"A\n\nPhần chưa làm được: B"` = content |
| A104 | AC-05 · R22 | Delegate đầu stream `done` → delta khi step mở; `done` → pass-through, đúng 1 job Orchestrator |
| A105 | R22 | Delegate đầu phát `partial` → không chuyển tiếp; Orchestrator gọi lại (2 job), content = `answer` |
| A106 | AC-05 | Delegate thứ 2 phát `job.delta` (ép) → không có `delta` nào từ nó |
| A107 | AC-06 · R23 | S=`Xin chào`, F=`Chào bạn` → không phát thêm; content = E11 = S; step `detail.stream="delta_mismatch"`, `streamed_len`, `final_len`; `warn run-delta-mismatch` |
| A108 | R23 · P12 | Orchestrator stream rồi JSON hỏng → **không** job Orchestrator thứ 2; `run.finished` content = S; `stream_unparsed` |
| A109 | R23 · P12 | `direct` stream rồi `job.failed UPSTREAM_ERROR invalid_output` → `run.finished` (không `run.failed`), content S, `stream_unparsed` |
| A110 | R23 | Stream rồi `job.failed ALL_PROVIDERS_EXHAUSTED` / `timed_out` → `run.failed` đúng mã; đúng 1 sự kiện kết thúc |
| A111 | AC-06 | Huỷ giữa stream → `run.failed CANCELLED` ≤ 5 000 ms |
| A112 | P11 | `seq` 1 (started), 2 (delta), **4** (delta) → ngừng chuyển tiếp sau seq 2; `delta_gap`, `seq_expected:3`, `seq_seen:4`, `warn run-delta-gap`; F bắt đầu bằng S → phát phần còn lại, content = F |
| A113 | R23 | F = S → không phát thêm; `ask` Orchestrator / `need_input` không delta → như H1 |
| A114 | R22 | Delta trước `job.started` của job khác cùng run (job delegate) không lẫn vào S của Orchestrator |
| A115 | spec §6 | XADD `job.delta` → SSE `delta`: trung vị 10 chunk ≤ 150 ms |
| A116 | T13 | Chunk 4 000 ký tự (có emoji) → mọi `delta` ≤ 40, không surrogate lẻ, nối đúng |
| A117 | C1 §2.5 | E13 `Last-Event-ID` giữa stream → phát lại đúng, không trùng `delta` |
| A120 | AC-11 · R24 | `@dify-tro-ly hỏi` (`mk-slow-300`, 5 chunk) → ≥ 1 `delta` trước `run.finished` (trước khi MK gửi chunk cuối); `responder.key="dify-tro-ly"`; content = nối chunk |
| A121 | R24 | Orchestrator delegate `dify-tom` (delegate đầu) → delta khi step mở, pass-through |
| A122 | R24 | `dify-tom` là delegate thứ 2 → 0 delta từ nó |
| A123 | P14 | Run `@dify-tro-ly`: SSE id liên tục, không sự kiện ngoài `CHAT_EVENT_NAMES` |
| A130 | AC-08 · R27 | `direct`: `job.failed{UPSTREAM_ERROR, reason:refused}` → `run.failed UPSTREAM_ERROR`, `message` câu H1, `hint` refused (vi `lan` / en `hoa`) |
| A131 | R27 | Job Orchestrator `refused` → như A130 |
| A132 | R27 | reason `null` → hint H1; `NOT_CONFIGURED`/`credential` → câu H1 |
| A140 | spec §4 | CHECK `runs_direct_ck`, `runs_responder_ck`, `runs_orch_tenant_ck`, `runs_kind_check` (`workflow` → 23514) |
| A141 | R16 | RLS: transaction `user` của `lan` đếm `running` không thấy run `hoa` |
| A142 | R13 | `orchestrator_settings_scope_ck`, `_tenant_uq`, sequence `id ≥ 2` |
| A143 | R27 | `jobs.error_reason='refused'` ok |
| A150 | R30 | Tin không `@`/`/`: `run.started` khoá đúng `{run_id, flow_id, quota}`; tin E11 cùng tập khoá H2a; không `delta` khi job không phát |
| PF1 | spec §6 | `GET /agents` p95 ≤ 50 ms (200 lần) |
| PF2 | spec §6 | E12 `@` + kiểm 429: thêm ≤ 10 ms p95 so với tin thường |
| PF3 | spec §6 | `job.delta` → SSE ≤ 150 ms p95 |

## 3. H · hub-dev · K · hồi quy khoá (chạy lại, không sửa)
| ID | Bộ | Lý do |
|---|---|---|
| H01 | `hubdev/fixture.hubdev.test.ts` (R26, AC-02 vế `hoa`): `lan` `GET /agents` có `assistant`; `hoa` `items=[]` | F3 |
| K01 | `bun test packages/contracts/src/chat` (`entities.test.ts:142`) | P2 chỉ thêm |
| K02 | `tests/acceptance/C1/**` | contract chat |
| K03 | `test:contract:chat` 41 pass (Hub thật, fixture R26, Q-T1) | R26, R30 |
| K04 | `tests/acceptance/H1/**` (rules `agent-access`, `orchestrator`, `run-errors`; int `concurrency`, A15, `seed.int`, A48–A51; stack) | P5, P6, P8, P15 |
| K05 | `tests/acceptance/H2a/**` (`command-parse`, `confirm` A60–A67, A17/A31, `db.int:92`, `dify-agent`, stack) | P4, TD #44 |
| K06 | `apps/agent-runtime/tests/acceptance/**` H1/H2a + `test_contracts_hub.py` | Runtime không đổi hành vi |
| K07 | `tests/acceptance/{M1..M4,ADM-NFR-06}` | Admin không đổi |
| K08 | typecheck `@ai/chat-web`, `@ai/mocks` (`Record<ChatErrorCode>`) | P2 |
| K09 | `depcruise`, `check:size --all`, `check:fn` | TD #44 |
| K10 | `packages/db` int (`hub-h2b.int.test.ts` của D1) | `0006` idempotent |
| K11 | `bun run test:smoke:live` không `HUB_LIVE` → exit 0, mọi ca skip | R29 |

## 4. M · Thủ công
| ID | Checklist |
|---|---|
| M01 | `spike-stream.md` đủ 9 điểm `plan-runtime` §2, mỗi điểm ✓/✗ + quyết định áp vào PY-02/B9; qc chỉ kiểm biên bản |
| M02 | `smoke.md` (I2): SM1–SM3 với `claude-sub` thật, kết quả theo spike |
| M03 | `docs/guides/hub-dev.md` không còn câu "không code nào đọc" `HUB_LIVE` |
