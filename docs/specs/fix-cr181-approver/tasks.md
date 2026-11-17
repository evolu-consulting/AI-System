---
id: fix-cr181-approver
lát: fix-cr181-approver
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s13-sign-contract-ui
---
## Plan (ngắn)
Người duyệt không có ô chỗ ký riêng vẫn phải thấy khung «Ký trên tài liệu» (BR-D2): lượt Duyệt ⇒ y = mọi tệp cần ký, x = tệp chính người này đã Lưu trong lượt.

## Làm
- [x] Backend: `doc-sign-session` thêm `files[].signed_by_me_in_turn` (repo `versions.signedFilesInRun`, zod/type `SignFileOut`).
- [x] Web: `myProgress` tính theo lượt Duyệt; thẻ hiện khi `turn.step = "approve"` và có tệp cần ký; câu «Bạn ký ở vị trí tự chọn trên n tệp» khi không có ô riêng.
- [x] Test: unit web (`contract-view.test.ts`), int `sign-on-doc.int.test.ts » signedFilesInRun`.

## Không làm / Chạm
Chạm: `packages/contracts/src/pack-contracts/doc-sign.ts`, `apps/hub-api/.../sign-doc.{usecase,ports}.ts`, `sign-versions.repo.ts`, `features/doc-sign/lib/contract-view.ts`, `SignBox.tsx`, i18n `docsignc.*`.

## Test tối thiểu
bun test web (doc-sign, contract-files, contract-approval); int sign-on-doc (chạy trên evotest).

## Quyết định trong lúc làm
- «Đã ký x/y» đếm bản chưa huỷ của CHÍNH người gọi có `run_id` = `turn.run_id` (không dùng bản mới nhất: người khác ký sau không làm mất tiến độ của mình).
- Ngoài lượt Duyệt giữ cách tính cũ (theo ô của mình).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối
Ở bước duyệt, người có quyền chỉ thấy ba nút Duyệt, Trả lại sửa, Từ chối (Từ chối và Trả lại bắt buộc ghi lý do). Không dùng chữ "Đạt" hay "Cần quyết". Công ty bật ký trên tài liệu và HĐ có tệp cần ký thì ô vẽ chữ ký được thay bằng khung «Ký trên tài liệu» (số chỗ ký của bạn, đã ký x/y tệp, «Mở và ký»); nút Duyệt khoá tới khi ký đủ, tệp đính kèm thành tuỳ chọn. Người duyệt không có ô chỗ ký riêng vẫn thấy khung và phải ký mọi tệp cần ký (vị trí tự chọn); x là số tệp chính người này đã Lưu trong lượt hiện tại. Không có tệp cần ký thì không vẽ tay, máy chủ gắn chữ ký của người duyệt.
- Kịch bản: khi người duyệt mở thẻ thì đúng ba nút, không Xác nhận/Đọc lại [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » nút theo vai (người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối)]
- Kịch bản: khi đọc chuỗi tiếng Việt của ứng dụng Hợp đồng thì không còn "Cần quyết", "Giai đoạn", "Đạt", "đi tới" [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » từ vựng thẻ duyệt trong chuỗi contracts]
- Kịch bản: khi chưa ký đủ thì nút Duyệt khoá, ký đủ thì mở, và không có ô vẽ tay [test: apps/workspace-web/src/features/contract-files/components/sign-files.test.tsx » Đạt khoá khi chưa ký đủ, mở khi đủ, không có ô vẽ tay]
- Kịch bản: khi người duyệt không có ô riêng thì y là mọi tệp cần ký và x là tệp mình đã Lưu [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » lượt Duyệt, người duyệt KHÔNG có ô riêng: y = mọi tệp cần ký, x = tệp chính mình đã Lưu]
- Kịch bản: máy chủ trả tệp mình đã Lưu trong lượt, không tính bản huỷ hay của người khác [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » signedFilesInRun: chỉ tệp CHÍNH người này đã Lưu trong lượt đó, bản huỷ và người khác không tính]

## Việc còn lại
- Int test chưa chạy được: `run-tests.ps1` lỗi đóng gói tar từ môi trường này (báo XANH giả, 0 test). Điều phối chạy lại.
