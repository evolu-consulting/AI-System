---
id: s7-sign-stamp
lát: s7-sign-stamp
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Thư viện thuần in chữ ký lên PDF ở máy chủ (chưa route/DB/quyền/web): kiểm hình học, đổi toạ độ «trang đã xoay» → hệ gốc, tô màu mực, in ảnh, cổng ký số.

## Làm
- [x] `domain/sign-geometry.ts` (+ test): `resolveParts`, `displayToUser`, `displaySize`, `applyMatrix`, `normRotate`; `domain/sign-error.ts` (`SignError` + mã lỗi).
- [x] `adapters/sign-stamp.pdf.ts` (+ test): `stampPdf`, `tint`, `sha256Hex`.
- [x] `domain/digital-signer.ts` (+ test): `DigitalSigner`, `noDigitalSigner`, `produceSigned`.

## Không làm / Chạm
Không route, DB, quyền, web. Chỉ file mới trong `modules/packs/contracts/{domain,adapters}`.

## Test tối thiểu
`bun test` ba file `sign-geometry.test.ts`, `sign-stamp.pdf.test.ts`, `digital-signer.test.ts` (31 ca; perf 50 trang + 60 dấu ≈ 0,2–0,3 s).

## Quyết định trong lúc làm
- `produceSigned` nhận `stamp` và `sha256` làm tham số (domain không import adapter, Clean Architecture); route truyền `stampPdf` / `sha256Hex`. Thêm `ctx?` tuỳ chọn cho bộ ký.
- Lỗi chung `SignError(code)` ở `domain/sign-error.ts`; mã thêm ngoài brief: `SIGN_PAGE_NOT_FOUND`, `SIGN_PARTS_INVALID` (rỗng / > 5 / không liên tiếp), `SIGN_PDF_INVALID`, `SIGN_IMAGE_INVALID`. Route s8 đổi mã → HTTP status.
- Đặt dấu bằng ma trận `cm` hiển thị → gốc (đúng cho /Rotate 0/90/180/270 và CropBox lệch gốc); hộp nhìn thấy = CropBox ∩ MediaBox (như pdf.js). Clip/ảnh/dòng chữ vẽ trong hệ hiển thị nên không phải tính tay từng hướng.
- Nội dung cũ của trang được bọc q…Q bằng `page.translateContent(0, 0)` (API công khai) để CTM của tệp gốc không lệch dấu.
- Kiểm toàn bộ parts TRƯỚC khi tô màu/embed: một dấu sai ⇒ cả lần in lỗi, không có bytes.
- Ảnh trùng nội dung (sha256) chỉ tô màu + embed một lần (ký nháy chép 50 trang = 1 ảnh).
- Phần cắt giao với TRANG (không giao với khung); phần giáp mép (diện tích 0) coi là ngoài trang.
- pdf-lib biên dịch ES5 nên `instanceof EncryptedPDFError` có thể sai ⇒ nhận diện thêm theo thông điệp «is encrypted».
- `noDigitalSigner` vẫn chạy bước in hình trước rồi mới ném (đúng BR-L5); route nên chặn `digital` sớm bằng kiểm tra cấu hình để khỏi tốn công in.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: In chữ ký ở máy chủ
Máy chủ in ảnh chữ ký lên PDF theo các phần (trang, khung, vùng cắt) người dùng đặt: ảnh vừa khung giữ tỉ lệ, cắt theo từng trang, đổi nét đen sang màu mực của công ty lúc in, dòng chữ dưới (tên · ngày) bằng Be Vietnam Pro chỉ khi chữ ký nằm gọn một trang. Phần nằm ngoài trang bị cắt; không còn phần nào trong trang thì báo lỗi. Tệp có mật khẩu hoặc quá 50 trang bị từ chối. Chữ ký số (khi bật) chỉ được áp sau khi hình đã in.
- Kịch bản: khi trang bị xoay 90/180/270 thì hình vẫn nằm đúng chỗ người dùng thấy [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » trang xoay 90: ma trận hiển thị → gốc đúng]
- Kịch bản: khi tệp có vùng xem lệch gốc thì vị trí được cộng độ lệch [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » CropBox lệch gốc: ma trận cộng độ lệch]
- Kịch bản: khi chữ ký giáp lai hai trang thì mỗi trang có một vùng cắt và ghép lại đúng một hình [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » giáp lai 2 trang: clip 100 + 90 = khung 190, ảnh embed MỘT lần, ghép đúng một hình]
- Kịch bản: khi chữ ký tràn mép trang thì phần ngoài bị cắt [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » phần ngoài trang bị cắt: clip chỉ còn phần trong trang]
- Kịch bản: khi chữ ký hoàn toàn ngoài trang thì báo SIGN_OUTSIDE_PAGE [test: apps/hub-api/src/modules/packs/contracts/domain/sign-geometry.test.ts » không còn phần nào trong trang ⇒ SIGN_OUTSIDE_PAGE (kể cả chỉ chạm mép)]
- Kịch bản: khi ảnh nhỏ hơn khung thì ảnh vừa khung giữ tỉ lệ và căn giữa [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » ảnh vừa khung giữ tỉ lệ: khung 100×100, ảnh 240×100 ⇒ rộng 100, cao 41,67, căn giữa]
- Kịch bản: khi in thì nét đen đổi sang màu mực, nền trong suốt giữ nguyên [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » nét đen ⇒ màu mực, nền trong suốt giữ nguyên]
- Kịch bản: khi một chữ ký có tên người ký thì dòng chữ dưới in bằng Be Vietnam Pro, ảnh giống nhau chỉ nhúng một lần [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » caption một phần: nhúng Be Vietnam Pro (có dấu); ảnh giống nhau chỉ nhúng một lần]
- Kịch bản: khi PDF có mật khẩu thì báo SIGN_PDF_ENCRYPTED [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » PDF có mật khẩu ⇒ SIGN_PDF_ENCRYPTED]
- Kịch bản: khi tệp quá 50 trang thì báo SIGN_TOO_MANY_PAGES [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » > 50 trang ⇒ SIGN_TOO_MANY_PAGES; rác ⇒ SignError]
- Kịch bản: khi tệp 50 trang có 60 dấu thì in xong dưới 3 giây [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » perf: 50 trang + 60 dấu < 3 s]
- Kịch bản: khi ký bằng chữ ký số thì hình được in trước rồi bộ ký số mới chạy trên bản đã in [test: apps/hub-api/src/modules/packs/contracts/domain/digital-signer.test.ts » digital: bộ ký thấy bản ĐÃ in hình; kết quả là bytes bộ ký trả, sha256 trên bytes đó]
- Kịch bản: khi chữ ký số chưa bật thì báo DIGITAL_SIGN_NOT_ENABLED và không có tệp nào được trả [test: apps/hub-api/src/modules/packs/contracts/domain/digital-signer.test.ts » digital + noDigitalSigner ⇒ DIGITAL_SIGN_NOT_ENABLED, không có bytes]

## Việc còn lại
Route lưu chữ ký (lát s8) gọi `produceSigned({ stamp: stampPdf, sha256: sha256Hex, … })`; chặn `digital` sớm theo cấu hình công ty. Ngoài phạm vi: `bun run typecheck` ở hub-api đang có 1 lỗi sẵn `messages/pmsg-db.int.test.ts:412`.
