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
| X1 | `plan-db` §2 câu requeue: ngưỡng heartbeat `interval '60 seconds'` → `make_interval(secs => $1)` (cùng ngưỡng câu `failed` H1) | Hai câu chạy nối tiếp; ngưỡng `failed` H1 là tham số — nếu < 60 s, job `workflow.async` bị `failed orphaned` trước khi kịp requeue (vỡ AC-W06) |
| X2 | `plan-errors` §5: câu chỉ dẫn là `content[1].text` (không phải `content[0]`) | Mâu thuẫn `plan.md` §2.3 (`content[0].text` = JSON để Runtime parse, R6) |
| X3 | `plan-db` §3.2: kết quả xác nhận ghi đủ `content[0]` JSON + `content[1]` + `structuredContent` | Cùng X2 |
| X4 | `spec` AC-H01: `chat-ext` → `chat` | Q3 đã chốt sửa thẳng contract chat |
| X5 | Credential 401 → Runtime `NOT_CONFIGURED`/`credential` (trước: coi như mất job) | Theo `plan-errors` §2; tránh job treo `running` khi token lệch; SQL Kết thúc có `worker_id ∧ running` nên vô hại |
