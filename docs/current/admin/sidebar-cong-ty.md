# Admin · Sidebar lồng và workspace công ty

Cập nhật: 2026-11-09 · Gộp từ: cr112-nav (đợt cr125-wave).

## Yêu cầu: Sidebar lồng và workspace công ty (ADM-FR-76, ADM-FR-77) (nguồn: cr112-nav)
Sidebar có ba nhóm Nền tảng, Công ty, Hệ thống; Người dùng, Nhóm, Đối tác, Phân quyền nằm trong workspace công ty; route cũ chuyển hướng tới tab tương ứng; tenant_admin chỉ thấy công ty mình, không có nhóm Nền tảng và không có ô tìm.
- Kịch bản: khi platform_admin mở khung thì thấy ba nhóm theo thứ tự Nền tảng, Công ty, Hệ thống và các mục Người dùng/Nhóm/Đối tác/Phân quyền không còn trên sidebar [test: apps/admin-web/src/features/shell/lib/nav.test.ts]
- Kịch bản: khi platform_admin gõ vào ô tìm thì danh sách công ty lọc theo tên hoặc mã [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
- Kịch bản: khi mở /users?tenant=<mã> thì chuyển tới tab Người dùng của công ty đó, giữ query; chưa chọn công ty thì về danh sách công ty [test: apps/admin-web/src/features/tenants/lib/legacy-redirect.test.ts » platform_admin + ?tenant=<mã> ⇒ workspace công ty đó, giữ query, bỏ tenant]
- Kịch bản: khi tenant_admin mở khung thì sidebar chỉ có công ty mình, không nhóm Nền tảng [test: apps/admin-web/src/features/shell/lib/nav.test.ts]
- Kịch bản: khi tenant_admin mở workspace thì chỉ thấy các tab Thông tin, Ứng dụng & Gói (chỉ xem), Người dùng, Nhóm, Đối tác, Phân quyền, Agents [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]
- Kịch bản: khi tenant_admin vào khung trên trình duyệt thì sidebar chỉ có công ty acme, /users chuyển về tab Người dùng của acme, công ty khác báo không tìm thấy [test: e2e/cr112-nav.spec.ts]
