---
id: cr122-p17-io-keys
lát: cr122-p17-io-keys
cr: CR-122
làn: đầy đủ (migration dữ liệu)
migration: hub 0112
phụ thuộc:
---
## Plan (ngắn)
Một khoá bản ghi HĐ `contract_id` ở mọi nơi (code + dữ liệu); gỡ khoan dung `ioKeyOf` ở `edgeIssues`; giữ `inputKeyOf` chỉ cho snapshot lượt cũ;
output node Ghi giá trị (cầu nối AI) phải tới `args` bước tool kế.

## Làm
- Đổi `contract-id` → `contract_id`: flow-templates.def, contracts-intake.def, approval-flow(.dify).rules, approval-engine.usecase (input lượt), approval/intake.mount, seed.library-sample + test.
- hub 0112: đổi trong `process_defs.inputs|stages` + `process_def_releases.stages` (set-based, idempotent, NOTICE); không đụng `process_runs`, `dlc.*`.
- `edgeIssues` khớp tuyệt đối (lệch ⇒ báo + gợi ý cầu nối AI). `inputKeyOf` (tool-run.rules) giữ làm tương thích snapshot cũ.
- Cầu nối: `fieldArgSources` (tool-stage-load.repo) tự nối đầu vào node chưa có nguồn & không có trong input lượt ⇐ field cùng khoá của stage gần nhất phía trước.

## Không làm / Chạm
Không rewrite `process_runs`; không chạm DLC; `contract-title|deal|value|partner` (khoá Dify) giữ nguyên. Seed flow mẫu chỉ chèn khi vắng ⇒ prod đã có thì 0112 sửa tại chỗ.

## Test tối thiểu
unit nodes.rules + tool-input-key; int contract-id-key (0112), tool-auto-args (cầu nối → buildToolArgs), esign-node, contracts-intake.seed; e2e journey-approval một lần (evotest).

## Quyết định trong lúc làm
- Cầu nối tới tool: trước p17 `autoArgKeys` chỉ nhìn input lượt ⇒ output node Ghi giá trị KHÔNG tới bước tool (chỉ chạy khi args khai tường minh) ⇒ thêm nguồn field gần nhất (O(n) nhỏ, 1 cột SQL thêm trong câu sẵn có).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Một khoá bản ghi hợp đồng `contract_id` (CR-122 p17)
Mọi flow/mẫu Thư viện/input lượt của app Hợp đồng dùng một khoá `contract_id` (hub 0112 đổi dữ liệu đã lưu, không đụng snapshot lượt đang chạy). Cạnh nối hai node khớp khoá tuyệt đối: lệch khoá ⇒ báo thiếu và gợi ý cầu nối AI; snapshot lượt cũ khoá `contract-id` vẫn dựng được tham số.
- Kịch bản: khi chạy hub 0112 trên def nháp, đã xuất bản, bản công ty và release chứa `contract-id` thì khoá thành `contract_id`, snapshot lượt và def dlc không đổi, chạy lại vô hại [test: apps/hub-api/src/modules/processes/library/contract-id-key.int.test.ts » CR-122 p17 · hub 0112 contract-id → contract_id]
- Kịch bản: khi cạnh nối có khoá lệch (contract-id vs contract_id) thì edgeIssues báo thiếu [test: packages/contracts/src/app-manifest/nodes.rules.test.ts » FLOW2-FR-26 · edgeIssues]
- Kịch bản: khi snapshot lượt cũ khai contract-id mà input lượt là contract_id thì buildToolArgs vẫn dựng được [test: apps/hub-api/src/modules/processes/domain/tools/tool-input-key.test.ts » CR-122 · khoá input coi - và _ là một]

#### Yêu cầu: Khoá đầu vào cho phép `_` (CR-122 p17)
Khoá đầu vào quy trình/run (khai input, nguồn `input` của tool/Nếu/Chờ/Ghi giá trị) theo `^[a-z0-9_-]{2,32}$`; khoá nguồn tham chiếu vẫn `^[a-z0-9-]{2,32}$`.
- Kịch bản: khi khai input hoặc nguồn tham số tool khoá `contract_id` thì hợp lệ, khoá nguồn có `_` vẫn bị từ chối [test: packages/contracts/src/hub-admin/input-key.test.ts » CR-122 p17 · khoá đầu vào]

#### Yêu cầu: Output node Ghi giá trị tới bước tool kế (CR-122 p17)
Đầu vào của node tool (manifest) chưa có nguồn khai rõ và không có trong input lượt được tự nối với trường cùng khoá ở stage gần nhất phía trước; nhờ đó node Ghi giá trị do AI sinh (X → Y) làm bước tool nhận đúng giá trị lúc chạy.
- Kịch bản: khi lượt chỉ có input ma_hd, cầu nối AI ghi contract_id từ ma_hd, thì bước Ký số có args contract_id từ trường cầu nối và buildToolArgs ra đúng giá trị [test: apps/hub-api/src/modules/processes/adapters/tools/tool-auto-args.int.test.ts » cầu nối Ghi giá trị (dạng AI sinh) ⇒ bước Ký số nhận đúng giá trị qua buildToolArgs]

## Việc còn lại
