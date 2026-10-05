# H2a · Smoke I2: Dify thật (`DIFY_LIVE=1`) và `claude-sub` gọi MCP (`HUB_LIVE=1`), chạy 2026-10-05

Phụ lục của `test-plan-cases.md` §3 (M01, M02). Người chạy: backend-lead. Cách lấy key Dify theo `spec-decisions.md` "Gate duyệt": key chỉ được đọc lúc chạy từ `DIFY_LIVE_ENV_FILE` (file `.env` của auto-pilot), không chép vào repo.

**Môi trường**
- Windows: compose Postgres/Redis. DB **riêng** `ai_system_h2a_smoke_test` (tạo + migrate Admin/Hub bằng `prepareDb` của `tests/acceptance/H1/_fixtures.ts`), Redis DB 13. Dữ liệu dùng fixture H1 + catalog `_h2a.ts` (`insertCatalog`, `insertH2aAgents`), rồi sửa cho Dify thật bằng script tạm ở scratchpad (không commit):
  - workflow `dich` trỏ app **translate** (Dify `workflow`, input `text` và `target_lang`). Lệnh `/dich`, `/dich-async`, `/cham` có map `text←arg text`, `target_lang←arg lang`.
  - workflow `tro-ly` trỏ app **chatbot** (Dify `agent-chat`). Agent `dify-tro-ly` có runtime `dify-agent`.
  - agent `trello` dùng profile `claude-sub-1`, có tool `dich` và `create-trello-card` (`side_effect`). Secret của `create-trello-card` là key giả nên Dify thật trả 401, không có tác dụng phụ.
  - Secret mã hoá bằng khoá master **test** của `_h2a.ts`. JWT ký bằng cặp khoá tạm.
- hub-api: `apps/hub-api/src/server.ts`, cổng `:4100`, `APP_ENV=development`, `LOG_LEVEL=debug`, `HUB_INTERNAL_TOKEN` sinh ngẫu nhiên, `HUB_PUBLIC_INTERNAL_URL=http://172.26.0.1:4100` (xem F2).
- agent-runtime: chạy trong WSL Ubuntu, user `worker`, venv `~/.venvs/agent-runtime`, lệnh `uv run --frozen`. Cấu hình: `AGENT_RT_PROVIDERS=fake-cli,claude-sub,dify`, `AGENT_RT_HUB_URL=http://172.26.0.1:4100`. Orchestrator dùng `fake-cli` (`#fake:delegate=<agent>`) để lời gọi model thật chỉ dành cho agent.
- Dify: `http://149.202.83.5:4203/v1`. Trước khi gọi đã kiểm tra `GET /info` và `/parameters`:
  - translate: `workflow`, không có tác dụng phụ.
  - chatbot: `agent-chat` "Trello Refine→TechCard". App này có công cụ ghi Trello nhưng phải xác nhận trước khi ghi, nên smoke chỉ gửi câu chào hoặc câu hỏi và yêu cầu "không dùng công cụ".
  - `DIFY_AGENT_API_KEY`: Dify trả **401** (key không hợp lệ), nên bỏ qua.
  - Không gọi Gmail, misa, extract hay app gửi mail hoặc ghi dữ liệu.
- Client: script Bun gọi HTTP/SSE trực tiếp (helper `send`/`openSse` của `H1/_hub.ts`), user `acme/lan`.

## Kết quả

