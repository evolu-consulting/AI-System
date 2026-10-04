# Test plan · H2a-dify-command · phụ lục ca (qc)

Phụ lục của [`test-plan.md`](test-plan.md): §1 bảng ca hàm thuần (R, R-P) · §2 hồi quy khoá (K) · §3 thủ công/blocked (M) · §4 không phủ · §5 Python/stack (P, S) · §6 A tách ra (agent `dify-*`, test-run, DB/seed) · §7 catalog fixture · bảng ca P30: [`test-plan-py.md`](test-plan-py.md).

## 1. R · Hàm thuần — bảng ca (chữ ký `plan-rules.md`)

### 1.1 `command-parse` (R01–R14) · R05, HUB-BR-01, HUB-H2a-AC-01
| ID | Đầu vào → kỳ vọng |
|---|---|
| R01 | `classifyMessage("xin chào")` → `{kind:"text", content:"xin chào"}`; `"/dich en"` → `{command, name:"dich", rest:"en"}`; `"a /dich"` → text |
| R02 | `"//abc"` → text `"/abc"`; `"///x"` → text `"//x"`; `"  //a"` → text `"/a"` |
| R03 | `"/"` → command `name:""`; `"/ abc"` → `name:""`; `"/DICH x"` → `name:"dich"`; `"/Translate"` → `"translate"` |
| R04 | `"\t\n  /dich en"` → command (trim đầu) |
| R05 | `tokenize("a  b\tc")` → `["a","b","c"]`; `""`, `"   "` → `[]` |
| R06 | `tokenize('"hello world" x')` → `["hello world","x"]`; `'"a \"b\" c"'` → `['a "b" c']`; `'""'` → `[""]` |
| R07 | Ngoặc không đóng `'"abc def'` → `["abc def"]` (Q-T9) |
| R08 | `bindArgs([lang, text], "en xin", {})` → `{values:{lang:"en", text:"xin"}, extra:0}` |
| R09 | `text.rest=true`: `"en  hello   world  "` → `text:"hello   world"`; `'en "a  b" c'` → `text:'"a  b" c'` (nguyên văn từ token đó, Q-T9) |
| R10 | thiếu `tone` có `default:"neutral"` → `"neutral"`; có cả `default` và `fallback` → `default` thắng |
| R11 | thiếu `text`, `fallback:"$selection"`, `ctx.selection="xin chào"` → `"xin chào"` (AC-H01) |
| R12 | thiếu, không default/fallback → `null`; `$selection` mà `ctx` không có → `null` |
| R13 | `[lang]` + `"en a b"` (không `rest`) → `values.lang="en"`, `extra:2` |
| R14 | Token có dấu/emoji giữ nguyên; U+00A0 không tách (chỉ khoảng trắng ASCII, Q-T10) |

### 1.2 `command-input` (R15–R26) · R06, HUB-FR-12
| ID | Đầu vào → kỳ vọng |
|---|---|
| R15 | map `arg`, `const`, `user_id`, `tenant_id` → `inputs` đúng giá trị/kiểu |
| R16 | map `selection`/`page_url`/`page_text` lấy từ `ctx` |
| R17 | input `required` rỗng, nguồn `arg lang` → `{ok:false, missing:["lang"], invalid:[]}` (tên **tham số command**) |
| R18 | input `required` nguồn `selection` rỗng → `missing:["source_text"]` (tên input) |
| R19 | number: `"3.5"`→3.5, `"1e3"`→1000, `"-2"`→-2; `"abc"`, `"Infinity"`, `"NaN"` → `invalid` |
| R20 | boolean: `true/FALSE/1/0/yes/No` → bool; `"maybe"` → `invalid` |
| R21 | select ∉ options (`"xx"`) → `invalid:["lang"]`; ∈ → giữ |
| R22 | input không bắt buộc rỗng → không vào `missing` |
| R23 | input tên `query` → `query` = giá trị; không có → `query:null` |
| R24 | `appNeedsQuery("workflow")` false; `"chat"`, `"agent"` true |
| R25 | map `attachment` bắt buộc (H2c) → `missing` chứa tên tương ứng |
| R26 | vừa thiếu vừa sai kiểu → `ok:false` đủ hai danh sách, không trùng |

