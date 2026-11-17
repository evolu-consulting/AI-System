---
id: fix-cr181-uat
lát: fix-cr181-uat
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa lỗi lượt soát UI bản test (`docs/specs/CR-181/uat-ui-review.md`): giám đốc ký được, nói đích danh người ký, Tự đặt đủ Bên B, mục Chữ ký luôn có, tệp chính mặc định «Cần ký», cột trang không bị cắt.

## Làm
- [x] 1a Seed `seed-cr181-sign`: bảo đảm `demo-owner` thuộc nhóm `nguoi-ky-hd` (chỉ thêm).
- [x] 1b Trang HĐ: bước Ký trên tài liệu đang mở ⇒ ẩn khối «Ký số / Tải lên bản đã ký» cũ; có lượt ⇒ thẻ «Ký hợp đồng» + «Mở và ký»; không có lượt ⇒ «Chờ <tên> ký».
- [x] 2 `members` cho người ký kiểu nhóm (`doc-sign.ts`, `packs.sign-doc.ts`); chip, nhãn chỗ ký, dòng «Người ký:» ở bước Ký dùng tên người.
- [x] 3 Seed thêm liên hệ đối tác có email (Bên B); `findAnchors` đặt ô dưới dòng «(Ký, ghi rõ họ tên)».
- [x] 4 Cài đặt: nhóm «Chung» (mục «Chữ ký») luôn có, kể cả khi chưa nhận ra gói nào.
- [x] 5 Seed: hợp đồng mẫu là tệp CHÍNH (trước là tệp kèm ⇒ mặc định «Cần ký» tắt).
- [x] 6 Cột trang: ảnh thu nhỏ vừa khung.
- [x] 7 Lỗi Thấp còn lại → `docs/TECH-DEBT.md` (#286–#292).

## Không làm / Chạm
Không đổi phạm vi đợt 1, không migration, không deploy. Chạm: `packages/contracts/src/pack-contracts/doc-sign.ts`, `apps/hub-api/src/modules/packs/packs.sign-doc.ts`, `sign-doc.usecase.ts`, `processes/runs/pack-runs-modules.ts`, `apps/workspace-web/src/features/doc-sign`, `contract-review/ContractBody.tsx`, `settings/SettingsNav.tsx`, `tools/scripts/src/seed-cr181-sign*`.

## Test tối thiểu
- unit: `sign-doc.members.test.ts`, `pack-runs-modules.test.ts`, `contract-view.test.ts`, `doc-sign-lib.test.ts`, `SettingsNav.test.ts`, `section-key.test.ts`, `seed-cr181-sign.data.test.ts`.
- int (evotest): `pack-runs-members.int.test.ts`.

## Quyết định trong lúc làm
- Lỗi 1 gốc: (a) bản test chưa chắc có `demo-owner` trong nhóm `nguoi-ky-hd` ⇒ seed tự bảo đảm (idempotent); (b) `ContractBody` luôn vẽ `EsignPanel` (đường ký cũ) kể cả khi bước Ký là `ondoc` ⇒ ẩn theo `turn` (`signStepOf`: có lượt ⇒ mine; lý do `NOT_SIGNER` ⇒ other).
- Lỗi 2: giữ `name` «Đại diện <nhóm>» (nhãn đã lưu, test cũ); thêm `members`; nhãn hiển thị tính lúc đọc (`whoLabel`) nên chỗ ký đã lưu cũng đổi theo thành viên hiện tại. Nhiều người ⇒ tên riêng (từ cuối) «Hùng, Mai»; dòng bước Ký: «<nhóm>: <tên>».
- Lỗi 3 gốc: Bên B lấy từ `contracts.partner_contacts` (liên hệ đầu có email), seed chỉ ghi `fields.partner_email` ⇒ không có Bên B. Seed thêm liên hệ. Ô đặt dưới dòng chú thích gần nhất (cùng cột, ≤ 80pt); nhãn ô nằm trong ô nên không còn đè chữ «ĐẠI DIỆN BÊN …».
- Lỗi 4: KHÔNG tái hiện được bằng đọc code (hộp thoại mở qua `openSettings` rồi chuyển về Tổng quan là thiết kế; e2e vào bằng `/settings/signature`). Sửa phòng ngừa: nhóm «Chung» không còn phụ thuộc cờ gói (Q15: mọi thành viên thấy). Cần soát lại trên bản test.
- Lỗi 5 gốc: backend + web đúng (`defaultNeedsSign` = tệp chính + PDF); seed tải hợp đồng mẫu như tệp KÈM nên không có tệp chính ⇒ seed chuyển thành tệp chính (HĐ đã rời Nháp trên bản test thì không tự sửa).
- Lỗi 6: canvas ảnh trang rộng 119px trong cột 96px ⇒ `max-w-full h-auto`, nút `w-full min-w-0`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Trang hợp đồng ở bước Ký trên tài liệu
Khi bước Ký đang mở dùng «Ký trên tài liệu», trang hợp đồng không hiện khối «Ký số / Tải lên bản đã ký» cũ. Người có lượt thấy thẻ «Ký hợp đồng» với «Mở và ký»; người ký công ty khác thấy «Chờ <tên người ký> ký».
- Kịch bản: khi người có lượt ký ở bước Ký thì thẻ Mở và ký hiện và khối ký cũ ẩn [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » signStepOf: có lượt ký ⇒ mine, không phải người ký ⇒ other, bước khác ⇒ null]
- Kịch bản: khi người ký còn chỗ chưa ký thì dòng chờ nói đích danh tên họ [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » nhóm không có thành viên ⇒ vẫn tên nhóm, người đã ký hết không còn trong «chờ»]

#### Yêu cầu: Người ký kiểu nhóm nói đích danh thành viên
Phiên ký trả thêm `members: [{id, name}]` cho người ký kiểu nhóm. Chip người ký, nhãn chỗ ký «Chờ … ký» và dòng «Người ký:» của bước Ký hiện tên thành viên (một người ⇒ tên đầy đủ; nhiều người ⇒ «Hùng, Mai»; dòng bước Ký thêm tên nhóm phía trước).
- Kịch bản: khi nhóm ký có hai thành viên thì nhãn chỗ ký là «Hùng, Mai» [test: apps/hub-api/src/modules/packs/contracts/application/sign-doc.members.test.ts » signer nhóm mang members, nhãn chỗ ký = tên người, không còn «Đại diện …»]
- Kịch bản: khi nhóm chưa có thành viên thì giữ nhãn đã lưu [test: apps/hub-api/src/modules/packs/contracts/application/sign-doc.members.test.ts » nhóm chưa có thành viên ⇒ giữ nhãn đã lưu]
- Kịch bản: khi bước Ký có người ký là nhóm thì dòng người ký ghi nhóm và tên thành viên từ dữ liệu thật [test: apps/hub-api/src/modules/processes/runs/pack-runs-members.int.test.ts » «<nhóm>: <tên thành viên>», nhóm không ai ⇒ chỉ tên nhóm, người ⇒ tên người]

#### Yêu cầu: Tự đặt chỗ ký theo ĐẠI DIỆN BÊN A/B
Ô ký đặt ngay dưới dòng «(Ký, ghi rõ họ tên)» của cùng cột nếu có, không đè chữ; không có dòng đó thì giữ vị trí mặc định. Bên B chỉ có khi đối tác có liên hệ có email (sổ đối tác).
- Kịch bản: khi trang cuối có hai cụm ĐẠI DIỆN BÊN A và BÊN B kèm dòng chú thích thì cả hai ô nằm dưới dòng chú thích [test: apps/workspace-web/src/features/doc-sign/lib/doc-sign-lib.test.ts » fix-cr181-uat · lỗi 3 · có dòng «(Ký, ghi rõ họ tên)» ⇒ ô nằm dưới dòng đó, cả Bên A lẫn Bên B]
- Kịch bản: khi dòng chú thích thuộc cột khác thì không dùng [test: apps/workspace-web/src/features/doc-sign/lib/doc-sign-lib.test.ts » dòng chú thích của cột khác (lệch ngang xa) không bị nhận nhầm]

#### Yêu cầu: Dữ liệu mẫu UAT ký trên tài liệu
Seed bảo đảm: giám đốc demo thuộc nhóm người ký; hợp đồng mẫu là tệp chính (mặc định «Cần ký»); đối tác có liên hệ có email (Bên B).
- Kịch bản: khi HĐ mẫu có hợp đồng là tệp kèm và đối tác chưa có liên hệ thì seed chỉ sửa hai chỗ đó [test: tools/scripts/src/seed-cr181-sign.data.test.ts » HĐ nháp đã có 2 tệp nhưng hợp đồng đang là tệp kèm, đối tác chưa có liên hệ ⇒ chỉ sửa hai chỗ đó]
- Kịch bản: khi giám đốc chưa thuộc nhóm người ký thì thêm vào [test: tools/scripts/src/seed-cr181-sign.data.test.ts » giám đốc demo chưa thuộc nhóm người ký ⇒ thêm, có rồi ⇒ bỏ qua]

### ADDED web/cai-dat-chu-ky.md
#### Yêu cầu: Mục «Chữ ký» trong Cài đặt
Nhóm «Chung» với mục «Chữ ký» luôn có trong Cài đặt cho mọi thành viên, kể cả khi chưa nhận ra gói nào; chỉ quản trị công ty sửa được.
- Kịch bản: khi chưa nhận ra gói nào thì vẫn có mục Chữ ký [test: apps/workspace-web/src/features/settings/components/SettingsNav.test.ts » fix-cr181-uat · lỗi 4 · chưa nhận ra gói nào (đang tải / quyền gói trống) ⇒ vẫn có «Chữ ký» (mọi thành viên thấy)]

## Việc còn lại
- Soát UI lại trên bản test sau deploy: K07, K09 bước giám đốc, M02, K10; lỗi 4 chưa tái hiện được.
- Chạy lại seed `--sign-only` trên bản test; HĐ mẫu đã rời Nháp cần HĐ Kinh doanh mới dưới 100 triệu.
