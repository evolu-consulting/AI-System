---
id: cr195-postcard-mobile
lát: cr195-postcard-mobile
cr: CR-195
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Thẻ bài điện thoại gọn (BR-195-3..4) + tệp đính kèm: tên cắt giữa giữ đuôi, «Xem» cho văn bản (BR-195-5..6).

## Làm
- [x] PostActions: ≤ 640px một nút «⋯» (kit DropdownMenu); PostMeta 3 dòng, dấu «·» bằng CSS; biểu tượng người/nhóm thay ổ khoá.
- [x] web-kit: `nameParts`, `isTextItem`/`canViewItem`, `AttachTextPane`; chuyển `viewer-kind`, `text-head` xuống web-kit (app import lại, một nguồn).

## Không làm / Chạm
Không sửa Composer/Dialog, PostMedia, http adapter. AttachGallery cũng dùng ở Tin nhắn (messages-web, chat-web): chúng cũng có «Xem» cho .txt/.csv/.md và tên cắt giữa.

## Test tối thiểu
unit web-kit `attach-name.test.ts`, `viewer-kind.test.ts`, `text-head.test.ts`; `scope-icon.test.ts`; e2e `e2e/community-web/cr195-postcard-mobile.cm.ts` (chưa chạy).

## Quyết định trong lúc làm
- Tên tệp: tách `head` (co + «…» bằng CSS) và `tail` (3 ký tự cuối + đuôi) thay vì cắt cứng 32 ký tự — theo bề rộng thật.
- `AttachLabels.textTruncated` tuỳ chọn; mới điền ở Community. Tin nhắn chưa có ghi chú «tệp dài» (việc dở).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Đầu thẻ bài trên điện thoại
Ở ≤ 640px đầu thẻ 3 dòng (tên · chức vụ / công ty + nguồn / thời gian · phạm vi · loại bài), thao tác gom vào một nút «⋯»; không có dấu «·» đầu/cuối dòng; phạm vi người/nhóm dùng biểu tượng người, ổ khoá chỉ cho «Chỉ nội bộ».
- Kịch bản: khi mở bảng tin ở 390px thì đầu thẻ ≤ 3 dòng và có một nút «⋯» [test: e2e/community-web/cr195-postcard-mobile.cm.ts » đầu thẻ bài ≤ 3 dòng, một nút «⋯», không «·» đầu/cuối dòng]
- Kịch bản: khi phạm vi không phải nội bộ thì không dùng ổ khoá [test: apps/workspace-web/src/modules/community/domain/scope-icon.test.ts » «Tất cả đối tác»/«Nhà cung cấp» ⇒ biểu tượng người/nhóm]

#### Yêu cầu: Tệp đính kèm trong bài
Tên tệp dài cắt ở giữa, luôn giữ đuôi; .txt/.csv/.md/.log có nút «Xem» như PDF.
- Kịch bản: khi tên tệp dài thì phần đuôi gồm đuôi mở rộng luôn hiện [test: packages/web-kit/src/attach-name.test.ts » tên dài ⇒ đuôi gồm 3 ký tự cuối tên + phần mở rộng]
- Kịch bản: khi tệp là txt/csv/md thì có «Xem» [test: packages/web-kit/src/attach-name.test.ts » txt/csv/md và PDF có «Xem»]
- Kịch bản: khi bấm «Xem» tệp .txt thì thấy chữ [test: e2e/community-web/cr195-postcard-mobile.cm.ts » tệp .txt trong bài có nút «Xem», mở ra thấy chữ, tên tệp dài giữ đuôi]
