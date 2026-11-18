---
id: fix-cr182-role-save
lát: fix-cr182-role-save
cr: CR-182
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lưu / bật quy trình có bước Duyệt chỉ dùng `role` bị 422 `PROCESS_DEF_INCOMPLETE` (`stages.N.after.group_id`). Luật «đủ» phải tính vai là đã có người làm.

## Làm
- [x] `reviewHasGroup` (server): `after.role` và nhóm cùng duyệt có `role` tính là đã có người làm.
- [x] Cột `no_group` của danh sách quy trình công ty (SQL `company-flows.repo.ts`): cùng luật.
- [x] Kiểm phía admin-web (`def-form.ts`): «Theo vai» đủ nhãn thì không báo thiếu Group.
- [x] Rà: chuyển cấp có `role` không cần đích (schema + `escalateStageIssues` + `escalateRefMiss` đã chịu); bước Ký có `signer_role` đã hợp lệ ở `esignConfigIssues` + `checkNode`; `library-publish.rules` và `template-readiness` chỉ xét `group_key` nên không chạm vai.

## Không làm / Chạm
Chạm: `processes/defs/def-group-keys.rules.ts`, `processes/library/company-flows.repo.ts`, `admin-web/features/processes/lib/def-form.ts`, test.

## Test tối thiểu
unit `def-group-keys.rules.test.ts`, `def-form.test.ts`; int evotest `defs-flow.int.test.ts` (+ `company-flows.int.test.ts`): 13 xanh.

## Quyết định trong lúc làm
- Vai chưa giao KHÔNG chặn lưu/bật (chỉ chặn lúc mở lượt, theo CR-182 R1); chỉ cần khai vai.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Lưu và bật quy trình có bước chỉ dùng vai
Bước Duyệt (kể cả nhóm cùng duyệt) chỉ khai vai, không chọn nhóm hay người, vẫn lưu và bật được; người làm do quản trị công ty giao cho vai và được giải khi mở lượt.
- Kịch bản: khi lưu quy trình bật có bước Duyệt chỉ có vai thì lưu được rồi giao người cho vai thì lượt chạy giải ra người đó [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » bước Duyệt chỉ có `role` ⇒ lưu 2xx (không PROCESS_DEF_INCOMPLETE), rồi giao người ⇒ lượt chạy giải được vai]
- Kịch bản: khi bước Duyệt hoặc nhóm cùng duyệt có vai thì luật đủ người làm coi là đủ [test: apps/hub-api/src/modules/processes/defs/def-group-keys.rules.test.ts » CR-182 · vai (`after.role`, nhóm cùng duyệt có `role`) tính là đã có người làm, vai rỗng/sai dạng thì không]
- Kịch bản: khi trình soạn chọn Theo vai đã nhập nhãn thì không báo thiếu nhóm [test: apps/admin-web/src/features/processes/lib/def-form.test.ts » CR-182 · bật khi bước Duyệt chỉ có vai ⇒ không báo thiếu Group, vai chưa nhập nhãn thì vẫn báo]

## Việc còn lại
Không.
