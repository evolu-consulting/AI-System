---
id: cr125-x2-sign-card
lát: cr125-x2-sign-card
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
CEO review sửa 3 (`docs/specs/CR-125/demo-assessment.md`): thẻ ký số của người ký có MỘT banner "Đến lượt bạn ký — hạn <ngày>" + MỘT nút "Ký ngay"; không còn "Làm mới trạng thái" (thẻ tự cập nhật: hỏi trạng thái mỗi 4 giây chỉ khi đang chờ ký và tab mở, dừng khi xong); "Huỷ ký" vào menu "…" kèm hộp xác nhận (nhập lý do); người không phải người ký thấy "Đang chờ <tên> ký", không nút.

## Làm
`ESignEnvelopeOut.due_at` (= lúc gửi + `due_h`, tính ở `envelopeOut`, không thêm SQL) và `signers[].is_you` (so với người xem). Web `esign-view` (luật thuần), `EsignPanel`, `use-esign` (refetchInterval), i18n vi/en. Thẻ không còn email người ký.

## Không làm / Chạm
Không migration, không đổi luồng gửi ký, không SSE (poll GET trạng thái có điều kiện).

## Test tối thiểu
Unit `esign-view.test.ts`, `esign-due-at.test.ts`; e2e mock `esign.cw.ts`; hành trình `cr123-u6-run-card.spec.ts` (job journey-approval) + ảnh `docs/specs/CR-125/shots/x2`.

## Quyết định trong lúc làm
`is_you` do server tính (client_user_id = người xem) vì `embedded` chỉ nói người ký ký trong app, không nói ai đang xem; hub cũ không có `is_you` ⇒ dùng `embedded` như trước.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Thẻ ký số theo lượt người xem
Người ký thấy banner "Đến lượt bạn ký — hạn <ngày>" và một nút "Ký ngay"; thẻ tự cập nhật sau khi ký; "Huỷ ký" trong menu "…" có xác nhận; người khác thấy "Đang chờ <tên> ký" không có nút.
- Kịch bản: HĐ chờ ký, người ký mở thẻ ⇒ banner + Ký ngay, không có Làm mới trạng thái; giám đốc không phải người ký ⇒ Đang chờ tên người ký, không Ký ngay [test: thủ công — e2e/journey-approval/cr123-u6-run-card.spec.ts (job journey-approval), ảnh docs/specs/CR-125/shots/x2]

## Việc còn lại
Đẩy trạng thái thật (SSE) thay cho poll 4 giây nếu cần.
