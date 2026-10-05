# Spike PY-S2 · stream với Claude CLI thật (WSL) — biên bản

Phụ lục `plan-runtime.md` §2. Script: `apps/agent-runtime/spikes/stream_spike.py` (cách chạy ở `spikes/README.md`). Ngày 2026-10-05.

**Môi trường:** WSL Ubuntu, user `worker`, venv `$HOME/.venvs/agent-runtime`, `claude-agent-sdk` 0.2.163 (CLI bundled, `cli_path=None`), creds `/home/worker/.claude`, env sạch `env -i` + `setsid -w`. Options = **đúng** `build_options` của `src/` (`setting_sources=[]`, `dontAsk`, hook sandbox thật, env job) + `include_partial_messages=True`. Model: profile seed `claude-sub-1` có `model: null` ⇒ mặc định CLI = `claude-opus-5-5` (init). Orchestrator dùng nguyên văn `FORMAT_BLOCK` + khối prompt của Hub (`orchestrator.prompt.ts`); agent dùng `AGENT_RESULT_SCHEMA` (`status` đã đứng đầu `properties`).

**Ngân sách:** 4 lần chạy (≤ 4), **6 lượt model** theo `num_turns` (≤ 6) = 5 lời gọi API (`message_start`):

| Lần | Ca | `num_turns` | Lời gọi API | Điểm |
|---|---|---|---|---|
| 1 | `orch` (Orchestrator, không `output_format`) | 1 | 1 | #1, #4, #5, #6, #7, #8 |
| 2 | `agent` (`output_format`, không tool) | 2 | 1 (`StructuredOutput` kết thúc, không gọi thêm) | #2, #3 (lần 1), #5, #6, #8 |
| 3 | `agent-kill` (`Read` + MCP giả `mcp_fake.py`; kill sau `AssistantMessage[StructuredOutput]` của lượt 2) | — (bị kill, ~2) | 2 | #3 (lần 2), #6, #8, #9 |
| 4 | `orch` với `SPIKE_NO_PARTIAL=1` (đối chứng usage) | 1 | 1 | #6 |

## 1. Bảng 9 điểm

