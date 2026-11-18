---
id: fix-cr182-wait
lát: fix-cr182-wait
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: s13-sign-contract-ui
---
## Plan (ngắn)
Bên A đã ký đủ, đối tác chưa ký: mọi người xem HĐ thấy thẻ chờ đối tác (không «Chờ <người ký A> ký»); người ký A đã hết ô thấy «Bạn đã ký xong».

## Làm
- [x] `signStepOf`: `NOT_SIGNER` + Bên A đã ký đủ (`partnerWaitOf`) ⇒ null (không «other»).
- [x] `ContractBody`: `PartnerWaitCard` hiện cho mọi người xem; thẻ có tiêu đề «Ký hợp đồng» + dòng «Chờ đối tác <tên> ký» + câu «Bên A đã ký đủ. Chờ <tên> (Bên B) ký qua link riêng».
- [x] `signDoneByMe` + `SignTurnCard`: lượt còn allowed mà hết ô ⇒ «Bạn đã ký xong», bỏ «Mở và ký».
- [x] e2e: gỡ `collectDiag` ở `journey-dot2.spec.ts`; K07 (`journey-3-vai.spec.ts`) kiểm thêm `sign-partner-wait`.

## Không làm / Chạm
Backend không đổi: `sign-turn.rules.ts` chỉ xét thành viên bước đang mở (không biết ô), lượt còn tới khi `onSigned` chốt bước — thẻ web tự nói «đã ký xong».
Chạm: `features/doc-sign/{lib/contract-view.ts,components/contract/SignBox.tsx}`, `contract-review/components/ContractBody.tsx`, i18n `docsignc.*`, hai e2e trên (test KHOÁ: `e2e/cr181/journey-dot2.spec.ts`, `e2e/cr181/journey-3-vai.spec.ts` — qc cần khoá lại).

## Test tối thiểu
`bun test` doc-sign / contract-review / contract-files.

## Quyết định trong lúc làm
- Dòng bước «Ký hợp đồng» chờ đối tác ghi ở thẻ chờ đối tác (một nơi), không thêm chuỗi vào FlowPanel.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Một khối «Tài liệu kèm» cho mọi tệp ngoài file chính
Hai nhóm trong một chỗ: tệp gắn thẳng vào HĐ (Word, Excel, ảnh… theo danh sách nhận được; thêm/gỡ/xem/tải) và tệp kèm các bước duyệt (chỉ đọc, ghi rõ khi nào được kèm). Công ty bật ký trên tài liệu thì bảng có thêm tệp chính (dòng đầu «Hợp đồng chính») và các cột Cần ký, Chỗ ký, Tình trạng; công ty tắt thì giữ như cũ. Khi Bên A đã ký đủ và còn chờ đối tác, mọi người xem HĐ thấy thẻ «Chờ đối tác <tên> ký» kèm trạng thái link; người ký đã ký hết ô thấy «Bạn đã ký xong».
- Kịch bản: thêm .docx ⇒ hiện trong khối, có link tải, rồi gỡ [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » thêm → liệt kê hai nhóm → link tải → gỡ]
- Kịch bản: gom hai nhóm và tính quyền gỡ từng dòng [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » hai nhóm trong một khối]
- Kịch bản: e2e thêm .docx thấy trong khối và tải được [test: thủ công — e2e/contract-files/contract-files.spec.ts viết sẵn, chạy một lần cuối đợt]
- Kịch bản: khi người xem không phải người ký và Bên A đã ký đủ thì không hiện «Chờ người ký A» [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » sale (NOT_SIGNER) khi Bên A đã ký đủ ⇒ KHÔNG là 'other' (không «Chờ Giám đốc ký»)]
- Kịch bản: khi Bên A chưa ký đủ thì vẫn chờ người ký A [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » A chưa ký đủ ⇒ vẫn 'other']
- Kịch bản: khi người ký đã ký hết ô mà lượt còn mở thì báo đã ký xong [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » giám đốc đã ký hết ô mà lượt còn allowed ⇒ myProgress ready, có ô ⇒ dùng để báo «đã ký xong»]
- Kịch bản: nhãn chờ nói đối tác khi Bên A xong, nói người ký A khi còn ô [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » nhãn chờ: có đối tác ⇒ «partner», còn người ký A ⇒ «signer»]
