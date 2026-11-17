---
id: fix-cr181-ui
lát: fix-cr181-ui
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s12-sign-modes
---
## Plan (ngắn)
Ba lỗi web do e2e tìm ra: chuột phải không đặt được chữ ký; thiếu nút «Xem bản đã ký» và nhãn «Đang ký (x/y)»; chọn «Bản gốc» không đổi bản.

## Làm
- [x] `StageMenu`/`StageItems`/`SignWorkspace`: `onPick(tray, at)` — điểm chuột phải được chụp lúc chọn (menu đóng ngay sau đó), dùng chung cho chạm giữ và «Thêm chỗ ký cho <người>»
- [x] `lib/contract-view.ts` `fileStatus`: tệp có bản ký (`latest.seq > 0`) không còn là «Chưa ký»; còn ô chưa ký ⇒ «Đang ký (x/y)». `SignFilesList`: nút «Xem bản đã ký» hiện khi `latest.seq > 0`; nhãn «Đang ký (x/y)»
- [x] `lib/viewer-model.ts` `pickVersion` khớp theo `versionKey` (bản gốc = «original»); `SignedScreen` ghi `v = versionKey` lên URL

## Không làm / Chạm
Không đổi API. Chạm `doc-sign/components`, `doc-sign/lib`, `doc-sign/pages/SignedScreen.tsx`, `contract-files/components/SignFilesList.tsx`.

## Test tối thiểu
`bun test apps/workspace-web/src/features/doc-sign apps/workspace-web/src/features/contract-files` xanh; `tsc`, biome, `check:ui-kit`, `i18n:check` xanh.

## Quyết định trong lúc làm
- Bản gốc có `version_id = null` nên trước đây URL không mang `v` và `pickVersion` rơi về bản mới nhất; nay `v=original`. URL cũ mang id bản vẫn chạy.
- Menu chuột phải: không có DOM trong bun test nên chưa có test tự động cho đường chọn menu; cần e2e xác nhận.
- Nhãn trạng thái đổi từ «x/y» sang «Đang ký (x/y)» theo quyết định điều phối; e2e nào so chuỗi «1/2» cần đổi theo.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Tình trạng ký của tệp và nút xem bản đã ký
Tệp có bản ký mà còn ô chưa ký hiện «Đang ký (x/y)»; nút «Xem bản đã ký» hiện khi tệp có ít nhất một bản ký chưa bị bỏ.
- Kịch bản: khi tệp có bản ký nhưng còn ô chưa ký thì hiện đang ký x/y [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » có bản ký nhưng còn ô chưa ký ⇒ Đang ký (x/y)]
- Kịch bản: khi chữ ký tự do đã lưu mà ô còn trống thì không còn là Chưa ký [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » có bản ký mà chữ ký không thuộc ô nào (tự do), còn ô chưa ký ⇒ Đang ký (0/1), không phải Chưa ký]
- Kịch bản: khi chưa có bản nào thì vẫn Chưa ký [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » chưa có bản nào ⇒ vẫn Chưa ký]

#### Yêu cầu: Chọn «Bản gốc» khi xem bản đã ký
- Kịch bản: khi chọn Bản gốc thì xem đúng bản gốc, không chữ ký [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » chọn «Bản gốc»: khoá bản gốc là «original», chọn ra đúng bản gốc (không rơi về bản mới nhất)]

#### Yêu cầu: Chuột phải đặt chữ ký
- Kịch bản: chuột phải rồi chọn «Thêm chữ ký của tôi ở đây» đặt chữ ký tại điểm đã chuột phải [test: thủ công — chưa có DOM trong bun test, e2e cuối đợt]
