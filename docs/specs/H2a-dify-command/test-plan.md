# Test plan · H2a-dify-command (qc)

Chế độ **TEST-PLAN** · 2026-10-05. Chưa có file test, chưa khoá; viết + "đỏ đúng lý do" sau Gate (§8), rồi Q2 khoá. Ca hàm thuần (R), checklist thủ công (M), không phủ, hồi quy khoá chi tiết: [`test-plan-cases.md`](test-plan-cases.md).
"Đúng" = spec §2 (H2a-R01…R25), §8 (AC + HUB-H2a-AC-01…11); chữ ký `plan-rules.md`; câu chữ `plan-errors.md`; SQL `plan-db.md` §2–3; Runtime `plan-runtime.md` §3–6, `plan-runtime-dify.md` §3.4–3.7. BA chỉ ở mục AC được trỏ (`ba-agent-hub` §11, `ba-worker` §10).

## 1. Quy ước

| Mục | Quy ước |
|---|---|
| Tên test | TS `"<mã> · mô tả [ID]"` (vd `"HUB-FR-76 · HUB-H2a-AC-10 · beta chỉ cho beta-testers [R30]"`); Python `test_<mã_snake>_<mô_tả>` + docstring mã gốc |
| Loại | **R** unit TS hàm thuần · **A** int TS hub-api (HTTP + DB/Redis thật, Runtime kịch bản, mock Dify MK) · **P** Python int/unit (Runtime thật, mock Dify/credential/MCP Python) · **S** stack WSL2 (Hub thật + Runtime thật + `fake-cli`) · **K** test khoá có sẵn chạy lại (chỉ đọc) · **M** thủ công/blocked |
| Vị trí | R: `tests/acceptance/H2a/rules/*.test.ts` · A: `tests/acceptance/H2a/*.int.test.ts` · S: `tests/acceptance/H2a/stack/*.stack.test.ts` · P: `apps/agent-runtime/tests/acceptance/*{_int_test,test_*}.py` · perf: `tests/acceptance/H2a/perf.perf.int.test.ts` (không chặn) |
| Hộp đen | A: HTTP (`/commands`, E12, E15, `/mcp`, `/internal/*`) + DB/Redis + `calls()` của mock; P: `hub.jobs`, NOTIFY, `run:<id>`, request mock nhận, `/proc`, file log |
| Dữ liệu | Fixture H1 (`_fixtures.ts` `T`, `USERS`: `acme` `lan`,`hoa`,`tadmin`; `beta` `an`; `padmin`) + `_h2a.ts` mới: catalog cases §7; uuid cố định dải `a2a0…`; secret mã bằng `encryptSecret` Admin (import trong test, P6) với `SECRET_MASTER_KEY` test cố định |
| Chờ | Không `sleep`: `waitFor`/`expect.poll` (H1), đọc SSE tới sự kiện cuối; Python `wait_until(cond, timeout)` 50 ms. Ngưỡng thời gian dùng `≤` rộng (5 s → kiểm `≤ 5 000 ms`) |
| Cấm | `skip`/`only`/`todo`, `pytest.mark.skip`, `importorskip`; import module Python chưa có đặt trong thân test |
| Bí mật | Mọi app-key test có tiền tố `LEAK_KEY_` hoặc tên kịch bản MK; không key thật trong repo |

## 2. Hạ tầng và giả lập

| Mục | Đề xuất | Ai |
|---|---|---|
| DB test | Dùng lại `ai_system_h1_test` (`HUB_TEST_DATABASE_URL`, `plan-db` §5) + migration `0002`; `prepareDb` H1 idempotent. **Không** migrate Hub trên `TEST_DATABASE_URL` | qc |
| Redis | `redis://localhost:6379/15`, key theo `run_id` mới | qc |
| Runtime kịch bản (A) | Mở rộng `ScriptRuntime` H1 (`_runtime.ts`, không sửa file khoá — wrapper `tests/acceptance/H2a/_runtime2.ts`): claim cả `workflow.async` (parse `JobPayloadSchema`), giả "Runtime claim" bằng SQL owner: `token_hash = sha256(<token cố định>)`, XADD `job.progress/result/failed` theo kịch bản; trả token cho ca để gọi `/mcp`, credential | qc |
| Mock Dify TS (MK) | `tools/hub-dev/src/dify-mock.ts` `startDifyMock()` trong tiến trình test, kịch bản theo api key (`plan.md` §9): `mk-ok`, `mk-outputs`, `mk-empty`, `mk-failed`, `mk-error-event`, `mk-401/404/400`, `mk-503x<n>`, `mk-slow-<ms>`, `mk-agent`, `LEAK_KEY_*`; `calls()` ghi `path, auth, body, at`; nhận `stop` | backend-lead MK |
| Mock Dify Python | `apps/agent-runtime/tests/support/dify_mock.py` (PY-02): cùng tên kịch bản + hình sự kiện (RT9), kèm `/internal/jobs/{id}/dify-credential` kiểm Bearer ↔ `token_hash` DB | backend-lead PY-02 |
| Mock MCP Python | `tests/support/mcp_mock.py` (PY-06) cho P không cần Hub; S dùng `/mcp` Hub thật | backend-lead PY-06 |
| `fake-cli` (P, S) | chỉ thị `plan-runtime` §6: `#fake:tool=<key>`, `#fake:args=<json>`, `#fake:mcp-list` | backend-lead PY-06 |
| Stack (S) | `tools/hub-dev` (H1 I1) + `hub:dify-mock` :4030 + Runtime `AGENT_RT_PROVIDERS=fake-cli,dify`, `AGENT_RT_HUB_URL=http://localhost:4000`; dùng lại `stack/_stack.ts` (`bootStack`, `kill9`) | backend-lead I1 |
| Env test | `SECRET_MASTER_KEY` test · `HUB_INTERNAL_TOKEN=qc-internal-token-0123456789abcdef0123` · `HUB_PUBLIC_INTERNAL_URL` = base hub test · `HUB_DIFY_TIMEOUT_MAX_S=300` · `AGENT_RT_DIFY_BACKOFF_S=0.2,0.8` · `AGENT_RT_ORPHAN_S=5` (chỉ Runtime) | qc / backend-lead |
| Dify thật · CLI thật | `DIFY_LIVE=1` (I2): **M01–M02** blocked tới W1; M03 (spike PY-S1) chạy ngay sau Gate — checklist cases §3 | người dùng / backend-lead |
| Lock | `tests/acceptance/H2a/**` + file mới trong `apps/agent-runtime/tests/acceptance/`; đề xuất khoá thêm hai mock (Q-T1) | qc |

## 3. Ma trận mã → test

