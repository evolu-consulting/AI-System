---
id: cr122-e4-set-from-field
lát: cr122-e4-set-from-field
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: N2 (eb3a4e86e)
---
## Plan (ngắn)
Node Ghi giá trị (`set`) đọc thêm field output của bước trước và dữ kiện bản ghi, có biến đổi kiểu tối thiểu ⇒ cầu nối AI (FR-26)
map được `contract.value → amount`.

## Làm
- [x] Contract `SetFromSchema` += `{kind:"field", step, key}`, `{kind:"fact", key}`; `SetValueSchema.as` ∈ number/text/date/bool.
- [x] Domain `set.rules`: `setFieldsOf` (nguồn field theo bước, fact; sai dạng/vắng ⇒ `null` + `bad`), `convertAs`; luật lưu nguồn field (bước TRƯỚC, khoá có trong output bước đó, kiểu khớp/`as`).
- [x] Chạy: `adapters/runs/set-sources.repo.ts` — 1 câu đọc field theo bước + `FactsReader` (chỉ khi cần; chỉ input/hằng ⇒ 0 câu) + 1 dòng audit `update/process_run {kind: set_value_invalid}` khi sai dạng.
- [x] `flowDefIssues`: fact của `set` phải thuộc `AppEventDecl.facts`. `flowEdgeIssues`: đầu ra của `set` gồm mọi khoá đã ghi.
- [x] Cầu nối AI: reply nhận nguồn field/fact + `as` (zod), prompt thêm `from.step` + `facts`, kiểm lại luật `set` trên def SAU khi chèn; field nguồn field/fact `required: false`.
- [x] admin-web `set-form`: dòng nguồn field/fact/`as` giữ nguyên khi lưu (`keep`) — editor chưa có khối sửa (U2).

## Quyết định trong lúc làm
- `bool` ghi chuỗi "true"/"false" (kiểu field output không có boolean).
- Audit dùng action `update` có sẵn (không migration CHECK).
- Bridge service chưa có danh mục sự kiện ⇒ chưa truyền `facts` cho AI (AI không dùng được nguồn fact tới khi nối manifest).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Ghi giá trị từ bước trước / dữ kiện
- Kịch bản: map field bước trước + dữ kiện, sai dạng ⇒ null + audit [test: apps/hub-api/src/modules/processes/adapters/runs/set-sources.repo.int.test.ts » field bước trước + dữ kiện ⇒ amount = 150000000, kind, sai dạng ⇒ null + 1 dòng audit]
- Kịch bản: chỉ input/hằng không thêm câu SQL [test: apps/hub-api/src/modules/processes/adapters/runs/set-sources.repo.int.test.ts » chỉ input/hằng ⇒ 0 câu SQL thêm]
- Kịch bản: biến đổi kiểu [test: apps/hub-api/src/modules/processes/domain/set/set-from.rules.test.ts » number / text / date / bool, sai dạng ⇒ undefined]
- Kịch bản: luật lưu nguồn field [test: apps/hub-api/src/modules/processes/domain/set/set-from.rules.test.ts » bước không đứng trước / khoá không có / kiểu sai ⇒ SET_INVALID ở from]

## Việc còn lại
- Editor khối sửa nguồn field/fact + `as` (U2); bridge truyền `facts` từ manifest sự kiện của flow.
