# cr160-starter-top-fact — CR-160 (dữ kiện «Người gửi là cấp cao nhất» cho node Nếu + quy trình 3 công ty dùng nó)

## Plan
Thêm dữ kiện boolean `starter_is_top` (nhãn «Người gửi là cấp cao nhất» / «Sender is the top level»): Đúng ⇔ người bắt đầu lượt là `head_user_id` của phòng GỐC (`admin.departments.parent_group_id is null`) cùng tenant với lượt. Đây là dữ kiện LÕI: engine đọc từ chính lượt (`process_runs.started_by`) + sơ đồ tổ chức bằng MỘT câu SQL, nên có ở mọi lượt, kể cả lượt bắt đầu bằng phiếu (không bản ghi app ⇒ không có `FactsReader`). App chỉ khai khoá ở manifest `contract.submitted` để trình sửa cho chọn và lưu def kiểm kiểu. Không đổi cách chạy run / khoá / trạng thái; không migration.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Luật thuần `starterIsTop`, `splitFactKeys`, `mergeFacts` + unit | `processes/domain/if/core-facts.rules.ts` (+ `.test.ts`) | [x] |
| 2 | Câu đọc `CORE_FACTS_SQL` (1 câu, lọc `tenant_id` của run) + cổng `readCoreFacts` nối vào `StepRepo` + `ifContext` | `processes/adapters/runs/core-facts.repo.ts`, `flow-step.repo.ts`, `application/ports.ts`, `application/runs/settle-step.usecase.ts` | [x] |
| 3 | Khai dữ kiện ở manifest `contract.submitted` (vi + en) + danh sách khoá | `packages/contracts/src/app-manifest/contracts.manifest.ts`, `packs/contracts/domain/contract-flow-events.rules.ts` | [x] |
| 4 | int: câu đọc (gốc / con / Ngân / tenant khác / khoá) + một lượt bắt đầu bằng phiếu rẽ bỏ duyệt | `processes/adapters/runs/core-facts.repo.int.test.ts` | [x] |
| 6 | Vòng 2: lọc khoá lõi khỏi «Bắt đầu khi» (UI + `flowDefIssues`) + 422 `TRIGGER_FACT_CORE` khi lưu | `contracts/src/app-manifest/core-facts.ts`, `hub-admin/process-flowdef.ts`, `admin-web/.../TriggerCard.tsx`, `processes/defs/flow-check.ts`, `core/errors.ts`, `chat/processes-errors.ts` | [x] |
| 5 | Script `tenant:flows`: `if starter_is_top` thay nhánh theo phòng cho HĐ gửi đi + phiếu; bỏ đích dự phòng | `tools/scripts/src/tenant-flows.data.ts`, `tenant-flows.org.ts`, `tenant-flows.int.test.ts` | [x] |