| Mã | Test | Loại |
|---|---|---|
| HUB-FR-10 | A01–A04, R40–R42 | A, R |
| HUB-FR-11 · AC-H01 · HUB-H2a-AC-01 | R01–R14, A10, A11 | R, A |
| HUB-FR-12 | R15–R26, A12, A13 | R, A |
| HUB-FR-13 (sync) · HUB-H2a-AC-02 | A14–A17, A20–A23 | A |
| HUB-FR-13 (async) · WRK-FR-07 | A30–A36, P02–P05, P17 | A, P |
| HUB-FR-14 · AC-H02 | R27–R29, A05–A07 | R, A |
| HUB-FR-23 · HUB-H2a-AC-07 | R55, A40–A44 | R, A |
| HUB-FR-24 (phần `mcp`) | A45, A46, R61 | A, R |
| HUB-FR-50 · WRK-FR-13 · HUB-H2a-AC-05 | R50–R54, A50–A58, P01, P24, P26, P27, S02 | R, A, P, S |
| HUB-FR-51 · HUB-H2a-AC-08 | A70–A75 | A |
| HUB-FR-76 · HUB-H2a-AC-10 | R30–R39 (Hub ∥ Admin), A08 | R, A |
| HUB-FR-80 | A10, A15, A56, A70, P02 | A, P |
| HUB-FR-95 · HUB-BR-20 · AC-H22 | R56–R59, A60–A67, P25, S01 | R, A, P, S |
| HUB-BR-01 · HUB-H2a-AC-09 | R01–R04, A06, A09 | R, A |
| HUB-BR-04 · HUB-H2a-AC-03 | R43–R49, A20–A26, P05, P07–P10 | R, A, P |
| HUB-BR-06 · AC-H05 | A03, A04, A18, A34 | A |
| HUB-BR-11 | A52 (tên tool = key, có `-`) | A |
| HUB-BR-12 | A55 (tool chỉ gọi Dify, `calls()`) | A |
| HUB-BR-19 | R37, A53 | R, A |
| AC-H11 | A02, A07 | A |
| AC-H12 | A54, S02 (vế lời gọi thật); vế Studio → H4 | A, S |
| WRK-FR-06 · HUB-H2a-AC-06 | R-P (cases §1.9), P06–P12 | P |
| AC-W06 | A37–A39 (sweep Hub), P18–P22, S03 | A, P, S |
| HUB-H2a-AC-04 (secret) | R49, A80–A86, P23, P01 | R, A, P |
| HUB-H2a-AC-11 · H2a-R25 | R70–R74, K01–K08 | R, K |
| H2a-R15 (usage) | R47, A15, A44, A56, A71, P02, P22 | A, P |
| H2a-R16 (`context`) | R70, A11, A19 | R, A |
| H2a-R23 (cờ `side_effect`) | A67 | A |
| D1/D2 (grant, RLS, hàm) | A84–A92 | A |
| Seed R14 | A93–A95 | A |

**Không phủ / không test được** (lý do + mốc): cases §4 — vế Studio AC-H12 (H4); HUB-FR-24 `llm`/`python` (H2d); FR-13 "trả ngay `job_id`" (R12: client không đổi, A30); Dify thật + CLI thật gọi MCP (M01–M02, blocked W1; M03 chạy sau Gate); perf §6 không chặn.

## 4. R · Hàm thuần TS (chữ ký `plan-rules.md`)
Bảng ca đủ: cases §1. Nhóm:

| ID | File (`rules/`) | Hàm | Số ca |
|---|---|---|---|
| R01–R14 | `command-parse.test.ts` | `classifyMessage`, `tokenize`, `bindArgs` | 14 |
| R15–R26 | `command-input.test.ts` | `buildInputs`, `appNeedsQuery` | 12 |
| R27–R29 | `suggest.test.ts` | `levenshtein`, `suggestCommands` | 3 (bảng) |
| R30–R39 | `access-parity.test.ts` | `usableCommands` Hub **và** `computeEffectiveAccess(...).visible` Admin trên **cùng** bảng ca (`describe.each([hub, admin])`) + ca so tập | 10 × 2 + 1 |
| R40–R42 | `menu.test.ts` | `toMenuItem` | 3 |
| R43–R49 | `dify.test.ts` | `difyRunUrl/StopUrl/RunBody`, `interpretDifyEvent`, `mapDifyHttpError`, `finalText`, `difyUsage`, `maskSecret`, `difyUser`, `difyAgentInput` | 7 (bảng ~45 dòng) |
| R50–R55 | `mcp.test.ts` | `parseRpc`, `negotiateProtocol`, `toolInputSchema`, `mcpToolsFor`, `validateToolArgs`, `toolTimeoutS` | 6 |
| R56–R59 | `confirm.test.ts` | `isAgreeReply`, `confirmationPrompt`, `confirmationInstruction`, `hashJobToken` (vector = sha256 Python) | 4 |
| R60–R62 | `runner.test.ts` | `buildWorkflowJobPayload`, `mcpConfigFor`, `orphanAction` | 3 |
| R63 | `secret-crypto.test.ts` | `parseMasterKey`/`decryptSecret` giải được vector `encryptSecret` Admin; key/iv sai → ném | 1 |
| R70–R74 | `contracts-h2a.test.ts` | chat chỉ thêm; `hub` union mới; `hub-internal` | 5 |

## 5. A · hub-api int (`tests/acceptance/H2a/`)
File: `commands` (A01–A09) · `command-run` (A10–A19) · `dify-errors` (A20–A26) · `async` (A30–A39) · `dify-agent` (A40–A46) · `mcp` (A50–A58) · `confirm` (A60–A67) · `test-run` (A70–A75) · `secret` (A80–A86, cases §6) · `db` (A87–A92) · `seed` (A93–A95) `.int.test.ts`.

