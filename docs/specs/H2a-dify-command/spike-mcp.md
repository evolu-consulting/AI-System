# Spike PY-S1 · MCP Hub với Claude CLI thật (WSL) — biên bản

Phụ lục `plan-runtime.md` §4.6. Script: `apps/agent-runtime/spikes/mcp_spike.py` (server MCP giả stdlib `mcp_fake.py`, cách chạy ở `spikes/README.md`). Ngày 2026-10-05.

**Môi trường:** WSL Ubuntu, user `worker`, `claude-agent-sdk` 0.2.163 → CLI **bundled 2.1.286** (`cli_path=None` như `options.py`; `claude` hệ thống 2.1.289 không dùng). Mọi ca: `setting_sources=[]`, `permission_mode="dontAsk"`, `tools=["Read"]`, `strict_mcp_config=True`, env `ENABLE_CLAUDEAI_MCP_SERVERS=false` + `NO_PROXY=localhost,127.0.0.1`, env sạch (`env -i`).
**Lượt model: 4** (`call`, `confirm`, `timeout`, `call-discover`) ≤ 6. Ca `init-*` chỉ `connect` + `get_mcp_status()`, không query → 0 lượt.

## 1. Bảng 10 điểm

| # | Thử | Kết quả thật | Khớp plan? |
|---|---|---|---|
| 1 | `mcp_servers=<path file 0600>` + strict + env tắt connector | File `.mcp/job1.json` mode `0o600`; `get_mcp_status`: `hub connected`, scope `dynamic`, đủ 5 tool; init `mcp_servers=[{name:hub,status:connected,source:dynamic}]`, **không** `mcp__claude_ai_*`. Server nhận `Authorization: Bearer <token>` đúng ở **mọi** request (`auth=ok`) | ✅ |
| 2 | `tools=["Read"]` có ẩn tool MCP? | **Không.** init `tools=[Read, mcp__hub__confirm-send, …hook-deny, …secret-tool, …slow-tool, …translate-en]` — mọi tool server khai (kể cả không có trong `allowed_tools`) vào ngữ cảnh model | ✅ (đúng CX §4.2) |
| 3 | `allowed_tools` thiếu/có `mcp__hub__x` dưới `dontAsk` | Có → chạy, server nhận `tools/call`. Thiếu (`secret-tool`) → `is_error=true`, "Permission to use mcp__hub__secret-tool has been denied because Claude Code is running in don't ask mode…"; server **không** nhận call. Hook PreToolUse vẫn được gọi **trước** kiểm quyền (log `secret-tool` với hook trả `{}`) | ✅ |
| 4 | Hook nhận `tool_name`/`tool_input`; deny chặn thật | `tool_name="mcp__hub__translate-en"`, `tool_input={"text":"xin chào thế giới"}` = đúng `arguments` server nhận. Deny (`hook-deny`) → `is_error=true`, "PreToolUse:mcp__hub__hook-deny hook error: tool_not_allowed"; server **không** nhận call | ✅ |
| 5 | Key có `-` | `mcp__hub__translate-en`, `mcp__hub__hook-deny` giữ nguyên; `params.name="translate-en"` | ✅ |
| 6 | `ListMcpResourcesTool`/`ReadMcpResourceTool` | **Không xuất hiện** (server chỉ khai `capabilities.tools`) | ✅ (giữ luật hook phòng hờ) |
| 7 | `isError` + `content[0]` JSON + `content[1]` + `structuredContent` | `ToolResultBlock.is_error=True`, `content` là **chuỗi** = `content[0].text + "\n" + content[1].text` (ca thành công: `content` là **list** `[{type:text,text}]`). `structuredContent` **model không thấy** (marker `SC-ONLY-4711` chỉ ở đó → model báo "không có trường lạ"). Với `MCP_BLOCK` + `output_format`: model không gọi lại tool, `structured_output={status:"need_input", question:"Gửi email tới boss@example.com?", choices:["Gửi","Huỷ"]}` đúng nguyên văn | ✅ có lệch nhỏ (S2) |
| 8 | JSON thường, `GET`→405, không session; phiên bản | Chấp nhận JSON không SSE, `GET` 405, không `Mcp-Session-Id`. CLI **thử `server/discover` trước** (header `mcp-method: server/discover`, `mcp-protocol-version: 2026-07-28`, `id:"server-discover-probe-1"` — **chuỗi**, `params._meta` có `protocolVersion`/`clientInfo`/`clientCapabilities`). Trả `-32601` → lùi về `initialize` `protocolVersion:"2025-11-25"` → `notifications/initialized` → `GET` → `tools/list`. Trả result discover → chế độ **2026-07-28**: không `initialize`, mọi request có `mcp-method` (+ `mcp-name` khi `tools/call`), `params._meta` (`claudecode/toolUseId`, `progressToken`). **Bắt buộc**: mọi result có `resultType:"complete"`; `tools/list` có `ttlMs:number` + `cacheScope:"public"\|"private"`. Thiếu → `tools/list failed` (thử lại 3 lần) rồi server vẫn `connected` nhưng **0 tool, im lặng** | ⚠ lệch `plan.md` P7/§6 (S1) |
| 9 | Server 401 / tắt lúc init | 401 → `status:"failed"`, `error:"Server rejected the configured Authorization header (HTTP 401)… OAuth fallback is disabled when headers.Authorization is set."`; tắt → `failed`, `"ECONNREFUSED: Unable to connect…"`. CLI không chết, không tool hub. (Chỉ kiểm qua `get_mcp_status`; init `mcp_servers[].status` cùng dạng `{name,status,source}` ở ca connected) | ✅ |
| 10 | Token trên `/proc/<pid>/cmdline` | **File:** quét `/proc/*/cmdline` mọi process mỗi 50 ms suốt ca → **0** process chứa token; argv CLI chỉ có `--mcp-config /tmp/spike-mcp/.mcp/job1.json`. **Dict (đối chứng):** token thấy nguyên văn trên cmdline của `_bundled/claude` ⇒ loại. Sau các ca, `~/.claude/**` (transcript) không chứa token; log `--debug` ghi `"Authorization":"[REDACTED]"` | ✅ |

