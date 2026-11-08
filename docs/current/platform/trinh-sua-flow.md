# trinh sua flow

Cập nhật: 2026-11-08 · Nguồn: cr122-u1-editor. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Một trình sửa flow theo sự kiện của app (FLOW2-FR-02, FLOW2-FR-15, FLOW2-FR-16)
Flow có `trigger` mở ở MỘT trình sửa canvas: node Bắt đầu khi (sự kiện app khai + điều kiện AND/OR một cấp trên dữ kiện), bảng node theo manifest, node Kết thúc chọn kết quả của sự kiện; lỗi hiển thị theo `flowDefIssues`.
- Kịch bản: khi flow thiếu Kết thúc, kết quả lạ hoặc điều kiện sai kiểu dữ kiện thì báo đúng khoá lỗi [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » thiếu Kết thúc / kết quả lạ / sự kiện lạ báo đúng khoá]
- Kịch bản: khi đổi sự kiện thì bỏ vế dùng dữ kiện lạ và đưa Kết thúc về kết quả hợp lệ [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » đổi sự kiện bỏ vế lạ và đưa Kết thúc về kết quả hợp lệ]
- Kịch bản: khi dựng điều kiện thì tối đa 6 vế mỗi cấp, nhóm lồng một cấp [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » tối đa 6 vế mỗi cấp]
