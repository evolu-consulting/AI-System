---
id: cr126-seed-esign-signer
lát: cr126-seed-esign-signer
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
e2e `cr125-purchase-full` dừng ở bước «Ký số» của Phần 2 «Hợp đồng» (`ESIGN_NODE_NO_SIGNER`): mẫu Thư viện không mang id nhóm nên không có người ký công ty.
`writeCr125Config` thêm bước 7: công ty có nhóm `giam-doc` nhận bản riêng của Phần 2 (cùng đường «Sao chép để sửa»: mã nhóm → id, `company_signers` = `group:<giam-doc>`); lượt con ưu tiên bản công ty (`resolveSubprocessDef`). «Ký thử» đã bật ở bước 2.

## Làm
- `apps/hub-api/src/modules/seed/seed.cr125-config.ts`: `writePurchaseEsignSigners`, `withEsignSigner` (thuần), `esignSigners` trong kết quả.
- `apps/hub-api/src/modules/seed/seed.tenant-fixtures.ts`: trường kết quả mới.
- Test: `apps/hub-api/src/modules/seed/seed.cr125-esign-signer.int.test.ts`.

## Không làm / Chạm
Không đổi runtime/engine, không migration, không sửa mẫu Thư viện (dữ liệu tự sinh). Bản công ty của Phần 2 không tự nhận cập nhật mẫu Thư viện sau này (như mọi bản sao).

## Test tối thiểu
Một int: sau `writeCr125Config`, def lượt con Phần 2 có `ky-so` với người ký nhóm Giám đốc, `esignConfigIssues` rỗng, «Ký thử» bật, chạy lại không nhân đôi.

## Quyết định trong lúc làm
Dùng bản công ty (như UI) thay vì sửa runtime thư viện, vì id nhóm là theo công ty.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

### MODIFIED engine/seed-cau-hinh-cong-ty.md
#### Yêu cầu: Công ty mẫu gửi ký số được ở Phần 2 «Hợp đồng» (nguồn: cr126-seed-esign-signer)
Công ty mẫu có nhóm Giám đốc nhận sẵn bản công ty của Phần 2 «Hợp đồng» với người ký công ty = nhóm Giám đốc; không có công tắc tay nào còn thiếu trước bước «Ký số».
- Kịch bản: khi seed công ty mẫu thì bước «Ký số» của lượt con Phần 2 có người ký là nhóm Giám đốc và chạy lại không nhân đôi [test: apps/hub-api/src/modules/seed/seed.cr125-esign-signer.int.test.ts » seed công ty: bước Ký số của Phần 2 có người ký nhóm Giám đốc]

## Việc còn lại
Không.