| # | Thử | Kết quả thật | ✓/✗ |
|---|---|---|---|
| 1 | Orchestrator có `content_block_delta/text_delta`? độ trễ | Có. 1 khối `text`, **129** `text_delta` (TB 9 ký tự, tối đa 20), khoảng cách TB **50 ms**, tối đa 303 ms. Delta đầu **1,32 s**, delta cuối 7,69 s, `ResultMessage` 7,75 s (chữ 1 166 ký tự) | ✓ |
| 2 | Agent có `content_block_start{tool_use, name:"StructuredOutput"}` + `input_json_delta.partial_json`? | Có. Ca `agent`: khối `thinking` (index 0, `thinking_delta` **rỗng** ×7, 733 thinking token) rồi `tool_use StructuredOutput` (index 1), **71** `input_json_delta` (TB 12 ký tự, khoảng cách TB 52 ms). Delta JSON đầu **8,21 s** (sau thinking), `ResultMessage` 11,97 s | ✓ |
| 3 | Thứ tự khoá agent `status` trước `text` (2 lần) | Lần 1 (`agent`): `{"status":…,"text":…}`; lần 2 (`agent-kill`): như vậy. Không chữ/fence trước `{` | ✓ (×2) |
| 4 | Orchestrator `decision` trước `text`? fence/chữ trước `{`? | `decision` → `text`; phần trước `{` rỗng, không fence. Chữ nối là JSON hợp lệ | ✓ |
| 5 | Nối `partial_json` → `json.loads` = `structured_output`; `text_delta` nối = `ResultMessage.result` | `orch`: chuỗi nối **==** `result` (1 166/1 166). `agent`: `json.loads(nối)` **==** `structured_output` (`{status,text}`) | ✓ |
| 6 | `AssistantMessage.usage` có? lặp theo khối cùng id? `message_start`/`message_delta` có `usage`? | `AssistantMessage` phát **một bản cho mỗi khối** (cùng `message_id`, usage giống hệt) — **nhưng `usage` là ảnh chụp lúc `message_start`**: `output_tokens` = 8 / 10 / 16 / 24 trong khi thật 702 / 1 286 / 65 / … Đối chứng không partial (lần 4): vẫn 8 vs `ResultMessage` 623 ⇒ không do `include_partial_messages`. `message_start.message.usage` (input + cache đủ, output ảnh chụp) và `message_delta.usage` (**cuối**, = `ResultMessage.usage` khi 1 message; có thêm `output_tokens_details.thinking_tokens`, `iterations[]`). `AssistantMessage` tới **trước** `content_block_stop`/`message_delta` | ✗ với `AssistantMessage` · ✓ với `message_start` + `message_delta` |
| 7 | Có `parent_tool_use_id` ≠ None? | 0 ở cả 3 ca (không subagent; `Task` không có trong `tools`) | ✓ (giữ luật bỏ qua) |
| 8 | `include_partial_messages` không đổi hook / MCP / `session_id` / `RateLimitEvent` / `ResultMessage` | Hook `PreToolUse` gọi đủ (`StructuredOutput:allow`, `Read:allow`); MCP `hub` `connected` (`dynamic`, đủ 5 tool, `server/discover` → `initialize` → `tools/list` như PY-S1); **một** `session_id` cho mọi message/`StreamEvent`, khớp `ResultMessage`; `RateLimitEvent` 1/lần chạy (cùng khoá); `ResultMessage` cùng trường (`subtype success`, `num_turns`, `usage`, `structured_output`). Mới khi bật partial: `SystemMessage` subtype `status` và `thinking_tokens` (`estimated_tokens*`) — phải bỏ qua như subtype lạ | ✓ |
| 9 | Huỷ sau message assistant thứ 2: usage cộng dồn đọc được trước kill | Kill (SIGKILL con cháu = CLI) ngay khi nhận `AssistantMessage[StructuredOutput]` lượt 2 (9,70 s, trước `message_delta` lượt 2): SDK ném `ProcessError exit -9`, không `ResultMessage`. Đọc được: lượt 1 **cuối** qua `message_delta` (in 2, out 65, cache_creation 2 194) + lượt 2 qua `message_start` (in 2, cache_read 2 194, cache_creation 135, out 24 = ảnh chụp). Chỉ cộng `AssistantMessage` ⇒ out = 40 (thiếu hẳn lượt 1 thật 65 và phần lượt 2 đã sinh ~940 ký tự JSON) | ✓ với nguồn `message_start`/`message_delta` (output của message đang dở = ảnh chụp, thiếu) · ✗ với `AssistantMessage` |

