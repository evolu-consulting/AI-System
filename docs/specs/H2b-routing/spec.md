---
id: H2b-routing
title: Định tuyến mở rộng (`@agent`, `GET /agents`, Orchestrator theo tenant, `max_concurrent_runs`, `delta` từ Runtime) + nợ H1 F3–F7
milestone: H2b
status: draft                  # draft → ready → approved → in-progress → done
requirements:
  [HUB-FR-62, HUB-FR-77, HUB-FR-91, HUB-FR-92, HUB-FR-94, HUB-FR-95,
   HUB-BR-03, HUB-BR-06, HUB-BR-08, HUB-BR-18, HUB-BR-20,
   WRK-FR-03, WRK-FR-15, WRK-FR-17,
   AC-H16, AC-H17, AC-H18, AC-H19, AC-H21, AC-H22]
design:
  - docs/design/agent-hub/ba-agent-hub.md (§3, §5, §6.3 FR-91/92/94/95, FR-62, §7, §8, §9.1, §9.3, §11)
  - docs/design/worker/ba-worker.md (§5.1, §5.2, §7) · docs/design/architecture.md (§1, §5)
  - docs/specs/H1-hub-core/spec.md (H1-R05…R10, R16, R17, R24, R25) · spec-decisions "Kết luận H1" (F3–F7) · smoke-i2.md
  - docs/specs/H2a-dify-command/spec.md (H2a-R01, R04, R07, R09, R14, R21, R22, R25) · spec-decisions "Kết luận H2a"
  - CR-031 (4), CR-032, CR-033, CR-034 (4, 5), CR-036; CR-037 (đề xuất, sửa chữ BA theo spec này)
owner: backend-lead (TS + Python)
---

# H2b · Định tuyến mở rộng + nợ H1

Mốc con thứ hai của H2. Nền: H1 + H2a. Quyết định, câu hỏi: [spec-decisions.md](spec-decisions.md).

## 1. Phạm vi
**Mục tiêu:** user gọi thẳng agent bằng `@agent` (một hoặc nhiều tag), có menu `@`; mỗi tenant có thể có Orchestrator riêng (seed yaml); mỗi user tối đa `max_concurrent_runs` run chạy cùng lúc; câu trả lời dài hiện dần (Runtime phát `delta`); đóng điểm mở F3–F7 của smoke H1.

