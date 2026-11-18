---
id: cr184-deleg2
lát: cr184-deleg2
cr: CR-184
làn: nhanh
migration: 0158 (hub, chỉ thêm)
phụ thuộc: cr184-deleg (đã gộp f26f72da5)
---
## Plan (ngắn)
Form «Uỷ quyền khi vắng» một câu + «Đang uỷ quyền» + «Lịch sử uỷ quyền» (API tải dần) + dòng «Bạn đang ký thay A» ở màn ký + minor soát Opus.

## Làm
- [x] Migration hub 0158: `hub.delegations.revoked_by` + index đếm việc làm thay (`review_task_assignees_delegated_idx`) + `delegations_history_idx`.
- [x] API: `GET /me|/tenants/:tid/delegations/history` (limit ≤ 50, `next_offset`, MỘT câu SQL), `.../:id/work`, `GET /me/delegations/esign-eligible`; DELETE ghi `revoked_by`.
- [x] Web: `DelegationPane` (một câu, nút bật/tắt loại việc, khoá «Ký hợp đồng» + tooltip), `PersonPick` (avatar + họ tên), `DelegationHistory`; `SignTopBar` dòng «Bạn đang ký thay …».
- [x] Minor Opus: #1 ca int quản trị đặt thay; #3 sắp `delegs` theo `from_at, id`; #2 ghi `docs/TECH-DEBT.md` #296.

## Không làm / Chạm
- Không đổi luật `DELEGATE_NOT_SIGNER`, không đổi cách áp uỷ quyền khi giao việc.
- Tiêu đề hợp đồng trong danh sách «việc đã làm thay» chưa có (hub không đọc được `contracts.*`): hiện tên bước + giờ, bấm mở hợp đồng.
- Test khoá bị ảnh hưởng (qc sửa): `e2e/cr127/j03-uy-quyen.spec.ts` ca «A đặt uỷ quyền cho B từ Cài đặt › Quy trình duyệt» (`#dg-to` là ô tìm ngày xưa; nay `delegation-to` là nút mở danh sách, gõ ở ô tìm trong danh sách).

## Test tối thiểu
unit: `lib/delegation.test.ts`; int evotest: `delegations-history.int.test.ts`, `sign-delegation.int.test.ts`, `delegations.int.test.ts`; e2e (viết, chưa chạy): `e2e/cr181/delegation-sign.spec.ts`.

## Quyết định trong lúc làm
- Lịch sử: người thường (`/me`) thấy uỷ quyền có mình; quản trị công ty / trưởng phòng đi đường `/tenants/:tid` (luật R#43 cũ). Trạng thái tính ở SQL: thu hồi > hết hạn > còn hiệu lực (chưa bắt đầu tính «còn hiệu lực»).
- «Số việc làm thay» = việc đã đóng do B quyết trong [from_at, to_at) có hàng giao `via='delegated'` thay đúng A; một câu SQL, subquery tương quan trên ≤ 50 hàng/trang.
- Khoá «Ký hợp đồng»: hỏi `esign-eligible` (cùng `contractAccess().isSigner` với luật lưu) sau khi chọn người; không đoán ở web.
- `SignTurnOut.behalf` ra web chỉ gồm `user_id` + tên (không lộ Group).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Form uỷ quyền khi vắng là một câu và có lịch sử (CR-184)
Form: «[Tôi ▾] vắng từ [ngày] đến hết [ngày] giao việc [Duyệt] [Ký hợp đồng] [Bổ sung thông tin] [Xác nhận mốc] cho [người ▾] [Lưu uỷ quyền]»; ô «Người vắng» chỉ hiện với quản trị công ty; mặc định bật «Duyệt»; «Ký hợp đồng» khoá kèm lý do khi người nhận không thuộc nhóm người ký. «Đang uỷ quyền» chỉ gồm bản chưa thu hồi và chưa hết hạn. «Lịch sử uỷ quyền» (thu gọn, tải dần): ai vắng → giao ai, ngày, loại việc, ai đặt, trạng thái (còn hiệu lực / hết hạn / đã thu hồi + ai thu hồi, lúc nào), số việc đã làm thay và danh sách việc. Người thường thấy uỷ quyền có mình; quản trị công ty thấy cả công ty.
- Kịch bản: khi A đặt uỷ quyền chọn «Duyệt» cho B thì form một câu lưu được và dòng hiện ở «Đang uỷ quyền» [test: e2e/cr181/delegation-sign.spec.ts » trưởng phòng đặt uỷ quyền «Duyệt» cho kế toán]
- Kịch bản: khi mở «Lịch sử uỷ quyền» thì thấy trạng thái, số việc đã làm thay và mở được hợp đồng [test: e2e/cr181/delegation-sign.spec.ts » Lịch sử uỷ quyền (thu gọn)]
- Kịch bản: khi uỷ quyền hết hạn, thu hồi hoặc quản trị đặt thay thì lịch sử ghi đúng trạng thái, người đặt, người thu hồi, số việc [test: apps/hub-api/src/modules/processes/delegations/delegations-history.int.test.ts » trạng thái, người đặt thay, người thu hồi]
- Kịch bản: khi người thường mở lịch sử thì chỉ thấy uỷ quyền có mình, quản trị thấy cả công ty [test: apps/hub-api/src/modules/processes/delegations/delegations-history.int.test.ts » phạm vi xem]
- Kịch bản: khi lịch sử dài thì tải dần theo trang [test: apps/hub-api/src/modules/processes/delegations/delegations-history.int.test.ts » tải dần]
- Kịch bản: khi người không liên quan mở việc làm thay của uỷ quyền thì bị từ chối, người thu hồi được ghi [test: apps/hub-api/src/modules/processes/delegations/delegations-history.int.test.ts » danh sách việc làm thay]
- Kịch bản: mặc định chỉ bật «Duyệt» và bỏ «Ký hợp đồng» khi người nhận không thuộc nhóm người ký [test: apps/workspace-web/src/features/settings/lib/delegation.test.ts » mặc định chỉ bật]

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Màn ký nói rõ khi ký thay người vắng (CR-184)
Khi lượt ký có người vắng (`turn.behalf`), thanh trên màn ký hiện «Bạn đang ký thay <A> (uỷ quyền)». Quản trị đặt uỷ quyền thay vẫn cho người được giao có lượt.
- Kịch bản: khi quản trị đặt uỷ quyền thay A thì B vẫn có lượt và bản ký ghi thay A [test: apps/hub-api/src/modules/packs/sign-delegation.int.test.ts » quản trị đặt uỷ quyền THAY A]
- Kịch bản: khi B ký thay A thì màn ký hiện dòng «Bạn đang ký thay» [test: e2e/cr181/delegation-sign.spec.ts » kế toán được uỷ quyền: có lượt ký]
