---
id: cr182-annex-verify
lát: cr182-annex-verify
cr: CR-182
làn: nhanh
migration: pack-contracts 0124
phụ thuộc:
---
## Plan (ngắn)
R6 phụ lục ký sau: nút trên HĐ đã duyệt ⇒ tải PDF qua `POST /contracts` (`kind=appendix`, `parent_id`, `annex=1`) ⇒ chép hướng + đối tác/loại từ HĐ gốc ⇒ đặt «Cần ký» ⇒ mở trang phụ lục.
R7 kiểm tra tệp: `POST /pack/contracts/verify-file` băm sha256, so `sign_versions.sha256` + `sign_docs.src_sha256` (mới, 0124) trong công ty, theo quyền xem HĐ.

## Làm
- [x] Migration 0124 `sign_docs.src_sha256` + chỉ mục; `setNeedsSign` ghi sha tệp gốc (probe PDF).
- [x] R6: `annex` ở form tải HĐ, `annexInherit` (cha = HĐ done, người gọi thấy), `AnnexAdd` + mục «Phụ lục» ở `ContractBody` (AppendixPanel được gắn lại).
- [x] R7: domain `verify-file.rules`, repo, route, giới hạn 10 lần/phút/người, màn `/contracts/verify` + mục menu.

## Không làm / Chạm
Không đổi PATCH `/contracts/:id/parent` (vẫn chặn gắn phụ lục cũ). Tệp gốc bật «Cần ký» trước 0124 chưa có sha ⇒ chỉ so được bản đã ký.

## Test tối thiểu
unit `verify-file.rules.test.ts`; int `verify-file.int.test.ts`; e2e `e2e/contracts-web/cr182-annex-verify.cw.ts` (chưa chạy).

## Quyết định trong lúc làm
- Sha tệp gốc lưu ở `sign_docs.src_sha256` (migration 0124, journal idx 120 chừa 0123 cho partner-link), không thêm cột vào `files`.
- Lý do `no_flow`: trang phụ lục dùng sẵn câu «chưa có quy trình» của nút Gửi duyệt (không tạo thêm đường riêng).
- Mục menu «Kiểm tra tệp» là mục tĩnh, mọi nhân viên (máy chủ chỉ trả HĐ người đó thấy).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Phụ lục ký sau
HĐ đã duyệt có nút «Thêm phụ lục cần ký»: tải PDF ⇒ tạo phụ lục dưới HĐ gốc (cùng đối tác, hướng, loại) với tệp chính «Cần ký», rồi chạy duyệt và ký riêng; HĐ gốc giữ nguyên và liệt kê phụ lục kèm trạng thái.
- Kịch bản: khi người dùng tải phụ lục cho HĐ đã duyệt thì phụ lục có hướng và đối tác của HĐ gốc [test: thủ công — chạy trên evotest ở e2e cuối đợt]
#### Yêu cầu: Kiểm tra tệp
Người dùng tải một tệp lên màn «Kiểm tra tệp»; máy chủ băm sha256 (không lưu tệp) và so với bản đã ký, tệp gốc cần ký của công ty mình, chỉ trong HĐ người đó thấy.
- Kịch bản: khi tệp trùng bản đã ký thì báo khớp kèm mã kiểm tra và người ký [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khớp bản đã ký ⇒ HĐ, mã kiểm tra, người ký, bản để mở]
- Kịch bản: khi tệp trùng tệp gốc thì báo «Bản gốc» [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khớp tệp gốc cần ký ⇒ «Bản gốc»]
- Kịch bản: khi tệp bị sửa một byte thì không khớp [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » tệp sửa 1 byte ⇒ không khớp]
- Kịch bản: khi người gọi không thấy HĐ thì không khớp và không lộ [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » người không có quyền xem HĐ ⇒ không khớp, không lộ]
- Kịch bản: khi tệp thuộc công ty khác thì không khớp [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khác công ty ⇒ không khớp (cả hai chiều)]
- Kịch bản: khi chọn mã kiểm tra thì lấy 8 ký tự đầu viết hoa [test: apps/hub-api/src/modules/packs/contracts/domain/verify-file.rules.test.ts » bản đã ký ⇒ mã kiểm tra = 8 ký tự đầu viết hoa]
- Kịch bản: khi khớp thì màn hiện nút Xem bản đã ký [test: e2e/contracts-web/cr182-annex-verify.cw.ts » kiểm tra tệp: khớp bản đã ký ⇒ có mã kiểm tra và nút Xem bản đã ký]

## Việc còn lại
- Chưa chạy e2e. Chưa có int cho `annexInherit` (cha không phải HĐ done ⇒ PARENT_INVALID).

## Quyết định bổ sung (soát Opus)
- Phụ lục chỉ tạo được bởi quản trị gói ∪ người tạo ∪ người phụ trách HĐ gốc (điều phối chốt); điều kiện nằm trong câu `annexInherit`, cùng luật `canEditContractFiles` trừ cổng khoá (HĐ đã duyệt vốn bị khoá). Người chỉ có quyền xem bị từ chối `PARENT_INVALID`.
- Đường lỗi `UploadError` trong tx: rollback hàng phụ lục, `catch` của use case hoàn quota + gỡ tệp đã đẩy FileBox (chứng minh bằng unit + `annex.int.test.ts`).
- Tệp «Cần ký» bật trước migration 0124 không có sha gốc ⇒ kiểm tệp chỉ khớp được bản đã ký của chúng, không báo «Bản gốc».