### 1.3 `suggest` (R27–R29) · R04, AC-H02
| ID | Ca |
|---|---|
| R27 | `levenshtein`: `("","abc")`=3, `("kitten","sitting")`=3, `("dich","dich")`=0, `("dihc","dich")`=2, `("dịch","dich")`=1 |
| R28 | `suggestCommands("dihc", usable)` → `["dich"]`; ngưỡng `max(2,⌊len/3⌋)` (len 9 → 3; dist 4 bị loại); sắp khoảng cách rồi tên; khớp alias `translat` → tên chính `dich`; tên + alias cùng khớp → 1 mục; ≤ 3 |
| R29 | `""` → `[]`; `"zzzzzz"` → `[]`; lệnh ngoài `usable` không bao giờ xuất hiện |

### 1.4 `access-parity` (R30–R39) · HUB-FR-76, HUB-H2a-AC-10
Mỗi ca chạy **hai lần** (`describe.each`): `usableCommands` (Hub) và `computeEffectiveAccess(...).visible` (Admin, `apps/admin-api/src/modules/access/access.rules.ts`), cùng `AccessInput`.

| ID | Dữ liệu → có dùng `/x` |
|---|---|
| R30 | F on + entitlement + grant group của user → có |
| R31 | grant trực tiếp user → có; grant user khác / group user không thuộc → không |
| R32 | không entitlement → không (AC-H11) |
| R33 | entitlement đã thu hồi / của tenant khác → không |
| R34 | F off → không |
| R35 | F beta: user ∈ `beta-testers` → có; không thuộc → không |
| R36 | F `core`: không cần entitlement, không cần grant → có (theo M3-R11 + code Admin — luật gốc của H2a-R02); `core` `off` → không |
| R37 | command tắt / workflow tắt → không; agent có workflow gắn không ảnh hưởng (BR-19) |
| R38 | lệnh ở 2 feature (1 thu hồi, 1 hợp lệ) → có; Hub `featureId` = feature hiệu lực key nhỏ nhất (Q4) |
| R39 | Bộ đầy đủ §7 → tập Hub = tập Admin cho `lan`, `hoa`, `tadmin`, `an` |

### 1.5 `menu` (R40–R42) · HUB-FR-10
| ID | Ca |
|---|---|
| R40 | `required` = arg map vào input `required` ∧ `default=null` ∧ `fallback=null`; `text` có fallback → `required:false, has_fallback:true`; `rest` đúng |
| R41 | Kết quả parse `CommandMenuItemSchema`; không khoá workflow/`input_map`/secret |
| R42 | `description.en` null giữ null; alias ≤ 5 |

### 1.6 `dify` (R43–R49) · R09–R11, R15, R17
| ID | Ca |
|---|---|
| R43 | `difyRunUrl`: workflow → `<base>/workflows/run`; chat/agent → `<base>/chat-messages`; `difyStopUrl` → `/workflows/tasks/<id>/stop`, `/chat-messages/<id>/stop`; `difyRunBody`: `response_mode:"streaming"`, `user`, `inputs`; chat có `query`; `conversationId:"c1"` → `conversation_id:"c1"` |
| R44 | `interpretDifyEvent`: `text_chunk`, `message`, `agent_message` → `delta`; `workflow_started`/có `task_id`, `conversation_id` → `meta`; `workflow_finished{status, outputs}`, `message_end{metadata.usage}` → `finished`; `error` → `error`; `ping`, `node_started`, `agent_thought`, `null`, `"x"` → `ignore` |
| R45 | `mapDifyHttpError`: 401, 403, 404 → `NOT_CONFIGURED`; 400, 413, 415, 422, 429, 418, 500, 502, 503 → `UPSTREAM_ERROR` |
| R46 | `finalText("abc", …)` → `"abc"`; `("", {text:"x"}, null)` → `"x"`; `("", {result:"y"}, "result")` → `"y"`; object/number → `JSON.stringify`; `null`/`""`/thiếu khoá/`outputs null` → `null` |
| R47 | `difyUsage`: chat `{prompt_tokens:10, completion_tokens:5, total_price:"0.0012", currency:"USD"}` → 10/5/0.0012; workflow `{total_tokens:30}` → 30/0/0; `currency:"RMB"` → cost 0; thiếu/rác → 0/0/0 |
| R48 | `difyUser("acme", u)` → `"acme:<u>"`; `difyAgentInput`: có `query` → `"query"`; một input chuỗi bắt buộc → tên đó; hai → `null`; không có → `null` |
| R49 | `maskSecret`: thô, base64, hex (thường + hoa) → `***`; cắt ≤ 300; nhiều lần xuất hiện → che hết |

