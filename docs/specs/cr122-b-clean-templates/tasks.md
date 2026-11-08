---
id: cr122-b-clean-templates
lát: cr122-b-clean-templates
cr: CR-122
làn: nhanh
migration: không (seed bằng code, idempotent)
phụ thuộc: E1b (map mã Group → id lúc chạy), A (nối dữ liệu hồ sơ — chỉ ảnh hưởng ca `flowEdgeIssues`, đang `skip`)
---
## Plan (ngắn)
3 flow mẫu sạch trong Thư viện theo sự kiện `contract.submitted`, đã xuất bản: "Duyệt 2 cấp", "Duyệt theo giá trị", "Duyệt theo phòng ban". Duyệt theo MÃ Group; Từ chối ⇒ Kết thúc · Từ chối; Trả lại ⇒ Kết thúc · Trả lại. Không node Ghi giá trị.

## Làm
- `apps/hub-api/src/modules/processes/library/flow-templates.def.ts`: nguồn sự thật 3 mẫu (stage qua `normalizeStage`, id cố định `0c122000-…-b1..b3`, đầu vào `contract-id`).
  - Duyệt 2 cấp: Trưởng phòng duyệt (`truong-phong`) → Giám đốc duyệt (`giam-doc`) → Ký số → Thông báo người tạo → Kết thúc · Đã duyệt.
  - Duyệt theo giá trị: Nếu `total_value` > 100 triệu thì Pháp chế (`phap-che`) duyệt, ngược lại Kế toán (`ke-toan`) duyệt → gộp (`next_step`) → Ký số → Kết thúc.
  - Duyệt theo phòng ban: Nếu `creator_department` = `phong-kinh-doanh` (X mẫu) thì nhóm `duyet-kinh-doanh` duyệt → Ký số → Kết thúc (phòng khác: ký số luôn).
  - Ký số = tool `contracts-esign-send` + chờ `esign.completed|declined|voided` (hạn 168 h); từ chối / huỷ / quá hạn chờ ⇒ Kết thúc · Từ chối.
- `flow-templates.seed.ts` `seedFlowTemplates(hub)`: `parseFlowDef` + `flowDefIssues(manifest.events)` trước khi ghi; chèn def Thư viện (`tenant_id` null, `trigger`, `app`, `published_version = 1`) + release 1, `ON CONFLICT DO NOTHING` ⇒ chạy lại không nhân bản, không đè bản đã sửa.
- CLI `tools/scripts/src/seed-flow-templates.ts [--apply]` (mặc định chạy thử).
- Sửa lỗi gặp khi làm: `nodes/approve/node.ts` `ensureApproveStage` ghi trường `decision` thiếu `required` ⇒ def có node Duyệt không đọc lại được bằng `parseFlowDef`/`ProcessStageDefSchema` — thêm `required: true` (1 dòng).

## Không làm / Chạm
- Không đụng admin-web/e2e/engine (trừ 1 dòng `required` ở chuẩn hoá node Duyệt), không node Ghi giá trị, không DLC. Không migration (số `0112` có thể bị lát khác lấy).
- Prod/dev: chạy `seed-flow-templates --apply` một lần (như `seed-niti`); mẫu chưa gán cho công ty nào (công ty sao ra từ Thư viện, E1b map mã Group).

## Test tối thiểu
- unit `library/flow-templates.def.test.ts`: mỗi mẫu qua `parseFlowDef` + `flowDefIssues` + cấu hình node Ký số; Duyệt theo mã Group; đích Từ chối/Trả lại đúng node Kết thúc; hình riêng mẫu 2/3. `flowEdgeIssues = 0` viết sẵn, `skip` (chờ A).
- int `library/flow-templates.seed.int.test.ts`: tạo 3 def đã xuất bản, đọc lại hợp lệ; chạy lại không nhân bản / không đè bản sửa tay.

## Quyết định trong lúc làm
- Seed bằng code (builder dùng lại `normalizeStage` ⇒ một nguồn, không dán JSON dài vào migration); tên Group là MÃ mẫu, công ty tự đổi khi sao.
- Phòng ban khác X ở mẫu 3 đi thẳng Ký số (không duyệt thêm) — brief không nêu nhánh còn lại.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### ADDED current/engine/flow-templates.md
#### Yêu cầu: Thư viện có sẵn 3 flow mẫu duyệt hợp đồng
Thư viện có ba flow mẫu theo sự kiện gửi duyệt hợp đồng, đã xuất bản, duyệt theo mã Group, từ chối thì kết thúc là Từ chối.
- Kịch bản: khi chạy seed thì có đủ ba flow mẫu đã xuất bản bản 1 và đọc lại vẫn hợp lệ [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts » tạo 3 flow mẫu đã xuất bản (bản 1), có trigger + app, không khe, đọc lại vẫn hợp lệ]
- Kịch bản: khi chạy seed lần hai thì không nhân bản và không đè bản đã sửa [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts » chạy lại không nhân bản (3 def, mỗi def 1 release) và không đè bản đã đổi]
- Kịch bản: khi kiểm từng mẫu thì qua luật FlowDef với sự kiện của hợp đồng [test: apps/hub-api/src/modules/processes/library/flow-templates.def.test.ts » flowDefIssues với sự kiện của manifest contracts = 0 (outcome, điều kiện đúng dữ kiện + kiểu)]

## Việc còn lại
- Mở ca `flowEdgeIssues = 0` khi A gộp (đánh dấu `node: contracts.esign` ở bước Ký số + palette manifest).
- Chạy `seed-flow-templates --apply` trên prod sau khi người dùng xác nhận deploy.
