# CHANGE REQUESTS

Mọi thay đổi yêu cầu sau khi thiết kế v0.4 chốt. Mới nhất ở trên. Commit liên quan ghi `[CR-xxx]`. Do `docs-architect` ghi sau khi người dùng chốt kết quả Intake.

| CR | Ngày | Nguồn | Yêu cầu (tóm tắt) | Loại | Ảnh hưởng (FR / spec / artboard) | Quyết định | Trạng thái |
|---|---|---|---|---|---|---|---|
| CR-010 | 2026-10-01 | Gate M1 | Đổi mật khẩu chế độ bắt buộc dùng `change_token` (300 s, một lần), không hỏi mật khẩu cũ; chế độ tự đổi vẫn cần mật khẩu cũ, sai tính vào khoá tạm (nới readiness #23) | Mâu thuẫn | ADM-FR-06, M1-R06, readiness #23 | Theo spec M1 | Đã áp dụng |
| CR-009 | 2026-10-01 | Gate M1 | Refresh: token vừa xoay dùng lại trong 10 s → 401 `REFRESH_SUPERSEDED`, không thu hồi chuỗi (bổ sung readiness #22, chống nhiều tab) | Mới | ADM-FR-02, M1-R07, readiness #22 | Ân hạn 10 s | Đã áp dụng |
| CR-008 | 2026-10-01 | Gate M1 | `VERSION_CONFLICT` = `{error:{code,message,details:{current, updated_at}}}`; `updated_by` thêm ở M4 (thay dạng cũ của readiness #4: `current/updated_by/updated_at` ngoài `error`) | Mâu thuẫn | M1-R19, readiness #4, UI 12.5 (AC-A07) | Dạng mới | Đã áp dụng |
| CR-007 | 2026-10-01 | Gate M1 | ADM-BR-08: "mỗi tenant active còn ≥ 1 tenant_admin" → đếm `tenant_admin` active ở **mọi** tenant, kể cả tenant đang khoá (mở khoá không bao giờ ra tenant không admin) | Mâu thuẫn | ADM-BR-08, M1-R11 | Chặt hơn BA | Đã áp dụng |
| CR-006 | 2026-10-01 | Gate M1 | ADM-FR-60 "CRUD tenant" → không có Xoá tenant ở v1 (chỉ Khoá); mã công ty và username bất biến | Mâu thuẫn | ADM-FR-60, FR-63, M1-R15 | Không Xoá | Đã áp dụng |
| CR-005 | 2026-10-01 | Gate M0 | Duyệt M0: 5 câu hỏi theo mặc định (10 env, Bun 1.3.14, TS 6.0.3, commit đầu trên main, role DB quyết ở M1); ADR-0001/0003 Accepted; design 18 artboard duyệt hướng; chép canvas + token trước M1; tên tenant mẫu "Acme Việt Nam"; 8 câu màn mới theo mặc định | Quyết định | M0 spec, ADR-0001, ADR-0003, `_design/admin-missing-screens.md` §15 | Theo mặc định | Đã áp dụng |
| CR-004 | 2026-10-01 | chat | JWT dùng EdDSA thay HS256 | Mâu thuẫn | ADM-NFR-01, ADR-0001 | EdDSA | Đã áp dụng |
| CR-003 | 2026-10-01 | chat | Không hiện "Còn N lần thử" khi đăng nhập sai | Mâu thuẫn | ui-admin §7.1, artboard Đăng nhập | Bỏ | Đã áp dụng |
| CR-002 | 2026-10-01 | chat | 2FA + Import/Export vào M4 khi đủ artboard | Mới (lịch) | ADM-FR-08, 54 · ROADMAP M4 | Vào M4 | Đã áp dụng |
| CR-001 | 2026-10-01 | chat | Chấp nhận toàn bộ mặc định readiness Admin M1–M4 | — | `readiness/2026-10-01-admin-m1-m4.md` | Chấp nhận | Chờ đưa vào spec |
