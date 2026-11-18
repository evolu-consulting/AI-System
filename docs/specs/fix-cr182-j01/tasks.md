---
id: fix-cr182-j01
lát: fix-cr182-j01
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-admin
---
## Plan (ngắn)
Lỗi SẢN PHẨM (không phải test): sau đợt 2 bước Ký luôn hiện ô «Vai» (Vai mới… rỗng) kể cả khi công ty TẮT ký trên tài liệu, còn cảnh báo vẫn kiểu cũ. e2e khoá `e2e/cr127/j01-soan-ap-dung-duyet.spec.ts` đúng với hành vi mong muốn (công ty tắt ⇒ cách cũ «Ký qua» + «Người ký phía công ty») nên KHÔNG đổi test.

## Làm
- [x] Test đỏ trước: `esign-role-ui.test.ts` thêm `oldWay` (đỏ ⇒ xanh).
- [x] `esignRoleUi.oldWay` = công ty tắt/chưa rõ và bước chưa có vai ⇒ Panel hiện `EsignOldWay` (Ký qua + người ký phía công ty, cảnh báo kiểu cũ khớp); ngược lại ô Vai (công ty bật ⇒ vai mặc định điền sẵn nhờ `autoRole`).

## Không làm / Chạm
Chạm: admin-web `lib/esign-role-ui.ts`, `modules/contracts/esign/Panel.tsx`, `EsignOldWay.tsx` (mới). Không sửa e2e.

## Test tối thiểu
unit `esign-role-ui.test.ts`; tsc admin-web. e2e j01 chạy ở đợt QC (evotest).

## Quyết định trong lúc làm
- Bước đã có vai mà công ty tắt vẫn hiện ô Vai + cảnh báo «chưa bật ký trên tài liệu» (không rơi về cách cũ, tránh mất vai đã đặt).
- Công tắc «Cần chữ ký số» chỉ ở chế độ vai.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Gọn cấu hình bước Duyệt và bước Ký theo vai
Công ty tắt ký trên tài liệu thì bước Ký mới dùng cách cũ («Ký qua» và «Người ký phía công ty») và không hiện ô Vai; công ty bật thì ô Vai có sẵn vai «Người ký hợp đồng». Cảnh báo khớp cách đang dùng.
- Kịch bản: khi công ty tắt ký trên tài liệu thì bước Ký mới hiện cách cũ chứ không hiện ô Vai [test: apps/admin-web/src/features/processes/lib/esign-role-ui.test.ts » tắt hoặc chưa biết, chưa có vai ⇒ hiện «Ký qua» + người ký công ty (cách cũ)]
- Kịch bản: khi công ty bật thì bước Ký mới có vai mặc định còn bước đã có vai giữ ô Vai [test: apps/admin-web/src/features/processes/lib/esign-role-ui.test.ts » bật ⇒ ô Vai (mặc định điền sẵn), đã có vai ⇒ ô Vai dù công ty tắt (kèm cảnh báo)]
