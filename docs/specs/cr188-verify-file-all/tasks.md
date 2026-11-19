---
id: cr188-verify-file-all
lát: cr188-verify-file-all
cr: CR-188
làn: đầy đủ
migration: không
phụ thuộc: cr182-annex-verify
---
## Plan (ngắn)
BR-188-6: «Kiểm tra tệp» dò MỌI giấy tờ đã ký của công ty (`sign_versions`: HĐ, phụ lục, khác, mọi phiên bản chưa huỷ) trong MỘT câu SQL (LEFT JOIN HĐ dưới RLS xem HĐ).
Khớp mà không quyền xem ⇒ `{match:true, visible:false}` cùng hình dạng, mọi chi tiết null. `from_contract_id` ⇒ báo «bản đã ký của HĐ khác». Tệp gốc chưa ký ⇒ không khớp (Q3).
UI: nút «Kiểm tra tệp» trên danh sách HĐ + «⋯» từng HĐ (hộp thoại); bỏ mục thanh bên, giữ route `/contracts/verify`.

## Làm
- [x] Domain `verify-file.rules` (pickMatch: (a)(a')(b)(c)), repo một câu SQL, route nhận `from_contract_id`.
- [x] Web: `VerifyFilePanel`/`VerifyFileDialog`/`use-verify-dialog`, nút ở `ListHeader`, «⋯» ở `ContractCells`/`MobileRowMenu`, bỏ `VERIFY_NAV`.
- [x] i18n vi/en `contracts.verify.*`.
- [x] Test: unit rules, int (evotest), e2e `cr188-verify.cw.ts` (chưa chạy); sửa `journey-dot2.spec.ts` theo câu mới.

## Không làm / Chạm
Không đổi giới hạn tần suất (10/phút/người), không đổi lưu trữ, không migration. Cột `src_sha256` giữ nguyên (không còn dò).

## Test tối thiểu
unit `verify-file.rules.test.ts`; int `verify-file.int.test.ts` (evotest -Dirty: 9 pass); e2e `e2e/contracts-web/cr188-verify.cw.ts` (chưa chạy); `tsc` workspace-web.

## Quyết định trong lúc làm
- Hình dạng phản hồi cố định (mọi khoá luôn có); `visible=false` ⇒ `contract`, mã kiểm tra, người ký, giờ ký, id tệp/bản đều null (che ngay trong SQL bằng `case when c.id is null`).
- Giấy tờ khớp nhiều HĐ: ưu tiên HĐ đang mở (`from_contract_id`), rồi bản ký mới nhất; `limit 5` như cũ.
- «Loại» suy từ `kind`/`doc_type`: phụ lục / hợp đồng / giấy tờ khác; «đối tác» theo `direction` (bán ⇒ bên mua, còn lại ⇒ bên bán).
- Nút «Mở hợp đồng» luôn mở trang HĐ (bỏ «Xem bản đã ký»).
- Delta là ADDED `kiem-tra-tep.md` (yêu cầu «Kiểm tra tệp» của cr182-annex-verify chưa gộp vào docs/current ⇒ khi đóng, gộp thay thế khối cũ ở `ky-tren-tai-lieu.md`).
- Test cũ `verify-file.int.test.ts` «không quyền ⇒ không khớp» và `journey-dot2.spec.ts` (câu «Không khớp bản nào đã lưu», nút «Xem bản đã ký») đổi nghĩa theo spec mới — sửa trong lát này (spec mới thắng).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/kiem-tra-tep.md
#### Yêu cầu: Kiểm tra tệp
Người dùng tải một tệp lên «Kiểm tra tệp» (nút trên danh sách HĐ hoặc «⋯» của một HĐ); máy chủ băm sha256 (không lưu tệp) và so với MỌI giấy tờ đã ký của công ty mình (HĐ, phụ lục, giấy tờ khác, mọi phiên bản đã ký); tệp gốc chưa ký không tính; không bao giờ so với công ty khác. Khớp giấy tờ người dùng không có quyền xem ⇒ chỉ báo «Khớp một giấy tờ đã ký của công ty», không chi tiết, không nút mở (cùng hình dạng phản hồi).
- Kịch bản: khi tệp trùng bản đã ký thì báo khớp kèm HĐ, loại, mã kiểm tra, người ký [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khớp bản đã ký ⇒ HĐ, loại, mã kiểm tra, người ký, bản để mở]
- Kịch bản: khi tệp là phụ lục đã ký thì khớp với loại phụ lục [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khớp phụ lục đã ký ⇒ loại «phụ lục»]
- Kịch bản: khi tệp là phiên bản cũ đã ký thì vẫn khớp [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khớp phiên bản cũ đã ký (không phải bản mới nhất) ⇒ vẫn khớp]
- Kịch bản: khi tệp là bản gốc chưa ký thì không khớp [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » tệp gốc chưa ký ⇒ không khớp (Q3)]
- Kịch bản: khi tệp bị sửa một byte thì không khớp [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » tệp sửa 1 byte ⇒ không khớp]
- Kịch bản: khi khớp HĐ người gọi không có quyền xem thì chỉ báo khớp, không chi tiết [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khớp HĐ không có quyền xem ⇒ chỉ «khớp», không chi tiết, cùng hình dạng]
- Kịch bản: khi HĐ được giao cho người khác người tạo thì người được giao thấy chi tiết, người tạo bị che [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » N2 · người được giao (≠ người tạo) thấy chi tiết, người tạo không còn là chủ ⇒ bị che]
- Kịch bản: khi mở từ một HĐ mà tệp khớp HĐ khác thì báo «bản đã ký của HĐ khác» [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » mở từ HĐ này mà khớp HĐ khác ⇒ other=true, khớp chính HĐ đó ⇒ other=false]
- Kịch bản: khi tệp thuộc công ty khác thì không khớp [test: apps/hub-api/src/modules/packs/contracts/adapters/verify-file.int.test.ts » khác công ty ⇒ không khớp (cả hai chiều)]
- Kịch bản: khi chọn kết quả thì (a)(a')(b)(c) đúng luật [test: apps/hub-api/src/modules/packs/contracts/domain/verify-file.rules.test.ts » (a') khớp mà không quyền ⇒ chỉ match, mọi chi tiết null, không rò id]
- Kịch bản: khi khớp thì màn hiện nút Mở hợp đồng; thanh bên không còn mục [test: e2e/contracts-web/cr188-verify.cw.ts » kiểm tra tệp: khớp + có quyền ⇒ HĐ, loại, đối tác, giờ ký, nút Mở hợp đồng]

## Việc còn lại
- Chưa chạy e2e (điều phối chạy cuối đợt). Test tay: bấm «⋯» → «Kiểm tra tệp với hợp đồng này» trên desktop và điện thoại.