### 1.7 `mcp` (R50–R55) · R18–R20
| ID | Ca |
|---|---|
| R50 | `parseRpc`: hợp lệ (có/không `id`); mảng → `-32600`; thiếu `method`, `jsonrpc≠"2.0"`, không phải object → `-32600` |
| R51 | `negotiateProtocol`: 4 bản `MCP_PROTOCOL_VERSIONS` → giữ; lạ/`undefined`/số → `"2026-07-28"` |
| R52 | `toolInputSchema`: `type:"object"`, `properties` theo kiểu (string/number/boolean/select→`enum`), `required`, `description` từng tham số |
| R53 | `mcpToolsFor`: giao `agentWorkflowIds` ∩ `enabled` ∩ `allowed`; bỏ workflow có input `file` bắt buộc; sắp `name`; `name` = key, `description` = mô tả |
| R54 | `validateToolArgs`: đúng → `ok` + `query`; thiếu bắt buộc / sai kiểu / không phải object → `{ok:false}` |
| R55 | `toolTimeoutS(1,300)`=1, `(300,300)`=300, `(900,300)`=300 |

### 1.8 `confirm`, `runner`, `secret-crypto`, contract (R56–R74)
| ID | Ca |
|---|---|
| R56 | `isAgreeReply`: `"Đồng ý"`, `" đồng ý "`, `"ĐỒNG Ý"`, NFD `"Đồng ý"`, `"Agree"`, `"agree "` → true; `"Đồng ý."`, `"ok"`, `"Huỷ"`, `"đồng ý luôn"`, `""`, `"/dich"` → false |
| R57 | `confirmationPrompt("vi"/"en")` = nguyên văn `plan-errors` §5 (question + choices) |
| R58 | `confirmationInstruction("vi"/"en")` = nguyên văn §5 |
| R59 | `hashJobToken(t)` 32 byte = sha256 ASCII; vector cố định dùng chung P01/P28 |
| R60 | `buildWorkflowJobPayload` → parse `WorkflowAsyncJobSchema`; không khoá secret/URL; `side_effect` theo cờ |
| R61 | `mcpConfigFor`: tools rỗng → `null`; có → `{url, tools}` |
| R62 | `orphanAction`: async att 1–2 → `requeue`; att 3 → `fail`; `side_effect ∧ dispatched` → `fail`; `side_effect ∧ ¬dispatched` → `requeue`; `agent.cli` → `fail` |
| R63 | `decryptSecret` giải vector `encryptSecret` Admin; master key / iv / `key_version` sai → ném |
| R70 | `SendMessageRequestSchema` + `context{selection}` ok; khoá lạ trong `context`, `page_url` `ftp:`, `selection` 16 001, `page_text` 50 001 → lỗi; `{content}` → `{content}` |
| R71 | `CHAT_API_ERRORS` đúng 6 mã cũ; `CHAT_COMMAND_ERRORS` = `{CMD_NOT_FOUND:404, CMD_MISSING_ARG:422}`; `CHAT_EVENT_NAMES` không đổi; details ≤ 3 / ≤ 50 |
| R72 | `CommandMenu*` giới hạn (aliases ≤ 5, args ≤ 20, items ≤ 500) |
| R73 | `JobPayloadSchema`: fixture valid mới + cũ ok, invalid mới lỗi; `WorkflowAsyncJob` có `api_key`/`base_url`/`job_token` → lỗi; `McpConfig` có `token` / `tools:[]` / 21 tool → lỗi; `NOT_CONFIGURED ∈ HUB_JOB_ERROR_CODES ⊂ CHAT_RUN_ERROR_CODES`; `JOB_FAIL_REASONS` ∋ `credential`, `upstream` |
| R74 | `TestRunRequest` default (`args []`, `timeout_s 30`); `TestRunResponse` union `ok`; `DifyCredentialResponse` strict; `MCP_PROTOCOL_VERSIONS[0]="2026-07-28"`; `ToolConfirmationRequired.choices` đúng 2 |

