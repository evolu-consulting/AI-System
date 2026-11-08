---
id: cr125-manual-start-engine
lát: cr125-manual-start-engine
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Quy trình bắt đầu được từ **phiếu yêu cầu** (vd «Tạo đề xuất mua hàng», gap «flow chỉ bắt đầu từ contract.submitted» ở
`docs/specs/CR-125/purchase-flow-trial.md`), không chỉ từ sự kiện app. Một nguồn: cấu hình ở stage đầu (`core.start-form`), mở lượt
qua ĐÚNG đường của sự kiện (`flowLaunchOf` → `StartService.createFromApi`, gating `company_flows` + cờ `FLOW_TRIGGERS`).

## Làm
- contracts `modules/core/start-form/config.ts` (zod cấu hình + zod phiếu + đầu ra + input lượt + tên yêu cầu) · `node.ts` (khai báo
  `core.start-form`, kind base, baseExecutor `set`) · `core/module.ts` (cho `check:modules`) · `hub-admin/process-start.ts` (API + mã lỗi).
- Stage def thêm `start_form` (optional). `templateNeeds` tính `starters.group_keys` là nhóm cần.
- hub `triggers/manual-start.{repo,service,routes}.ts`; `flow-launch.ts` chỉ thêm tham số tuỳ chọn `x.inputs` (nối vào `recordInputs`).
- i18n `process.run.startError.*` (vi/en) + `check:error-codes` (bộ `process-start`).

## Không làm / Chạm
- Không UI (lát Sonnet: «Tạo yêu cầu» ở workspace + panel trình sửa). Không migration. Không đổi launch/settle của engine.
- Không kiểm lúc lưu def (stage start-form phải ở đầu, cấu hình hợp lệ): hiện chỉ kiểm lúc bắt đầu (`startFormOf` sai ⇒ START_FLOW_OFF).

## Hợp đồng cho lát UI (Sonnet)
**Stage đầu của flow** (`ProcessStageDef`, lưu như stage thường):
```jsonc
{ "key": "phieu", "name": "Bắt đầu bằng phiếu yêu cầu", "node": "core.start-form",
  "executor": { "kind": "set", "values": [] },            // không chạy gì; giá trị phiếu vào input của lượt
  "output": { "filename": "p.md", "template": "# p", "required_sections": ["p"], "fields": [] },
  "after": { "kind": "auto", "branch": [] }, "answerer": { "kind": "starter" }, "real_action": false, "token_budget": null,
  "start_form": {                                          // = StartFormConfigSchema (@ai/contracts/modules)
    "fields": [ { "key": "item", "label": "Hàng cần mua", "type": "text", "required": true, "help": "…" } ],  // 1–20, khoá FIELD_KEY_RE, không trùng
    "starters": { "kind": "everyone" } | { "kind": "groups", "group_ids": ["<uuid>"], "group_keys": ["mua-hang"] },  // group_keys: mẫu Thư viện
    "title_template": "Đề xuất mua {{item}}" } }
```
- `type` ∈ `START_FORM_FIELD_TYPES` = text · longtext · money · date · people · department · attachments (PortWidget + `attachments`;
  panel chung CHƯA có ô `attachments` — thêm vào `admin-web …/modules/generic/fields.ts`).
- Giá trị: text/longtext = chuỗi (≤ 500 / 5000) · money = số ≥ 0 · date = `YYYY-MM-DD` · department = uuid · people/attachments = mảng uuid (≤ 20).
- Đầu ra của node cho `mapSourcesAt(start, …)`: `startFormOutputs(cfg)` (thay `defStartOutputs` khi stage đầu là start-form). Lượt có
  input theo khoá ô + `request_title`.
- Node `stages: []` (bước có sẵn của trình sửa như Duyệt/Nếu): KHÔNG ở menu «+», chỉ đặt ở đầu flow.

**API (JWT, người dùng workspace, tenant = JWT):**
- `GET /processes/startable` → `{ items: StartableFlow[] }`, `StartableFlow = { flow_key, name, company_flow_id, form: { fields, title_template } }`.
  Chỉ flow bật + cờ công ty bật + người xem thuộc «ai được bắt đầu».
- `POST /processes/start` body `StartProcessRequestSchema` = `{ flow_key, request_id: uuid (client sinh mỗi lần mở phiếu), values: {khoá: giá trị} }`
  → 201 `{ run_id, created: true, title }`; gửi lại cùng `request_id` ⇒ 200 `created: false` (cùng lượt).
- Lỗi (`PROCESS_START_ERRORS`, i18n `process.run.startError.<mã>`): 404 `PROCESS_NOT_FOUND` (không có flow đó ở công ty) · 409
  `START_FLOW_OFF` (flow/cờ tắt, tính năng node tắt, mẫu chưa xuất bản; `details.reason` khi do đường mở lượt) · 403 `START_NOT_ALLOWED`
  · 422 `START_FORM_INVALID` `details.fields = { khoá: mã zod }` (`too_small`, `invalid_type`/`required_or_type`, `invalid_format`, `unrecognized`…) · 429 `TOO_MANY_PROCESS_RUNS`.

