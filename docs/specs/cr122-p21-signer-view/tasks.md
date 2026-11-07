---
id: cr122-p21-signer-view
lát: cr122-p21-signer-view
cr: CR-122
làn: đầy đủ (RLS)
migration: contracts 0083_esign_signer_visible
phụ thuộc:
---
## Plan (ngắn)
Lỗi: bước Ký số của flow gửi phong bì cho người ký công ty (vd Giám đốc Hùng) nhưng HĐ còn `needs_review`, chế độ thấy `org` ⇒ người
ký ngoài cây của chủ HĐ không đọc được HĐ ("chưa được gửi duyệt hoặc không có quyền xem") ⇒ không bấm được "Ký ngay".
Sửa như nhánh người duyệt 0070: thêm `contracts.esign_signer_contract_ids()` (HĐ có phong bì ĐANG MỞ mà tôi là người ký công ty) vào
policy SELECT `contracts_visible`. UPDATE giữ nguyên.

## Làm
- [x] Migration gói contracts 0083 (hàm + policy SELECT), journal idx 79.
- [x] Int `tests/acceptance/cf-esign/signer-visible.int.test.ts`.

## Không làm / Chạm
Không đổi policy UPDATE, route, UI. Không chạm DLC.

## Test tối thiểu
`bun run test:int:par tests/acceptance/cf-esign/signer-visible.int.test.ts` + e2e evotest `journey-approval`.

## Quyết định trong lúc làm
- Chỉ phong bì mở (sent/delivered); xong/huỷ/từ chối ⇒ hết thấy theo nhánh này (HĐ đã xác nhận thì theo luật thấy thường).
- Hàm SECURITY INVOKER (contracts_rw đọc được `esign_envelopes` trong tenant), không tham số.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Người ký công ty thấy HĐ đang chờ ký
Người ký công ty (`signers[].client_user_id`) của phong bì đang mở (sent/delivered) của một HĐ ĐỌC được HĐ đó (trang HĐ, trạng thái ký số,
"Ký ngay", làm mới) dù ngoài cây quản lý của chủ HĐ (chế độ thấy `org`); không sửa được HĐ. Phong bì xong/huỷ/từ chối ⇒ hết thấy theo
nhánh này. Chỉ trong tenant của mình.
- Kịch bản: khi bước Ký số gửi phong bì cho người ký ngoài cây thì người đó mở HĐ, xem trạng thái, lấy link Ký ngay và làm mới được; editor không phải người ký và tenant khác vẫn không thấy [test: tests/acceptance/cf-esign/signer-visible.int.test.ts » người ký đọc HĐ + trạng thái + Ký ngay + làm mới, editor khác và tenant khác không thấy]
- Kịch bản: khi phong bì xong hoặc bị huỷ thì người ký hết thấy HĐ theo nhánh này [test: tests/acceptance/cf-esign/signer-visible.int.test.ts » phong bì xong hoặc huỷ ⇒ người ký hết thấy theo nhánh này]

## Việc còn lại
