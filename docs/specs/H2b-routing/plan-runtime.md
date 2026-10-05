# Plan · H2b · Agent Runtime Python (`apps/agent-runtime`)

Luật: spec R19–R21, R25, R27, R28 (WRK-FR-03, WRK-FR-15, WRK-FR-17). Hub: `plan.md` §5.5 (P11–P14). Contract: `plan.md` §2.2. Nền: H1 `plan-runtime.md`, H2a `plan-runtime.md` (ghi `H2a-RT §x`). Không thư viện mới, không ADR (P18).

## 1. Tổng quan thay đổi
| File | Việc | Task |
|---|---|---|
| `spikes/stream_spike.py` (mới) · `docs/specs/H2b-routing/spike-stream.md` | Spike PY-S2 (§2) | PY-S2 |
| `providers/stream_scan.py` (mới, thuần) | `StreamScanner` JSON tăng dần (§3.2) — dùng chung `claude` + `fake` | PY-01 |
| `runtimes/cli/delta.py` (mới, thuần) | `DeltaBuffer`, `split_utf16` (§3.3) | PY-01 |
| `runtimes/cli/refusal.py` (mới, thuần) · `providers/patterns.py` (mới, thuần) · `providers/claude/mapping.py` | `classify_is_error` (§4); `RATE_RE`/`AUTH_RE`/`classify_text` chuyển sang `patterns.py`, `mapping.py` import lại (không đổi hành vi) | PY-01 |
| `providers/claude/usage_acc.py` (mới, thuần) | `UsageAcc` (§5) | PY-01 |
| `providers/base.py` · `runtimes/cli/protocol.py` | `Delta` ProviderEvent + vào `ChildEvent` | PY-02 |
| `providers/claude/{options,provider,mapping}.py` | `include_partial_messages=True` cho mọi job `claude-sub`; `StreamEvent` → scanner → `Delta` chỉ khi stream (§3.4); usage cộng dồn từ `message_start`/`message_delta` (F5, §5) | PY-02 |
| `runtimes/cli/delta_pump.py` (mới) · `events/job_events.py` | `DeltaPump` (gom + hẹn giờ + XADD), `RunEvents.delta` | PY-03 |
| `runtimes/cli/{host_proc,job_run,outcome}.py` | `_on_event(Delta)`; không thử lại khi đã phát; xả trước kết quả; F4 trong `decide_exit` | PY-03 |
| `config.py` | `AGENT_RT_DELTA_FLUSH_MS` (mặc định 100, 10–1 000), `AGENT_RT_DELTA_FLUSH_CHARS` (200, 1–4 000) | PY-03 |
| `providers/fake/{provider,directives,stream}.py` | `#fake:stream*`, `#fake:turns`, `#fake:answer-len`, `#fake:is-error`; #47; delegate lại theo tag; agent "Đồng ý" dùng lại chỉ thị (§6) | PY-04 |
| `contracts/hub.py` | sinh lại từ C2 (không sửa tay) | C2 |
`host_proc.py` (312 dòng) chỉ thêm ≤ 10 dòng (K6); logic gom ở `delta_pump.py`.

## 2. Spike PY-S2 (CLI thật trong WSL, đầu mốc, song song C/D)
`spikes/stream_spike.py` (mẫu `sdk_spike.py`): `ClaudeSDKClient` + `build_options` của job thật (tool tối thiểu) + `include_partial_messages=True`, ghi mọi message/`StreamEvent` (kiểu + khoá, **không** nội dung dài) vào JSONL. Ngân sách **≤ 6 lượt model**, ≤ 4 lần chạy, model rẻ nhất của profile seed, câu hỏi yêu cầu trả lời ~800 ký tự. Không cần Hub/Redis.