| # | Làm | Mã |
|---|---|---|
| 1 | Router `@`: tag đơn → run `kind=direct` (bỏ qua Orchestrator); nhiều tag → Orchestrator chỉ chọn trong agent được tag; `@@` = chữ `@`; `AGENT_NOT_FOUND` + ≤ 3 gợi ý; thiếu nội dung → `CMD_MISSING_ARG` | HUB-FR-91, BR-18, AC-H17/18/19 |
| 2 | `GET /agents` (menu `@`) | HUB-FR-92 |
| 3 | Tên agent khi user tự tag (Q1) | HUB-FR-91 (CR-033 sửa một phần CR-022) |
| 4 | Xác nhận tool `side_effect` cả khi `@agent` (đường H2a-R21/R22) | HUB-BR-20, HUB-FR-95, AC-H22 (vế `@`) |
| 5 | Orchestrator mặc định + bản riêng theo tenant (seed yaml), chọn lúc tạo run, chốt vào run | HUB-FR-62, BR-08, AC-H16 (vế runtime) |
| 6 | `max_concurrent_runs` mỗi user → `429 TOO_MANY_RUNS` + `Retry-After` | HUB-FR-94, AC-H21 |
| 7 | Runtime phát `delta` trực tiếp (Claude Agent SDK partial messages; `fake-cli` `#fake:stream`); Hub chuyển tiếp khi chắc là câu trả lời cuối; agent `dify-*` stream chunk Dify khi là câu trả lời cuối | WRK-FR-03 (CR-031 #4), F6 |
| 8 | Nợ H1: F3 fixture `beta-testers` · F4 `is_error` 0 token · F5 job huỷ/timeout ghi usage · F7 `HUB_LIVE` | WRK-FR-15, 17; smoke-i2 |
| 9 | Dọn trước: TD #44 (tách thư mục con module H2b chạm, không đổi hành vi); TD #47 (`fake-cli` delegate lại — cần cho test R12) | TECH-DEBT #44, #47 |

**Không làm (H2b):** API/Studio sửa Orchestrator + vế `tenant_admin` bị từ chối của AC-H16 (H2b không mở endpoint ghi; → **H4**); bộ câu kiểm thử định tuyến (H4); `/agent-grants`, quota, `QUOTA_BLOCKED` (H3); đính kèm (H2c); runtime `llm`/`python`, Gateway, Codex/Gemini (H2d); sửa `apps/chat-web`, Admin, test khoá C1; TD #43 (stop Dify trước `task_id`), #45, #46, #49–#51 (giữ TECH-DEBT).

## 2. Nghiệp vụ
Chỉ phần cụ thể hoá BA; nguồn ở cột cuối. "Agent dùng được" (viết tắt **AU**) = `visibleAgents` H1-R05 trên ảnh hiện hành: `enabled` ∧ runtime chạy được (`agentic-cli`, `dify-workflow`, `dify-agent`) ∧ entitlement chưa thu hồi của tenant ∧ grant (user ∨ group) ∧ **không** là Orchestrator ở bất kỳ phạm vi nào (R15).

### 2.1 Router `@` và gọi thẳng
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2b-R01 | Sau khi bỏ khoảng trắng đầu, thứ tự: `//` / `/` → H2a-R01 (không đổi). Bắt đầu `@@` → bỏ **một** `@`, tin thường qua Orchestrator; tin user lưu đã bỏ một `@`. Bắt đầu `@` → phân tích tag: các token liên tiếp ở đầu tin (tách bằng khoảng trắng) có dạng `@<x>`; dừng ở token đầu tiên không bắt đầu `@`. `<x>` so **không phân biệt hoa thường** với `agents.key`. `@` đứng riêng / `@` + khoảng trắng → `AGENT_NOT_FOUND` không gợi ý. `@` giữa tin không phải tag | HUB-BR-18, FR-91 |
| H2b-R02 | Mọi tag phải thuộc **AU**. Một tag sai (không tồn tại, tắt, không được dùng, là Orchestrator, runtime chưa chạy được) → `AGENT_NOT_FOUND` cho **tag sai đầu tiên**, không xét tag còn lại, không rơi xuống Orchestrator. Mọi lý do cùng một mã | HUB-FR-91, BR-14, 18 |
| H2b-R03 | Gợi ý: như H2a-R04 (Levenshtein, ngưỡng max(2, ⌊len/3⌋), sắp khoảng cách rồi key, ≤ 3) trên key của **AU**; trả key **không** kèm `@`; AU rỗng → `[]` | HUB-FR-91, AC-H18 |
| H2b-R04 | Nội dung = phần sau token tag cuối, bỏ khoảng trắng hai đầu. Rỗng → 422 `CMD_MISSING_ARG` `details={missing:["content"], invalid:[]}` (BA dùng mã này). Tag trùng (không phân biệt hoa thường) gộp một | HUB-FR-91 |
| H2b-R05 | `AGENT_NOT_FOUND` / `CMD_MISSING_ARG` của `@` trả JSON **trước khi tạo run**: không lưu message, không run, không job, không gọi Orchestrator/Dify (như H2a-R07) | HUB-BR-18, AC-H18 |
| H2b-R06 | **Một** agent (sau gộp) → run `kind='direct'`, `runs.agent_id` = agent. Hub chạy agent như **một delegate** của H1/H2a (job `agent.cli` qua `AgentRunner`, hoặc `dify-*` trong Hub — H2a-R14) với `task` = nội dung R04; **không** job/step Orchestrator. Đúng một step `delegate` (nhãn tĩnh như H1-R10). Ảnh cấu hình chốt lúc tạo run (BR-06); resume `cli_sessions` như H1-R23 | HUB-FR-91, BR-06, AC-H17 |
| H2b-R07 | Kết quả run `direct`: `done{text}` → `text` (pass-through); `partial{text,missing}` → `text` + `"\n\n"` + câu tĩnh theo `locale` ("Phần chưa làm được: " / "Not done yet: ") + `missing` (không Orchestrator, BR-04); `need_input` → SSE `ask` như H1-R08. Run `finished` → `flows.agent_id` = agent (cả `need_input`: `pending_ask` như H1). Lỗi job → `run.failed` mã như H1/H2a | HUB-FR-27, 28, 91 |
| H2b-R08 | Tin kế không tag → Orchestrator như H1 (mọi tin trong flow qua Orchestrator — người dùng chốt), gợi ý `last_agent` = `flows.agent_id`, `waiting_for` khi có `pending_ask` (H1-R08) | HUB-FR-91, 28, AC-H17 |
| H2b-R09 | **Nhiều** agent (≥ 2 sau gộp) → run `kind='orchestrated'`; `<agents>` của Orchestrator = các agent được tag (∈ AU), sắp `key`; message đưa Orchestrator = nội dung R04 (không có tag). Mọi delegate kiểm `canDelegate` trên **danh sách thu hẹp** → agent ngoài danh sách = step `skipped(not_allowed)` (H1-R06). Danh sách tag ghi vào trace của run. Tin kế không tag dùng lại danh sách đầy đủ | HUB-FR-91, AC-H19 |
| H2b-R10 | Tên hiển thị (theo Q1, mặc định **B**): run `direct` → Hub gửi `responder={key, name}` (`name` = `agents.name[locale của run]`, chốt lúc tạo run) trong `run.started` và trong message assistant của run đó (E11, `preview` E10). Run `orchestrated` (kể cả nhiều tag, kể cả pass-through) và `command` → **không** có trường này (client hiện "Consultant"). Không bao giờ khoá `agent`/`provider`/`model`/`usage` | HUB-FR-91, CR-033, CHAT-AC-30 |

### 2.2 Menu `@` và `side_effect`
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2b-R11 | `GET /agents` (JWT) = AU của user, sắp `key`: `key`, `name{vi,en}`, `description` (mô tả cho Orchestrator, 20–400 ký tự, BR-09). Không system prompt, runtime, profile, workflow, cấu hình. Đọc cache (0 query). Thu hồi/tắt ở Admin/seed → biến khỏi menu ≤ 5 s; gửi tag sau khi bị thu hồi → `AGENT_NOT_FOUND` (kiểm lại lúc gửi) | HUB-FR-92, 77 |
| H2b-R12 | `side_effect` qua `@`: không đổi H2a-R21/R22 — MCP từ chối tool `side_effect` khi flow chưa có xác nhận `confirmed` cho đúng (flow, agent, workflow); run `direct` trả `need_input` → `ask`. Tin kế: nếu là `@` một tag thì so "Đồng ý"/"Agree" trên **nội dung R04**; xác nhận `pending` của agent X chỉ `confirmed` khi tin kế **không tag** hoặc **tag đơn đúng X**; tag khác / nhiều tag → `declined`. Lượt dùng xác nhận được gọi tool đúng một lần (tiêu thụ nguyên tử H2a-R22) | HUB-BR-20, FR-95, AC-H22 |

### 2.3 Orchestrator theo tenant
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2b-R13 | Seed yaml (`agents.yaml`): `orchestrator:` = bản **mặc định** (bắt buộc, như H1). Thêm `orchestrator_tenants:` — danh sách `{tenant_key, agent, max_steps?, token_budget?, history_n?, on_no_match?}` (trường thiếu → giá trị của bản mặc định trong cùng yaml) hoặc `{tenant_key, remove: true}` (xoá bản riêng). Upsert theo `tenant_key`; bản không nhắc trong yaml **giữ nguyên** (H1-R16). Tenant không tồn tại → bỏ + cảnh báo (H1 Q8). Agent không tồn tại / tắt / runtime khác `agentic-cli` (H2b) / không có profile → **lỗi seed**, không ghi dở. `tenant_key` trùng trong yaml → lỗi seed | HUB-FR-62, CR-032, H1-R16 |
| H2b-R14 | Chọn lúc tạo run (`orchestrated`): bản riêng của `tenant_id` của run nếu có **và** hợp lệ trên ảnh hiện hành (agent tồn tại, bật); không → bản mặc định. Bản riêng không hợp lệ lúc chạy → dùng mặc định + log cảnh báo `orchestrator_tenant_invalid` (không chặn user). Run ghi `runs.orchestrator_tenant_id` (null = mặc định); cài đặt (agent, `max_steps`, `token_budget`, `history_n`, `on_no_match`) chốt trong ảnh của run — seed lại giữa chừng không ảnh hưởng run đang chạy. | HUB-FR-62, BR-06, 08, AC-H16 |
| H2b-R15 | Khởi động: chỉ bản **mặc định** bắt buộc hợp lệ (H1-R17, BR-08). Agent đang là Orchestrator của **bất kỳ** phạm vi nào (mặc định hoặc tenant nào) không vào `<agents>`, `GET /agents`, không tag được | HUB-BR-03, 08, FR-62 |

### 2.4 Giới hạn run đồng thời
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2b-R16 | `max_concurrent_runs` = env `HUB_MAX_CONCURRENT_RUNS` (mặc định 2, nguyên 1–20; sai → hub-api không lên). Đếm `runs.status='running'` của `(tenant_id, user_id)`, **mọi** `kind` (`orchestrated`, `direct`, `command` sync/async). Run đã `ask` là `finished` → không tính. `/internal/test-run` không tạo run → không tính | HUB-FR-94 |
| H2b-R17 | Kiểm trong **cùng transaction** tạo run, nguyên tử với INSERT `runs` (khoá theo user): N POST song song → đúng `max(0, limit − đang chạy)` run, còn lại 429. Đủ ngưỡng → `429 TOO_MANY_RUNS`, header `Retry-After: 5`, body `ErrorResponse`; không lưu message, không run | HUB-FR-94, AC-H21 |
| H2b-R18 | Thứ tự kiểm E12: auth (401) → hội thoại/path (404) → body (400) → router: `CMD_*` (H2a), `AGENT_NOT_FOUND`/`CMD_MISSING_ARG` (R02, R04) → flow lạ (404) → `FLOW_BUSY` (409) → `TOO_MANY_RUNS` (429) → tạo run. `FLOW_BUSY` thắng `TOO_MANY_RUNS` khi cả hai đúng | HUB-FR-94, H1-R11, H2a-R07 |

### 2.5 `delta` từ Runtime (WRK-FR-03 phần H2, F6)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2b-R19 | Hub đặt `payload.stream=true` cho job **có thể** là câu trả lời cuối: mọi job Orchestrator; job agent của run `direct`; job agent là **delegate đầu tiên** của run `orchestrated` (có thể pass-through, H1-R08). Còn lại `false` (Runtime không phát) | WRK-FR-03, HUB-FR-29 |
| H2b-R20 | Runtime (`stream=true`) phát sự kiện mới `job.delta{text, kind}` vào `run:<run_id>`; `kind` cố định cho cả job, xác định **trước** khi phát chữ: Orchestrator — JSON quyết định đã có `"decision":"answer"` **trước** khoá `text` → `answer`; agent (`StructuredOutput`) — `status` ∈ {`done`,`partial`} **trước** `text` → `done`/`partial`. Thứ tự khoá ngược, `ask`, `delegate`, `need_input` → không phát (Hub dùng kết quả cuối như H1). Chữ phát = giá trị chuỗi `text` đã giải mã JSON (`\n`, `\uXXXX`, không cắt đôi cặp surrogate) | WRK-FR-03 |
| H2b-R21 | Runtime gom: XADD khi bộ đệm ≥ 200 ký tự hoặc ≥ 100 ms từ lần phát trước (cái nào tới trước), mỗi chunk ≤ 4 000 ký tự. Đã phát ≥ 1 `job.delta` → **không** thử lại JSON hỏng (PY-10) | WRK-FR-03 |
| H2b-R22 | Hub chuyển tiếp `job.delta` sang SSE `delta` **ngay** (trong lúc step còn mở) chỉ khi `kind` hợp vai job: Orchestrator → `answer`; `direct` → `done`/`partial`; delegate đầu tiên → `done`. Khác → bỏ (dùng kết quả cuối). Mỗi chunk cắt thành `delta` ≤ 40 ký tự (giữ H1-R09). Delegate đầu tiên đã được chuyển tiếp → run kết thúc pass-through (Orchestrator không gọi lại) | H1-R08, R09 |
| H2b-R23 | Khi `job.result`: `S` = chữ đã phát, `F` = chữ cuối (với `partial` của `direct`: F theo R07). `F` bắt đầu bằng `S` → phát phần còn lại rồi `run.finished.content = F`. Lệch (không phải tiền tố) hoặc JSON cuối hỏng sau khi đã phát → không phát thêm, `content = S`, trace `delta_mismatch`/`stream_unparsed` (cảnh báo). Job `failed`/`cancelled`/`timed_out` sau khi đã phát → `run.failed` như H1 (bất biến C1: một sự kiện kết thúc; `content` = nối `delta` chỉ áp cho `run.finished`) | C1 §2.5, H1-R09 |
| H2b-R24 | Agent `dify-workflow`/`dify-agent` chạy trong Hub, khi là câu trả lời cuối (R19) → chunk Dify (`text_chunk`/`message`/`agent_message`) thành `delta` ngay như H2a-R09; kết quả luôn `done` | H2a-R09, R14 |
| H2b-R25 | `fake-cli`: chỉ thị `#fake:stream[=<n>]` → phát câu trả lời (`answer` của Orchestrator giả hoặc `text` của agent giả) thành `n` chunk (mặc định 5) cách nhau 50 ms rồi kết quả cuối. Không có chỉ thị → không phát `job.delta` (giữ nguyên hành vi test khoá H1/H2a) | test |

### 2.6 Nợ H1 (smoke-i2 F3–F7)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H2b-R26 | **F3:** fixture `tools/hub-dev` thêm `lan` (acme) vào group `beta-testers` → `lan` dùng được `assistant`; `hoa` giữ ngoài (user không có agent nào, dùng cho ca phủ định). Bộ 41 ca contract chat chạy lại với Hub thật phải xanh | smoke-i2 F3 |
| H2b-R27 | **F4:** `Final.is_error=true` ∧ output token = 0 → phân loại theo ≤ 300 ký tự đầu của chữ result (không phân biệt hoa): khớp mẫu rate/usage limit → như H1-R24 (`quota`, cooldown, `ALL_PROVIDERS_EXHAUSTED`); khớp mẫu đăng nhập/khoá (not logged in, `/login`, invalid api key, 401, 403) → `NOT_CONFIGURED`, reason `credential`, `provider_state=logged_out`; còn lại → `UPSTREAM_ERROR` reason mới `refused`, `hint` = "Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ." / "The request could not be handled — rephrase or split it.". Mẫu ở plan; chữ result chỉ vào trace (đã che). `is_error` có output > 0 → như H1 | WRK-FR-15, BR-04 |
| H2b-R28 | **F5:** Runtime cộng dồn usage theo từng message assistant (sự kiện stream `message_start`/`message_delta`, hoặc `AssistantMessage.usage`). Job kết thúc `cancelled`/`timed_out`/`failed` mà đã có usage > 0 → ghi **1** dòng `usage_logs` (như H1-R25: billing theo provider, `cost_usd=0` với subscription) với token đã cộng dồn; `job.failed.usage` cùng số. Chưa có usage → không ghi (không bịa) | WRK-FR-17, AC-W09 |
| H2b-R29 | **F7:** `HUB_LIVE=1` là cờ bật bộ smoke tự động `bun run test:smoke:live` (Hub thật + Runtime + `claude-sub`; kịch bản §8 HUB-H2b-AC-12); vắng cờ → mọi ca `skip`, exit 0. Không thuộc `done:h2b`. Cập nhật `docs/guides/hub-dev.md` (bỏ câu "không code nào đọc") | smoke-i2 F7 |
| H2b-R30 | Tương thích: tin không bắt đầu `@`/`/` và không dùng trường mới → response/SSE như H2a; `test:contract:chat` 41 ca xanh không sửa; test khoá H1, H2a xanh nguyên văn | H1-R01, H2a-R25 |

## 3. Contract (backend-lead)
- **`@ai/contracts/chat` — sửa thẳng, chỉ thêm** (Q3 H2a): `chat/agents.ts` (`AgentMenuItem{key, name{vi,en}, description}`, `AgentMenuResponse{items}`) · hằng **riêng** `CHAT_ROUTING_ERRORS {AGENT_NOT_FOUND: 404, TOO_MANY_RUNS: 429}` + `AgentNotFoundDetails{suggestions ≤ 3}` + `RETRY_AFTER_HEADER` — **không** thêm vào `CHAT_API_ERRORS`/`CHAT_RUN_ERROR_CODES` (unit `chat/entities.test.ts` đếm mã; `tools/mocks` `Record<ChatErrorCode>`) · theo Q1=B: `ResponderSchema{key, name}` **tuỳ chọn** trong `RunStartedDataSchema` và `MessageSchema` (khoá `responder`, không phải `agent`). Không sự kiện SSE mới. Không đổi/xoá trường cũ.
- **`@ai/contracts/hub`:** `JobDeltaEvent{type:"job.delta", text ≤ 4000, kind: answer|done|partial}` thêm vào `RunEventSchema` · payload `agent.cli` + `stream: boolean` (mặc định false) · `JOB_FAIL_REASONS` + `refused` · `contracts:gen/check` (pydantic).

| Method | Path | Auth | Request → Response | Lỗi (HTTP · code) |
|---|---|---|---|---|
| GET | `/agents` | JWT | — → `AgentMenuResponse` | 401 |
| POST | `/conversations/:id/messages` | JWT chủ hội thoại | `SendMessageRequest` (không đổi) → SSE C1 | như H2a + 404 `AGENT_NOT_FOUND` · 422 `CMD_MISSING_ARG` (tag rỗng) · 429 `TOO_MANY_RUNS` (`Retry-After`) — JSON, trước khi tạo run |

## 4. Dữ liệu (backend-lead)
Migration `migrations-hub/0006_h2b_routing.sql` (SQL ở `plan-db.md`):
- `runs`: CHECK `kind` + `'direct'`; cột `agent_id uuid NULL` (CHECK `(kind='direct') = (agent_id IS NOT NULL)`), `orchestrator_tenant_id uuid NULL`; index một phần `runs(tenant_id, user_id) WHERE status='running'` cho đếm R16.
- `orchestrator_settings`: thêm `tenant_id uuid NULL`, bỏ ràng buộc `id = 1`, duy nhất theo `tenant_id` (đúng một hàng `tenant_id IS NULL`). Hàng mặc định hiện có giữ nguyên.
- Không bảng mới; RLS không đổi (đếm R16 trong phạm vi `user` như transaction tạo run).

## 5. UI
Không có UI Hub. Menu `@`, `AGENT_NOT_FOUND`/`TOO_MANY_RUNS`, tên agent (R10), `delta` khi step còn mở: phiên Chat khi combine (CR-impact ở I3).

## 6. Hiệu năng
| Chỉ tiêu | Ngưỡng | Đo bằng |
|---|---|---|
| `GET /agents` (cache, 0 query) | ≤ 50 ms p95 | `test:perf` (không chặn) |
| Router `@` + kiểm `TOO_MANY_RUNS` thêm vào E12 | ≤ 10 ms p95 | `test:perf` |
| `job.delta` (XADD) → SSE `delta` | ≤ 150 ms | int (dấu thời gian) |
| Delta đầu tiên với `#fake:stream` trước `job.result` | delta đầu tới client trước `run.finished` ≥ 200 ms | acceptance (chặn) |
| Thu hồi agent → biến khỏi `GET /agents` | ≤ 5 s | acceptance (chặn) |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Claude Agent SDK partial messages (`input_json_delta` của `StructuredOutput`) | **Spike PY-S2 đầu mốc**: thứ tự khoá `status`/`decision` trước `text`, usage từng lượt → `spike-stream.md`. Test/CI: `fake-cli` (R25) |
| `claude-sub` thật | Chỉ smoke `HUB_LIVE=1` (R29), không chặn `done:h2b` |
| Dify | Mock Hub H2a (`tools/hub-dev/src/dify-mock.ts`) cho R24 và AC-H22 vế `@` |

Env mới: `HUB_MAX_CONCURRENT_RUNS=2` (test đặt 2) · `HUB_LIVE` (đã có, nay được đọc). Runtime: `AGENT_RT_DELTA_FLUSH_MS=100`, `AGENT_RT_DELTA_FLUSH_CHARS=200`.

## 8. Tiêu chí nghiệm thu (qc)
Nguyên văn AC ở BA `ba-agent-hub` §11.

| AC | Phạm vi H2b | Test |
|---|---|---|
| AC-H16 | Vế runtime: seed bản riêng `acme` (agent `B`, `max_steps=3`) → run của `acme` dùng `B`/3, `runs.orchestrator_tenant_id=acme`; `beta` dùng mặc định; seed `remove: true` → lượt kế dùng mặc định; seed lại giữa run không đổi run đang chạy. Vế `tenant_admin` → H4 | acceptance |
| AC-H17 | Đủ (`assistant`, user `lan`): `kind=direct`, trace chỉ 1 step delegate, 0 job Orchestrator, `flows.agent_id`, `responder` (Q1); tin kế không tag → job Orchestrator nhận `last_agent=assistant` | acceptance |
| AC-H18 | Đủ: agent có nhưng chưa cấp / sai chính tả → 404 `AGENT_NOT_FOUND`, gợi ý chỉ trong AU, 0 run/message/job; `@@abc` → Orchestrator nhận "@abc" | acceptance |
| AC-H19 | Đủ: 2 tag → `<agents>` đúng 2 agent; Orchestrator giả delegate agent thứ ba → `skipped(not_allowed)` | acceptance |
| AC-H21 | Đủ: 2 run `running` (mock chậm) → tin thứ 3: 429 + `Retry-After`, 0 run; một run xong → gửi được | acceptance |
| AC-H22 | Vế `@`: `@trello` + `fake-cli #fake:tool=create-trello-card` → `ask`, Dify 0 lời gọi; "Đồng ý" (không tag) và "@trello Đồng ý" → đúng 1 lời gọi; "@khac Đồng ý" → `declined` | acceptance |

**AC kỹ thuật mới**

| AC | Given / When / Then | Test |
|---|---|---|
| HUB-H2b-AC-01 | Parse tag R01–R04: `@a x`, `@A x`, `@a @b x`, `@a @a x`, `@a`, `@`, `@ x`, `@@x`, `x @a`, `@a /dich`, tag sai vị trí 2 | unit |
| HUB-H2b-AC-02 | `GET /agents`: chỉ AU; không có Orchestrator mặc định lẫn Orchestrator tenant; không trường cấu hình; thu hồi grant → ≤ 5 s biến mất; `hoa` → `items=[]` | acceptance |
| HUB-H2b-AC-03 | 10 POST song song (flow khác nhau, limit 2, 0 đang chạy) → đúng 2 run tạo, 8 × 429; `FLOW_BUSY` thắng 429 | int concurrency |
| HUB-H2b-AC-04 | Orchestrator `#fake:stream=5` answer 300 ký tự → ≥ 1 `delta` trước `step.finished` của step Orchestrator; mọi delta ≤ 40; nối = `run.finished.content` = E11 | acceptance |
| HUB-H2b-AC-05 | Run `direct` agent `#fake:stream` `done` → delta sớm; `partial` → content = text + câu R07; delegate đầu tiên `done` stream → pass-through, 1 job Orchestrator; delegate thứ hai stream → **không** chuyển tiếp | acceptance |
| HUB-H2b-AC-06 | Lệch R23: `F` không bắt đầu bằng `S` → `content = S`, trace `delta_mismatch`; huỷ giữa stream → `run.failed CANCELLED` ≤ 5 s | acceptance |
| HUB-H2b-AC-07 | Python: bộ phân tích JSON tăng dần — khoá ngược thứ tự → không phát; `\n`, `á`, emoji cặp surrogate cắt giữa chunk → giải mã đúng; gom 200 ký tự/100 ms; đã phát → không thử lại JSON | Python unit/int |
| HUB-H2b-AC-08 | F4: ba mẫu chữ result (rate limit / not logged in / từ chối) → `ALL_PROVIDERS_EXHAUSTED` + cooldown / `NOT_CONFIGURED` + `logged_out` / `UPSTREAM_ERROR` hint "diễn đạt lại" | Python int + acceptance |
| HUB-H2b-AC-09 | F5: huỷ job sau 2 lượt có usage → 1 dòng `usage_logs` đúng token cộng dồn; huỷ trước usage → 0 dòng | Python int |
| HUB-H2b-AC-10 | Seed `orchestrator_tenants`: tenant lạ → bỏ + cảnh báo; agent tắt / key trùng → lỗi seed, không ghi dở; bản tenant mất hiệu lực → mặc định + log | int |
| HUB-H2b-AC-11 | Dify agent `@dify-tro-ly` (mock chậm 5 chunk) → delta trước `run.finished`; `responder` có | acceptance |
| HUB-H2b-AC-12 | Smoke `HUB_LIVE=1` (không chặn): `@assistant` câu dài stream; Orchestrator answer dài stream; huỷ giữa chừng có usage | smoke |
| HUB-H2b-AC-13 | Hồi quy: `test:contract:chat` 41 ca (Hub thật, fixture R26) xanh; test khoá H1/H2a xanh nguyên văn; `contracts:check` xanh | contract + CI |

Lệnh xong mốc: `done:h2b` (qc định nghĩa ở `test-plan.md`, mẫu `done:h2a`).

## 9. Câu hỏi mở
Ở [spec-decisions.md](spec-decisions.md) "Câu hỏi cho người dùng" (Q1) và "Mặc định tự chọn" (T1–T18).

## 10. Rủi ro
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| K1 | CLI/SDK không stream `input_json_delta` của `StructuredOutput`, hoặc model đặt `text` trước `status` → agent không stream được | Spike PY-S2 trước; R20 tự lùi về hành vi H1 (không sai, chỉ chậm); ghi kết quả spike |
| K2 | `delta` đến khi step còn mở → Chat có thể hiển thị khác mock | Bất biến C1 §2.5 không cấm; CR-impact Chat; e2e ở combine |
| K3 | Đếm `TOO_MANY_RUNS` khoá theo user thêm vào transaction tạo run (thứ tự khoá §3.5 H1) → nguy cơ deadlock | Khoá user **đầu tiên**, advisory xact; int concurrency (AC-03) + `lock-order` |
| K4 | F3: `lan` thấy `assistant` → contract chat có thể đổi | `fake-cli` chỉ delegate khi có `#fake:delegate`; AC-13 đỏ → hard stop |
| K5 | Mẫu chữ F4 lệch thực tế | Mẫu một chỗ (plan), smoke `HUB_LIVE`; lệch → `UPSTREAM_ERROR` như H1 |
| K6 | `host_proc.py` (312 dòng) gần trần | Bộ phân tích tăng dần ở module riêng |
| K7 | `responder` (Q1=B) vượt câu chữ ROADMAP về contract | Hỏi người dùng (Q1) |

## 11. Tranh chấp test
- (chưa có)