### 1.9 R-P · Python `retry_delay(err_kind, attempt, flags: RetryFlags, backoff)` — P28 (`plan-runtime` §3.1, `-dify` §3.4)
Bảng ca: [`test-plan-py.md`](test-plan-py.md) mục `retry_delay`.

Ngưỡng heartbeat mặc định = 60 s (Q-T5): đọc `Settings` không env (kiểm riêng, không thuộc `retry_delay`).

### 1.10 R-P · `parse_confirmation(content)` — P29 (`plan-runtime` §5)
JSON đúng hình ở khối đầu → `Confirm`; khối thứ 2 là câu chỉ dẫn → bỏ qua; `content` là str → một khối; `code` khác / `choices` 1 hoặc 3 phần tử / `question` rỗng hoặc 2 001 ký tự / không phải JSON → `None`.

## 2. K · Hồi quy khoá (chạy lại, không sửa) — HUB-H2a-AC-11, H2a-R25
| ID | Bộ | Lý do |
|---|---|---|
| K01 | `bun test packages/contracts/src/chat` (`entities.test.ts:142` 6 mã) | Q3 chỉ thêm |
| K02 | `tests/acceptance/C1/**` | contract chat |
| K03 | `bun run test:contract:chat` (41 ca, Hub thật, I1) | CHAT-AC-33 |
| K04 | `tests/acceptance/M2/db-rls`, `M3/{db-rls,hub-view,access-sql}` trên DB Admin | P1 không GRANT `admin.secrets`; bản trên DB h1: A84 |
| K05 | `tests/acceptance/H1/**` (rules, int A48–A51, lease/orphan, stack) | P2, P11, orphan H1 |
| K06 | `apps/agent-runtime/tests/acceptance/**` H1 (sau PY-00 tách `job_run.py`) | không đổi hành vi |
| K07 | `apps/admin-api/src/modules/access/*.test.ts` + typecheck `@ai/chat-web`, `@ai/mocks` | không sửa Admin/Chat |
| K08 | Test khoá Admin dùng `tools/mocks/src/dify.ts` | mock Admin không đổi (P15) |

## 3. M · Thủ công (M01–M02 blocked I2/W1; M03 chạy ngay sau Gate)
| ID | Checklist (biên bản `smoke.md`) |
|---|---|
| M01 | `DIFY_LIVE=1`: workflow `dich` + secret nhập ở Admin → `/dich en` có selection: stream về, ≥ 2 `delta`; Dify log thấy `user=<tenant>:<user>`; key sai → `NOT_CONFIGURED`; huỷ giữa chừng → Dify hiện `stopped`; `dify-agent` lượt 2 giữ `conversation_id`; `usage_logs` có token thật; grep log hub-api/Runtime không có key |
| M02 | `HUB_LIVE=1` `claude-sub`: agent `trello` gọi `mcp__hub__create-trello-card` → `ask` → "Đồng ý" → 1 lời gọi Dify; model thấy mô tả mới sau sửa Admin; `ps -o args` không thấy token |
| M03 | Spike PY-S1 (`spike-mcp.md`): đủ 10 điểm `plan-runtime` §4.6, mỗi điểm có kết luận áp vào §4.2–4.5; qc chỉ kiểm biên bản |

## 4. Không phủ ở H2a
| Mã / vế | Lý do · mốc |
|---|---|
| AC-H12 vế Studio "Xem như model thấy" | H4 |
| HUB-FR-24 `llm`/`python` (`agent.run`) | H2d |
| HUB-FR-13 "trả ngay `job_id`" | R12: client không đổi (SSE như sync) — A30 kiểm thay |
| HUB-FR-33 quota/overage cho Dify | H3 |
| Đính kèm, `attachment` thật | H2c (chỉ `CMD_MISSING_ARG`, R25) |
| Dify thật, CLI thật + MCP | M01–M02 blocked W1 |
| Hiệu năng spec §6 (trừ ≤ 5 s cấu hình/huỷ) | `test:perf`, không chặn |