| # | Thử | Quyết định phụ thuộc · lùi nếu ✗ |
|---|---|---|
| 1 | Orchestrator (không `output_format`): có `StreamEvent` `content_block_delta/text_delta`? độ trễ delta đầu so với `ResultMessage` | ✗ ⇒ `claude-sub` không stream gì (chỉ `fake`, Dify); F6 mở lại → TECH-DEBT; AC-12 ghi ✗; không chặn `done:h2b` |
| 2 | Agent (`output_format` json_schema): có `content_block_start{tool_use, name:"StructuredOutput"}` + `input_json_delta.partial_json`? | ✗ ⇒ agent **không** stream (Runtime bỏ qua `stream` khi `output="agent_result"`); Orchestrator vẫn stream; TECH-DEBT "agent stream" (H2d: thử bỏ structured output) |
| 3 | Thứ tự khoá agent: `status` trước `text` (2 lần) | ✗ ⇒ đổi thứ tự `properties` của `AGENT_RESULT_SCHEMA` (`status` đầu) + câu trong system prompt agent; vẫn ✗ ⇒ như #2 |
| 4 | Orchestrator: `decision` trước `text`? có code fence/chữ trước `{`? | fence/chữ ⇒ scanner bỏ qua tới `{` (đã thiết kế); `text` trước ⇒ thêm "`decision` trước" vào `FORMAT_BLOCK` (Hub B9) |
| 5 | Nối `partial_json` rồi `json.loads` = `structured_output` cuối; chữ text_delta nối = `ResultMessage.result` | ✗ ⇒ Hub `delta_mismatch` (an toàn, chỉ mất phần cuối) |
| 6 | `AssistantMessage.usage` có mặt? lặp theo từng khối cùng `message_id`? `StreamEvent message_start/message_delta` có `usage`? | chọn nguồn F5 (§5) — **kết quả: `message_start` → `message_delta`** (`AssistantMessage.usage` là ảnh chụp lúc `message_start`, S1) |
| 7 | Có `parent_tool_use_id` khác None (subagent) không | bỏ qua sự kiện có `parent_tool_use_id` |
| 8 | Bật `include_partial_messages` không đổi: hook `PreToolUse`, MCP `hub`, `session_id`, `RateLimitEvent`, `ResultMessage` | ✗ ⇒ chỉ bật cho job không MCP; ghi rủi ro |
| 9 | Huỷ (kill group) sau message assistant thứ 2 (lượt có tool `Read`): usage cộng dồn đọc được trước khi kill | ✗ ⇒ F5 chỉ đúng với `fake`; ghi TECH-DEBT |
Kết quả → `spike-stream.md` (bảng ✓/✗ + mẫu sự kiện đã che). #1 ✗ **và** #2 ✗ ⇒ PY-02 chỉ làm F5; báo điều phối (không phải hard stop: spec K1 cho phép lùi).
**Đã chạy (2026-10-05, `e8e218e`):** #1–#5, #7–#9 ✓, #6 ✗ với `AssistantMessage` ⇒ `claude-sub` stream cả Orchestrator lẫn agent; S1–S5 của biên bản đã áp vào §3.4, §5 và `spec-decisions.md` "Spike PY-S2 → plan".

## 3. `delta` (WRK-FR-03, R19–R21, R25)
### 3.1 Luồng
Con (`claude`/`fake`, chỉ khi `payload.stream is True` ∧ `retry_prompt is None`) → `StreamScanner.feed` → mỗi mảnh chữ đã giải mã → `Delta{type:"delta", kind, text}` (stdout JSON line) → cha `_on_event` → `DeltaPump.add` → gom (§3.3) → `RunEvents.delta` XADD `job.delta{kind, text}` vào `run:<run_id>` (seq chung bộ đếm job). Trước `job.result`/`job.failed`: `await pump.drain()` (thứ tự XADD: mọi `job.delta` trước sự kiện kết thúc).