| # | Kịch bản (M01/M02) | Kết quả | Số đo |
|---|---|---|---|
| 1a | Sync `/dich en <câu tiếng Việt>` → translate thật | ✅ `run.started → step.started → 23 delta → step.finished → run.finished`. Delta về theo 3 đợt chunk (3974/4179/4204 ms), nghĩa là Dify có stream thật. Bản dịch đúng | tổng 4,27 s, delta đầu 3,97 s, `step.started` sau 106 ms. Dify `elapsed` 2,95 s |
| 1b | `user` gửi Dify | ✅ Log Dify (`/workflows/logs`) ghi `session_id = acme:<user_id>` cho mọi run. Chat thì `GET /conversations?user=acme:<user_id>` trả đúng hội thoại của smoke | — |
| 1c | `usage_logs` có token thật | ✅ `dify/dify/model NULL`. Ví dụ: workflow `input_tokens=186` (= `total_tokens` Dify), `output_tokens=0`, `feature_id`=translate, `latency_ms` 4104 | — |
| 1d | Key sai → `NOT_CONFIGURED` | ✅ Dify trả 401, Hub phát `run.failed NOT_CONFIGURED` với câu tĩnh. `run_steps.detail.upstream` chứa thân 401 của Dify, không có key. Không ghi usage | 0,68 s |
| 1e | Huỷ giữa chừng (E15 sau delta đầu) | ✅ phía Hub: `run.failed CANCELLED` 47 ms sau khi gọi huỷ, run `cancelled`. Qua proxy ghi log thấy Hub gọi `POST /workflows/tasks/<task>/stop`, Dify trả **200 `{"result":"success"}`**. ⚠️ phía Dify: log vẫn `running`, `total_tokens 0` (xem F1) | huỷ tới SSE đóng 47 ms. Usage 1 dòng 0 token |
| 2 | Async `/dich-async ja …` → job `workflow.async` ở Runtime (WSL) | ✅ credential lấy qua `/internal/jobs/:id/dify-credential`, `dify.attempt n=1`, job `succeeded` (attempts 1), `result.kind=text`. SSE như sync, 1 step `workflow` (`provider_key=dify`). `usage_logs` có `billing=dify` (179 token), `feature_id`=translate, `agent_id NULL` | tổng 2,34 s, Dify 1,78 s |
| 3 | `dify-agent` (chatbot) 2 lượt cùng hội thoại | ✅ Lượt 1 "Mình tên là Lan" thì bot chào "Chào Lan!…". Lượt 2 "Mình tên là gì?" thì bot trả "Bạn tên là Lan." `cli_sessions` (`provider_key=dify`) có 1 dòng, cùng `session_id` (= `conversation_id` Dify) qua 2 lượt. Step `delegate` `provider=dify` | 3,98 s / 2,95 s. Token 2921→25 và 2974→6, `cost_usd` 0,006042 / 0,005996 (Dify trả USD) |
| 4 | `claude-sub` gọi `mcp__hub__dich` qua `/mcp` | ✅ Orchestrator (fake) delegate sang `trello` (Claude thật, `claude-opus-5-5`). Model gọi tool → step `tool` `ok` (`workflow_id`=dich, input đã ghi), Hub gọi Dify một lần. Model trả đúng kết quả tool: "Thank you very much for your help." File cấu hình MCP `work/.mcp/` trống sau khi job xong | tổng 14,7 s (CLI 13,0 s, tool Dify 1,54 s). Token Claude 7187/185 |
| 5 | `side_effect`: `mcp__hub__create-trello-card` → `ask` → "Đồng ý" | ✅ Lượt 1: tool trả `CONFIRMATION_REQUIRED` mà không gọi Dify. Agent trả `need_input`, SSE `ask` có choices `[Đồng ý, Huỷ]`, có 1 dòng `tool_confirmations` `pending`. Lượt 2 "Đồng ý": step `confirmed` → model gọi tool → `consumed` → **đúng 1** lời gọi Dify (401 do key giả → `isError` `NOT_CONFIGURED`) → model báo không tạo được thẻ. Lần gọi lại sau đó trong cùng run → lại `CONFIRMATION_REQUIRED` (R22 đúng, xem F3) | lượt 1: 12,6 s. Lượt 2: 26,2 s (2 job Claude) |
| 6 | Không lộ key | ✅ Quét `leakForms` (thô/base64/base64url/hex) của 2 key thật: log hub-api (3 file), `runtime.log` + log job Runtime (26 file, 23,8 KB) và dump DB (`runs`, `run_steps`, `messages`, `jobs`, `usage_logs`, `tool_confirmations`, `cli_sessions`, 91 KB) đều **0 lần xuất hiện**. Log hub-api không có dòng warn/error | — |