| ID | Mã | Given/When → Then |
|---|---|---|
| A01 | FR-10 | `lan` `GET /commands` → parse `CommandMenuResponseSchema`; đúng tập `{dich, hoi, so}` sắp `name`; không có khoá `workflow*`, `base_url`, `secret`, `input_map`, `api`; `args[].required/has_fallback/rest` đúng cases §7 |
| A02 | AC-H11 | `/tom` (feature không entitlement) không trong menu `lan`; `/tat` (workflow tắt), `/dong` (command tắt) không có; `an` (beta) chỉ thấy lệnh của beta |
| A03 | AC-H05 · BR-06 | `adminChange` tắt command `/dich` → `GET /commands` không còn `dich` trong ≤ 5 000 ms; bật lại → có lại ≤ 5 s; tương tự tắt feature `translate` |
| A04 | AC-H05 | Run `/dich` đang chạy (`mk-slow-300`, 5 chunk) → tắt `/dich` giữa chừng → SSE vẫn tới `run.finished`, nội dung đủ; tin `/dich` mới sau ≤ 5 s → 404 |
| A05 | AC-H02 | `/dihc xin` → 404 `{code:"CMD_NOT_FOUND", details:{suggestions:["dich"]}}`; `counts()` messages/runs/jobs không đổi; ScriptRuntime 0 job; MK `calls()`=0 |
| A06 | BR-01 | `/` và `/ abc` → 404 `suggestions:[]`; `"   /dich en"` (khoảng trắng đầu) → chạy command |
| A07 | R03 | Không tồn tại / không quyền (`/tom`) / tắt (`/dong`) / workflow tắt (`/tat`) → cùng status + body (so byte sau bỏ `request_id`); `/tomm` gợi ý **không** chứa `tom` |
| A08 | FR-76 · AC-10 | Bảng 10 ca fixture R30–R39 dựng trong DB → `GET /commands` của từng user = tập `visible` của `computeEffectiveAccess` Admin chạy trên cùng dữ liệu SQL (đối chiếu int) |
| A09 | AC-09 | `//abc` → luồng H1: job Orchestrator nhận khối `<message>` = `/abc`; `messages.content` = `/abc` (Q14). Menu có `dich` → thu hồi grant → ≤ 5 s → gửi `/dich en` → 404 |
| A10 | AC-H01 · FR-80 | `context.selection="xin chào"`, gửi `/dich en` → MK nhận đúng 1 `POST /v1/workflows/run`: `inputs.source_text="xin chào"`, `target_lang="en"`, `tone="neutral"`, `user="acme:<lan>"`, `response_mode="streaming"`, `Authorization: Bearer mk-ok`; SSE ≥ 5 `delta`, `run.finished.content` = nối `delta` = nối 5 chunk |
| A11 | FR-11 · R16 | `/dich en  hello   world ` → `source_text="hello   world"` (rest nguyên văn, trim hai đầu); `/dich "en" xin` → `target_lang="en"`; tin thường kèm `context` → payload job Orchestrator không chứa `selection` |
| A12 | FR-12 | `/dich` không `lang`, không selection → 422 `CMD_MISSING_ARG{missing:["lang","text"], invalid:[]}`; không message/run |
| A13 | FR-12 | `/so abc maybe` → 422 `invalid:["n","flag"]`; `/dich xx a` (select ∉ options) → `invalid:["lang"]`; `/hoi` (chat, thiếu `query`) → `missing:["q"]` |
| A14 | AC-02 | `mk-outputs` (không chunk) → `delta` từ `outputs[output.field]`; `output.field` null → khoá `text` |
| A15 | AC-02 · R15 | 1 dòng `usage_logs`: `billing='dify'`, `provider_key='dify'`, `model NULL`, `input_tokens`=`total_tokens` mock, `output_tokens=0`, `cost_usd`=`total_price` (USD) / 0 (`currency=RMB`), `latency_ms>0`, `feature_id` = `translate` (`lan`) / `aaa-dup` (`hoa`, Q4) |
| A16 | R08 | `runs.kind='command'`, `command_id`, `feature_id`; `run_steps` 1 bước `type='workflow'`, `workflow_id`, nhãn "Đang chạy lệnh" (vi) / "Running command" (`locale=en`); không tên workflow/node trong SSE `step.*` |
| A17 | R09 | `mk-agent`/`hoi` (chat) → `POST /v1/chat-messages` có `query`; `agent_message.answer` → `delta`; chunk 95 ký tự → các `delta` ≤ 40 |
| A18 | BR-06 | Run `/dich` (`mk-slow`) → giữa chừng đổi `input_map`/`workflow.description`/tắt workflow → run hiện tại xong với inputs cũ (MK nhận inputs cũ) |
| A19 | R16 | `context` sai (`page_url` không `http`, `selection` 16 001) → 400 `VALIDATION_ERROR`; `context` + thừa khoá → 400 |
| A20 | AC-03 | `mk-401` → `run.failed{code:"NOT_CONFIGURED"}`; `mk-404` → `NOT_CONFIGURED`; `mk-400` → `UPSTREAM_ERROR`; `message` = câu `runErrorText` H1, không chứa thân lỗi mock |
| A21 | AC-03 | `mk-503x1` → `UPSTREAM_ERROR`, MK `calls()` = **1** (sync không retry) |
| A22 | AC-03 · BR-04 | `mk-failed` (HTTP 200 + `status=failed`) → `UPSTREAM_ERROR`; `mk-error-event` → `UPSTREAM_ERROR`; `mk-empty` → `UPSTREAM_ERROR` (không `run.finished` rỗng) |
| A23 | AC-03 · R10 | `timeout_s=1` + `mk-slow-800` → `run.failed TIMEOUT`; MK nhận `POST …/tasks/<task_id>/stop` với `task_id` của stream ≤ 3 s sau |
| A24 | AC-03 · FR-43 | `mk-slow-500` → `POST /runs/:id/cancel` → `run.failed CANCELLED` ≤ 5 000 ms + MK nhận stop; app chat → stop `/chat-messages/:id/stop` |
| A25 | R11 | Secret không có (`workflow_secret` 0 dòng) / ciphertext hỏng → `NOT_CONFIGURED`, MK 0 lời gọi; log có `secret_decrypt_failed` + `workflow_id`, không bản mã/key |
| A26 | R11 | Thân lỗi mock chứa key → `run_steps.detail.upstream` ≤ 300 ký tự, key → `***` |
| A30 | FR-13 async | `/dich` `mode=async` → 1 hàng `jobs` `type='workflow.async'`, `provider_key='dify'`, `agent_id NULL`, payload parse `WorkflowAsyncJobSchema`; **không** khoá `api_key/base_url/token/job_token`, không chuỗi `mk-`/`LEAK_KEY_`; `dify_user="acme:<lan>"`, `side_effect=false`, `timeout_s`=`commands.timeout_s`; SSE như sync (client không đổi) |
| A31 | R12 | ScriptRuntime XADD `job.progress` ×3 → SSE có đúng 1 cặp `step.started`/`step.finished` (step `workflow`, P13), không `job.progress`, không sự kiện ngoài `CHAT_EVENT_NAMES`; `job.result{text}` → `delta` ≤ 40 + `run.finished` |
| A32 | R12 | `job.failed{code:UPSTREAM_ERROR}` → `run.failed UPSTREAM_ERROR`; `NOT_CONFIGURED` → `NOT_CONFIGURED` |
| A33 | R12 | Provider `dify` `enabled=false` → `run.failed NOT_CONFIGURED`, 0 job |
| A34 | R13 · P10 | Hạn run giữ qua requeue: `timeout_s=3`, ScriptRuntime claim → giả requeue (SQL) → claim lại → không trả kết quả → ≤ 3 s + biên: `run.failed TIMEOUT`, `jobs.cancel_requested_at` đặt + NOTIFY `job_cancel`; `job.started` lặp không làm hỏng SSE |
| A35 | R12 | Hết hạn `queued` tính từ `queued_at` (không `created_at`): job `created_at` cũ, `queued_at` mới → chưa hết hạn |
| A36 | E15 | Cancel run async → `cancel_requested_at` + NOTIFY; ScriptRuntime XADD `job.failed CANCELLED` → `run.failed CANCELLED` ≤ 5 s |
| A37 | AC-W06 (Hub sweep) | Job `workflow.async` `running`, `heartbeat_at = now() - 61 s` (Hub hằng 60 s), `attempts=1` → sweep Hub → `queued`, `token_hash/dispatched_at/worker_id NULL`, `queued_at` mới, NOTIFY `job_enqueued{provider_key:"dify"}`, **không** XADD `job.failed` |
| A38 | Q6 | Như A37 với `side_effect=true` ∧ `dispatched_at` đặt → `failed` `orphaned` (H1); `attempts=3` → `failed`; `cancel_requested_at` đặt → không requeue |
| A39 | H1 hồi quy | Job `agent.cli` mồ côi → vẫn `failed orphaned` (HUB-H1-AC-04 không đổi) |
| A50 | AC-05 | `/mcp` không header / `Bearer` sai / token đúng hình nhưng không có hash → 401 body rỗng + `WWW-Authenticate: Bearer`; GET/DELETE `/mcp` → 405 |
| A51 | AC-05 · WRK-FR-13 | Token của job đã `succeeded`/`cancelled`/`queued` → 401 (hết hạn khi job kết thúc); token job `workflow.async` → 401 ở `/mcp` |
| A52 | FR-50 · BR-11 | `initialize` (`2025-11-25` → giữ; `2025-06-18` → giữ; `1999-01-01` → `2026-07-28`), `server/discover` có `supportedVersions`; `id` chuỗi được trả nguyên; mọi result có `resultType === "complete"`, `tools/list` có `ttlMs` số + `cacheScope === "private"` (spike S1); `tools/list` (token job `hoadon`) = `[check-invoice]`, `description` = mô tả workflow, `inputSchema` JSON Schema có mô tả từng tham số (`properties.x.description === "Mã hoá đơn"`) |
| A53 | AC-05 · BR-19 | Token job `trello` → `tools/call check-invoice` → JSON-RPC `-32602` "Unknown tool" (không lộ lý do), MK 0 lời gọi; user của job **không** có feature chứa workflow → vẫn gọi được tool của mình (BR-19) |
| A54 | AC-H12 | Sửa `workflows.description` (adminChange) → job **mới** `tools/list` thấy mô tả mới ≤ 5 000 ms |
| A55 | FR-50 · BR-12 | `tools/call check-invoice {x, y}`, secret `S` = `LEAK_KEY_a550f1e2d3c4b5a6978899a` (cases §7), `x = "a".repeat(190) + S`, `y = "b".repeat(250)` → MK nhận đúng 1 lời gọi `user="acme:<lan>"`, response `{content:[{type:"text"}], isError:false}`; `run_steps` `type='tool'`, `workflow_id`, `detail.inputs` qua `maskInputs` (che trước, cắt ≤ 200 sau): `detail.inputs.x === "a".repeat(190) + "***"` (che trước; cắt trước sẽ để lộ mảnh `S`), `detail.inputs.y === "b".repeat(200)`; `detail` không chứa `LEAK_KEY`; không SSE live (P12) |
| A56 | R20 | Tham số sai → `isError` "Invalid arguments for this tool."; `mk-401` → "This tool is not configured."; `mk-failed` → "The tool's service returned an error."; usage 1 dòng `feature_id NULL` |
| A57 | AC-05 · tenant | Token job tenant `beta` không thấy/ghi run/flow/`tool_confirmations` của `acme` (xác nhận `confirmed` của acme giữ nguyên; `run_steps` chỉ ghi vào run beta) |
| A58 | R20 | Timeout tool = min(`agents.timeout_s`, 300): `agents.timeout_s=10` (CHECK 10–3600) + `mk-slow-3000` → "The tool took too long to respond." + stop |
| A60 | AC-H22 · BR-20 | Token job `trello` (run R1, flow F) `tools/call create-trello-card` → `isError:true`, `content[0].text` parse = `ToolConfirmationRequiredSchema` (`choices:["Đồng ý","Huỷ"]`, câu vi `plan-errors` §5), `content[1].text` = câu chỉ dẫn, `structuredContent` cùng object; MK **0** lời gọi; `tool_confirmations` 1 `pending`; `run_steps` `tool` `failed` `detail.code="CONFIRMATION_REQUIRED"` |
| A61 | AC-H22 | E12 "Đồng ý" trong F → run R2, xác nhận `confirmed`, `decided_run_id=R2`; job R2 gọi tool → MK đúng **1**; gọi lần 2 → lại `CONFIRMATION_REQUIRED`, MK vẫn 1; trace R2 có `confirmed`, `consumed` |
| A62 | R22 | "  agree " (en) → `confirmed`; "Huỷ"/"ok"/`/dich…` → `declined`, gọi → `CONFIRMATION_REQUIRED` mới |
| A63 | R22 | `confirmed` nhưng R2 không gọi; R3 trong F → `expired`; R3 gọi → `CONFIRMATION_REQUIRED` |
| A64 | R22 nguyên tử | `confirmed` → 5 `tools/call` song song → MK đúng 1; 4 còn lại `CONFIRMATION_REQUIRED` |
| A65 | R21 | Xác nhận flow F không dùng được cho flow G, agent khác, workflow khác |
| A66 | R21 | `locale=en` → `["Agree","Cancel"]` + câu en |
| A67 | R23 | Không cột `admin.workflows.side_effect` → `workflow_flags` quyết; có cột (thêm bằng SQL owner rồi reload) → cột thắng |

