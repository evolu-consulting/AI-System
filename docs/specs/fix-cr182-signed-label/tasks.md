---
id: fix-cr182-signed-label
lát: fix-cr182-signed-label
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: s13-sign-contract-ui
---
## Plan (ngắn)
Đầu trang HĐ: công ty bật ký trên tài liệu và mọi tệp cần ký «Đã ký đủ» (cả Bên B) ⇒ nhãn «Đã ký» thay «Đã duyệt xong» (chip hiệu lực «Còn hiệu lực» giữ). Dữ liệu từ phiên ký đã có (`allSigned`), không truy vấn mới.

## Làm
- [x] `allSigned(session)` (contract-view), `StatusChip signed`, `ContractHead signed`, `ContractBody` truyền; khoá i18n `contracts.docsignc.statusSigned`.
- [x] Unit: `contract-view.test.ts`, `chips-signed.test.tsx`.
- [x] Rà e2e: không test nào kiểm chữ «Đã duyệt xong» trên trang HĐ có ký (`v2f-list.cw.ts` là danh sách, không đổi); `data-status` vẫn `done`.

## Không làm / Chạm
Không đổi danh sách HĐ (chip danh sách vẫn «Đã duyệt xong») — ghi lại nếu cần thống nhất sau.
Chạm: `contract-shared/components/Chips.tsx`, `contract-review/components/{ContractHead,ContractBody}.tsx`, `doc-sign/lib/contract-view.ts`, i18n `docsignc.*`.

## Test tối thiểu
`bun test` doc-sign, contract-shared, contract-review.

## Quyết định trong lúc làm
- Chỉ nhãn chữ đổi; `data-status="done"` giữ để e2e/chức năng cũ không vỡ (thêm `data-signed="1"`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Một khối «Tài liệu kèm» cho mọi tệp ngoài file chính
Hai nhóm trong một chỗ: tệp gắn thẳng vào HĐ (Word, Excel, ảnh… theo danh sách nhận được; thêm/gỡ/xem/tải) và tệp kèm các bước duyệt (chỉ đọc, ghi rõ khi nào được kèm). Công ty bật ký trên tài liệu thì bảng có thêm tệp chính (dòng đầu «Hợp đồng chính») và các cột Cần ký, Chỗ ký, Tình trạng; công ty tắt thì giữ như cũ. Khi mọi tệp cần ký đã ký đủ (cả Bên B) thì đầu trang HĐ ghi «Đã ký» thay «Đã duyệt xong».
- Kịch bản: thêm .docx ⇒ hiện trong khối, có link tải, rồi gỡ [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » thêm → liệt kê hai nhóm → link tải → gỡ]
- Kịch bản: gom hai nhóm và tính quyền gỡ từng dòng [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » hai nhóm trong một khối]
- Kịch bản: e2e thêm .docx thấy trong khối và tải được [test: thủ công — e2e/contract-files/contract-files.spec.ts viết sẵn, chạy một lần cuối đợt]
- Kịch bản: khi cả Bên A và Bên B đã ký thì HĐ là «Đã ký» [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » Bên A + Bên B đã ký ⇒ true]
- Kịch bản: khi còn chờ đối tác thì chưa là «Đã ký» [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » còn chờ đối tác ⇒ false, Bên A chưa ký ⇒ false]
- Kịch bản: khi không có tệp cần ký hoặc công ty tắt thì nhãn như cũ [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » không có tệp cần ký, hoặc công ty tắt ⇒ false (nhãn như cũ)]
- Kịch bản: chip trạng thái ghi «Đã ký» khi đã ký đủ, «Đã duyệt xong» khi không [test: apps/workspace-web/src/features/contract-shared/components/chips-signed.test.tsx » done + signed ⇒ «Đã ký»]