**Kết luận: `claude-sub` STREAM ĐƯỢC** cả Orchestrator (#1 ✓) lẫn agent `output_format` (#2 ✓) ⇒ không lùi K10; PY-02 làm đủ `include_partial_messages` + `StreamEvent` → scanner → `Delta`, `options.py` dùng nhánh "`output == "text"` **hoặc** spike #2 ✓" = bật cho cả agent. Không cần thêm "`decision` trước" vào `FORMAT_BLOCK` (B9, #4 ✓). Không cần đổi `AGENT_RESULT_SCHEMA` (#3 ✓).

## 2. Độ trễ và ảnh hưởng tới gom / retry
- Chunk SDK nhỏ (≈ 9–12 ký tự, ≈ 20/s) ⇒ `DeltaBuffer` mặc định (100 ms / 200 ký tự) gom ≈ 2 chunk/lần, ≤ 10 XADD/s — giữ mặc định.
- Agent có `thinking` (adaptive) trước `StructuredOutput`: chữ đầu tới muộn (8,2 s / 12 s), `thinking_delta` rỗng ⇒ scanner chỉ gắn khối `text`/`tool_use StructuredOutput` như §3.4 (khối `thinking`, `tool_use Read` có `input_json_delta` riêng — **phải** bỏ qua theo tên khối, không theo kiểu delta).
- Retry định dạng: JSON Orchestrator đã hợp lệ, agent qua `StructuredOutput` (CLI kiểm schema) ⇒ `invalid_output` sau khi phát hiếm; luật §3.5 (đã phát ⇒ không thử lại, lần thử lại `retry_prompt` không stream) giữ nguyên. Không thấy lệch giữa chữ stream và kết quả cuối (#5) ⇒ `delta_mismatch` chỉ còn do lỗi Runtime/scanner.
- Kill khi đang stream: SDK báo `ProcessError` (exit -9) trong reader — host_proc đã xử lý thoát bất thường (H1); không treo.

## 3. Mẫu sự kiện (đã che, không nội dung)
```jsonl
{"t":1319.6,"kind":"StreamEvent","ev":"message_start","message_id":"msg_…","usage":{"input_tokens":2,"cache_creation_input_tokens":1049,"cache_read_input_tokens":0,"output_tokens":8,…}}
{"t":1319.9,"kind":"StreamEvent","ev":"content_block_start","index":0,"block":"text","name":null}
{"t":1746.2,"kind":"RateLimitEvent","info_type":"RateLimitInfo"}
{"t":7733.7,"kind":"AssistantMessage","message_id":"msg_…","usage":{…,"output_tokens":8}}
{"t":7733.9,"kind":"StreamEvent","ev":"content_block_stop","index":0}
{"t":7736.1,"kind":"StreamEvent","ev":"message_delta","usage":{…,"output_tokens":702,"output_tokens_details":{"thinking_tokens":0},"iterations":[…]}}
{"t":7750.1,"kind":"ResultMessage","subtype":"success","num_turns":1,"usage":{…,"output_tokens":702}}
{"t":8208.4,"kind":"StreamEvent","ev":"content_block_start","index":1,"block":"tool_use","name":"StructuredOutput"}
{"t":1345.2,"kind":"StreamEvent","ev":"content_block_delta","index":0,"delta":"thinking_delta","n":0}
```

## 4. Lệch plan và đề xuất sửa (không tự sửa plan)

| ID | Mức | Chỗ | Đề xuất |
|---|---|---|---|
| S1 | **Cao** | `plan-runtime` §5 (F5), §2 #6, task PY-01/PY-02, test-plan F5 (AC-09) | Nguồn usage cộng dồn **không** là `AssistantMessage.usage` (ảnh chụp lúc `message_start`, output gần 0). Dùng `StreamEvent`: `message_start.message.usage` (id = `message.id`) rồi `message_delta.usage` (cùng id, bản sau thay — đúng luật `UsageAcc.add` "cùng id ⇒ lấy bản sau"). `message_delta` không mang id ⇒ `_Turn` nhớ id của `message_start` gần nhất. Message đang dở khi huỷ chỉ có output ảnh chụp (thiếu) — ghi rõ trong AC-W09/F5 là "cận dưới" |
| S2 | **Cao** | `plan-runtime` §3.4 (`options.py`: `include_partial_messages = payload.stream ∧ …`) | Vì S1, F5 cần `StreamEvent` cho **mọi** job `claude-sub` (huỷ/timeout không stream cũng phải có usage). Đề xuất: `include_partial_messages=True` luôn; chỉ gắn scanner/phát `Delta` khi `payload.stream is True ∧ retry_prompt is None`. #8 cho thấy bật partial không đổi hook/MCP/session/result. Phương án lùi nếu không muốn bật luôn: job không stream giữ F5 qua `AssistantMessage` (thiếu output) + TECH-DEBT |
| S3 | Thường | `plan-runtime` §3.4, `mapping.py` | Bỏ qua `SystemMessage` subtype `status`, `thinking_tokens` (mới khi partial) và khối `thinking`; chọn khối theo `content_block_start` (`text` cho Orchestrator, `tool_use` tên `StructuredOutput` cho agent) — `input_json_delta` của `tool_use Read`/MCP **không** được đưa vào scanner |
| S4 | Thấp | `plan-runtime` §3.4 | `AssistantMessage` tới **trước** `content_block_stop`/`message_delta` của khối đó ⇒ không dùng `AssistantMessage` làm mốc "khối xong"; dùng `content_block_stop` |
| S5 | Thấp | smoke I2 (AC-12) | Model mặc định `claude-opus-5-5` + thinking ⇒ agent có thể im ~8 s trước chữ đầu; kịch bản smoke đặt kỳ vọng "có ≥ 1 `job.delta` trước `job.result`", không đặt ngưỡng độ trễ |

Không sửa `src/**` trong spike.