## 6. P · Python · S · K
P01–P30, S01–S03: [cases §5](test-plan-cases.md) (bảng ca P30: [`test-plan-py.md`](test-plan-py.md)); K01–K08: cases §2. Secret A80–A86 (+A83b), agent `dify-*` A40–A46, test-run A70–A75, DB/seed A87–A95: cases §6. Catalog fixture `_h2a.ts`: cases §7.

## 7. Lệnh

### 7.1 Xong mốc H2a — script `bun run done:h2a` (`tools/scripts/src/done-h2a.ts`, mẫu `done-h1.ts`), tuần tự, DB h1 không song song
```
bunx turbo run typecheck --filter=@ai/hub-api --filter=@ai/contracts --filter=@ai/db --filter=@ai/hub-dev --filter=@ai/chat-web --filter=@ai/mocks
bun test packages/contracts packages/db tools/hub-dev apps/admin-api/src/modules/access tests/acceptance/C1 \
  tests/acceptance/H1/rules tests/acceptance/H2a/rules
bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 \
  tests/acceptance/H1/ tests/acceptance/H2a/ tests/acceptance/M tests/acceptance/ADM-NFR-06     # H1+H2a int (DB h1) + khoá Admin M1–M4
bun run contracts:check
(cd apps/agent-runtime && uv sync --frozen && uv run ruff check . && uv run ruff format --check . && uv run pyright \
  && uv run lint-imports && uv run pytest && uv run pytest -m int)                           # WSL2
bun run test:h1:stack && bun run test:h2a:stack                                              # tools/hub-dev + hub:dify-mock
HUB_URL=http://localhost:4000 AUTH_URL=http://localhost:3001 CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat   # 41 ca, HUB-H2a-AC-11
bun run test:lock:verify && bun run trace --check && bun run check:size --all \
  && bunx depcruise apps/hub-api packages/contracts/src/hub packages/contracts/src/hub-internal packages/db tools/hub-dev
```
Kế thừa `done:h1` (mọi bước của nó nằm trong danh sách trên) + `H2a/` + khoá C1/M2/M3. Chạy riêng, chỉ báo cáo: `tsc -p tsconfig.tests.json`, `bun run test:perf tests/acceptance/H2a`. `test:h2a:stack` = `test:h1:stack` với `tests/acceptance/H2a/stack` (thêm vào `pathIgnorePatterns` như H1).

### 7.2 Thủ công / blocked: Dify thật (`DIFY_LIVE=1`), `claude-sub` + MCP (`HUB_LIVE=1`), spike PY-S1 (M03, không blocked) — checklist cases §3.

## 8. Ước lượng và nhóm WRITE (sau Gate)

| Nhóm | File | Số ca (≈) | Phải đỏ đúng lý do vì |
|---|---|---|---|
| QW-R | 11 file `rules/` | 78 (R30–R39 chạy ×2) | stub `plan-rules.md` ném (B0); R parity: nhánh Admin **xanh**, nhánh Hub đỏ (ghi §10) |
| QW-A1 (cao) | `commands`, `command-run`, `dify-errors`, `secret`, `db` | A01–A26, A80–A92 (+A83b) = 40 | route 404 / `expect`; fixture catalog + secret SQL phải xanh; A84/A85 có thể **xanh** trước code (chấp nhận, ghi §10) |
| QW-A2 (cao) | `async`, `dify-agent`, `mcp`, `confirm`, `test-run`, `seed` | A30–A75, A93–A95 = 43 | như QW-A1 |
| QW-PU | `test_dify_rules.py` (P28–P30, unit) — viết sau C2, **trước PY-01** | 3 | `ModuleNotFoundError`/import hàm chưa có (`ErrKind`, `RetryFlags`, `retry_delay`, `map_failure`, `usage_row`, `reduce`, `parse_confirmation`: chữ ký `plan-runtime §3.1`) |
| QW-P | 5 file Python int | 27 | `ModuleNotFoundError` trong thân test / chờ trạng thái hết hạn; DB/Redis/mock phải xanh |
| QW-S | 3 `.stack.test.ts` | 3 | stack/`expect` |
| K | có sẵn | 41 contract chat + C1 + M2/M3/H1 | chạy lại, không viết mới |
| perf | 1 | 3 | không chặn |

