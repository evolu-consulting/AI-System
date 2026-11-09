---
id: cr126-partner-pick-fix
lát: cr126-partner-pick-fix
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-engine, cr126-partner-pick-form (đã gộp)
---
## Plan (ngắn)
Sau gộp engine, e2e q6 + s7 đỏ ở `beforeAll` (422 FLOW_NODE_SPLIT): node «Gửi đối tác xác nhận» nay có BA stage (form + tool + chờ). Sửa kit e2e và ẩn ô cấu hình trùng.

## Làm
- `e2e/_kit/flows.ts` `partnerSendNode`: thêm stage form «Chọn đối tác & người nhận» (đúng khai báo node) đứng đầu cụm; bước kế dịch +1 ở q6/s7.
- q6/s7: bỏ `partner_tax_code` hằng (đặt hằng thắng giá trị người chọn), thêm sổ đối tác của A (`seedPartner`, vì HĐ mẫu không mang MST công ty nhận); chọn đối tác bằng ô tìm.
- `PortSchema.hidden` + node partner-send ẩn `partner_tax_code`/`partner_email` khỏi panel cấu hình (args cũ vẫn đọc được); admin-web `fieldsOf` lọc theo `hidden`.

## Không làm / Chạm
Không đổi engine; sản phẩm không có lỗi (cả hai đỏ là lỗi test dựng node cũ).

## Test tối thiểu
Unit: `fields.group.test.ts`, `panel-registry.test.ts`. e2e: chạy lại đúng job `journey-approval-journey` một lần.

## Quyết định trong lúc làm
- Chọn đối tác trong e2e bằng ô tìm MST (HĐ mẫu không có đối tác nên không điền sẵn) — phần điền sẵn đã có unit/int của engine.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Panel chung của node chọn nhóm phụ trách bằng ô chọn nhóm có sẵn
Cổng cấu hình có widget `group` (vd «Nhóm phụ trách gửi đối tác») hiện CÙNG ô chọn nhóm với widget `department`; không có ô riêng thứ hai. Khoá khai `hidden` của cổng
(vd đối tác và email của node «Gửi đối tác xác nhận», đã có ở bước «Chọn đối tác & người nhận») không hiện ở panel cấu hình nhưng vẫn lưu và đọc được trong args.
- Kịch bản: khi cấu hình node gửi đối tác thì không có ô mã số thuế và email đối tác, còn ô nhóm phụ trách [test: apps/admin-web/src/features/processes/modules/generic/fields.group.test.ts » node gửi đối tác: ô đối tác và email cũ bị ẩn khỏi panel cấu hình, nhóm phụ trách còn]

## Việc còn lại
- Kết quả chạy lại e2e `journey-approval-journey` ghi trong báo cáo lát.