## 5. P · Python (`apps/agent-runtime/tests/acceptance/`) · S
Thứ tự: QW-PU (P28–P30, `test_dify_rules.py`) viết **sau C2 và Q2 (chuỗi `Q2 → QW-PU → Q-PU`), trước PY-01** (test trước code; chữ ký `plan-runtime §3.1`: `ErrKind`, `RetryFlags`, `retry_delay`, `map_failure`, `usage_row`, `reduce`). QW-P (int), QW-S viết **sau PY-02** (cần `dify_mock.py`; fixture phải xanh) và khoá lần 2 (Q3) **trước PY-03**; ca `fake-cli` MCP (P24–P27, S01–S02) đỏ vì chỉ thị chưa có tới PY-06 — đúng lý do.
File: `dify_job_int_test.py` (P02–P05, P13–P17) · `dify_retry_int_test.py` (P06–P12) · `dify_requeue_int_test.py` (P18–P22) · `dify_leak_int_test.py` (P23) · `mcp_int_test.py` (P01, P24–P27) · `test_dify_rules.py` (P28–P30, unit, QW-PU). Helper `_dify.py` (payload `workflow.async`, chạy mock Python).

| ID | Mã | Given/When → Then |
|---|---|---|
| P01 | RT1 · FR-50 | Claim mọi job (`agent.cli`, `workflow.async`) → `token_hash` 32 byte; token không trong `jobs.*`, XADD, log JSON, `/proc/<pid>/cmdline` CLI con; mock credential nhận Bearer có sha256 = `token_hash` |
| P02 | WRK-FR-07 · R15 | `mk-ok` → `succeeded{result:{kind:"text"}}`, XADD `job.result{output.kind="text"}`; mock nhận `response_mode=streaming`, `user=payload.dify_user`, inputs; `usage_logs` 1 dòng `dify/dify/NULL`, `agent_id NULL`, `feature_id`=payload, token/cost theo R15 |
| P03 | R09 | App chat: `/chat-messages` có `query`; app `workflow` không `query` |
| P04 | R09 | `mk-outputs` → text từ `output_field`; `null` → `text` (RQ8) |
| P05 | R11 | `mk-empty` → `UPSTREAM_ERROR`/`invalid_output`; `mk-failed`, `mk-error-event` → `UPSTREAM_ERROR`/`upstream` |
| P06 | AC-06 | `mk-503x2` → `succeeded`, mock 3 lời gọi, khoảng 1→2 ≥ 0.2 s, 2→3 ≥ 0.8 s; progress "Đang thử lại (1/2)", "(2/2)" |
| P07 | AC-06 | `mk-400` → 1 lời gọi, `UPSTREAM_ERROR`; `mk-503x5` → 3 lời gọi rồi `UPSTREAM_ERROR` |
| P08 | AC-06 · Q6 | `side_effect=true` + `mk-503x1` → 1 lời gọi, `failed UPSTREAM_ERROR`; `dispatched_at` đặt **trước** khi mock nhận request |
| P09 | R11 | `mk-401`/`mk-404` → `NOT_CONFIGURED`/`upstream`, 1 lời gọi; 429 → không retry (RQ4) |
| P10 | RQ5 | Stream đứt sau `workflow_started` → không retry, `UPSTREAM_ERROR`, stop best-effort |
| P11 | WRK-FR-06 | Cổng Dify đóng (kết nối lỗi) → 3 lần thử rồi `UPSTREAM_ERROR` |
| P12 | R13 | Huỷ trong lúc ngủ backoff → `cancelled` ≤ 5 s, không lần thử kế |
| P13 | Q5 | Credential 409 / 401 → `NOT_CONFIGURED`/`credential`, Dify 0 lời gọi; 5xx → thử lại rồi `credential` |
| P14 | RQ9 | Credential `app_type` ≠ payload → `NOT_CONFIGURED`/`credential`, 0 lời gọi |
| P15 | R10 | Huỷ (`job_cancel`) giữa stream `mk-slow` → `cancelled` + `job.failed CANCELLED` ≤ 5 s + mock nhận stop đúng `task_id` |
| P16 | R12 | `timeout_s=1` → `timed_out` + `TIMEOUT` + stop |
| P17 | R12 · RT7 | Mock gửi `node_started{title:"NODE_SECRET_TITLE"}` → `job.progress.message` ∈ {"Đang chạy lệnh","Đang chạy bước n"}, không chứa title; ≤ 1/giây |
| P18 | AC-W06 | Job đang chạy (`mk-slow`), `kill -9` Runtime A → heartbeat quá `AGENT_RT_ORPHAN_S=5` → Runtime B `REQUEUE_ORPHANS` → `queued` (`token_hash`,`dispatched_at` NULL, không XADD) → B claim (token khác) → `succeeded`, `attempts=2`, `run:<id>` đúng 1 sự kiện kết thúc |
| P19 | Q6 | Như P18 với `side_effect` + `dispatched_at` → `failed orphaned` (H1), không lời gọi Dify thứ 2 |
| P20 | R13 | `attempts=3` mồ côi → `failed orphaned` |
| P21 | RT4 | Runtime khởi động lại cùng `WORKER_ID` → `REQUEUE_RESTART` đưa job của mình về `queued` |
| P22 | R15 | Sau requeue + chạy xong: `usage_logs` theo `job_id` đúng 1 dòng |
| P23 | AC-04 | `LEAK_KEY_…` (thô/base64/hex) không có trong `jobs`, `usage_logs`, Redis `run:<id>`, log JSON Runtime, file log job; lỗi `mk-401` có key trong thân → log đã che |
| P24 | WRK-FR-13 | `fake-cli` `#fake:tool=check-invoice #fake:args={…}` + `mcp_mock` → mock nhận `tools/call{name, arguments}` + Bearer token claim; file MCP 0600 ngoài `work/<job_id>`, bị xoá sau job; không token trong argv |
| P25 | FR-95 | `mcp_mock` trả `CONFIRMATION_REQUIRED` đúng hình → job `succeeded` `need_input{question, choices}` = của Hub; 1 lời gọi tool, không retry/resume |
| P26 | R19 | `#fake:tool=x` với `x` ∉ `payload.mcp.tools` → không gọi MCP (nghĩa H1); `mcp__other__x` deny |
| P27 | H1-R17 | Orchestrator (`output=text`) có `mcp` ≠ null → bỏ qua, log `warn`, không gọi MCP |
| P28 | unit · QW-PU | `retry_delay(…, RetryFlags(first_seen, side_effect))` (`test-plan-py`) BACKOFF `(2, 8)` → 2.0, 8.0, `None` lần 3; `ErrKind` đủ giá trị |
| P29 | unit · QW-PU | `parse_confirmation` (cases §1.10); fixtures `hub.py` valid/invalid mới |
| P30 | unit · QW-PU | `map_failure` (R11), `usage_row` (R15), `reduce` (workflow/chat) — bảng ca tối thiểu [`test-plan-py.md`](test-plan-py.md); nguồn `plan-runtime-dify` §3.2, §3.4, §3.5, §3.7; chữ ký `plan-runtime §3.1` |

