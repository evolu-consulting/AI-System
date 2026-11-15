---
id: cr166-ui-fix
lát: cr166-ui-fix
cr: CR-166
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ba sửa UI nhỏ: menu «⋯» nổi trên mọi khung; ảnh/tệp bài Community căn giữa có lề; đổi chữ «Uy tín của mình».

## Làm
- [x] `PopMenu`: menu vẽ qua portal, `position: fixed` theo nút, lật lên gần mép dưới, đóng khi bấm ngoài/Esc (`menuPosition` thuần + unit).
- [x] `AttachGallery` thêm `align="center"` (mặc định `start` ⇒ chat không đổi); `PostMedia` bọc lề 19px trái / 16px phải như chữ bài.
- [x] i18n `contracts.vgaps.mine.*` + `pts.mine` VI/EN; sửa e2e deployed theo tên vùng mới.

## Không làm / Chạm
Không đổi API/contract. Không đổi chat-web.

## Test tối thiểu
`apps/workspace-web/src/components/shared/pop-menu.test.ts`; `bun run i18n:check`; e2e (chạy cuối đợt): `e2e/deployed/02-contracts-pages.deployed.ts`.

## Quyết định trong lúc làm
- `align` là prop tuỳ chọn để chat-web giữ căn trái.
- Khoá `pts.mine` không còn chỗ dùng trong code; vẫn đổi chữ cho nhất quán.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Ảnh và tệp trong bài căn giữa, lề đồng đều với chữ
Khối ảnh/tệp của bài nằm giữa thẻ, lề hai bên cùng chữ của bài; một ảnh giữ tỉ lệ, cao tối đa 360px.
- Kịch bản: khi lưới ảnh của bài căn giữa thì có lề tự động hai bên [test: packages/web-kit/src/attach-layout.test.ts » tên dài cắt giữa]

### MODIFIED pack-contracts/tin-nhan.md
#### Yêu cầu: Dải «Mình giữ hẹn với đối tác này»
Dải nói rõ là mức công ty mình giữ hẹn (thanh toán, giao hàng…) trong 90 ngày qua.
- Kịch bản: khi mở trang Đối tác thì thấy vùng «Mình giữ hẹn với đối tác này» nhắc đến mốc [test: e2e/deployed/02-contracts-pages.deployed.ts » Đối tác: dải 'Mình giữ hẹn với đối tác này' (C10) trên danh sách]

### MODIFIED contracts/partner-pick.md
#### Yêu cầu: Menu «⋯» không bị khung che
Menu nổi trên mọi khung và lật lên khi gần mép dưới màn.
- Kịch bản: khi nút gần mép dưới thì menu lật lên [test: apps/workspace-web/src/components/shared/pop-menu.test.ts » gần mép dưới màn ⇒ lật lên]
