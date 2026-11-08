# danh sach flow cong ty

Cập nhật: 2026-11-08 · Nguồn: cr122-u2-editor-list. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Một danh sách flow của công ty (FLOW2-FR-05, FLOW2-FR-08, FLOW2-FR-20)
Công ty thấy MỘT danh sách flow nhóm theo app: tên, Bắt đầu khi, nguồn, trạng thái kèm lý do; bật/tắt, kéo thứ tự, Sao chép để sửa, Xuất bản, Quay về bản gốc; lỗi 409 nói cách sửa.
- Kịch bản: khi tắt/đổi thứ tự thì danh sách theo nhóm app và trạng thái tắt luôn kèm lý do [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » trạng thái luôn kèm lý do khi tắt]
- Kịch bản: khi kéo đổi chỗ thì chỉ đổi trong cùng app [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » kéo đổi thứ tự chỉ trong cùng app, giữ nguyên app khác]
- Kịch bản: khi Hub trả 409 thì hiện câu nghiệp vụ [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » lỗi 409 ra câu nghiệp vụ]