Tổng mới ≈ **197** ca (R 78, A 83, P 30, S 3, perf 3) + K + M (3 checklist blocked). Theo nhóm: quyền 22, MCP/`side_effect` ~40, lỗi/huỷ/retry ~35, secret ~12.

## 9. Rủi ro test · câu hỏi (mặc định dùng nếu không trả lời)

| # | Rủi ro / câu hỏi | Mặc định |
|---|---|---|
| Q-T1 | Hai mock (MK TS, `dify_mock.py`, `mcp_mock.py`) do backend-lead viết, ngoài `tests/acceptance` → agent code có thể sửa mock cho xanh | Sau QW, qc thêm 3 file vào danh sách khoá (`LOCKED_DIRS`/`tests/.lock`); sửa mock = tranh chấp test. **Q2 xong**: `tools/hub-dev/src/dify-mock.ts` đã vào `LOCKED_DIRS` + `tests/.lock`; **Q3 xong**: `apps/agent-runtime/tests/support/dify_mock.py` + `test_dify_mock.py` vào `LOCKED_DIRS` + `tests/.lock`; `mcp_mock.py` sau PY-06 |
| Q-T2 | R import tĩnh `*.rules.ts` chưa có | Như H1 Q-T2: B0 tạo stub chữ ký (thân `throw`) trước QW |
| Q-T3 | BA HUB-BR-11 regex tên tool ≠ plan | **Đóng**: đã sửa bởi CR-035; A52 theo plan (tên = key, có `-`) |
| Q-T4 | Test-run secret thiếu: 409 (`plan-errors` §1) hay 200 `ok:false NOT_CONFIGURED` | 409 `NOT_CONFIGURED` trước khi gọi Dify; lỗi **từ** Dify (401) → 200 `ok:false` |
| Q-T5 | AC-W06 "> 60 s" không chờ thật | Hub: A37 lùi `heartbeat_at` 61 s (hằng 60); Runtime: `AGENT_RT_ORPHAN_S=5`; mặc định 60 kiểm unit (P28) |
| Q-T6 | Đo "≤ 5 s" (AC-H05, H12, huỷ) có thể chập chờn trên Windows | Poll 100 ms, ngưỡng `≤ 5 000 ms` từ lúc NOTIFY; ghi thời gian đo vào tên lỗi |
| Q-T7 | Admin `computeEffectiveAccess` đổi chữ ký khi combine | R30–R39 import Admin trực tiếp; vỡ → tranh chấp, không sửa Admin |
| Q-T8 | A60–A66 giả claim bằng SQL (token cố định) thay vì Runtime thật | Chấp nhận (hộp đen Hub); đường Runtime thật phủ ở S01, S02, P24 |
| Q-T9 | Ngoặc kép không đóng; `rest` bắt đầu bằng token có ngoặc | Không đóng → tới hết chuỗi là một token; `rest` nguyên văn (giữ ngoặc) — cases R07, R09 |
| Q-T10 | Tách token theo khoảng trắng nào | Chỉ khoảng trắng ASCII; U+00A0 không tách |
| R-WIN | P/S không chạy trên Windows | P qua `wsl.exe`; S ở I1 trên WSL2 |

## 10. Đỏ đúng lý do
Chưa chạy (chưa viết test). Sau QW: bảng `ID · ca đỏ đúng lý do / tổng · ca xanh trước code (lý do)` ghi ở đây.

### QW-R · `tests/acceptance/H2a/rules/` (2026-10-05, trên B0 `6962fbf`)
`bun test tests/acceptance/H2a/rules`: **79 ca / 11 file** (+ helper `_catalog.ts`) · **62 đỏ** — cả 62 đỏ ở `Error: not implemented: <hàm>(…)` của stub B0 (0 lỗi import/cú pháp/dựng dữ liệu) · **17 xanh trước code** (có lý do). `tsc -p tsconfig.tests.json`, biome, `check:size` sạch.

| File | ID | Đỏ đúng lý do / tổng | Xanh trước code (lý do) |
|---|---|---|---|
| `command-parse` | R01–R14 | 14/14 | — |
| `command-input` | R15–R26 | 12/12 | — |
| `suggest` | R27–R29 | 3/3 | — |
| `access-parity` | R30–R39 ×2 + so tập | 11/21 (nhánh Hub 10 + so tập R39) | 10 — nhánh Admin `computeEffectiveAccess` (chuẩn tham chiếu, đúng thiết kế) |
| `menu` | R40–R42 | 3/3 | — |
| `dify` | R43–R49 (+`maskInputs` trong R49) | 7/7 | — |
| `mcp` | R50–R55 | 6/6 | — |
| `confirm` | R56–R59 | 3/4 | R59 — `lib/job-token.ts` B0 đã làm thật (không phải stub) |
| `runner` | R60–R62 | 3/3 | — |
| `secret-crypto` | R63 | 0/1 | R63 — `lib/secret-crypto.ts` B0 đã chép thật (P6) |
| `contracts-h2a` | R70–R74 | 0/5 | R70–R74 — contract C1/C2 đã có (`fc19f86`, `f753471`) |

Ghi chú: R36 theo spec H2a-R02 + M3-R11 (`core` hiệu lực **không cần grant**), khác câu chữ cases §1.4 ("`core` không grant → không") — nhánh Admin xanh xác nhận; sửa cases khi khoá Q2. R61 giả định tham số `url` của `mcpConfigFor` là URL `/mcp` đầy đủ (Hub dựng `<HUB_PUBLIC_INTERNAL_URL>/mcp` trước khi gọi). Kiểm chéo: 29 ca `command-parse`/`command-input`/`suggest` xanh trên một bản cài tham chiếu tạm (đã xoá) — kỳ vọng nhất quán.

### QW-A1 · `tests/acceptance/H2a/{commands,command-run,dify-errors,secret,db}.int.test.ts` (2026-10-05, trên `6a8562d`)
`bun --env-file=.env.local --env-file=.env.test-h2a_qwa1.local --config=bunfig.int.toml test --timeout 30000 <5 file>` (DB riêng `ai_system_h2a_qwa1_test`): **40 ID / 44 ca** (A08 ×4 biến thể, A89 + A89b) · **36 đỏ đúng lý do** · **8 xanh trước code** (có lý do). Không đỏ nào do fixture/import: catalog §7 + secret mã bằng `encryptSecret` Admin + agent H2a + job SQL (payload qua `JobPayloadSchema`) đều chèn được. `tsc -p tsconfig.tests.json`, biome, `check:size` sạch. Helper: `_h2a.ts` (catalog, proxy Dify, `startHubH2a`, `adminVisible`, `leakForms`, `dumpRun`), `_runtime2.ts` (`ScriptRuntime2.claimAsync` có token, `insertSqlJob`, `credential`, `mcp`) — QW-A2 dùng lại.

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `commands` | A01–A09 | 12/12 | `GET /commands` 404; `/lệnh` vẫn đi luồng H1 (200 SSE thay vì 404/422, MK 0 lời gọi); `//abc` tới Orchestrator còn `//abc` | — |
| `command-run` | A10–A19 | 9/10 | MK 0 lời gọi / `run.kind='orchestrated'` / không `usage_logs` / không 422 | A19 — `context` sai đã 400 nhờ `SendMessageRequestSchema` C1 |
| `dify-errors` | A20–A26 | 7/7 | MK 0 lời gọi; `run.failed` = `ALL_PROVIDERS_EXHAUSTED` (luồng H1) thay vì mã Dify | — |
| `secret` | A80–A86, A83b | 6/8 | Hub không tạo job `workflow.async`; `/internal/jobs/:id/dify-credential` 404 | A84, A85 — DB thuần, D2 đã có (test-plan §8 chấp nhận) |
| `db` | A87–A92 | 2/7 | A89b: `jobs_error_code_check`/`jobs_error_reason_check` chưa nhận `NOT_CONFIGURED`/`credential`/`upstream` (**lệch D1**, xem dưới); A92 `/mcp` 404 | A87, A88, A89, A90, A91 — CHECK/RLS/unique của D1 đã có |

