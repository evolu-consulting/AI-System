---
id: cr125-x5-approver-default
lát: cr125-x5-approver-default
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: x3 (đã gộp)
---
## Plan (ngắn)
Báo lỗi: bước Duyệt vừa thả có "Ai duyệt" = "Beta testers". Kiểm mã: mẫu Duyệt trong bảng node (`flow-def.ts` NODE_TABLE) KHÔNG đặt nhóm, `groupId` mặc định "" và Lưu để áp dụng bị chặn khi trống (`def-form.ts`); danh sách chọn đã lọc nhóm kỹ thuật bằng `isApproverGroup` từ x3. "Beta testers" ở ảnh x4 là do ảnh chụp chọn lựa chọn ĐẦU TIÊN trên nhánh chưa có x3, không phải mặc định.

## Làm
1. Khoá hành vi bằng test: bước Duyệt mới chưa có người duyệt, Lưu bị chặn, danh sách chỉ có nhóm nghiệp vụ.
2. Lời nhắc trong ô "Ai duyệt" thành "Chọn người duyệt" (trước: "Chọn phòng ban…", không đúng với nhóm chức danh).

## Không làm / Chạm
- Không đổi luật nào; chỉ i18n `process.admin.editor.stage.approverPh` + test.

## Test tối thiểu
Unit `lib/x5-approver-default.test.ts`; e2e `cr123-arrow-drag.spec.ts` (U8, U12b) một lần.

## Quyết định trong lúc làm
- Không đặt mặc định nào cho người duyệt (nếu sau này cần, phải lấy từ `isApproverGroup`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Bước Duyệt mới chưa có người duyệt và buộc chọn trước khi Lưu (nguồn: CR-125 x5)
Bước Duyệt vừa thả không có người duyệt mặc định (ô nhắc "Chọn người duyệt"); Lưu để áp dụng bị chặn tới khi chọn; danh sách chỉ có phòng ban / chức danh, không có nhóm kỹ thuật.
- Kịch bản: khi thả bước Duyệt mới thì chưa có nhóm nào được chọn và Lưu bị chặn [test: apps/admin-web/src/features/processes/lib/x5-approver-default.test.ts » Lưu để áp dụng bị chặn tới khi chọn người duyệt, chọn rồi thì hết lỗi]
- Kịch bản: khi mở ô Ai duyệt của bước Duyệt mới trên flow thật thì hiện Chọn người duyệt, không phải Beta testers [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U8 · thả Duyệt đứng riêng, kéo mũi tên 'Ký xong' tới nó, kéo từ nó tới Kết thúc · Đã duyệt, Lưu và áp dụng thành công]

## Việc còn lại
- Không.
