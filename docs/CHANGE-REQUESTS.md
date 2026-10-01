# CHANGE REQUESTS

Mọi thay đổi yêu cầu sau khi thiết kế v0.4 chốt. Mới nhất ở trên. Commit liên quan ghi `[CR-xxx]`. Do `docs-architect` ghi sau khi người dùng chốt kết quả Intake.

| CR | Ngày | Nguồn | Yêu cầu (tóm tắt) | Loại | Ảnh hưởng (FR / spec / artboard) | Quyết định | Trạng thái |
|---|---|---|---|---|---|---|---|
| CR-014 | 2026-10-01 | Gate M2 | UI M2 lệch artboard/ui-admin: editor Workflows và Commands là **trang riêng** (`/x/new`, `/x/:id`) thay panel cạnh danh sách; bỏ panel "Chạy thử" (Test = M5) và "Kiểm tra kết nối"/"Lấy từ Dify"/"Lịch sử"; bước 2 artboard Workflows đổi thành "Chọn secret, khai báo input, viết mô tả. Chưa gắn cũng được"; giữ câu toast "có hiệu lực sau vài giây" ở design | Mâu thuẫn | ui-admin 7.4, 7.6, artboard Workflows/Commands, spec M2 §5, plan-frontend D2/D4/D5 | Theo spec M2 | Đã áp dụng |
| CR-013 | 2026-10-01 | Gate M2 | ADM-FR-24 (tab "Ai dùng được") tách: M2 chỉ phần tenant (feature `on\|beta` + entitlement/`core`, số user); phần group/grant/quyền hiệu lực để M3 | Mâu thuẫn (lịch) | ADM-FR-24, M2-R23, ROADMAP M2/M3 | Tách 2 phần | Đã áp dụng |
| CR-012 | 2026-10-01 | Gate M2 | ADM-FR-12 ("Lấy schema từ Dify", COULD) hoãn, không làm ở M2; ẩn nút; chỉ có test âm (không có route) | Mâu thuẫn (lịch) | ADM-FR-12, ROADMAP M2, spec M2 §1/§9 A8, test-plan G6 | Hoãn (chưa gán mốc) | Đã áp dụng |
| CR-011 | 2026-10-01 | Gate M2 | AC-A03 tách vế: M2 kiểm phía Admin (không lưu khi thiếu map, báo "thiếu input bắt buộc: target_lang", lưu được khi đủ); vế "≤ 5 giây trong menu `/`" đo ở Hub, cần NOTIFY `config_changed` (FR-53) nên để M3. Cùng lý do: hiệu lực kill switch (FR-33)/`beta` (FR-34) ở Hub, M2 chỉ lưu `status` | Mâu thuẫn (lịch) | AC-A03, ADM-FR-33, 34, 53, M2-R24, ROADMAP M2/M3 | Tách vế | Đã áp dụng |
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