Lệch plan / cần backend-lead:
- **D1 thiếu CHECK `hub.jobs`** (A89b đỏ ở DB): `jobs_error_code_check` chưa có `NOT_CONFIGURED`, `jobs_error_reason_check` chưa có `credential`, `upstream` — trong khi C2 đã thêm vào `HUB_JOB_ERROR_CODES`/`JOB_FAIL_REASONS` (plan §2.2, `plan-errors` §2). `plan-db` §1.1 không liệt kê đổi hai CHECK này ⇒ Runtime ghi `failed NOT_CONFIGURED` sẽ 23514. Cần migration mới (không sửa `0002`).
- **Seam deps H2a** (`createApp` không đọc env, như H1): test truyền thêm `secretMasterKey`, `internalToken`, `publicInternalUrl`, `difyTimeoutMaxS` (tuỳ chọn) + H1 `jobMaxWaitS: 5`.
- **App-key ngắn không lưu được**: CHECK `admin.secrets.ciphertext` ≥ 24 byte ⇒ `mk-ok`, `mk-401/404/400` (< 8 ký tự) không chèn được. `_h2a.ts` lưu `<kịch bản>~pad` và đặt proxy trước MK bỏ hậu tố (MK vẫn ghi `calls()` với key gốc). Đề xuất MK nhận tiền tố khi khoá Q-T1.
- **MK không có kịch bản "thân lỗi chứa key"** (A26, A80) và RMB/chunk 95 ký tự (A15 vế RMB, A17 vế 95 ký tự): proxy trả 400 chứa key cho `LEAK_KEY_ECHO…`; vế RMB và chunk dài để cho R47 / R-unit.
- A25 "secret không có" không dựng được: `admin.workflows.secret_id` NOT NULL + FK ⇒ `workflow_secret` luôn 1 dòng; thay bằng bản mã hỏng + `key_version` lệch.
- A14 "`output.field` null → khoá `text`": `CommandOutputSchema.field` bắt buộc ⇒ chỉ phủ `field="text"`.

### QW-A2 · `tests/acceptance/H2a/{async,dify-agent,mcp,confirm,test-run,seed}.int.test.ts` (2026-10-05, trên `0e702ef`)
`bun --env-file=.env.local --env-file=.env.test-h2a_qwa2.local --config=bunfig.int.toml test --timeout 30000 <6 file>` (DB riêng `ai_system_h2a_qwa2_test`, 75 s): **43 ID / 52 ca** (A32 ×2, A38 ×3, A62 ×4, A93 ×4 biến thể) · **48 đỏ đúng lý do** · **4 xanh trước code** (có lý do). 0 đỏ do fixture/import/SQL (không `TypeError`/`PostgresError`): catalog §7, agent H2a, job SQL có token (payload qua `JobPayloadSchema`), seed tạm đều dựng được. Tên ca bắt đầu bằng mã (`trace --check` OK — có HUB-FR-23, WRK-FR-06, WRK-FR-13). `tsc -p tsconfig.tests.json`, biome, `check:size` sạch. Helper mới `_h2a2.ts` (`addCommand`, `jobInRun` — job có token chèn vào run Hub tạo, `claimWithToken`, `endSqlRun`, `rpcRaw`/`toolCall`, `expectConfirmation`, câu `plan-errors` §4–5); `_runtime2.ts` chỉ thêm `export` cho `sqlJobPayload`.

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `async` | A30–A39 | 9/13 | Hub chưa tạo job `workflow.async` (`claimAsync` → `expect(row).toBeDefined()` sau 5 s; `/dich-async` vẫn đi luồng H1); A33 `run.failed` = `ALL_PROVIDERS_EXHAUSTED` thay vì `NOT_CONFIGURED`; A37 job async mồ côi bị câu H1 đánh `failed orphaned` thay vì requeue | A38 ×3 (side_effect ∧ dispatched / attempts=3 / cancel_requested → `failed orphaned` = hành vi H1 giữ nguyên), A39 (hồi quy H1 `agent.cli`) |
| `dify-agent` | A40–A46 | 7/7 | Agent `dify-*` chưa có runner: delegate bị bỏ qua → Orchestrator echo (`run.finished` ≠ text Dify, MK 0 lời gọi, không `cli_sessions`/usage `dify`); `agent.cli.mcp` = `null` | — |
| `mcp` | A50–A58 | 9/9 | `/mcp` 404 (không 401/405/JSON-RPC) | — |
| `confirm` | A60–A67 | 11/11 | `/mcp` 404 ⇒ không `CONFIRMATION_REQUIRED`; E12 chưa cập nhật `tool_confirmations` | — |
| `test-run` | A70–A75 | 6/6 | `POST /internal/test-run` 404 | — |
| `seed` | A93–A95 | 6/6 | D3 chưa làm: seed chấp nhận agent `dify-*` sai loại app/không map input/thừa `runtime_options` (không ném, CLI exit 0); `vendor: dify` + `agent_workflows`/`workflow_flags` bị schema từ chối (`SeedValidationError`) | — |

Lệch plan / cần backend-lead:
- **`agents_timeout_s_check` (10–3600)** chặn `agents.timeout_s=1` (A43, A58 theo test-plan): dùng `timeout_s=10` + `mk-slow-3000` (5 chunk × 3 s = 15 s) — A43/A58 mất ~10–13 s mỗi ca.
- ~~**A32** phụ thuộc migration `0004`~~ **Đóng** (Q2, 2026-10-05): `0004_h2a_jobs_checks` (`8f7c9a9`, D1b) đã nới `jobs_error_code_check`/`jobs_error_reason_check` (kiểm trên DB test: có `NOT_CONFIGURED`, `credential`) ⇒ A32 ×2 không còn blocked bởi DB; chạy lại vẫn đỏ đúng lý do (chưa có code: `claimAsync` không thấy job `workflow.async`).
- ~~**`difyAgentInput` với `select`**~~ **Đóng** (điều phối, spec-decisions "WRITE — QW-A2 chốt"): giữ R48 — đếm **mọi** input bắt buộc (kể cả `select`); `dify-dich` ↔ `dich` (2 input bắt buộc) là fixture sai ⇒ đổi sang `dify-tom` ↔ `tom` (một input `source_text` text bắt buộc). R48 (`rules/dify.test.ts`) thêm vế `[text req, number req]`, `[text req, select req]`, `[select req]` → `null`.
- **A94 "bỏ dòng"** hiểu là: agent `dify-*` có `workflow_key` không tồn tại **không** được ghi; dòng `agent_workflows`/`workflow_flags` trỏ workflow lạ bị bỏ; mỗi dòng một cảnh báo chứa key.
- **A56 "usage 1 dòng"**: kiểm trên lời gọi Dify thành công (1 dòng/lời gọi, `feature_id NULL`, `agent_id` = agent của job); `validateToolArgs` với khoá thừa không có trong plan nên không kiểm.
- **A61 trace "confirmed, consumed"**: kiểm chuỗi có trong `run_steps.detail` của R2 (plan-db §3.1 ghi `confirmation` ở bước đầu; `consumed` ở bước `tool`) — plan chưa chốt tên khoá.
- **Job MCP trong run Hub tạo** (A61–A65): job `agent.cli` có token chèn bằng SQL (step `seq` ≥ 100 để không đụng bộ đếm H1); khi P11 xong `insertStep` lấy `max(seq)+1` vẫn đúng.
- **A67** thêm/xoá cột `admin.workflows.side_effect` bằng owner trong DB test (dọn trong `finally`); Hub phải phát hiện cột khi nạp lại catalog (`config_changed`).