## Test tối thiểu
- unit `packages/contracts/src/modules/core/start-form/config.test.ts` (+ sửa `modules.rules.test.ts`): 56 pass.
- int evotest -Dirty: `manual-start.int.test.ts` + `packs.module-registry.int.test.ts` + `launch-real.int.test.ts` — 12 pass, 0 fail.
- tsc contracts + hub-api xanh; admin-web có 39 lỗi tsc SẴN (i18n key typing, không do lát này — kiểm trên cây không đổi).
- `check:modules`, `check:error-codes`, `check:i18n-unused --strict` OK.

## Quyết định trong lúc làm
- Mỗi lần bắt đầu = một dòng `hub.flow_events` (`event = core.start-form`, `event_id = ref = start:<request_id>`, `facts` = giá trị phiếu,
  ghi ở trạng thái đã chốt ⇒ bộ điều phối không nhận). Chống trùng: unique `(tenant_id, event_id)` + `process_runs_flow_event_uq`.
- Đọc flow + nhóm ở scope system (như `candidatesOf`, để đọc bản xuất bản mẫu Thư viện), lọc `cf.tenant_id = JWT tenant`; ghi sự kiện +
  đọc lượt ở scope user (RLS tenant).
- Giá trị phiếu ⇒ `process_runs.inputs` (như dữ kiện của sự kiện): tiền = number, danh sách nối ", ", còn lại text.
- `core/module.ts` thêm để `check:modules` đối chiếu `core/<node>/node.ts` (sổ tự sinh vẫn nhập `./core`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-triggers.md
#### Yêu cầu: Bắt đầu quy trình bằng phiếu yêu cầu
Flow công ty có stage đầu `core.start-form` bắt đầu được bằng tay qua `POST /processes/start` (khoá flow + giá trị phiếu + `request_id`),
mở lượt qua cùng đường với sự kiện (gating `company_flows` + cờ `FLOW_TRIGGERS`); giá trị phiếu là input của lượt. `GET /processes/startable`
liệt kê flow người xem được bắt đầu kèm phiếu. Chỉ công ty của người gọi.
- Kịch bản: khi người thuộc nhóm được phép gửi phiếu hợp lệ thì mở đúng một lượt, input của lượt là giá trị phiếu + tên yêu cầu; gửi lại cùng request_id thì trả cùng lượt [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » người trong nhóm thấy flow + phiếu, bắt đầu ⇒ một lượt với input là giá trị phiếu, gửi trùng ⇒ cùng lượt]
- Kịch bản: khi người không thuộc nhóm được phép bắt đầu thì 403 START_NOT_ALLOWED và flow không có trong danh sách [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » người không trong nhóm ⇒ 403 START_NOT_ALLOWED, không thấy trong danh sách]
- Kịch bản: khi phiếu sai (thiếu ô bắt buộc, sai kiểu, ô lạ) thì 422 START_FORM_INVALID kèm lỗi theo ô và không ghi gì [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » phiếu sai ⇒ 422 START_FORM_INVALID kèm lỗi theo ô, không mở lượt]
- Kịch bản: khi người của công ty khác gọi thì không thấy và không bắt đầu được flow [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » công ty khác không thấy, không bắt đầu được flow của X]
- Kịch bản: khi cờ quy trình của công ty tắt thì 409 START_FLOW_OFF và danh sách rỗng [test: apps/hub-api/src/modules/processes/triggers/manual-start.int.test.ts » cờ quy trình của công ty tắt ⇒ 409 START_FLOW_OFF, danh sách rỗng]

### MODIFIED engine/company-flows.md
#### Yêu cầu: Nhóm «ai được bắt đầu» là nhóm cần của mẫu
`templateNeeds` tính `start_form.starters.group_keys` của stage là nhóm cần (như nhóm duyệt), để gán/sao chép mẫu báo thiếu nhóm.
- Kịch bản: khi mẫu có phiếu yêu cầu chỉ cho nhóm «mua-hang» thì nhóm cần của mẫu có «mua-hang» [test: packages/contracts/src/modules/core/start-form/config.test.ts » nhóm «ai được bắt đầu» là nhóm cần của mẫu, node có trong sổ module]

## Việc còn lại
- Lát UI (Sonnet): panel trình sửa cho stage start-form + «Tạo yêu cầu» ở workspace (hợp đồng ở trên); ô `attachments` ở panel chung.
- Kiểm lúc lưu def: start-form chỉ ở stage 0, `start_form` bắt buộc khi `node = core.start-form`.
- e2e hành trình thật (D5) tạo yêu cầu → lượt chạy: chạy ở đợt cuối cùng lát UI.
