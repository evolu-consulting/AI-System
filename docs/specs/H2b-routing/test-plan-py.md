# Test plan · H2b-routing · phụ lục Python, stack, smoke (qc)

Phụ lục của [`test-plan.md`](test-plan.md). Chữ ký: `plan-runtime.md` §3.2, §3.3, §4, §5; chỉ thị `fake-cli` §6 (+ `#fake:is-error`, Lệch L2). Chạy: `bun apps/agent-runtime/scripts/run.ts "<env DB> uv run pytest …"` (env DB trong chuỗi lệnh; DB Hub/Runtime riêng — test-plan §2).

## 1. P · unit thuần `tests/acceptance/test_stream_rules.py` (QW-PU → Q-PU, trước PY-01)
Import trong thân test (`importlib`) → mỗi ca đỏ riêng `ModuleNotFoundError`.

| ID | Hàm | Ca → kỳ vọng |
|---|---|---|
| P01 | `StreamScanner("orchestrator")` | `{"decision":"answer","text":"Xin chào"}` cắt **mọi** vị trí (từng ký tự, 2 phần, 3 phần) → nối `feed` = `"Xin chào"`, `kind="answer"`, `state` → `closed`; `text` trước `decision` → `[]`, `off`; `decision:"delegate"`/`"ask"` → `off`; tiền tố ```` ```json\n ```` / chữ trước `{` bị bỏ; giá trị lồng trước `text` (`"meta":{"text":"x","a":["{\"}"]}`) không kích hoạt; `feed` sau `closed`/`off` → `[]`; JSON hỏng trước khi stream → `off`, không ném |
| P02 | `StreamScanner("agent")` | `status:"done"`/`"partial"` trước `text` → `kind` tương ứng; `need_input` → `off`; `text` trước `status` → `off`; `status` lồng (`"x":{"status":"done"}`) không tính |
| P03 | escape | `\n \t \r \b \f \" \\ \/ á` giải đúng; escape cắt giữa chunk (`"\\"`|`"n"`, `"\\u00"`|`"e1"`) → không phát dở; `\ud83d`|`\ude00` ở hai chunk → phát một `"😀"`, không bao giờ phát surrogate lẻ; `\ud83d` + `x` → `"�"`; UTF-8 thô (`á`, emoji) đi qua |
| P04 | thuộc tính | 200 JSON sinh ngẫu nhiên (seed cố định; `text` có escape, emoji, `{`, `"`) × cách cắt ngẫu nhiên → nối `feed` = `json.loads(doc)["text"]` khi khoá vai đứng trước |
| P05 | `split_utf16` | `""` → `[]`; 4 000 ASCII → 1; 4 001 → 2; 3 999 ASCII + emoji → `[3999, emoji]` (không cắt code point); 8 001 → 3; mọi phần ≤ 4 000 đơn vị UTF-16; nối = gốc |
| P06 | `DeltaBuffer` (đồng hồ giả) | `add` 50 ký tự t=0 → `[]`, `due()` false; t=0.1 s → `due()` true, `add` → xả; `add` 250 ký tự → xả ngay; `take()` xả phần còn; `wait_s()` = thời gian còn tới 100 ms; `flush_chars=200, flush_ms=100` mặc định; mỗi chunk ≤ `max_units`; nối mọi chunk = nối đầu vào |
| P07 | `classify_is_error` | output > 0 → `None`; `"You've hit your usage limit"`, `"Rate limit exceeded"`, `"Error 429"` → `rate`; `"Not logged in · Please run /login"`, `"Invalid API key"`, `"OAuth token has expired"`, `"HTTP 401"`, `"403 Forbidden"` → `auth`; có cả rate và auth → `rate`; `"I can't help with that."`, `None`, `""` → `refused`; mẫu ở ký tự 301+ → `refused`; không phân biệt hoa; `"4290"` không khớp `\b429\b` |
| P08 | `UsageAcc` | 2 `message_id` khác → cộng (`input`, `output`, `cache_read`, `cache_creation`); cùng id 2 lần → bản sau thay, không cộng đôi; tổng không đổi → `None`; `usage=None` → `None`; id `None` → mỗi lần là message mới (Q-T7) |
| P09 | `Settings` | `delta_flush_ms` 100 (10–1 000), `delta_flush_chars` 200 (1–4 000); ngoài khoảng → `ValidationError` (xanh ở PY-03, L8) |

## 2. P · int Runtime thật (`fake-cli`) — QW-P, khoá Q3
Payload `agent.cli` có `stream` qua helper mới `_stream.py` (bọc `build_payload` của `_rt.py` khoá). Hộp đen: `hub.jobs`, Redis `run:<id>`, `usage_logs`, `provider_state`, log JSON.

| ID | File · Mã | Given/When → Then |
|---|---|---|
| P20 | `stream_int_test.py` · WRK-FR-03 · AC-07 | Orchestrator `stream=true`, `<message>#fake:stream=5 #fake:answer-len=300</message>` → `run:<id>`: ≥ 1 `job.delta{kind:"answer"}`, nối = `decision.text` của `job.result`; mọi `job.delta` trước `job.result` (thứ tự stream); `seq` liền mạch từ `job.started`; mỗi `text` ≤ 4 000 |
| P21 | R25 · H1 | Cùng chỉ thị, `stream` vắng / `false` → 0 `job.delta`; kết quả như H1 |
| P22 | R20 | Agent `#fake:stream=5` → `kind:"done"`; `#fake:partial #fake:stream=5` → `partial`; `#fake:need_input #fake:stream` → 0; Orchestrator `#fake:delegate=x #fake:stream` → 0; `#fake:stream-order=text-first` → 0, `job.result` đúng |
| P23 | R21 · AC-07 | `AGENT_RT_DELTA_FLUSH_MS=1000`, `FLUSH_CHARS=200`, `#fake:stream=10 #fake:answer-len=1000` → mọi `job.delta` trừ cuối ≥ 200 ký tự, số `job.delta` ≤ 6; `FLUSH_CHARS=4000`, `FLUSH_MS=100` → 3–10 `job.delta` (theo giờ); nối = text |
| P24 | R21 | `#fake:stream=1 #fake:answer-len=9000` → ≥ 3 `job.delta`, mỗi `text` ≤ 4 000 đơn vị UTF-16 |
| P25 | R21 · H7 | Agent `#fake:stream=5 #fake:stream-badjson` → `job.failed{UPSTREAM_ERROR, invalid_output}`, không dòng log `job.output_retry`; đối chứng `#fake:badjson=1` (không stream) → `succeeded` (H1 AC-10) |
| P26 | `refusal_int_test.py` · WRK-FR-15 · AC-08 | `#fake:is-error=rate` → `job.failed ALL_PROVIDERS_EXHAUSTED`/`quota`, `provider_state` `cooldown` (+30 phút ± 1); `=auth` → `NOT_CONFIGURED`/`credential`, `provider_state` `logged_out`; `=refused` → `UPSTREAM_ERROR`/`refused`, `provider_state` không đổi; `=refused #fake:usage=10,5` → `UPSTREAM_ERROR`, reason `null` (H1); chữ result không có trong `job.failed.message`, `jobs.error_message`, XADD; log có chữ đã che ≤ 300 |
| P27 | `usage_h2b_int_test.py` · WRK-FR-17 · AC-09 | `#fake:turns=2 #fake:usage=100,50 #fake:sleep=10` → chờ ~200 ms → huỷ → `cancelled`, `usage_logs` **1** dòng `input=200, output=100`, `billing=subscription`, `cost_usd=0`; `job.failed.usage` cùng số. `#fake:sleep=10` (huỷ trước usage) → 0 dòng. `timeout_s` nhỏ sau 2 lượt → `timed_out`, 1 dòng |
| P28 | WRK-FR-17 | `#fake:turns=3 #fake:usage=10,5` chạy hết → 1 dòng = tổng cuối (30, 15), không cộng đôi |

## 3. S · stack (`tests/acceptance/H2b/stack/*.stack.test.ts`) — QW-P, khoá Q3
Hub thật trên host (`HUB_MAX_CONCURRENT_RUNS=2`), Runtime container `fake-cli`, MK; harness theo H2a `_stack.ts` (TC-4, TC-5). Đỏ đúng lý do trước PY-03/04.

| ID | Mã | Ca |
|---|---|---|
| S01 | AC-04 · R25 | `#fake:stream=5 #fake:answer-len=300` → ≥ 1 `delta` trước `step.finished` step Orchestrator, mọi `delta` ≤ 40, nối = content = E11; `#fake:stream=10` → delta đầu trước `run.finished` ≥ 200 ms (L3) |
| S02 | AC-05 | `@assistant #fake:stream=10 viết` → delta sớm, `responder`; `@assistant #fake:partial #fake:stream=10` → content = text + `"\n\nPhần chưa làm được: thiếu dữ liệu"` |
| S03 | AC-05 | `#fake:delegate=assistant #fake:stream=10` → delta khi step delegate mở, pass-through, đúng 1 job Orchestrator |
| S04 | AC-06 | `#fake:stream=5 #fake:stream-diverge` → content = S, `delta_mismatch`; Orchestrator `#fake:stream-badjson` → `stream_unparsed`, 1 job Orchestrator; `#fake:stream=50` huỷ giữa chừng → `run.failed CANCELLED` ≤ 5 s |
| S05 | AC-H22 · R12 · TD #47 | `@trello #fake:tool=create-trello-card #fake:args={"title":"A"} Tạo thẻ` → `ask`, MK 0; `Đồng ý` → Orchestrator delegate lại `trello` (tag tin trước) → MK 1, đúng 1 job `trello`, `run.finished`; flow mới: `@trello Đồng ý` → MK 1; flow mới: `@helper Đồng ý` → MK 0 |
| S06 | R20 | `#fake:stream-order=text-first` → 0 `delta` trước `step.finished`, content đúng |
| S07 | R24 | `@dify-tro-ly hỏi` (`mk-slow-300`) → delta trước `run.finished` |
| S08 | AC-08 | `@assistant #fake:is-error=refused x` → `run.failed UPSTREAM_ERROR` + hint refused |

## 4. SM · smoke `tests/smoke/h2b-live.test.ts` (`HUB_LIVE=1`, không chặn, không khoá)
| ID | Ca (kỳ vọng theo `spike-stream.md`) |
|---|---|
| SM1 | `claude-sub`: `@assistant` câu trả lời ~800 ký tự → ≥ 2 `delta` trước `step.finished` (nếu spike #2 ✗: 0, ghi ✗) |
| SM2 | Orchestrator `answer` dài → ≥ 2 `delta` trước `run.finished` (spike #1) |
| SM3 | Huỷ sau lượt có tool → `usage_logs` 1 dòng token > 0 (spike #9) |