### 3.2 `providers/stream_scan.py` (thuần — qc viết unit trước)
`class StreamScanner(mode: Literal["orchestrator", "agent"])` · `feed(chunk: str) -> list[str]` · thuộc tính `kind: Literal["answer","done","partial"] | None`, `state: Literal["seeking","streaming","off","closed"]`.
- Bỏ qua mọi ký tự trước `{` đầu tiên (fence, chữ). Chỉ xét khoá **cấp 1** của object; giá trị lồng (object/array/chuỗi có `{`, `"`) đi qua đúng (đếm độ sâu, trong/ngoài chuỗi, escape).
- `orchestrator`: gặp khoá `decision` → nhớ giá trị chuỗi. Gặp khoá `text`: `decision == "answer"` ⇒ `kind="answer"`, `state="streaming"`; khác/chưa có ⇒ `state="off"` (không bao giờ phát).
- `agent`: khoá `status` ∈ {`done`,`partial`} ⇒ nhớ; khoá `text` sau `status` hợp lệ ⇒ `kind=status`, `streaming`; `text` trước `status` / `status=need_input` ⇒ `off`.
- `streaming`: phát chữ **đã giải mã** của chuỗi `text` (`\" \\ \/ \b \f \n \r \t \uXXXX`); escape cắt giữa hai chunk ⇒ giữ lại tới khi đủ; `\uD8xx\uDCxx` ghép thành một code point; high surrogate chưa có low ⇒ giữ; surrogate lẻ ⇒ `U+FFFD` (Hub sẽ thấy lệch → `delta_mismatch`). Đóng chuỗi ⇒ `closed` (bỏ phần còn lại). `feed` sau `off`/`closed` ⇒ `[]`.
- Không ném; JSON hỏng ⇒ `off` nếu chưa `streaming`, giữ `closed`/dừng nếu đang `streaming`.

### 3.3 `runtimes/cli/delta.py` (thuần) + `delta_pump.py`
`split_utf16(text: str, max_units: int = 4000) -> list[str]` (đếm đơn vị UTF-16; không cắt giữa code point. zod/pydantic đếm **code point** (BC6) ⇒ cắt UTF-16 chặt hơn cần thiết, luôn hợp lệ) · `class DeltaBuffer(flush_chars=200, flush_ms=100, max_units=4000, clock=time.monotonic)`: `add(text) -> list[str]` (trả các chunk phải XADD ngay: bộ đệm ≥ `flush_chars` ký tự **hoặc** ≥ `flush_ms` từ lần xả trước; mốc ban đầu = lúc tạo bộ đệm), `due() -> bool`, `take() -> list[str]` (xả hết), `wait_s() -> float` (thời gian tới hạn). Chunk ≤ `max_units`.
`DeltaPump(events, job, cfg)`: `async add(kind, text)` (kind đầu tiên chốt; kind khác ⇒ bỏ + log `job.delta_kind_changed`), hẹn giờ `asyncio` xả khi `due`, `asyncio.Lock` giữa xả do hẹn giờ và `drain`; `async drain()`; `streamed: bool` = đã gọi XADD ít nhất một lần (kể cả XADD lỗi — Hub tự phát hiện hở bằng `seq`, P11). Review 1: mẻ chunk đã lấy khỏi bộ đệm được XADD trong task riêng bọc `asyncio.shield` — huỷ reader/hẹn giờ giữa XADD không làm mất mẩu đã `take()` (hở `seq`); lần xả sau, `drain` và `close` chờ mẻ đang bay xong trước (giữ thứ tự, không XADD sau sự kiện kết thúc).