**Không chạy (ghi lý do):**
- M02 vế "model thấy mô tả mới sau khi sửa ở Admin": để tiết kiệm lượt Claude. Đã có ca stack S02 với `fake-cli` qua `/mcp` thật.
- Vế `ps -o args` không thấy token: job Claude kết thúc trước khi kịp chụp. Đã phủ bởi P01 (int) và `spike-mcp.md`.
- Agent `dify-workflow` với app thật: translate có 2 input bắt buộc nên seed sẽ từ chối (R48). Không có app workflow một input phù hợp.

**Ngân sách đã dùng**
- Lời gọi Dify chạy app: **9**. Gồm translate sync 4 (ok, key sai/401, huỷ ×2), async 1, chatbot 2, tool MCP 1, tool xác nhận 1 (401, key giả). Thêm **2** lời gọi `stop`.
- Lời gọi Dify chỉ đọc metadata: 11 (`/info`, `/parameters`, `/workflows/logs`, `/conversations`).
- Claude thật: **4 job** `claude-sub`. Token vào/ra: 7187/185 · 7291/227 · 8513/322 · 9837/228. Orchestrator dùng `fake-cli`.

## Lỗi / phát hiện

| # | Mức | Nơi | Mô tả | Trạng thái |
|---|---|---|---|---|
| F1 | Thấp (giới hạn Dify) | Dify server | Huỷ workflow streaming: Hub gọi stop và Dify trả `success`, nhưng `/workflows/logs` vẫn để run ở `running`, `total_tokens 0` (2/2 lần, sau > 1 phút). Vế M01 "Dify hiện `stopped`" không quan sát được trên bản Dify này. Run không chạy hết (không có token, không `succeeded`) | Phía Hub đúng R10. Đề xuất (task sau, không bắt buộc): ghi `stop_ok` vào `run_steps.detail` để kiểm được mà không cần proxy |
| F2 | Thường (tài liệu/môi trường) | `docs/guides/hub-dev.md`, `.env.example` | WSL trên máy dev đang chạy **NAT** (không có `.wslconfig` mirrored). Trong WSL, `localhost:5432/6379` vẫn tới được nhờ Docker Desktop, nhưng `localhost:<cổng Hub Windows>` thì bị từ chối kết nối. Phải đặt `HUB_PUBLIC_INTERNAL_URL` và `AGENT_RT_HUB_URL` bằng IP Windows nhìn từ WSL (`ip route` default gateway, ví dụ `172.26.0.1`). Giá trị mặc định `http://localhost:4000` chỉ đúng khi bật mirrored | Ghi cho I3: runbook thêm cách lấy gateway. Không sửa code |
| F3 | Thấp (công cụ test) | `providers/fake/directives.py` `redelegate_message` | Orchestrator `fake-cli` delegate lại **ở mọi bước** của run khi tin hiện tại là "Đồng ý". Sau khi agent trả kết quả, bước Orchestrator kế tiếp lại delegate thêm lần nữa, sinh 1 job Claude thừa và 1 `ask` mới. Orchestrator thật không có hành vi này. Hub vẫn đúng R22 (lần hai → `CONFIRMATION_REQUIRED`, Dify chỉ bị gọi 1 lần) | Ghi nhận, không sửa (ngoài phạm vi I2). Đề xuất: chỉ delegate lại khi `<history>` của run chưa có kết quả delegate |
| F4 | Thông tin | auto-pilot `.env` | `DIFY_AGENT_API_KEY` bị Dify trả 401 (key hết hạn hoặc bị thu hồi) | Báo người dùng. Smoke không cần key này |
| F5 | Thông tin | Hub usage (R15) | Run sync bị huỷ ghi 1 dòng `usage_logs` 0 token, vì Dify không trả usage khi stop. Đúng R15 ("đã có `task_id`") | Ghi nhận |

**Dọn dẹp:** đã dừng hub-api và Runtime, xoá `~/smoke-h2a` trong WSL, `DROP DATABASE ai_system_h2a_smoke_test`, `FLUSHDB` Redis 13. I3 không cần giữ DB. Không đổi DB dev `ai_system`. Không đụng Admin hay `apps/chat-web`.
