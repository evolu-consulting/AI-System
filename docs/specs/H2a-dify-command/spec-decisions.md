# H2a — Quyết định

## Trước Gate — người dùng trả lời (2026-10-05)
| # | Câu hỏi (spec §9) | Trả lời |
|---|---|---|
| Q1 | `hub_ro` không đọc được `admin.secrets` | **Theo mặc định:** migration phía Hub (`packages/db/migrations-hub/`) cho `hub_ro` SELECT đúng các cột bản mã (ciphertext/iv/…) của secret workflow; Hub giải mã bằng master key chung lúc gọi Dify (HUB-FR-04). Ghi CR-impact để phiên Admin rà khi combine |
| Q3 | Contract chat mới (`GET /commands`, `context`, `CMD_*`) | **Khác mặc định: sửa thẳng contract chat** (`packages/contracts/src/chat`), không tạo subpath `chat-ext`. Giới hạn: chỉ **thêm** (endpoint/schema/mã lỗi mới, trường tuỳ chọn), không đổi/xoá trường cũ; **không** sửa `apps/chat-web` và test khoá C1 (`tests/contract/chat`, `tests/acceptance/C1`). Thay đổi làm đỏ test khoá C1 → hard stop, báo lại |
| Q5 | Runtime lấy app-key Dify cho `workflow.async` | **Theo mặc định:** endpoint nội bộ của Hub, xác thực bằng token riêng của job; key không nằm trong payload job hay env Runtime |
| — | Codex/Gemini (H2d) | **Chưa có subscription** → H2d chỉ làm Gateway API + fallback + `llm`/`python` bằng provider giả; Codex/Gemini để sau |
| Q2, Q4, Q6–Q12 | (mức Thường) | Dùng mặc định trong spec §9 |

## PLAN backend-lead (TS/DB/contract) — 2026-10-05
Chi tiết: `plan.md` §1 (P1–P15), trả lời plan-runtime §9 ở `plan.md` §10.
| # | Quyết định | Lý do ngắn |
|---|---|---|
| P1 | Q1 bằng hàm `hub.workflow_secret` SECURITY DEFINER (EXECUTE `hub_ro`), không GRANT cột `admin.secrets` | GRANT cột làm sai test khoá M2 `db-rls` (`select id … as hub_ro` → 42501) trên DB đã chạy migration Hub |
| P2 | Usage Dify của Hub qua hàm `hub.log_dify_usage` | Test khoá H1 A51: `hub_api` không INSERT `usage_logs` |
| P3 | Q3: `CMD_*` ở hằng riêng `CHAT_COMMAND_ERRORS`, không thêm vào `CHAT_API_ERRORS` | `chat/entities.test.ts:142` assert đúng 6 mã; `tools/mocks/src/chat/http.ts` `Record<ChatErrorCode>` |
| P4 | Token job do Runtime sinh lúc claim, chỉ lưu hash (chỉnh R18; từ chối `job_token` trong payload) | Payload nằm trong DB — token rõ trong payload = token rõ trong DB |

## Đối chiếu plan Hub ↔ Runtime — backend-lead, 2026-10-05
Runtime theo plan TS (`plan.md` §10): token sinh lúc claim (RT1), payload không token/URL, requeue hai câu (R7), reason `credential`/`upstream`, xác nhận R6. Bảng ✓/✗: `plan-runtime.md` §9; chi tiết gọi Dify tách `plan-runtime-dify.md`.
| # | Sửa phía TS / spec | Lý do |
|---|---|---|
| X1 | `plan-db` §2 câu requeue: ngưỡng heartbeat `make_interval(secs => $1)` — Hub `$1 = 60` (cùng hằng H1 phía Hub), Runtime `$1 = AGENT_RT_ORPHAN_S` (cùng `SWEEP_ORPHANS`) | Hai câu chạy nối tiếp; ngưỡng `failed` H1 là tham số — nếu < 60 s, job `workflow.async` bị `failed orphaned` trước khi kịp requeue (vỡ AC-W06) |
| X2 | `plan-errors` §5: câu chỉ dẫn là `content[1].text` (không phải `content[0]`) | Mâu thuẫn `plan.md` §2.3 (`content[0].text` = JSON để Runtime parse, R6) |
| X3 | `plan-db` §3.2: kết quả xác nhận ghi đủ `content[0]` JSON + `content[1]` + `structuredContent` | Cùng X2 |
| X4 | `spec` AC-H01: `chat-ext` → `chat` | Q3 đã chốt sửa thẳng contract chat |
| X5 | Credential 401 → Runtime `NOT_CONFIGURED`/`credential` (trước: coi như mất job) | Theo `plan-errors` §2; tránh job treo `running` khi token lệch; SQL Kết thúc có `worker_id ∧ running` nên vô hại |

