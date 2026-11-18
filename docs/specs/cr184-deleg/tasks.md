# CR-184 · ý (5) · uỷ quyền khi vắng chạy với ký trên tài liệu

Lát `cr184-deleg`. Luật: A uỷ quyền `approve` cho B (đang hiệu lực, chưa thu hồi) ⇒ B có lượt ở bước duyệt có chữ ký của A; A uỷ quyền `esign` ⇒ B có lượt ở bước Ký `ondoc` thay A (A là người ký công ty, đích danh hoặc qua Group). B luôn ký bằng chữ ký CỦA B; bản ký ghi `on_behalf_of = A` (migration 0122, chỉ thêm). Không chọn `esign` ⇒ B không ký được bước Ký. Áp cả khi quản trị / trưởng phòng đặt thay (`for_user_id`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Người được uỷ quyền có lượt ký thay người vắng (CR-184)
Uỷ quyền còn hiệu lực loại `approve` (bước duyệt có chữ ký) hoặc `esign` (bước Ký `ondoc`) cho người làm thay lượt ký của người vắng; người làm thay Lưu bằng chữ ký của chính mình, bản ký ghi «thay <người vắng>» (Xem bản đã ký, Hồ sơ duyệt JSON + PDF). Hết hạn / thu hồi / không có loại phù hợp / người khác ⇒ không có lượt.
- Kịch bản: khi A uỷ quyền «Ký hợp đồng» cho B thì B ký bằng chữ ký của B và bản ký ghi thay A [test: apps/hub-api/src/modules/packs/sign-delegation.int.test.ts » A uỷ quyền esign cho B]
- Kịch bản: khi A chỉ uỷ quyền «Duyệt» thì B không ký được bước Ký [test: apps/hub-api/src/modules/packs/sign-delegation.int.test.ts » A chỉ uỷ quyền approve]
- Kịch bản: khi uỷ quyền hết hạn hoặc đã thu hồi thì không có lượt [test: apps/hub-api/src/modules/packs/sign-delegation.int.test.ts » uỷ quyền hết hạn hoặc đã thu hồi]
- Kịch bản: khi người bất kỳ mở màn ký thì không có lượt [test: apps/hub-api/src/modules/packs/sign-delegation.int.test.ts » người C bất kỳ]
- Kịch bản: khi A uỷ quyền «Duyệt» cho người ngoài nhóm thì người đó ký bước duyệt bằng chữ ký của mình [test: apps/hub-api/src/modules/packs/sign-delegation.int.test.ts » A uỷ quyền approve cho X]
- Kịch bản: luật thuần lượt ký + «thay ai» của bản ký [test: apps/hub-api/src/modules/packs/contracts/domain/sign-turn.rules.test.ts » bước Ký: A uỷ quyền esign cho B]

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Form uỷ quyền khi vắng dùng nhãn nghiệp vụ (CR-184)
Form «Uỷ quyền khi vắng»: «Người vắng», «Giao việc cho», loại «Ký hợp đồng» (thay «Ký số»), câu phụ «Trong thời gian này, việc mới của người vắng tự chuyển sang người được giao»; «Ký hợp đồng» chỉ chọn được khi người được giao thuộc nhóm người ký hợp đồng (`DELEGATE_NOT_SIGNER`, luật không đổi).
- Kịch bản: khi A đặt uỷ quyền cho B thì form dùng nhãn mới và B thấy việc của A [test: e2e/cr181/delegation-sign.spec.ts » trưởng phòng đặt uỷ quyền «Duyệt» cho kế toán]
- Kịch bản: khi người được uỷ quyền ký và Đạt thì hồ sơ duyệt ghi thay người vắng [test: e2e/cr181/delegation-sign.spec.ts » hồ sơ duyệt ghi người ký thật là kế toán và «thay» trưởng phòng]

## Quyết định trong lúc làm
- Một câu SQL cố định (`packRecordStepOf`) trả thêm `delegations` (uỷ quyền còn sống giao cho người gọi + Group của người vắng) và `behalfOf` của task; luật thuần `signTurnOf` / `onBehalfOfVersion`. Không thêm câu mỗi hàng.
- Bước duyệt dùng hàng giao việc `via='delegated'` (cùng nguồn với quyết định duyệt, `delegatedLive`) ⇒ một nguồn sự thật; chỉ bước Ký `ondoc` (không có task) đọc `hub.delegations` loại `esign`.
- Không thêm index `hub.delegations (tenant_id, to_user_id)`: bảng nhỏ theo công ty; nếu đo chậm sẽ thêm migration hub riêng.
- Đổi nhãn `issue.person` KHÔNG làm (e2e `cr127/j03` đang kiểm «Chọn người làm thay»).

## Việc còn lại
- Web: ô chỗ ký vẫn ghi tên A (đúng yêu cầu); chưa có ghi chú «bạn ký thay A» trên màn ký (SignTurn.behalf đã có trong phiên, UI chưa dùng).
