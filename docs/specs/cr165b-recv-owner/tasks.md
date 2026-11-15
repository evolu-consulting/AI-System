# CR-165b · người phụ trách nhận HĐ + hồ sơ công ty yaml

- [x] Nhận HĐ: owner theo công ty (`RECV_OWNER`), người phụ trách là cấp cao nhất ⇒ Chuẩn bị ký → Ký; Julian ⇒ Thomas duyệt + ký (`tools/scripts/src/tenant-flows.data.ts`)
- [x] Hồ sơ `profile:` evolu + preschool; unit test CLI tách cột (`onboard.rules.test.ts`)

## Quyết định trong lúc làm
- Người dùng đổi người nhận NitiGroup từ Vy sang Tiên; Tiên và Dung là trưởng gốc nên dùng cùng dạng `none` (Chuẩn bị ký rồi Ký), tránh bước duyệt không người.
- MST tạm 10 số (`8888888888`, `9999999999`) vì `TENANT_PROFILE_TAX_CODE_RE` buộc 10 chữ số; chờ người dùng xác nhận.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/onboarding-cong-ty.md

#### Yêu cầu: Người phụ trách «Nhận hợp đồng từ đối tác» theo công ty và hồ sơ công ty trong yaml (CR-165b)
Người phụ trách nhận: Evolu là Julian (Thomas duyệt và ký), NitiGroup là Tiên, Preschool là Dung; Tiên và Dung là cấp cao nhất nên chỉ «Chuẩn bị ký» rồi «Ký», không có bước duyệt không người. Hồ sơ yaml của Evolu và Preschool có tên pháp lý và mã số thuế 10 số (tạm, chờ xác nhận) và onboarding ghi đúng vào cột hồ sơ công ty.
- Kịch bản: Tiên phụ trách nhận hợp đồng NitiGroup thì chuẩn bị ký rồi ký, không bước duyệt treo; Julian phụ trách ở Evolu thì Thomas duyệt [test: tools/scripts/src/tenant-flows.int.test.ts » CR-165b nhận HĐ · Tiên phụ trách ⇒ Chuẩn bị ký rồi Ký không bước duyệt · Julian ⇒ Thomas duyệt]
- Kịch bản: file yaml Evolu và Preschool có tên pháp lý và mã số thuế, onboarding tách đúng vào cột [test: apps/admin-api/src/modules/tenant-onboard/domain/onboard.rules.test.ts » CR-165b · hồ sơ công ty evolu / preschool trong yaml]
