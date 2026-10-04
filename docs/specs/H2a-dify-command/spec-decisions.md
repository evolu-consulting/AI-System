# H2a — Quyết định

## Trước Gate — người dùng trả lời (2026-10-05)
| # | Câu hỏi (spec §9) | Trả lời |
|---|---|---|
| Q1 | `hub_ro` không đọc được `admin.secrets` | **Theo mặc định:** migration phía Hub (`packages/db/migrations-hub/`) cho `hub_ro` SELECT đúng các cột bản mã (ciphertext/iv/…) của secret workflow; Hub giải mã bằng master key chung lúc gọi Dify (HUB-FR-04). Ghi CR-impact để phiên Admin rà khi combine |
| Q3 | Contract chat mới (`GET /commands`, `context`, `CMD_*`) | **Khác mặc định: sửa thẳng contract chat** (`packages/contracts/src/chat`), không tạo subpath `chat-ext`. Giới hạn: chỉ **thêm** (endpoint/schema/mã lỗi mới, trường tuỳ chọn), không đổi/xoá trường cũ; **không** sửa `apps/chat-web` và test khoá C1 (`tests/contract/chat`, `tests/acceptance/C1`). Thay đổi làm đỏ test khoá C1 → hard stop, báo lại |
| Q5 | Runtime lấy app-key Dify cho `workflow.async` | **Theo mặc định:** endpoint nội bộ của Hub, xác thực bằng token riêng của job; key không nằm trong payload job hay env Runtime |
| — | Codex/Gemini (H2d) | **Chưa có subscription** → H2d chỉ làm Gateway API + fallback + `llm`/`python` bằng provider giả; Codex/Gemini để sau |
| Q2, Q4, Q6–Q12 | (mức Thường) | Dùng mặc định trong spec §9 |