## Ghi chú khi combine (readiness lần 1)
| # | Ghi chú |
|---|---|
| C1 | `/internal/*` và `/mcp` (token Bearer bản rõ) **bắt buộc TLS hoặc mạng nội bộ** khi Runtime chạy ở máy khác Hub; cùng máy (WSL2 mirrored, `localhost`) không cần. Chuyển vào `docs/PRODUCTION-NOTES.md` khi combine (không sửa file dùng chung ở H2a) |

## Gate duyệt — 2026-10-05
- Người dùng duyệt Gate H2a (ADR-0010 Accepted; Q1 bằng hàm `hub.workflow_secret` SECURITY DEFINER; Q3 contract chat chỉ thêm).
- **Dify thật:** người dùng chỉ định lấy cấu hình ở `D:\AI\evoluconsulting\auto-pilot`. Dify API `http://149.202.83.5:4203/v1` (kiểm 2026-10-05: `GET /parameters` app translate → 200, 0,54 s). App-key ở `apps/copilot-hub/.env` (`DIFY_KEY_TRANSLATE`, `DIFY_KEY_CHATBOT`, `DIFY_AGENT_API_KEY`, `DIFY_EXTRACT_API_KEY`, `DIFY_KEY_GMAIL`…) và `apps/extension-hub/.env` (`WXT_DIFY_KEY_MISAINVOICECHECK`). **Không chép key vào repo này:** smoke `DIFY_LIVE=1` đọc key lúc chạy qua env `DIFY_LIVE_ENV_FILE` (đường dẫn tới file `.env` của auto-pilot) và seed vào `admin.secrets` (mã hoá) của DB dev/smoke. Smoke M01 không còn "blocked W1" — chạy được sau khi B*/PY xong.
- **Rủi ro (combine/production):** Dify đang mở HTTP thường trên IP công khai — app-key đi không mã hoá. Ghi để xử lý trước production (TLS hoặc mạng nội bộ).

## BUILD — C2 (backend-lead, 2026-10-05)
| # | Quyết định | Lý do |
|---|---|---|
| B-C2-1 | `WorkflowAsyncJob.inputs` ≤ 50 khoá là luật Hub, không ở schema | `z.record` không có `maxProperties` hai phía (cấm `refine`, H1 §2); Hub dựng từ `input_map` ≤ `INPUT_SCHEMA_MAX` |
| B-C2-2 | `HUB_JSON_SCHEMAS` thêm `JobPayloadWorkflowAsync` (→ `$ref` trong `JobPayload`, pydantic `JobPayloadWorkflowAsync`; `agent.cli` giữ `JobPayload1`) và `DifyCredentialResponse` (từ `hub-internal`, cho PY-02) + fixture | Tên model ổn định cho `plan-runtime` §3.1; mẫu hai chiều C2 |
| B-C2-3 | Header `hub.py` sinh thêm `# pyright: reportInvalidTypeForm=false` (`tools/contracts-gen/hub.ts`) | datamodel-codegen sinh `dict[constr(pattern=…), …]` cho khoá regex; hợp lệ lúc chạy |
| B-C2-4 | `apps/hub-api` runner (H1) gõ kiểu `AgentCliJob` thay `JobPayload` | `JobPayload` thành union → `p.agent` lỗi kiểu; B6 mở rộng cho `workflow.async` |

## BUILD — PY-S1 (spike MCP, `spike-mcp.md`) — 2026-10-05
- Token MCP qua file 0600 + `strict_mcp_config=True`: **đạt** (#1, #10) — không token trên `/proc/*/cmdline` ⇒ PY-04 không `blocked`.
- Áp mặc định của biên bản (điều phối): S1 → `plan.md` §6 (`server/discover` chế độ 2026-07-28: `resultType`, `ttlMs`, `cacheScope:"private"`, `id` chuỗi; `initialize` 2025-11-25) + `test-plan.md` A52 (trước QW, test chưa viết); S2 → `plan-runtime` §5 (content str tách tại `
` đầu); S3 → §4.2 `MCP_TOOL_TIMEOUT`; S4 → §4.2 không log `get_mcp_status`; S5 → §4.3 allow = `{}`.
- Biên bản đổi tên `spike-s1.md` → `spike-mcp.md` cho khớp tasks/plan-runtime/test-plan-cases.