### Q2 · chạy lại trước khoá (2026-10-05, trên `0376f94` + sửa fixture QW-A2 chốt)
DB riêng `ai_system_h2a_q2_test` (`.env.test-h2a_q2.local`, Hub/Runtime URL trỏ cùng DB). Fixture: agent `dify-dich` → `dify-tom` (`_h2a.ts` `AG2.difyTom`, `dify-agent.int.test.ts` A40–A44, `secret.int.test.ts` A80 bước dify-* — `tom` mang `LEAK_DICH` trong ca); R48 theo luật đếm mọi input bắt buộc.

| File | Đỏ đúng lý do / tổng | Ghi chú |
|---|---|---|
| `async` | 9/13 | như QW-A2; A32 ×2 đỏ ở `claimAsync` (`toBeDefined`, chưa có code) — không còn phụ thuộc DB |
| `dify-agent` | 7/7 | A40 nhận echo Orchestrator thay vì `MOCK_TEXT` (chưa có runner `dify-*`) |
| `seed` | 6/6 | như QW-A2 |
| `secret` | 6/8 | như QW-A1 (A84, A85 xanh) |
| `db` | 1/7 | **A89b nay xanh** nhờ `0004` (D1b); còn A92 (`/mcp` 404) |
| `rules/dify` | 7/7 | R48 đỏ ở stub `not implemented` |

0 lỗi `PostgresError`/`TypeError` trong dựng dữ liệu. Khoá: `tests/.lock` thêm 26 file `tests/acceptance/H2a/**` + `tools/hub-dev/src/dify-mock.ts` (qua `LOCKED_DIRS`) = +27 dòng, tổng 261 file; `stack/` chưa viết (QW-P, khoá ở Q3).

### QW-PU · `apps/agent-runtime/tests/acceptance/test_dify_rules.py` (2026-10-05, trên `4079190`)
`uv run pytest tests/acceptance/test_dify_rules.py` (container `scripts/run.ts`): **85 ca / 3 nhóm** (P28 31 · P29 19 · P30 35) · **85 đỏ đúng lý do**, 0 xanh trước code, 0 lỗi collect/cú pháp. Import trong thân test (`importlib`, như `test_contracts_hub.py`) để mỗi ca đỏ riêng. ruff check/format, pyright strict, `check:size` sạch; `pytest` toàn bộ: 245 ca cũ xanh.

| Nhóm | Hàm | Đỏ / tổng | Lý do đỏ |
|---|---|---|---|
| P28 | `ErrKind`, `BACKOFF`, `RetryFlags`, `retry_delay` | 29/29 | `ModuleNotFoundError: agent_runtime.runtimes.dify` |
| P28 | `ClaimedJob.token` (+ vector sha256 = `job-token.test.ts`) | 1/1 | `AttributeError: 'ClaimedJob' … 'token'` |
| P28 | `Settings.orphan_s`=60, `dify_backoff_s` (2, 8) / env `0.2,0.8` (Q-T5) | 1/1 | `AttributeError: 'Settings' … 'dify_backoff_s'` |
| P29 | `parse_confirmation` (khối list + `content` str spike S2) | 19/19 | `AttributeError: providers.base … 'parse_confirmation'` |
| P30 | `map_failure` 15 · `usage_row` 7 · `mask` 2 · `reduce` 11 | 35/35 | `ModuleNotFoundError: agent_runtime.runtimes.dify` |

Chốt diễn giải (PY-01 làm theo): `reduce(state, event, data)` — `data` = object JSON nguyên dòng `data:` SSE (`task_id`, `data{text|status|outputs}`, `answer`, `metadata{usage}`), như `dify-mock.ts`; bảng `test-plan-py` ghi tắt. `mask`: thô / base64 chuẩn / hex thường → `***`, cắt ≤ `max_len` sau khi che. `agent_thought` → `Progress`, `agent_message.answer` cộng dồn (§3.5, §3.2). `Confirm.choices` so bằng `list(...)`.

Lệch task: 2 ca P28 nằm ngoài file của PY-01 — `test_p28_settings_defaults_backoff_and_orphan` (`config.py`, PY-02) và `test_p28_job_token_claimed_job_and_vector` (`ClaimedJob.token`, `jobs_sql.py`, PY-03). PY-01 xong = 83/85 xanh (hai ca này xanh ở PY-02/PY-03), hoặc điều phối cho PY-01 thêm hai trường đó.

### Tranh chấp
| # | Test | Phán quyết (qc, 2026-10-05) | Sửa | Kết quả |
|---|---|---|---|---|
| TC-1 (B-B3-9) | H1 A28 `tests/acceptance/H1/runner.int.test.ts` — "tin bắt đầu `/` vẫn đi qua Orchestrator" | **Test sai** (lỗi thời). H1-R05 tự giới hạn "tin bắt đầu `/` coi là text thường **tới H2**"; H2a-R01 (HUB-BR-01, FR-11) đổi: `/xxx` → Command Runner (không tồn tại → 404 `CMD_NOT_FOUND`), `//xxx` → bỏ một `/`, đi Orchestrator. B3 (`794d0ea`) cài đúng H2a. | A28 (giữ id) gửi `//tong-hop hoá đơn tháng 9`; kỳ vọng job Orchestrator, prompt chứa `/tong-hop hoá đơn tháng 9` và **không** chứa `//tong-hop`; tên ca thêm `[H2a-R01]`. `tests/.lock` chỉ cập nhật dòng hash của file này (không `test:lock:write` vì có file QW-P chưa khoá). | DB riêng `ai_system_h2a_a28_test`: `runner.int.test.ts` 9/9 xanh (A28 xanh). `test:lock:verify` chỉ còn `UNLOCKED` các file Python chưa khoá dưới `apps/agent-runtime/tests/acceptance/` (`_dify.py`, `dify_*_int_test.py`, `mcp_int_test.py`). |
| TC-2 (TC-B5-1) | H2a A62 `tests/acceptance/H2a/confirm.int.test.ts` — biến thể trả lời `"/dich en xin chào"` → `declined`, kỳ vọng `dify.runs().length === 0` sau `dify.mock.reset()` | **Test sai** (đếm quá rộng). R22: tin khác "Đồng ý"/"Agree" ⇒ `declined`; điều cần kiểm là workflow side_effect **không** được gọi Dify. Tin trả lời `/dich` là lệnh hợp lệ ⇒ được phép chạy bình thường (R09, driver sync B5 `d686b0e`), lời gọi MK của nó tới bất đồng bộ sau `reset()` ⇒ đếm = 1. Code đúng. | A62 (giữ id) thay `dify.runs().length` bằng `trelloRuns()` = lời gọi MK có input `title` (chỉ `create-trello-card`; `/dich` dùng `source_text`). Chọn lọc thay vì chờ `r.s.terminal()` vì không phụ thuộc thời điểm run lệnh kết thúc. `tests/.lock` chỉ cập nhật dòng hash của file này (tính bằng `hashFile` của `test-lock.ts`). | DB riêng `ai_system_h2a_a62_hub_test`: `confirm.int.test.ts` 11/11 xanh (A62 cả 4 biến thể xanh), lặp 5 lần: 4 xanh, 1 lần lỗi `beforeAll` `tuple concurrently updated` (DDL/GRANT cấp cluster đụng agent khác chạy song song, không liên quan A62). `test:lock:verify` OK. |

