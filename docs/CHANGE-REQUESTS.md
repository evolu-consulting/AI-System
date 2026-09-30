# CHANGE REQUESTS

Mọi thay đổi yêu cầu sau khi thiết kế v0.4 chốt. Mới nhất ở trên. Commit liên quan ghi `[CR-xxx]`. Do `docs-architect` ghi sau khi người dùng chốt kết quả Intake.

| CR | Ngày | Nguồn | Yêu cầu (tóm tắt) | Loại | Ảnh hưởng (FR / spec / artboard) | Quyết định | Trạng thái |
|---|---|---|---|---|---|---|---|
| CR-005 | 2026-10-01 | Gate M0 | Duyệt M0: 5 câu hỏi theo mặc định (10 env, Bun 1.3.14, TS 6.0.3, commit đầu trên main, role DB quyết ở M1); ADR-0001/0003 Accepted; design 18 artboard duyệt hướng; chép canvas + token trước M1; tên tenant mẫu "Acme Việt Nam"; 8 câu màn mới theo mặc định | Quyết định | M0 spec, ADR-0001, ADR-0003, `_design/admin-missing-screens.md` §15 | Theo mặc định | Đã áp dụng |
| CR-004 | 2026-10-01 | chat | JWT dùng EdDSA thay HS256 | Mâu thuẫn | ADM-NFR-01, ADR-0001 | EdDSA | Đã áp dụng |
| CR-003 | 2026-10-01 | chat | Không hiện "Còn N lần thử" khi đăng nhập sai | Mâu thuẫn | ui-admin §7.1, artboard Đăng nhập | Bỏ | Đã áp dụng |
| CR-002 | 2026-10-01 | chat | 2FA + Import/Export vào M4 khi đủ artboard | Mới (lịch) | ADM-FR-08, 54 · ROADMAP M4 | Vào M4 | Đã áp dụng |
| CR-001 | 2026-10-01 | chat | Chấp nhận toàn bộ mặc định readiness Admin M1–M4 | — | `readiness/2026-10-01-admin-m1-m4.md` | Chấp nhận | Chờ đưa vào spec |
