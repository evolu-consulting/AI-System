---
id: cr182-admin
lát: cr182-admin
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-roles
---
## Plan (ngắn)
Trình soạn quy trình của quản trị nền tảng ghi vai (R1) và gọn cấu hình ký (R3): bước Duyệt (kể cả cùng duyệt, chuyển cấp) có cách chọn «Theo vai»; bước Ký chọn vai người ký + công tắc «Cần chữ ký số», ẩn «Ký qua» và «Người ký phía công ty»; DocuSign ẩn khỏi mọi danh sách chọn.

## Làm
- [x] `lib/role-pick.ts` (khoá vai sinh từ nhãn, gom vai đã có) + `RoleField.tsx`; nối vào `StageApproveBasics`, `StageApproveParallel`, chuyển cấp (`approve-panel`, `wait-form`, `stage-convert`, `parallel-form`).
- [x] `esign/Panel.tsx`: «Người ký» (vai, mặc định «Người ký hợp đồng») + «Cần chữ ký số»; dòng chỉ đọc «Cấu hình cũ» + nút «Chuyển sang vai».
- [x] `esignConfigIssues`: có `signer_role` thì hợp lệ; `checkNode`: `need_digital` ⇒ `DIGITAL_NOT_ENABLED`.
- [x] DocuSign ẩn ở `settingsOut` (⇒ Cài đặt › Chữ ký và options của node); adapter + webhook giữ.
- [x] i18n `process/admin.{vi,en}.json`.

## Không làm / Chạm
Không làm: màn giao việc (cr182-assign), điền vai từ cấu hình cũ (cr182-migrate), ký số thật (đợt 3), ô nhập nhãn vai MỚI riêng cho bước Ký (khoá vai Ký chỉ chọn trong vai đã có + mặc định, vì `signer_role` chỉ lưu khoá).
Chạm: admin-web `features/processes`, contracts `pack-contracts/esign-node`, hub-api `packs/contracts` (`esign.providers`, `esign.helpers`, `esign-node.usecase`), i18n process/admin.

## Test tối thiểu
unit `role-pick.test.ts`, `esign-node.test.ts`, `esign-node.validator.test.ts`; tsc admin-web/contracts; biome; `check:ui-kit`; `i18n:check`.

## Quyết định trong lúc làm
- `StageRole` khai ở `lib/draft-types.ts` (contract không xuất qua `hub-admin`), cùng hình `StageRoleSchema`.
- Ô «Ai duyệt» có thêm lựa chọn «Theo vai (công ty tự giao người)»; chọn ⇒ hiện ô vai (chọn vai đã có hoặc «Vai mới…» + tên vai). Giữ nguyên chọn nhóm/người/trưởng phòng.
- Vai chưa đủ (khoá rỗng) không ghi ra def; ô báo «Tên vai cần có chữ hoặc số» khi nhãn không sinh được khoá.
- Bước Ký mới tự ghi `signer_role = nguoi-ky-hop-dong` lúc mở panel; «Chuyển sang vai» xoá `provider` + `company_signers`.
- `providerIssue`: nhà cung cấp ẩn (DocuSign) không chặn lưu — cấu hình cũ giữ.
- `need_digital = true` luôn báo `DIGITAL_NOT_ENABLED` (chưa công ty nào có chữ ký số trước đợt 3).
- DocuSign lọc ở `settingsOut` ⇒ nếu mặc định công ty là DocuSign thì mặc định hiệu lực chuyển sang nhà cung cấp kế.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Gọn cấu hình bước Duyệt và bước Ký theo vai
Quản trị nền tảng soạn bước Duyệt (kể cả nhóm cùng duyệt, chuyển cấp) có thể chọn «Theo vai» và nhập tên vai; khoá vai sinh từ tên, chọn lại được vai đã có. Bước Ký chọn «Người ký» theo vai (mặc định «Người ký hợp đồng») và công tắc «Cần chữ ký số» (tắt); «Ký qua» và «Người ký phía công ty» ẩn, quy trình cũ hiện dòng «Cấu hình cũ» với nút «Chuyển sang vai». DocuSign không còn trong danh sách chọn. Cần chữ ký số mà công ty chưa bật thì báo khi lưu.
- Kịch bản: khi chọn Theo vai thì bỏ phòng và người, khi chọn lại phòng thì bỏ vai [test: apps/admin-web/src/features/processes/lib/role-pick.test.ts » chọn «Theo vai» bỏ phòng/người, chọn lại phòng thì bỏ vai]
- Kịch bản: khi nhập tên vai thì khoá vai sinh từ tên [test: apps/admin-web/src/features/processes/lib/role-pick.test.ts » khoá vai sinh từ nhãn: bỏ dấu, đ ⇒ d, gạch ngang, ≤ 40]
- Kịch bản: khi chuyển cấp theo vai thì ghi vai vào quy trình [test: apps/admin-web/src/features/processes/lib/role-pick.test.ts » vai chưa đủ không ghi ra def, chuyển cấp theo vai ghi role]
- Kịch bản: khi nhiều bước dùng cùng một vai thì chỉ liệt kê một lần để chọn lại [test: apps/admin-web/src/features/processes/lib/role-pick.test.ts » gom vai đã có (Duyệt, cùng duyệt, chuyển cấp), một khoá một dòng]
- Kịch bản: khi bước Ký có vai người ký thì hợp lệ dù không chọn Ký qua và người ký cố định [test: packages/contracts/src/pack-contracts/esign-node.test.ts » CR-182 · vai người ký thay cho người ký cố định, need_digital=false không ghi ra args]
- Kịch bản: khi lưu bước Ký có vai thì máy chủ chấp nhận và vẫn kiểm theo công ty [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.test.ts » có signer_role (không «Ký qua», không người ký cố định) ⇒ hợp lệ, vẫn kiểm theo công ty]
