---
id: fix-stale-resubmit
lát: fix-stale-resubmit
cr: CR-127
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Người gửi «Rút về Nháp» rồi «Gửi lại» ⇒ lỗi thô «Contract was modified» (`CONTRACT_STALE`).
Nguyên nhân: ở màn xác nhận (HĐ nháp có phần AI đọc) «Gửi lại» luôn GHI NHÁP trước (`POST /review`, tăng `version`) rồi mới Gửi. Hub đòi lý do «không đổi gì» (`UNCHANGED_REASON_REQUIRED`) ⇒ hộp lý do mở ⇒ bấm Gửi kèm lý do ghi nháp LẦN HAI với `version` cũ của màn ⇒ 409 STALE. Web không có câu cho mã này (rơi vào câu chung).

## Làm
- `HeadActions.resubmit`: nạp lại chi tiết HĐ ngay sau khi ghi nháp, trước khi Gửi ⇒ lần bấm kế dùng đúng version. Sau mọi thao tác đổi trạng thái (rút về, …) nạp lại cả chi tiết lẫn thẻ duyệt.
- `contract-shared/lib/error-text.ts`: `isStale`, câu `contracts.errors.stale`, `unknownErrorText` (mã chưa có câu ⇒ «Có lỗi xảy ra… (Mã: X)»). Nối vào `saveErrorText`, `approvalErrorText`, `manageErrorKey`, `HeadActions`, trang chi tiết.
- Mọi nơi gặp STALE (đầu trang, thẻ duyệt, lưu form, xác nhận, đổi tên, khối Quản lý) ⇒ tự nạp lại bản mới + câu dễ hiểu; không tự gửi lại thay người dùng.
- i18n vi + en (`contracts.errors.stale`, `contracts.errors.unknownCode`); bỏ `contracts.gapa1.err.stale` (gộp vào câu chung).

## Không làm / Chạm
Không đổi hub, không đổi contract API, không đổi test khoá. Rà `.message` thô trong `features/contract-*`: chỉ còn `ErrorLine` của trang chi tiết (đã qua `saveErrorText`) và lỗi cục bộ web tự soạn (chặn trước khi gửi).

## Test tối thiểu
unit `error-text.test.ts`, `review.test.ts`, `approval.test.ts`, `manage.test.ts`; e2e contracts-web `fix-stale-resubmit.cw.ts`.

## Quyết định trong lúc làm
Không tự gửi lại khi gặp STALE thật (người dùng có thể đã đổi nội dung); chỉ tải lại + báo, bấm lại là xong.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Gửi lại sau Rút về / Trả lại không báo lỗi phiên bản
- Kịch bản: khi người gửi bấm Gửi lại, hub đòi lý do «không đổi gì» và người dùng nhập lý do thì Gửi thành công (ghi nháp lần hai dùng version mới) [test: e2e/contracts-web/fix-stale-resubmit.cw.ts » Gửi lại sau Rút về]
#### Yêu cầu: Lỗi hợp đồng luôn hiện câu dễ hiểu
- Kịch bản: khi hub trả CONTRACT_STALE thì màn hiện «Hợp đồng vừa được cập nhật» (không chữ thô), tự tải lại bản mới và bấm lại dùng đúng version [test: e2e/contracts-web/fix-stale-resubmit.cw.ts » CONTRACT_STALE thật]
- Kịch bản: khi mã lỗi chưa có câu riêng thì hiện câu chung «Có lỗi xảy ra» kèm mã, không hiện thông điệp thô của máy chủ [test: apps/workspace-web/src/features/contract-shared/lib/error-text.test.ts » mã lạ]
