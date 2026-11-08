---
id: cr121-d3-cond-editor
lát: cr121-d3-cond-editor
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-d0 (fields/nodes của khe), D-2 song song (422 {bước, trường, câu sửa})
---
## Plan (ngắn)
Admin-web trình sửa Form của quy trình thư viện: trình dựng điều kiện theo `fields` của khe, thanh trạng thái + lỗi nhảy tới bước, nút thêm bước icon theo `nodes`.

## Làm
- Hub: `GET /process-slots` trả thêm `fields`/`nodes` (từ `SlotSpec`, D-0); DTO `SlotFieldSchema`/`SlotNodeSchema` + `SlotIssueSchema` thêm `step/field/fix` (tùy chọn).
- `lib/flow-when.ts` viết lại (thêm/sửa/xoá/nhóm lồng một cấp, mã lỗi); `FlowWhenEditor` + `FlowCondRow` thay control cũ (loại HĐ + giá trị cố định).
- Đầu trang Loại + nguồn + phiên bản, thanh trạng thái, bộ đếm n/20, `FlowAddNodes` chỉ icon, `publish-issues.ts` đọc lỗi xuất bản Hub.

## Không làm / Chạm
- Không làm API kiểm hợp lệ/preview (D-2), không đụng trang lượt chạy (R-3).
- Sửa nhẹ `PublishDialog` (callback `onIssues`) và `LibraryEditorBody` (giữ lỗi xuất bản) ngoài danh sách file D-3 — chỉ để nối lỗi vào thanh trạng thái.

## Test tối thiểu
- unit: `flow-when.test.ts`, `flow-form.test.ts`, `publish-issues.test.ts`. e2e `e2e/journey-approval/cr121-editor.spec.ts` (viết, chạy cuối đợt).

## Quyết định trong lúc làm
- Công tắc Danh sách | Sơ đồ dùng sẵn "Cách xem" của thanh công cụ (Sơ đồ = Canvas flow-canvas): không dựng control thứ hai, không thêm sơ đồ tĩnh.
- Nhãn trường lấy i18n `form.field.<key>` (thắng nhãn server): "Phòng ban người gửi duyệt" theo quyết định D-1.
- Node Dify chưa thêm được ở Form (cần chọn workflow): nút mờ + tooltip "thêm ở Canvas".
- Nguồn quy trình ("sao từ thư viện / bản sửa riêng") chưa có trường nguồn ở DTO def ⇒ hiện "Quy trình thư viện · đã xuất bản vN".
- Dạng lỗi xuất bản D-2 chưa chốt ⇒ parser chấp nhận `details.issues[{step|path, field, fix, rule}]`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Trình dựng điều kiện bước theo trường của app
Mỗi bước (trừ bước đầu) có "Chỉ chạy khi": chọn trường trong danh mục của khe, toán tử theo kiểu trường, giá trị; nhiều điều kiện ghép và/hoặc, nhóm lồng một cấp; trống = "Luôn chạy". Điều kiện thiếu giá trị (vd chưa chọn phòng ban) chặn lưu và hiện lỗi ở thanh trạng thái, bấm lỗi nhảy tới bước.
- Kịch bản: thêm Giá trị ≥ 500tr và Loại = Mua rồi nhóm "(phòng KD và ≥ 500tr) hoặc đối tác mới" ⇒ lưu, mở lại y nguyên [test: apps/admin-web/src/features/processes/lib/flow-when.test.ts » nhóm: (phòng KD và ≥ 500tr) hoặc đối tác mới]
- Kịch bản: điều kiện phòng ban chưa chọn phòng ⇒ chặn ở bước đó [test: apps/admin-web/src/features/processes/lib/flow-form.test.ts » điều kiện phòng ban chưa chọn phòng ⇒ chặn (condValueEmpty) ở bước 2]
- Kịch bản: lỗi xuất bản Hub (bước, trường, câu sửa) hiện ở thanh trạng thái và trỏ tới đúng bước [test: apps/admin-web/src/features/processes/lib/publish-issues.test.ts » dạng chuẩn {step,field,code,params}: khoá của mã + biến, kèm số bước]
- Kịch bản: thêm điều kiện, xuất bản bị chặn khi thiếu phòng ban [test: e2e/journey-approval/cr121-editor.spec.ts » thiếu phòng ban ⇒ chặn: báo lỗi ở thanh trạng thái, bấm nhảy tới bước, không cho lưu/xuất bản]

## Việc còn lại
- Chạy e2e `cr121-editor.spec.ts` cuối đợt (chưa chạy; selector chưa kiểm trên stack thật).
- Nguồn quy trình (sao từ thư viện) cần trường ở DTO def; khớp dạng 422 của D-2.
