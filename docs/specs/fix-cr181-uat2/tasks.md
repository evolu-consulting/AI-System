---
id: fix-cr181-uat2
lát: fix-cr181-uat2
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa lỗi soát UI lượt 3 (`docs/specs/CR-181/uat-ui-review.md` mục «Lượt 3»): sau khi Bên A ký, trang HĐ không còn khối ký số cũ và nói rõ chờ Bên B; Hồ sơ duyệt có dòng cho bước Ký; vài lỗi Thấp.

## Làm
- [x] 1 Trang HĐ: công ty bật ký trên tài liệu + có tệp cần ký ⇒ ẩn khối «Ký số / Gửi ký» cũ ở mọi trạng thái; Bên A ký đủ, Bên B chưa ⇒ thẻ «Chờ <liên hệ> (Bên B) ký» + «Xem bản đã ký».
- [x] 2 Hồ sơ duyệt (JSON + PDF): người ký không có quyết định duyệt có dòng riêng «Ký hợp đồng» (`action: "sign"`).
- [x] 3a Ô tự đặt hạ thêm 4pt dưới dòng «(Ký, ghi rõ họ tên)».
- [x] 3b Tên người ký đủ họ tên, cách dấu phẩy.
- [x] 3c Vùng bấm ≥ 44px: công tắc (`Switch`) và nút đóng hộp thoại.
- [x] 3d HĐ Nháp: bỏ thông báo trùng (lý do chặn đã có trong danh sách kiểm tra của thẻ Chuẩn bị chỗ ký).
- [x] 3e Lỗi có từ trước CR-181 ⇒ `docs/TECH-DEBT.md` #292–#294; #295 = K10 không có thông báo lưu.

## Không làm / Chạm
Không đổi phạm vi đợt 1, không migration, không deploy. Không sửa «Phụ trách (người đã nghỉ…)», «Duyệt» vs «Đạt», mốc hiện nút (có từ trước, ghi nợ).

## Test tối thiểu
- unit: `contract-view.test.ts`, `doc-sign-lib.test.ts`, `approval-record.sign.test.ts`, `sign-doc.members.test.ts`, `pack-runs-modules.test.ts`.
- int: `approval-record-sign.int.test.ts`, `pack-runs-members.int.test.ts` (evotest).

## Quyết định trong lúc làm
- Lỗi 2: dữ liệu CÓ bước ký (`signs` theo người) nhưng `items` chỉ dựng từ quyết định duyệt ⇒ người chỉ ký (giám đốc) mất dòng. Thêm dòng `action: "sign"`, `task_id` = id người ký, bước «Ký hợp đồng»; người đã có dòng duyệt không lặp. Một chỗ (`buildApprovalRecord`) nên JSON, PDF và bản lưu cùng đúng.
- Lỗi 3b đảo quyết định cũ (tên gọi «Hùng, Mai») theo yêu cầu điều phối: họ tên đầy đủ.
- Lỗi 3c: sửa ở thành phần dùng chung (`Switch`: vùng bấm mở rộng bằng `before:`; nút đóng hộp thoại `size-11`) thay vì từng màn.
- Lỗi 3d: ẩn dòng «Chưa có tệp nào cần ký…» khi thẻ Chuẩn bị chỗ ký (có danh sách ✓/✗) đang hiện.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Trang hợp đồng sau khi Bên A ký
Công ty bật ký trên tài liệu và hợp đồng có tệp cần ký ⇒ trang hợp đồng không hiện khối «Ký số / Gửi ký» cũ ở mọi trạng thái. Bên A ký đủ mà Bên B chưa ký ⇒ thẻ «Bên A đã ký đủ. Chờ <tên liên hệ> (Bên B) ký …» kèm «Xem bản đã ký».
- Kịch bản: khi Bên A ký đủ và còn chỗ Bên B thì có tên liên hệ và bản đã ký [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » A ký đủ + còn chỗ Bên B ⇒ nói tên liên hệ và trỏ tới bản đã ký]
- Kịch bản: khi bật ký trên tài liệu và có tệp cần ký thì khối ký số cũ ẩn [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » khối ký số cũ ẩn khi công ty bật + có tệp cần ký (mọi trạng thái), tắt hoặc không tệp ⇒ hiện]
- Kịch bản: khi HĐ Nháp có thẻ Chuẩn bị chỗ ký thì không nói lý do chặn hai lần [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » thẻ Chuẩn bị chỗ ký (có danh sách kiểm tra) chỉ khi Nháp + chế độ chuẩn bị]

#### Yêu cầu: Người ký nói bằng họ tên đầy đủ
Chip, nhãn chỗ ký và dòng «Người ký:» của bước Ký dùng họ tên đầy đủ, nhiều người cách dấu phẩy (thay cho tên gọi).
- Kịch bản: khi nhóm ký có hai thành viên thì nhãn là hai họ tên đầy đủ [test: apps/hub-api/src/modules/packs/contracts/application/sign-doc.members.test.ts » signer nhóm mang members, nhãn chỗ ký = tên người, không còn «Đại diện …»]

#### Yêu cầu: Tự đặt chỗ ký cách dòng chú thích
Ô đặt cách dòng «(Ký, ghi rõ họ tên)» 10pt để nhãn ô không chạm dòng.
- Kịch bản: khi có dòng chú thích thì đỉnh ô thấp hơn dòng 10pt [test: apps/workspace-web/src/features/doc-sign/lib/doc-sign-lib.test.ts » fix-cr181-uat · lỗi 3 · có dòng «(Ký, ghi rõ họ tên)» ⇒ ô nằm dưới dòng đó, cả Bên A lẫn Bên B]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Hồ sơ duyệt có dòng cho bước Ký
Hồ sơ duyệt (JSON và PDF) có mỗi bước một dòng: người ký trên tài liệu không có quyết định duyệt có dòng «Ký hợp đồng · Ký» với tên, lúc ký, hình chữ ký, loại chữ ký, số tệp. Người đã có dòng duyệt không lặp.
- Kịch bản: khi giám đốc chỉ ký (không có quyết định duyệt) thì hồ sơ có dòng ký của giám đốc [test: apps/hub-api/src/modules/packs/contracts/domain/approval-record.sign.test.ts » người ký không có quyết định duyệt có dòng riêng «Ký hợp đồng» (ai, lúc nào, loại, số tệp, hình)]
- Kịch bản: khi người đã có dòng duyệt thì không lặp dòng ký [test: apps/hub-api/src/modules/packs/contracts/domain/approval-record.sign.test.ts » người đã có dòng duyệt không bị lặp dòng ký, không có bản ký ⇒ không thêm dòng]

## Việc còn lại
- Soát UI lại trên bản test: sau khi giám đốc ký (trang HĐ, Hồ sơ duyệt, PDF), 390px (công tắc, nút đóng).
- Không sửa: «Phụ trách (người đã nghỉ…)», «Duyệt» vs «Đạt», mốc hiện nút khi đang duyệt (TECH-DEBT #292–#294).