### 3.4 Phía con `claude-sub` (theo PY-S2, S2–S4)
`options.py`: `include_partial_messages=True` cho **mọi** job `claude-sub` (F5 cần `StreamEvent` cả khi không stream — huỷ/timeout; spike #8: không đổi hook/MCP/`session_id`/`RateLimitEvent`/`ResultMessage`). Scanner + `Delta` chỉ khi `payload.stream is True ∧ job.retry_prompt is None` (lần thử lại định dạng không stream); ngược lại `StreamEvent` chỉ dùng cho F5 (§5).
`provider.py` `_Turn.handle(StreamEvent)` (bỏ khi `parent_tool_use_id` ≠ None):
- Chọn khối theo `content_block_start` (S3): khối `text` (Orchestrator) / `tool_use` tên `StructuredOutput` (agent) ⇒ gắn scanner nếu chưa phát. Khối khác — `thinking` (`thinking_delta`), `tool_use` `Read`/MCP (có `input_json_delta` riêng) — **bỏ qua theo index khối**, không theo kiểu delta.
- `content_block_delta` của khối đã gắn: `text_delta.text` / `input_json_delta.partial_json` ⇒ `feed` ⇒ `emit(Delta)`.
- Mốc khối xong = `content_block_stop` (S4; `AssistantMessage` tới **trước** `content_block_stop`/`message_delta` nên không dùng làm mốc): khối chưa phát ⇒ tháo (khối sau dùng scanner mới). Đã phát ở một khối ⇒ khối khác bỏ qua (Hub đối chiếu `F`).
- `message_start`/`message_delta` ⇒ F5 (§5), không vào scanner.
`mapping.py`: `SystemMessage` subtype `status`, `thinking_tokens` và subtype lạ khác (mới khi bật partial) ⇒ bỏ qua như H1.

### 3.5 Phía cha
`host_proc._on_event`: `Delta` ∧ `payload.stream` ⇒ `await pump.add(...)`; `seen.streamed = pump.streamed`. `job_run`: `_retryable` thêm `and not self.seen.streamed` (R21: không thử lại JSON, không dựng lại session sau khi đã phát); `_apply`: `await pump.drain()` trước `_close` (mọi nhánh trừ `stopped_no_write`). `Seen.next_attempt` giữ `streamed`.

## 4. F4 — `is_error` 0 token (R27, WRK-FR-15)
`runtimes/cli/refusal.py`: `classify_is_error(text: str | None, output_tokens: int) -> Literal["rate","auth","refused"] | None` — `classify_text(text[:300])` H1 (một nguồn mẫu `RATE_RE`/`AUTH_RE`, rate trước auth; chuyển 2 regex + `classify_text` từ `providers/claude/mapping.py` sang module thuần `providers/patterns.py`, `mapping.py` import lại — không đổi hành vi, cha không import SDK): `rejected` ⇒ `rate`, `logged_out` ⇒ `auth` (bất kể output); không khớp ∧ `output_tokens == 0` ⇒ `refused`; còn lại ⇒ None. `outcome.decide_exit` nhánh `final.is_error ∧ confirm is None` (chỉ tới khi `seen.rate_limit is None` — claude-sub đã phân loại bằng `result_signal` H1): `kind = classify_is_error(final.text or final.raw_json or " ".join(final.errors), seen.total().output_tokens)` ⇒ `rate`: `Verdict(RATE_LIMITED, provider=broken_of(RateLimit(status="rejected")))` · `auth`: `Verdict(LOGGED_OUT, provider=broken_of(RateLimit(status="logged_out")))` (như H1) · `refused`: `Verdict(Failure("failed","UPSTREAM_ERROR","refused","provider refused the request"))` · None ⇒ `PROVIDER_ERROR` (H1). Chữ result chỉ vào log job (che, ≤ 300).

## 5. F5 — usage cộng dồn (R28, WRK-FR-17, AC-W09)
`providers/claude/usage_acc.py`: `class UsageAcc` · `add(message_id: str | None, usage: Mapping[str, Any] | None, model: str | None) -> UsageEv | None` — khử trùng theo `message_id` (cùng id ⇒ lấy bản sau **thay** bản trước theo từng khoá — khoá vắng ở bản sau giữ giá trị cũ (review 1), không cộng hai lần; `None` ⇒ message mới, cộng — Q-T7), cộng `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`; trả `UsageEv` **cộng dồn** khi tổng đổi, None khi không.
**Nguồn (PY-S2 #6/#9, S1):** `StreamEvent`, **không** `AssistantMessage.usage` (ảnh chụp lúc `message_start`, output gần 0: 8 vs thật 702). `_Turn`: `message_start` ⇒ nhớ `message.id` (thiếu id ⇒ id tạm riêng cho message đó, review 1 — `message_delta` sau thay chứ không cộng đôi), `add(id, message.usage)` (input + cache đủ, output ảnh chụp); `message_delta` (không mang id) ⇒ `add(<id message_start gần nhất>, delta.usage)` — bản cuối, thay bản `message_start` cùng id. Mỗi lần `add` trả khác None ⇒ `emit(UsageEv)` cộng dồn. `AssistantMessage.usage` bị bỏ qua. `ResultMessage` ⇒ `UsageEv` tổng như H1 (thay thế); Result không mang `usage` ⇒ không phát `UsageEv` (review 1 F5 — không đè phần cộng dồn bằng `{0,…}`).
Cha giữ `seen.usage = ev` (bản sau thay bản trước — sẵn có) ⇒ huỷ/timeout/fatal ghi đúng 1 dòng `usage_logs` qua `usage_row` (H1, `ON CONFLICT (job_id)`); chưa có usage ⇒ không ghi (sẵn có). Huỷ giữa chừng = **cận dưới**: message đang dở (chưa tới `message_delta`) chỉ có output ảnh chụp của `message_start` (spike #9: lượt 1 đủ 65, lượt 2 dở 24).

## 6. `fake-cli` (R25, TD #47, AC-H22 vế `@`)
| Chỉ thị / luật | Hành vi |
|---|---|
| `#fake:stream[=<n>]` (n 1–50, mặc định 5) — chỉ khi `payload.stream is True` | Dựng JSON cuối (Orchestrator `{"decision":"answer","text":…}` / agent `{"status":…,"text":…}` khoá theo thứ tự đó, `ensure_ascii=False`), cắt thành `n` đoạn đều theo code point, mỗi đoạn qua `StreamScanner` cùng mode ⇒ `Delta`; cách nhau 50 ms; rồi `Final` như cũ. Quyết định `delegate`/`ask`, `need_input` ⇒ scanner tự `off` |
| `#fake:stream-order=text-first` | JSON đặt `text` trước khoá vai ⇒ 0 delta (AC-07) |
| `#fake:stream-diverge` | Chữ stream = `text` đổi ký tự đầu; `Final` giữ `text` đúng ⇒ Hub `delta_mismatch` (AC-06) |
| `#fake:stream-badjson` | Sau stream, `Final` Orchestrator `text` JSON hỏng / agent `raw_json` hỏng (`structured=None`) ⇒ Hub `stream_unparsed`; Runtime không thử lại (R21) |
| `#fake:answer-len=<n>` | `body` đệm/cắt đúng `n` ký tự (n ≤ 64 000) |
| `#fake:turns=<n>` (1–10) với `#fake:usage=<in>,<out>` | phát `n` `UsageEv` cộng dồn (lượt k: k×in, k×out) cách nhau 50 ms **trước** `#fake:sleep` (AC-09); không có ⇒ như H1 |
| `#fake:is-error=<rate\|auth\|refused>` (test-plan L2) | `Final{is_error:true, text}` với chữ cố định: "You've hit your usage limit" / "Not logged in · Please run /login" / "I can't help with that."; **không** phát `RateLimit` (đi nhánh phân loại §4); usage `{in:10, out:0}` trừ khi có `#fake:usage` (khi đó dùng số đó) |
| TD #47 `redelegate_message` | chỉ trả tin cũ khi khối `<steps>` của prompt là `[]` (run chưa có kết quả delegate) |
| Delegate lại theo tag (Orchestrator, tin "Đồng ý") | tin user trước (bỏ tin đồng ý) bắt đầu `@<key>` (đúng một tag, cú pháp R01) ⇒ trả `#fake:delegate=<key> <phần sau tag>` |
| Agent nhận "Đồng ý" / "Agree" không chỉ thị | lấy chỉ thị từ tin `user` gần nhất **không** phải câu đồng ý trong `payload.history` (bỏ tag `@…` đầu) ⇒ chạy như tin đó (gọi lại `#fake:tool`) |
Không chỉ thị mới ⇒ hành vi H1/H2a giữ nguyên (test khoá xanh).

## 7. Test và giả lập
| Lớp | Nơi | Ai |
|---|---|---|
| Unit thuần §3.2, §3.3, §4, §5 (P31–P40) | `tests/acceptance/test_stream_rules.py` (khoá trước PY-01) | qc (QW-PU) |
| Int Runtime: `job.delta` (fake), gom 200/100, không thử lại, F4 ba mẫu, F5 huỷ sau 2 lượt / trước usage | `tests/acceptance/{stream,refusal,usage_h2b}_int_test.py` (mẫu `_rt.py`) | qc (QW-P) |
| Unit con/cha (SDK giả `StreamEvent`) | `src/agent_runtime/**/test_*.py` | backend-lead |
| Stack Hub + Runtime | `tests/acceptance/H2b/stack/*` | qc |
| Smoke thật | `HUB_LIVE=1` (I2) | backend-lead |

## 8. Env
`AGENT_RT_DELTA_FLUSH_MS=100` · `AGENT_RT_DELTA_FLUSH_CHARS=200` (`config.py` validate; sai ⇒ không lên). `.env.example` thêm.

## 9. Đối chiếu Hub ↔ Runtime
✓ = khớp `plan.md` · ✗ = đã sửa, theo cột "Chốt".
| # | Chủ đề | Hub (`plan.md`) | Runtime (file này) | | Chốt |
|---|---|---|---|---|---|
| H1 | Bật stream | `payload.stream=true` theo `streamAccept` (§5.5) | đọc `payload.stream is True`; vắng/false ⇒ không phát | ✓ | `stream` `.optional()` (P3) |
| H2 | Sự kiện | `JobDeltaEvent{kind, text 1–4000}` trong `RunEvent` | `RunEvents.delta` validate bằng `RunEvent` pydantic sinh | ✓ | C2 |
| H3 | Đơn vị 4 000 | zod `max` đếm **code point** (đo ở C2, BC6) | `split_utf16` cắt theo đơn vị UTF-16 (§3.3) | ✓ | Giữ cắt UTF-16: ≤ 4 000 đơn vị ⇒ ≤ 4 000 code point, luôn hợp lệ (chặt hơn cần thiết); test không assert zod đếm UTF-16 |
| H4 | `kind` cố định | Hub lọc theo `accept`, kind đầu tiên | Pump chốt kind đầu, bỏ kind khác | ✓ | — |
| H5 | Hở chunk | `seq` liền mạch, hở ⇒ ngừng chuyển tiếp (P11) | `seq` chung bộ đếm job; XADD lỗi chỉ log | ✓ | Runtime không đổi `seq` |
| H6 | Thứ tự | delta trước kết quả | `drain()` trước `_close` | ✓ | — |
| H7 | Thử lại sau khi phát | Orchestrator: Hub không `reopen` khi S≠"" | Agent/Orchestrator: không thử lại JSON, không dựng lại session | ✓ | R21 |
| H8 | JSON cuối hỏng agent | `invalid_output` sau stream ⇒ `content=S` (P12) | gửi `job.failed{UPSTREAM_ERROR, invalid_output}` như H1 | ✓ | Runtime không bịa `done` |
| H9 | Chữ phát | so tiền tố với `decision.text` / `result.text` | chữ đã giải mã JSON | ✓ | — |
| H10 | F4 | `refused` ⇒ hint (P15); rate/auth ⇒ mã H1 (`ALL_PROVIDERS_EXHAUSTED`) | §4 | ✓ | CHECK `refused` (`plan-db` §1) |
| H11 | F5 | không đổi (usage từ `job.failed.usage`) | §5 (`message_start`/`message_delta`, huỷ = cận dưới) | ✓ | — |
| H12 | Dify agent stream | Hub tự phát `job.delta` tổng hợp (P14) | — (không qua Runtime) | ✓ | — |
| H13 | `workflow.async` | không `stream` | không phát | ✓ | — |
| H14 | `fake` AC-H22 vế `@` | Hub: R12, `pending_ask` của run `direct` | §6 hai luật delegate lại / agent đồng ý | ✓ | — |

## 10. Task PY: `tasks.md` khối PY.