| ID | Loại | Ca |
|---|---|---|
| S01 | AC-H22 | Stack: tin "#fake:tool=create-trello-card #fake:args={\"title\":\"A\"}" tới agent `trello` → SSE `ask{choices:["Đồng ý","Huỷ"]}`, `hub:dify-mock` 0 lời gọi; "Đồng ý" → Orchestrator delegate lại → mock **1** lời gọi; trace run 1 `CONFIRMATION_REQUIRED` |
| S02 | AC-H12 · AC-05 | `#fake:mcp-list` → `done` chứa tên + mô tả mới sau khi sửa ở Admin ≤ 5 s; sau run xong, token (đọc từ file MCP lúc chạy) → 401 |
| S03 | AC-W06 | Stack: `/dich` async `mk-slow` → `kill9` Runtime → Runtime mới → `run.finished` (client chỉ thấy một `run.finished`) |

## 6. A tách ra (`tests/acceptance/H2a/`)
File: `secret` (A80–A86) · `dify-agent` (A40–A46) · `test-run` (A70–A75) · `db` (A87–A92) · `seed` (A93–A95) `.int.test.ts`.

| ID | Mã | Given/When → Then |
|---|---|---|
| A40 | FR-23 · AC-07 | Orchestrator (kịch bản) delegate `dify-dich` → **không** hàng `jobs` cho bước đó; MK nhận `workflows/run`, `user="acme:<lan>"`; `run.finished` = text Dify (pass-through `done`) |
| A41 | AC-07 | `dify-tro-ly` lượt 1 → MK trả `conversation_id=c1` → `cli_sessions(provider_key='dify')`; lượt 2 cùng hội thoại → body có `conversation_id:"c1"`; hội thoại khác → không gửi |
| A42 | R14 | Workflow của agent tắt → bước `job.failed NOT_CONFIGURED` → Orchestrator xử lý như H1; `mk-failed` → `UPSTREAM_ERROR` |
| A43 | R14 | Timeout `agents.timeout_s=1` + `mk-slow` → stop + bước lỗi `TIMEOUT`; huỷ run → stop |
| A44 | R15 | Usage `agent_id`=`dify-dich`, `feature_id NULL` |
| A45 | FR-24 | Delegate `trello` → payload `agent.cli.mcp = {url:"<HUB_PUBLIC_INTERNAL_URL>/mcp", tools:["create-trello-card"]}`, không `token`; agent không gắn workflow → `mcp: null`; Orchestrator → `mcp: null` |
| A46 | FR-24 | `hoadon` gắn `check-invoice` + `tat` (tắt) → `tools` chỉ `["check-invoice"]` |
| A70 | FR-51 · AC-08 | `POST /internal/test-run` Bearer đúng, command nháp `/dich` → 200 `{ok:true, output, steps≤10, usage, ms}`; MK `user="platform:<padmin>"`; `counts()` conversations/runs/messages/usage_logs/jobs không đổi (Q13) |
| A71 | AC-08 | Không header / sai token / JWT `padmin` hợp lệ → 401 `UNAUTHORIZED`; `HUB_INTERNAL_TOKEN` vắng → 503 `UNAVAILABLE` |
| A72 | R24 | Command nháp có workflow user không có feature → vẫn chạy (không kiểm quyền) |
| A73 | R24 | Thiếu arg → 422 `CMD_MISSING_ARG`; body sai → 400; `mk-failed` → 200 `ok:false, error.code=UPSTREAM_ERROR, error.detail` ≤ 300 đã che key (Q16) |
| A74 | R24 | Secret thiếu → 409 `NOT_CONFIGURED` (`plan-errors` §1) · Q-T4 |
| A75 | R24 | Không SSE: `content-type` JSON; `timeout_s` nháp hết → `ok:false TIMEOUT` + stop |
| A80 | AC-04 | Secret `LEAK_KEY_…`: chạy sync, async (ScriptRuntime + credential), MCP, `dify-*`, test-run, lỗi `mk-401` có key trong thân → quét `LEAK_KEY`/base64/hex trong: SSE thô, response JSON, `jobs.payload/result/error_*`, `run_steps.detail`, `usage_logs`, `messages`, `tool_confirmations`, Redis `run:<id>`, log hub-api (bắt stdout như H1 A52) → 0 |
| A81 | R17 | Credential endpoint: token job `workflow.async` `running` → 200 `{base_url, api_key, app_type}` + `Cache-Control: no-store`; log không có `Authorization`/key |
| A82 | Q5 | Credential 401 (cùng body) cho: không token, token sai, token job khác (`job_id` ≠), job không `running`, job `agent.cli` |
| A83 | Q5 · R08 | Secret thiếu / giải mã lỗi → 409 `NOT_CONFIGURED`; credential **không** xét `workflows.enabled` |
| A83b | HUB-BR-06 · AC-H05 | Async: job `queued`, tắt workflow (Admin) trước claim → Runtime claim + credential 200 → run vẫn `finished` (không `failed`) |
| A84 | P1 · khoá M2 | Trên DB h1 **sau** `0002`: `SET ROLE hub_ro` `select id from admin.secrets` → 42501; `has_table_privilege('hub_ro','admin.secrets','SELECT')=false`; `hub.workflow_secret(<wf>)` trả đúng 1 secret của workflow, workflow khác/không secret → 0 dòng; `hub_rw`/`agent_runtime` không EXECUTE |
| A85 | P2 · khoá H1 A51 | `hub_api` vẫn không INSERT/UPDATE `usage_logs`; `log_dify_usage` cố định `billing/provider/model` |
| A86 | R17 | Token job rõ không có trong DB (Runtime kịch bản giữ token): chỉ `token_hash` 32 byte; `jobs_token_hash_uq` chặn trùng |
| A87–A92 | D1 | CHECK `runs.kind`/`command_id`; `run_steps` `workflow_id` ↔ type; `jobs.agent_id NULL` chỉ `workflow.async`; RLS `tool_confirmations` (tenant khác 0 hàng, ghi chéo 42501); unique mở `(flow,agent,workflow)`; `insertStep` song song (MCP + vòng) → `seq` liên tục không trùng (P11) |
| A93–A95 | R14 · seed | `dify-*` `workflow_key` sai loại app / không map được `query` / `runtime_options` thừa khoá → seed exit 1; workflow không có trong `admin.workflows` → bỏ dòng + cảnh báo; `workflow_flags` upsert |