**Kết luận #1/#10: token qua file 0600 CHẠY ĐƯỢC** với `mcp_servers=<path>` + `strict_mcp_config=True`, không lộ trên argv ⇒ PY-04 **không** `blocked`; giữ đúng §4.2, không dự phòng argv.

## 2. Thêm: timeout tool
Server ngủ 15 s, env `MCP_TOOL_TIMEOUT=4000` → sau ~4 s `is_error=true`, `"MCP server \"hub\" tool \"slow-tool\" timed out after 4s"`; CLI gửi `notifications/cancelled` tới server; model không thử lại. Mặc định khi không đặt: chưa đo (debug ghi transport `timeoutMs:60000`, connect `30000ms`).

## 3. Lệch plan và sửa cần làm

| ID | Mức | Chỗ | Sửa |
|---|---|---|---|
| S1 | **Cao** | `plan.md` P7, §6 (`server/discover`), task **B8**, test-plan A52 | Nếu Hub trả result cho `server/discover`, mọi result 2026-07-28 PHẢI có `resultType:"complete"`, `tools/list` thêm `ttlMs` (số) + `cacheScope` (`"private"` — danh sách theo token job); `id` có thể là chuỗi; đọc tên tool từ `params.name` (header `mcp-name` chỉ là gợi ý). Thiếu ⇒ agent mất tool im lặng. Mặc định đề xuất: B8 thêm các trường trên khi phiên bản 2026-07-28 (đã kiểm chạy với CLI 2.1.286, `spike call-discover`); phương án lùi: trả `-32601` cho `server/discover` (CLI tự về `initialize` 2025-11-25 — đã kiểm). `initialize` phải giữ được `2025-11-25` (CLI gửi bản này, không phải 2025-06-18) |
| S2 | Thường | `plan-runtime` §5 / PY-05 `mapping` | `ToolResultBlock.content` là `str` khi lỗi (các khối text nối `\n`), `list[dict]` khi thành công ⇒ xử lý cả hai. `structuredContent` không tới model ⇒ Hub **phải** đặt `code/question/choices` trong `content[0]` JSON (như plan); không dựa vào `structuredContent` |
| S3 | Thường | `plan-runtime` §4.2 hàng "Env job host" ("không thêm biến khác") | Đề xuất PY-04 đặt `MCP_TOOL_TIMEOUT` (ms) = timeout tool phía Hub `/mcp` + biên, để CLI báo lỗi rõ thay vì treo tới timeout job; Hub nhận `notifications/cancelled` (notification → 202 như P7) |
| S4 | Thường | PY-04 `providers/claude/mcp.py`, log | `ClaudeSDKClient.get_mcp_status()` trả `config.headers.Authorization` **nguyên văn** ⇒ không log/không trả ra ngoài kết quả này (init `SystemMessage.mcp_servers` không chứa config — an toàn để log `status`) |
| S5 | Thường | `sandbox/hook.py` §4.3 | Hook chạy **trước** kiểm `allowed_tools`; spike chỉ kiểm hook trả `{}` (không quyết) ⇒ `dontAsk` vẫn chặn tool thiếu. PY-04 giữ "allow" = trả `{}`, **không** trả `permissionDecision:"allow"` tường minh (có thể vượt `allowed_tools` — chưa thử) |
| S6 | Thấp | §4.5 | Lỗi init (401/không tới) có chuỗi `error` rõ trong `get_mcp_status`; Runtime log `warn job.mcp_unavailable{status}` như plan, **không** log `error` nguyên văn nếu có URL nội bộ (tuỳ chọn) |

Không sửa `src/**` trong spike.
