# Tasks · C1-chat-ui

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục tài liệu task cần (agent BUILD chỉ đọc chừng đó + bàn giao). Cột `Rủi ro` (`cao` / `thường`) quyết định model khi BUILD — định nghĩa trong `docs/WORKFLOW.md` mục "Chính sách model".

<!-- Khung. backend-lead / frontend-lead điền task sau PLAN (plan.md, plan-frontend.md). Nhóm gợi ý: contract zod · mock Hub (auth, hội thoại/flow, SSE + kịch bản, drop/Last-Event-ID) · bộ test contract · chat-web (khung, login, luồng flow, khung flow, sidebar, lỗi/kết nối, mobile) · e2e. -->

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T1 | … | backend-lead | cao / thường | `plan §…`, `spec §3 …` | `packages/contracts/src/chat.ts` (Q1) | — | `bun test …` | [ ] |
