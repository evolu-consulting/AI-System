---
id: fix-cr181-e2e
lát: fix-cr181-e2e
cr: CR-181
làn: nhanh
migration:
phụ thuộc:
---
## Plan (ngắn)
Điều tra 3 ca cr181 đỏ ở e2e cuối đợt (log `.data/evotest/20261120-011204-8032-e2e`): cả ba do TEST, không do code.

## Làm
- [x] `journey-3-vai.spec.ts:47`: dải người ký là avatar (CR-185/187: họ tên là tên truy cập + tooltip, không là chữ hiện) ⇒ tìm `getByRole("img", { name: "E2E Giám đốc" })`.
- [x] `first-login-signature.spec.ts:37`: nhân viên j03 đã có chữ ký vì `cr188-sig-docs.spec.ts` (chạy trước, cùng công ty j03 + cùng người) tạo chữ ký qua API ở `beforeAll` ⇒ không còn màn chặn. Chuyển `cr188-sig-docs` sang công ty `dot2` (nhân viên có sẵn chữ ký).
- [x] `partner-sign-link.spec.ts` (hết giờ `waitForResponse`): HỆ QUẢ của ca 1 — công ty q5 không có chữ ký sẵn, chữ ký của trưởng phòng/giám đốc do `journey-3-vai` (serial) tạo; ca K01 đỏ ⇒ các ca sau bị bỏ qua ⇒ trưởng phòng gặp màn «Tạo chữ ký của bạn» chắn trang HĐ (không có yêu cầu `/approval`). Không sửa riêng.

## Không làm / Chạm
Không đổi code sản phẩm. Ca `journey-dot2.spec.ts:200` (chữ «Tệp không khớp…») đã được sửa trước trên staging.

## Test tối thiểu
e2e `e2e/cr181/*` (điều phối chạy lại việc `cr181`; chưa chạy ở đây).

## Quyết định trong lúc làm
- Test sai, không phải code sai: spec CR-185 («tooltip CHỈ họ tên») và `docs/specs/CR-187/nghiep-vu.md` BR-188-4/5 không đòi tên hiện thành chữ ở dải người ký.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa e2e)

## Việc còn lại
Chạy lại việc `cr181` trên evotest.
