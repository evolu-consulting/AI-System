# trinh sua flow

Cập nhật: 2026-11-08 · Nguồn: cr122-u1-editor. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Một trình sửa flow theo sự kiện của app (FLOW2-FR-02, FLOW2-FR-15, FLOW2-FR-16)
Flow có `trigger` mở ở MỘT trình sửa canvas: node Bắt đầu khi (sự kiện app khai + điều kiện AND/OR một cấp trên dữ kiện), bảng node theo manifest, node Kết thúc chọn kết quả của sự kiện; lỗi hiển thị theo `flowDefIssues`.
- Kịch bản: khi flow thiếu Kết thúc, kết quả lạ hoặc điều kiện sai kiểu dữ kiện thì báo đúng khoá lỗi [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » thiếu Kết thúc / kết quả lạ / sự kiện lạ báo đúng khoá]
- Kịch bản: khi đổi sự kiện thì bỏ vế dùng dữ kiện lạ và đưa Kết thúc về kết quả hợp lệ [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » đổi sự kiện bỏ vế lạ và đưa Kết thúc về kết quả hợp lệ]
- Kịch bản: khi dựng điều kiện thì tối đa 6 vế mỗi cấp, nhóm lồng một cấp [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » tối đa 6 vế mỗi cấp]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Lưu và áp dụng không im lặng khi bước Ký số thiếu người ký (nguồn: cr125-ux-s3-canvas-save)
Khi lưu bị Hub từ chối vì cấu hình bước (vd Ký số chưa có người ký), trình sửa hiện thông báo nêu bước và lý do kèm nút "Đến bước"; bản sao từ Thư viện được điền sẵn người ký là nhóm duyệt của quy trình.
- Kịch bản: khi bỏ người ký rồi bấm Lưu và áp dụng thì thấy "Chưa lưu được" + "Đến bước", chọn người ký rồi lưu thì "Đã áp dụng" [test: e2e/journey-approval/cr125-s3-save-blocked.spec.ts » C3 · Lưu và áp dụng thiếu người ký nói rõ lý do rồi áp dụng được]
- Kịch bản: khi sao chép quy trình có nhóm duyệt thì bước Ký số có người ký là nhóm đó, không ghi đè người ký đã có [test: apps/hub-api/src/modules/processes/library/esign-signer-prefill.rules.test.ts » prefillEsignSigner]

