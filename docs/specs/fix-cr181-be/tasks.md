---
id: fix-cr181-be
lát: fix-cr181-be
cr: CR-181
làn: nhanh
migration: 0157_cr181_signature_png_reads (hub)
phụ thuộc: s1-sig-db, s2-sig-api, s8-sign-api, s9-sign-flow, s10-sign-record
---
## Plan (ngắn)
Sửa lỗi backend của lượt soát cuối CR-181: #2 đọc ảnh chữ ký của máy chủ in qua hàm DEFINER, #3 chặn PNG khai kích thước khổng lồ, #4 chặn «Ký qua» = ondoc khi công ty tắt, #6 `signer_ref` ≤ 300, #7 ghi nợ.

## Làm
- [x] #2 BLOCKER — hub `0157`: `hub.signature_png_by_ids(p_tenant, p_ids)` DEFINER (chỉ khi scope system hoặc tenant khớp ngữ cảnh, chỉ trả hàng đúng tenant); `stampPngOf` gọi hàm này; int gọi `stampPngOf` THẬT + PDF Hồ sơ duyệt với bản ký thật.
- [x] #3 MAJOR — `pngDimensions` (đọc IHDR, `@ai/contracts/signature`) + `SIGNATURE_PNG_MAX_WIDTH/HEIGHT` = 2000/1000; `checkPng` trả `dimensions_too_large` ⇒ 422 `SIGNATURE_IMAGE_TOO_LARGE`; `tint()` kiểm trước khi tạo canvas ⇒ `SIGN_IMAGE_TOO_LARGE`.
- [x] #4 MAJOR (backend) — `esignNodeApi.checkNode`: `ondoc` + công ty tắt ⇒ issue `{field:"provider", code:"ONDOC_NOT_ENABLED"}`; tool `contracts-esign-send` ném `ONDOC_NOT_ENABLED` (mã nghiệp vụ trên stage ⇒ thẻ HĐ báo, không treo câm). Cờ tiêm từ `packs.esign-mount.ts` (hàm DEFINER 0156 `sig_settings_of`).
- [x] #6 — `SignFieldInSchema.signer_ref` max 300 (khớp CHECK 0121).
- [ ] #7 — không làm (xem Quyết định); ghi `docs/TECH-DEBT.md` #284.

## Không làm / Chạm
Không làm panel admin (lát web: dùng mã issue `ONDOC_NOT_ENABLED` ở trường `provider`). Chạm hub 0157 + journal, `packs.tenant-config/esign-mount`, `esign*`, `intake.*`, `signatures/domain+application`, contracts `signature.ts`/`doc-sign.ts`.

## Test tối thiểu
unit: contracts (`signature`, `doc-sign`), `signature.rules`, `sign-stamp.pdf`, `intake.tools.esign-node`; int evotest: `approval-record-sign`, `signatures`, `signatures.routes`, `sign-save`, `sign-flow`.

