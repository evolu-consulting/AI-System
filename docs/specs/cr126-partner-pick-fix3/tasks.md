---
id: cr126-partner-pick-fix3
lát: cr126-partner-pick-fix3
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-fix2
---
## Plan (ngắn)
e2e q6/s7: «Gửi» ở bước «Chọn đối tác & người nhận» bị 422 FORM_VALUES_INVALID: kiểm giá trị form của engine (`form.rules.ts`) chỉ nhận
select có trong `options`, mà danh sách máy chủ cấp (`options_from`) có `options` trống. Sửa: `options_from` ⇒ nhận chuỗi gọn 1..200 ký tự,
không ký tự điều khiển (tool gói `PARTNER_NOT_IN_COMPANY` vẫn là cửa kiểm thuộc danh sách); ô text `format: "email"` kiểm `FORM_EMAIL_RE`.

## Không làm / Chạm
Perf: không. Đỏ có sẵn ngoài lát: form.rules.test.ts «FormExecutorSchema (def) › thuộc tính lạ» (đỏ cả trên base, do lát form).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Gửi bước chọn đối tác & người nhận
Người được giao gửi được đối tác chọn từ danh sách máy chủ cấp; email sai dạng bị từ chối ở máy chủ như ở giao diện.
- Kịch bản: khi chọn đối tác từ danh sách máy chủ cấp và email đúng dạng thì giá trị form hợp lệ [test: apps/hub-api/src/modules/processes/domain/form/form.rules.test.ts » select `options_from`]
- Kịch bản: khi email sai dạng hoặc giá trị chọn rỗng/quá dài thì máy chủ báo lỗi đúng ô [test: apps/hub-api/src/modules/processes/domain/form/form.rules.test.ts » chuỗi rỗng / quá 200 ký tự]