### QW-P · `apps/agent-runtime/tests/acceptance/{dify_job,dify_retry,dify_requeue,dify_leak,mcp}_int_test.py` + `tests/acceptance/H2a/stack/*.stack.test.ts` (2026-10-05, trên `3977db1`…`572408a`)
Python: `pytest -m int` (container `scripts/run.ts`, DB riêng `ai_system_h2a_qwp_hub_test` qua `HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL`, `.env.test-h2a_qwp.local`): **27 ID (P01–P27) / 44 ca** · **44 đỏ đúng lý do**, 0 xanh trước code, 0 lỗi collect/`PostgresError`/`TypeError`: job `workflow.async` (payload `WorkflowAsyncJob`), provider `dify`, mock `dify_mock.py` + credential xác thực Bearer bằng DB như Hub đều dựng được trước điểm đỏ. Stack: `bun --env-file=.env.local --env-file=.env.test-h2a_qwp.local test --timeout 300000 tests/acceptance/H2a/stack`: **3 ca (S01–S03) · 3 đỏ đúng lý do**; hub-api thật + Runtime container + MK boot xanh. Helper `_dify.py` (payload, `dify_env`, `QcDifyMock`, quét rò rỉ), `stack/_stack.ts` (`bootStackH2a`, `startHubProcH2a`, `startRuntimeH2a`). ruff check/format, pyright strict, `tsc -p tsconfig.tests.json`, biome, `check:size --all`, `trace --check` sạch; `pytest` mặc định 394 xanh.

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ |
|---|---|---|---|
| `dify_job_int_test.py` | P02–P05, P13–P17 | 17/17 | `ModuleNotFoundError: agent_runtime.runtimes.dispatch` (PY-03, `need_router()` trong `DifyEnv.runtime()`, sau khi job + mock đã dựng) |
| `dify_retry_int_test.py` | P06–P12 | 12/12 | như trên |
| `dify_requeue_int_test.py` | P18–P22 | 6/6 | như trên |
| `dify_leak_int_test.py` | P23 | 2/2 | như trên |
| `mcp_int_test.py` | P01 (agent.cli) | 1/1 | chờ `token_hash` sau claim hết hạn 5 s (`CLAIM_UPDATE` chưa ghi — PY-03) |
| `mcp_int_test.py` | P01 (MCP), P24–P27 | 6/6 | `ModuleNotFoundError: tests.support.mcp_mock` (PY-06) |
| `stack/confirm` | S01 | 1/1 | `ask` không có (`expect(ask?.data?.choices)` = undefined) — fake-cli chưa gọi `/mcp` (PY-06), chưa ép `need_input` (PY-05) |
| `stack/mcp` | S02 | 1/1 | không có file `/tmp/qc-work/.mcp/<job>.json` sau 30 s (PY-04) |
| `stack/requeue` | S03 | 1/1 | Runtime `fake-cli,dify` thoát `runtime.config_invalid AGENT_RT_PROVIDERS: ['dify']` (PY-03) |

Xanh trước code tiềm năng (không xảy ra vì `need_router` chặn trước): P20 `attempts=3` → `failed orphaned` là hành vi quét H1; P26 (tool ngoài `mcp.tools`) là nghĩa H1 — cả hai chỉ đỏ ở import.

Lệch plan / cần backend-lead:
- **S01 vế "Đồng ý → delegate lại" cần thêm cho `fake-cli`** (PY-06): `isAgreeReply` so khớp nguyên câu (R56) nên tin trả lời không mang được `#fake:delegate=…`; Orchestrator giả chỉ đọc khối `<message>` hiện tại ⇒ không thể delegate lại. Đề xuất mặc định (đơn giản nhất): Orchestrator `fake-cli` khi tin hiện tại là câu đồng ý (`isAgreeReply` bản Python) ∧ `history` có tin user trước chứa `#fake:delegate=<a>` → delegate lại `<a>` với task của tin đó. Không có thì S01 không thể xanh.
- **API `mcp_mock.py` do test định** (PY-06 làm theo, docstring `mcp_int_test.py`): `start_mcp_mock(tools: dict[key, mô tả], confirm: dict[key, {question, choices}] | None)` (async CM) → `.url` (URL `/mcp` đầy đủ), `.calls(method=None)` → bản ghi `.method`, `.params`, `.auth`.
- **`dify_mock.py` thiếu kịch bản** (mock khoá ở Q3, không sửa): luồng đứt sau sự kiện đầu (P10), `node_started` có tiêu đề (P17), HTTP 429 (P09, RQ4), thân lỗi chứa key (P23) → `QcDifyMock` (lớp con trong `_dify.py`) thêm key `qc-cut`, `qc-node`, `qc-429`, `LEAK_KEY_ECHO*`; key khác giữ nguyên hành vi mock. Đã tự kiểm 4 kịch bản qua `DifyClient` PY-02 (`read`/`http_4xx`/che key đúng).
- **P06 tiến độ**: gộp 1 `job.progress`/giây (§3.5) có thể nuốt "(1/2)" khi backoff 0.2 s ⇒ tách ca: khoảng thời gian với `0.2,0.8`; thông điệp "(1/2)", "(2/2)" với `AGENT_RT_DIFY_BACKOFF_S=1.2,1.2`.
- **P11 đếm lần thử qua log**: dòng JSON `event="dify.attempt"` có `job_id` (bind_job) và `err_kind="connect"` ×3 (`-dify` §3.4) — PY-03 phải log đúng tên khoá này.
- **P13 credential 5xx**: hiểu "thử lại như hàng kết nối" = tối đa 3 lời gọi credential rồi `NOT_CONFIGURED`/`credential`; 503 một lần rồi 200 → `succeeded` (2 lời gọi).
- **P18**: Runtime B vừa requeue vừa claim ngay nên trạng thái `queued` quan sát qua NOTIFY `job_enqueued{provider_key:"dify"}` + `job.started` ×2 + 2 token Bearer khác nhau + 1 sự kiện kết thúc, không poll `queued`. P20 dựng mồ côi bằng SQL (worker `qc-ghost`, heartbeat −61 s), thêm ca biên `attempts=2` → requeue → `attempts=3` `succeeded`.
- **P24** đường file MCP = `AGENT_RT_WORK_DIR/.mcp/<job_id>.json` (§4.2); P27 kiểm có dòng log mức `warning` chứa `"mcp` (tên sự kiện chưa chốt).
- **Stack**: container tới Hub/MK qua `host.docker.internal` (`--add-host …:host-gateway`); `HUB_PUBLIC_INTERNAL_URL` và `base_url` catalog dùng tên này; bỏ `--rm` của `dockerArgs` để giữ log khi Runtime thoát sớm. S01/S02 Runtime `fake-cli`; S03 `fake-cli,dify`.

### Q3 · khoá lần 2 (2026-10-05, trên `2c8f680`)
`test:lock:verify` trước khi ghi: đúng 12 dòng `UNLOCKED` (10 file QW-P + `tests/support/dify_mock.py`, `tests/support/test_dify_mock.py` thêm vào `LOCKED_DIRS` của `tools/scripts/src/test-lock.ts`), không file khoá nào `CHANGED`/`MISSING`. `test:lock:write` → `tests/.lock` +12 dòng, 0 dòng xoá, tổng 274 file; verify xanh. Sửa hai mock = tranh chấp test (Q-T1). `mcp_mock.py` khoá khi PY-06 xong.