## Quyết định trong lúc làm
- Mã lỗi kích thước ảnh là `SIGNATURE_IMAGE_TOO_LARGE` (422), KHÔNG dùng lại `SIGNATURE_TOO_LARGE` vì mã đó đã là 413 (quá dung lượng) — một mã một status.
- `checkPng` nay đòi khối IHDR hợp lệ (13 byte, ≠ 0 điểm ảnh) ⇒ PNG thiếu IHDR là `SIGNATURE_NOT_PNG` 415; helper PNG giả của test int s2 được thêm IHDR 100×50.
- #4 lượt đang chạy: không thêm cột/lý do mới; tool ném lỗi nghiệp vụ `ONDOC_NOT_ENABLED` (khuôn `ESIGN_DISABLED`) ⇒ engine mở quyết định, `last_error_code` = mã, không treo câm. Lúc ô đã ký trước khi công ty tắt, `signWaitReady` vẫn tự xong (giữ nguyên quyết định s9).
- `onDocEnabled` của esign vắng (chỉ test dựng thẳng) ⇒ coi là bật; ở máy chủ thật luôn được tiêm.
- #7 không gọn: `turnFor` + `companySigners` là hai cổng riêng (đổi chữ ký cổng chạm s8/s9), còn lần đọc thứ ba ở Lưu chữ ký (`turnStill`) PHẢI đọc mới (chống TOCTOU) ⇒ ghi nợ #284.
- N8: test đỏ chưa chạy riêng trước khi sửa (mỗi lát tối đa 3 lượt int); bằng chứng lỗi #2 = `signatures.int.test.ts` đã chứng minh `hub_api` đọc thẳng bảng ⇒ 42501.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/hub/chu-ky.md
#### Yêu cầu: Ảnh chữ ký tải lên có khuôn khổ tối đa 2000×1000 điểm ảnh
Ngoài giới hạn 200 KiB, ảnh chữ ký phải khai rộng tối đa 2000 và cao tối đa 1000 điểm ảnh (đọc từ đầu tệp PNG, không giải mã). Vượt ⇒ 422 `SIGNATURE_IMAGE_TOO_LARGE`. Tệp PNG thiếu đầu tệp hợp lệ bị từ chối như không phải PNG (415).
- Kịch bản: khi tải PNG nhỏ nhưng khai 20000×20000 thì bị từ chối 422, đúng 2000×1000 thì nhận [test: apps/hub-api/src/modules/signatures/signatures.routes.int.test.ts » PNG > 200 KiB ⇒ 413, không phải PNG ⇒ 415, khai kích thước > 2000×1000 ⇒ 422, base64 sai ⇒ 400, đúng 200 KiB ⇒ 201, có user_id ⇒ 400]
- Kịch bản: khi kiểm PNG thì vượt rộng hoặc cao báo quá lớn, thiếu đầu tệp báo không phải PNG [test: apps/hub-api/src/modules/signatures/domain/signature.rules.test.ts » kích thước khai trong IHDR: ≤ 2000×1000 ⇒ ok, vượt rộng hoặc cao ⇒ dimensions_too_large (PNG 200 KiB khai 20000×20000)]
- Kịch bản: khi đọc đầu tệp PNG thì lấy đúng rộng và cao, sai thì không đọc được [test: packages/contracts/src/signature.test.ts » đọc rộng × cao khai, sai chữ ký / thiếu IHDR / 0 / quá ngắn ⇒ null]

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Máy chủ in đọc được ảnh chữ ký của chính công ty
Ảnh chữ ký đã in trong Hồ sơ duyệt (PDF, bản lưu tự động, ảnh xem) được đọc bằng hàm riêng chỉ trả ảnh của đúng công ty đang xử lý; công ty khác không thấy; chạy được với quyền thật của máy chủ.
- Kịch bản: khi lập PDF Hồ sơ duyệt cho HĐ có bản ký thật thì ảnh được đọc đúng và công ty khác không thấy [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-record-sign.int.test.ts » stampPngOf THẬT (role hub_api): đọc đúng ảnh của tenant, tenant khác không thấy, PDF Hồ sơ duyệt lập được với bản ký thật]

#### Yêu cầu: Ảnh chữ ký khai khuôn khổ quá lớn không làm máy chủ in cấp bộ nhớ
Trước khi tô màu mực, máy chủ in kiểm lại khuôn khổ ảnh; vượt 2000×1000 ⇒ lỗi rõ `SIGN_IMAGE_TOO_LARGE`, không tạo canvas.
- Kịch bản: khi ảnh khai 20000×20000 thì in báo ảnh quá lớn trước khi cấp canvas [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » PNG khai kích thước vượt 2000×1000 (IHDR) ⇒ SIGN_IMAGE_TOO_LARGE trước khi cấp canvas]

#### Yêu cầu: Bước Ký qua «ký trên tài liệu» bị chặn khi công ty đang tắt
Công ty tắt «ký trên tài liệu» thì không lưu hay kích hoạt được quy trình có bước Ký qua ký trên tài liệu (lỗi `ONDOC_NOT_ENABLED` ở trường nhà cung cấp). Lượt đang chạy tới bước đó mà công ty đã tắt thì bước dừng với mã `ONDOC_NOT_ENABLED` trên thẻ HĐ, không chờ im lặng.
- Kịch bản: khi công ty tắt ký trên tài liệu thì lưu quy trình Ký qua ký trên tài liệu bị chặn, bật thì qua [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » Q1 · lưu quy trình có Ký qua ondoc không đòi nhà cung cấp ký số, nhưng công ty TẮT ký trên tài liệu thì chặn bằng ONDOC_NOT_ENABLED]
- Kịch bản: khi lượt chạy tới bước ký trên tài liệu mà công ty đã tắt thì bước dừng với mã lỗi, không gửi ký và không giao người [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » tắt ⇒ lỗi nghiệp vụ ONDOC_NOT_ENABLED (không treo câm, không ghi người được giao, không gửi ký), bật ⇒ chờ ký trên tài liệu]

#### Yêu cầu: Vị trí ký đối tác dài tối đa 300 ký tự
- Kịch bản: khi đặt chỗ ký có người ký dài 301 ký tự thì bị từ chối ở biên [test: packages/contracts/src/pack-contracts/doc-sign.test.ts » đúng 300 ký tự ⇒ hợp lệ, 301 ⇒ bị từ chối ở biên]

## Việc còn lại
- #7 ghi nợ `docs/TECH-DEBT.md` #284. Lát web: panel admin hiện lỗi `ONDOC_NOT_ENABLED` (trường `provider`) + nhãn mã `SIGNATURE_IMAGE_TOO_LARGE` / `SIGN_IMAGE_TOO_LARGE`.