## 7. Catalog fixture (`_h2a.ts`, SQL owner vào `admin.*`)
| Đối tượng | Giá trị |
|---|---|
| workflows | `dich` (workflow, inputs `source_text` string req, `target_lang` select[en,vi,ja] req, `tone` string opt) key `mk-ok` · `tom` (workflow) · `hoi` (chat, `query` req) · `tro-ly` (agent app) · `check-invoice` (workflow, mô tả "Kiểm tra một hoá đơn điện tử…", inputs `x` string opt mô tả "Mã hoá đơn", `y` string opt mô tả "Ghi chú") · `create-trello-card` (workflow, `side_effect`, input `title` req) · `so` (input number + boolean) · `tat` (enabled=false) |
| args/input_map | `/hoi`: arg `q` (rest) → `query←arg q`, tin `/hoi` trống → `missing:["q"]` · `/so`: args `n` (number), `flag` (boolean) → `n←arg n`, `flag←arg flag` (số/boolean ép kiểu; `abc`/`maybe` → `invalid`) |
| commands | `/dich` (alias `translate`; args `lang`, `text` `rest` fallback `$selection`; input_map `target_lang←arg lang`, `source_text←arg text`, `tone←const "neutral"`) · `/tom` (feature `summary`) · `/hoi` · `/so` · `/tat` (workflow tắt) · `/dong` (`enabled=false`) |
| features | `core` (`/hoi`), `translate` on (`/dich`, `/so`), `summary` on không entitlement `acme` (`/tom`), `labs` beta (`/so`), `aaa-dup` on chứa `/dich` (kiểm Q4 key nhỏ nhất) |
| grants | `core` + `translate` → group `acme/staff` (`lan`,`hoa`); `aaa-dup` → user `hoa`; `labs` → `lan`; `lan` ∈ `beta-testers`; `beta/an` grant `translate` + entitlement beta |
| agents (`hub.*`) | `trello` (`agentic-cli`) ↔ `create-trello-card`; `hoadon` ↔ `check-invoice`, `tat`; `dify-dich` (`dify-workflow`, `workflow_key: dich`); `dify-tro-ly` (`dify-agent`, `tro-ly`) |
| secrets | mỗi workflow một secret mã: app-key = tên kịch bản MK; `dich` ở ca rò rỉ = `LEAK_KEY_7f3a…`; `check-invoice` (A55) = `LEAK_KEY_a55` + 20 hex = `LEAK_KEY_a550f1e2d3c4b5a6978899a` |
