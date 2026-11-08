# Admin · Tổng quan và Quota rút gọn

Cập nhật: 2026-11-09 · Gộp từ: cr112-wizard (đợt cr125-wave).

## Yêu cầu: Tab Tổng quan và Quota rút gọn cho tenant_admin (ADM-FR-77, Q11, Q14) (nguồn: cr112-wizard)
Workspace có tab Tổng quan chỉ đọc (số người dùng, ứng dụng đang bật, số vai, quota tháng run/token); tenant_admin thấy thêm tab Quota rút gọn chỉ đọc, không tiền, không gọi route chỉ-platform.
- Kịch bản: khi tenant_admin mở tab Quota thì thấy mức dùng run/token so với giới hạn, không có ô nhập, không có USD và không gọi daily-limits/grants-matrix/packs [test: e2e/cr112-wizard.spec.ts » ADM-FR-77 AC4 · tenant_admin: tab Quota rút gọn chỉ đọc (run/token, không tiền), không gọi route chỉ-platform]
- Kịch bản: khi tóm tắt công ty thì chỉ app đang bật được liệt kê kèm mức cao nhất [test: apps/admin-web/src/features/tenants/lib/overview.test.ts » chỉ liệt kê app đang bật, kèm mức cao nhất, app Tắt và core bị bỏ]
- Kịch bản: khi tenant_admin xem workspace thì thấy thêm tab Tổng quan và Quota [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]
