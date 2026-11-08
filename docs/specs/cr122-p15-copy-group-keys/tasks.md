---
id: cr122-p15-copy-group-keys
lát: cr122-p15-copy-group-keys
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-p6-library-group-keys
---
# CR-122 · P15 — Sao chép flow Thư viện: người duyệt theo mã → id công ty

Lỗi e2e G2: tenant_admin sao chép flow Thư viện, sửa người duyệt, PUT ⇒ 422 `PROCESS_REF_INVALID` tại `stages.1.after.group_key`.

## Plan (ngắn)
- Nguyên nhân: `bindGroupKeys` thêm `group_id` nhưng GIỮ `group_key` ⇒ bản sao (def công ty, chỉ nhận id — P6) không lưu lại được.
- Cách đơn giản: (1) lúc SAO CHÉP, đổi mã → id bằng chính `bindGroupKeys` (thêm `strip` bỏ `group_key`/`also_group_keys`); mã chưa có nhóm ở công ty ⇒ `group_id` trống + cảnh báo, KHÔNG chặn. (2) lúc LƯU def công ty (POST/PUT, không đường khe), mã hợp lệ của công ty tự đổi sang id (client cũ); mã lạ ⇒ 422 `GROUPS_MISSING` câu nghiệp vụ.

## Làm
- `triggers/group-keys.rules.ts`: `bindGroupKeys(stages, ids, { strip })`.
- `defs/def-group-bind.ts` (mới): `groupIdsByKey`, `groupMissingMessage`, `bindCompanyGroupKeys` (cả `run_group_keys`); gọi trong `defs.service` create/update (def công ty, không khe/bản riêng slot_body).
- `library/company-flows.service.ts` `clone`: bỏ lỗi `GROUPS_MISSING`; trả thêm `missing_group_keys` + `message` ("Nhóm <mã> chưa có ở công ty — chọn nhóm khác."). Dòng danh sách có cảnh báo bền `group_missing` (SQL `no_group`: def công ty còn bước duyệt trống nhóm).
- Contract `COMPANY_FLOW_WARNINGS` + `group_missing`; `CompanyFlowList.tsx` hiện mọi cảnh báo; i18n vi/en `warn.groupMissing`.

## Không làm / Chạm
- Không migration, không đổi luật def Thư viện (vẫn chỉ mã), không đổi đường mở lượt (`flow-launch` giữ mã). Engine không đổi.
- Không thêm UI chọn nhóm mới (editor có sẵn); admin-web chưa map riêng mã `GROUPS_MISSING` khi lưu (hiện lời server).
- Perf: không chạm đường nóng; thêm 1 câu đọc `admin.groups` chỉ khi def công ty có mã; `no_group` là `exists` trên jsonb ≤ 200 dòng.

## Test tối thiểu
- unit: `triggers/group-keys.rules.test.ts` (đường cũ không đổi, chạy lại).
- int `library/library-flow-publish.int.test.ts`: sao chép có Duyệt theo key ⇒ bản sao có `group_id`, không còn key; PUT đổi người duyệt (id và key cũ) ⇒ 200; mã thiếu nhóm ⇒ sao chép vẫn 201, cảnh báo + `missing_group_keys`, rồi PUT chọn nhóm ⇒ 200 và hết cảnh báo; def công ty với mã lạ ⇒ 422 `GROUPS_MISSING`.
- int `library/company-flows.int.test.ts`: công ty thiếu nhóm ⇒ 201 (không còn 422).
- Luật 0d.10: e2e `journey-approval-journey` một lần (spec nhánh slice/cr122-q1-e2e, evotest `-Dirty`).

## Quyết định trong lúc làm
- Bản sao thiếu nhóm vẫn `enabled` trong def nhưng dòng công ty `not_published`; bật/xuất bản lúc còn trống nhóm bị `PROCESS_DEF_INCOMPLETE` — đúng ý "chọn nhóm khác".
- Cảnh báo bền tính từ dữ liệu (không thêm cột) để không lệch với def.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Sao chép flow Thư viện về công ty đổi người duyệt theo mã sang id
"Sao chép để sửa" đổi mọi mã nhóm của flow Thư viện sang id nhóm của công ty và bỏ mã trong bản sao, nên bản sao sửa và lưu được. Mã chưa có nhóm ở công ty ⇒ ô nhóm để trống, vẫn sao chép được, dòng flow báo "Nhóm <mã> chưa có ở công ty — chọn nhóm khác".
- Kịch bản: khi sao chép flow Thư viện có bước Duyệt theo mã thì bản sao có `group_id` và không còn `group_key`, rồi đổi người duyệt (PUT) trả 200 [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P15 · sao chép flow Thư viện có Duyệt theo key]
- Kịch bản: khi mã nhóm chưa có ở công ty thì vẫn sao chép được, có cảnh báo `group_missing` và chọn nhóm khác lưu được [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P15 · mã nhóm chưa có ở công ty]
- Kịch bản: khi công ty thiếu nhóm theo mã thì sao chép trả 201 kèm mã thiếu [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » sao chép để sửa]

#### Yêu cầu: Def của công ty vẫn chỉ trỏ Group bằng id
Lưu def công ty nhận mã nhóm hợp lệ của chính công ty và tự đổi sang id (phòng client cũ); mã không có nhóm ở công ty ⇒ 422 `GROUPS_MISSING` nêu mã.
- Kịch bản: khi lưu def công ty có mã nhóm không tồn tại thì 422 `GROUPS_MISSING` "Nhóm <mã> chưa có ở công ty — chọn nhóm khác." [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P6/P15 · def của công ty: group_key lạ]
- Kịch bản: khi PUT bản sao với mã nhóm hợp lệ của công ty thì lưu thành id [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » P15 · sao chép flow Thư viện có Duyệt theo key]

## Việc còn lại
- Chạy int + e2e `journey-approval-journey`; báo kết quả G2.