## Quyết định trong lúc làm
- Dữ kiện đọc ở engine, không ở `FactsReader` của gói: lượt bắt đầu bằng phiếu có `pack_key` rỗng nên không có reader nào được gọi; một nguồn cho cả hai đường (G1). Khoá lõi tách khỏi khoá app trước khi gọi reader (`splitFactKeys`).
- «Người gửi» = `process_runs.started_by` (người gửi duyệt HĐ / người gửi phiếu). Nhiều phòng gốc ⇒ trưởng của bất kỳ phòng gốc nào là Đúng. Hệ thống (không người bắt đầu) hoặc phòng gốc chưa có trưởng ⇒ Sai.
- Trưởng gốc bị khoá: vẫn Đúng nếu chính họ là người bắt đầu (câu hỏi là «ai đứng đầu sơ đồ», không xét còn dùng được; người bị khoá không gửi được nên không tới đây). Người khác vẫn Sai ⇒ đi bước duyệt, nơi `starter_head` chọn trưởng còn dùng được hoặc giao đích dự phòng.
- `contract.received` (Nhận HĐ): KHÔNG khai. Bên gửi là đối tác ngoài hệ thống, không có «cấp cao nhất» nội bộ; người bắt đầu lượt là người phụ trách ở trigger (không phải người gửi). Script giữ nguyên: Nhận HĐ vẫn «trưởng phòng của người phụ trách → Ký».
- `contract.approved` không khai (không có bước duyệt sau nó). `starter_is_top` chỉ dùng ở node Nếu: «Bắt đầu khi» không chọn được (UI + danh mục `triggerFactsOf`) và lưu def có vế đó bị chặn 422 `TRIGGER_FACT_CORE` (vòng 2, Opus). Danh sách khoá lõi ở MỘT chỗ `packages/contracts/src/app-manifest/core-facts.ts`.
- Dữ kiện đọc HIỆN TẠI mỗi lần rẽ: nếu trưởng gốc đổi giữa lúc rẽ và Kết thúc, lượt có bản ghi app dừng «Cần xử lý» theo luật H2 sẵn có (không đổi luật).
- Script: bỏ `shapeOf` ba kiểu (none / branch / chain) còn hai (none / tiered): một luật cho mọi người tạo. Phiếu: Đúng ⇒ nhảy qua bước duyệt tới bước sau (nitigroup: Phương kiểm; evolu: Ghi đã chi). Người duyệt Phương tự tạo phiếu vẫn đi đích dự phòng ở bước «Kế toán kiểm» (R#15, người kiểm ≠ người tạo) — không thuộc CR-160.

## Việc còn lại
- Chạy `tenant:flows` lên staging/prod (cần người dùng đồng ý) để quy trình đã lưu nhận nhánh mới.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md

#### Yêu cầu: Node Nếu đọc dữ kiện bản ghi
Thêm: dữ kiện LÕI `starter_is_top` («Người gửi là cấp cao nhất») do engine đọc từ chính lượt, có cả ở lượt bắt đầu bằng phiếu. Đúng ⇔ người bắt đầu lượt là trưởng của phòng gốc của tenant.
- Kịch bản: trưởng phòng gốc gửi thì dữ kiện Đúng [test: apps/hub-api/src/modules/processes/adapters/runs/core-facts.repo.int.test.ts » trưởng phòng gốc gửi ⇒ Đúng]
- Kịch bản: trưởng phòng con gửi thì dữ kiện Sai [test: apps/hub-api/src/modules/processes/adapters/runs/core-facts.repo.int.test.ts » trưởng phòng con gửi ⇒ Sai]
- Kịch bản: thành viên phòng gốc không phải trưởng gửi thì dữ kiện Sai [test: apps/hub-api/src/modules/processes/adapters/runs/core-facts.repo.int.test.ts » thành viên phòng gốc không phải trưởng (Ngân) ⇒ Sai]
- Kịch bản: không có người bắt đầu thì dữ kiện Sai [test: apps/hub-api/src/modules/processes/domain/if/core-facts.rules.test.ts » không người gửi (hệ thống) ⇒ Sai, kể cả khi phòng gốc chưa có trưởng]
- Kịch bản: công ty khác không đọc được và không bị rò [test: apps/hub-api/src/modules/processes/adapters/runs/core-facts.repo.int.test.ts » tenant khác không rò: không đọc lượt của tenant khác, mỗi tenant chỉ so với cây phòng của mình]
- Kịch bản: trưởng gốc bị khoá vẫn là trưởng gốc, người khác vẫn Sai [test: apps/hub-api/src/modules/processes/adapters/runs/core-facts.repo.int.test.ts » trưởng gốc bị khoá vẫn là trưởng gốc, người khác vẫn Sai (Quyết định: hỏi ai đứng đầu sơ đồ, không xét còn dùng được)]
- Kịch bản: lượt bắt đầu bằng phiếu do trưởng gốc gửi thì node Nếu bỏ bước duyệt [test: apps/hub-api/src/modules/processes/adapters/runs/core-facts.repo.int.test.ts » trưởng gốc bắt đầu ⇒ Nếu Đúng ⇒ bỏ bước Duyệt, tới Ghi đã chi, lịch sử ghi giá trị đã đọc]
- Kịch bản: lượt bắt đầu bằng phiếu do người khác gửi thì vào bước duyệt [test: apps/hub-api/src/modules/processes/adapters/runs/core-facts.repo.int.test.ts » Ngân (không phải trưởng) bắt đầu ⇒ Nếu Sai ⇒ vào bước Duyệt]
- Kịch bản: luật tính thuần [test: apps/hub-api/src/modules/processes/domain/if/core-facts.rules.test.ts » người gửi là trưởng phòng gốc ⇒ Đúng]

#### Yêu cầu: Dữ kiện lõi không dùng được ở «Bắt đầu khi»
Khoá lõi không có trong danh sách chọn của «Bắt đầu khi»; lưu quy trình có vế đó trả 422 mã TRIGGER_FACT_CORE kèm đường lỗi.
- Kịch bản: danh sách chọn bỏ khoá lõi, node Nếu vẫn chọn được [test: packages/contracts/src/app-manifest/core-facts.test.ts » danh sách chọn của contract.submitted bỏ starter_is_top, giữ các dữ kiện khác]
- Kịch bản: luật tính đường lỗi của vế dùng khoá lõi [test: apps/hub-api/src/modules/processes/domain/if/core-facts.rules.test.ts » vế đơn và vế trong nhóm dùng starter_is_top ⇒ đường lỗi, dữ kiện khác ⇒ hợp lệ]
- Kịch bản: lưu quy trình có vế khoá lõi ở Bắt đầu khi thì bị chặn 422 [test: apps/hub-api/src/modules/processes/defs/flow-check.int.test.ts » vế starter_is_top ở Bắt đầu khi ⇒ 422 TRIGGER_FACT_CORE kèm đường lỗi]
- Kịch bản: vế trong nhóm cũng bị chặn [test: apps/hub-api/src/modules/processes/defs/flow-check.int.test.ts » vế trong nhóm cũng bị chặn]

### MODIFIED engine/app-events.md

#### Yêu cầu: App khai sự kiện trong manifest, kiểm bằng check:app-events (FLOW2-FR-17/18)
Thêm: `contract.submitted` khai dữ kiện `starter_is_top` (boolean, nhãn vi «Người gửi là cấp cao nhất», en «Sender is the top level»); `contract.received` không khai (bên gửi là đối tác ngoài).
- Kịch bản: khoá dữ kiện của sự kiện hợp đồng khớp manifest, có `starter_is_top` [test: apps/hub-api/src/modules/packs/contracts/application/contract-flow.usecase.test.ts » 3 sự kiện + khoá dữ kiện khớp manifest events]

### ADDED engine/quy-trinh-3-cong-ty.md

#### Yêu cầu: Quy trình duyệt của evolu / nitigroup / preschool dùng «Người gửi là cấp cao nhất»
HĐ gửi đi và phiếu mua hàng: cấp cao nhất (Thomas, Tiên, Dung) tự gửi thì không có bước duyệt; người khác qua trưởng phòng của mình (leo cấp). Phiếu nitigroup vẫn Phương kiểm rồi Phương ghi đã chi. Nhận HĐ không đổi.
- Kịch bản: mỗi người tạo ra đúng chuỗi người duyệt, không còn nhánh theo phòng hay đích dự phòng [test: tools/scripts/src/tenant-flows.int.test.ts » CR-160 · mỗi người tạo của mỗi công ty ⇒ đúng chuỗi, cấp cao nhất bỏ duyệt, không còn nhánh theo phòng hay đích dự phòng]
- Kịch bản: nitigroup, bước Ghi đã chi của phiếu do Phương làm [test: tools/scripts/src/tenant-flows.int.test.ts » nitigroup: mọi người trừ Tiên đi qua Tiên, phiếu thêm Phương kiểm, Tiên tạo thì bỏ duyệt]
- Kịch bản: evolu, Thomas tự gửi HĐ hoặc phiếu thì không duyệt [test: tools/scripts/src/tenant-flows.int.test.ts » evolu: chuỗi người duyệt theo người tạo, Thomas tạo thì không duyệt]
- Kịch bản: nitigroup, Ngân gửi thì Tiên duyệt, Tiên gửi thì không duyệt và phiếu còn Phương kiểm [test: tools/scripts/src/tenant-flows.int.test.ts » nitigroup: mọi người trừ Tiên đi qua Tiên, phiếu thêm Phương kiểm, Tiên tạo thì bỏ duyệt]
- Kịch bản: preschool, Dung tự gửi thì không duyệt [test: tools/scripts/src/tenant-flows.int.test.ts » preschool: không bước Duyệt nào, Dung ký, có Gửi đối tác, Nhận HĐ Dung ký, không phiếu]
- Kịch bản: chạy lại script không đổi gì [test: tools/scripts/src/tenant-flows.int.test.ts » chạy lần 2: không đổi gì (unchanged, version giữ nguyên, không thêm dòng)]
