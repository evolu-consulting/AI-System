---
id: cr125-request-steps
lát: cr125-request-steps
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-form-step-card, cr125-manual-start-ui
---
## Plan (ngắn)
Trang yêu cầu (`/contracts/requests/:id`) làm được MỌI việc của người xem trong chuỗi: bước điền, Duyệt / Trả lại / Từ chối, thẻ nhóm cùng duyệt, và thấy cả
lượt con (Phần 1/2/3, `parent_run_id`) lồng dưới lượt cha — không cần thẻ HĐ.

## Làm
- Hub: `GET /processes/requests/:run_id` thêm `steps` (cây `RequestStepNode`: FlowView mỗi lượt + `children`) và `root_run_id`. Phép chiếu dùng lại `stepOf/actionsOf/submitActions` của thẻ HĐ qua `flowViewOfRun` (cửa `packs/contracts/public.ts`). Quyền: `ViewService.get` (process_run_viewer) trước; lượt con đọc scope system lọc tenant CHỈ sau khi qua kiểm quyền lượt cha; `root_run_id` chỉ khi người xem xem được lượt gốc. `stepsView` thêm tham số scope.
- Web: `RunStepActions` (platform/flow) = các bước + hành động của task đang mở; `RequestStepsTree` vẽ cây; mở từ «Chờ tôi duyệt» của lượt con ⇒ chuyển sang trang lượt gốc (`?focus=<lượt con>`).
- e2e `cr125-purchase-full` làm mọi bước từ «Chờ tôi duyệt» → trang yêu cầu gốc (viết, chưa chạy).

## Không làm / Chạm
- Thẻ HĐ giữ nút Duyệt/Trả lại/Từ chối riêng ở đầu trang (gắn sản phẩm, lưu ô, xác nhận HĐ); phần dùng chung với trang yêu cầu là renderer bước (FormStep «Gửi» qua FlowPanelBody). Chưa gộp nút đầu trang của thẻ HĐ vào `RunStepActions`.
- Không migration; không đổi `/me/review-tasks` (chuyển sang lượt gốc làm ở trang).

## Test tối thiểu
- unit: `approval-flow-view.run.test.ts`, `request-tree.test.ts`, `RunStepActions.test.tsx`.
- int (evotest -Dirty): `request-steps.int.test.ts` (4 pass).

## Quyết định trong lúc làm
- «Trả lại» ở trang yêu cầu gửi `fail` + `back_to_step` = `back_to_steps[0]` của bước mở (như thẻ HĐ `fail_back`); không có đích ⇒ `fail` không `back_to_step` (nhánh Trả lại do bước quyết).
- Tối đa 30 lượt con / 5 cấp mỗi trang; mỗi lượt ≤ 2 câu SQL (chưa đo perf).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Trang yêu cầu hiện toàn bộ bước của lượt và lượt con, làm việc ngay tại đó
Trang một yêu cầu (không phải hợp đồng) hiện đầy đủ các bước của lượt và các lượt con lồng dưới lượt cha; việc đang mở của người xem (điền thông tin rồi «Gửi», Duyệt, Trả lại, Từ chối) làm ngay trên trang. Việc của lượt con mở trang của yêu cầu gốc. Người không được xem lượt hoặc công ty khác nhận 404.
- Kịch bản: khi người gửi mở yêu cầu có Quy trình con thì thấy bước của lượt cha và lượt con lồng nhau; người ngoài và công ty khác nhận 404 [test: apps/hub-api/src/modules/processes/triggers/request-steps.int.test.ts » CR-125 · cây bước của yêu cầu (cha + lượt con)]
- Kịch bản: khi bước mở là bước điền thì người làm thấy một việc «Gửi», khi là bước duyệt thì thấy Duyệt, Trả lại, Từ chối [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.run.test.ts » flowViewOfRun]
- Kịch bản: khi mở việc của lượt con từ Chờ tôi duyệt thì trang chuyển sang yêu cầu gốc [test: apps/workspace-web/src/features/requests/lib/request-tree.test.ts » request-tree]
- Kịch bản: khi task duyệt mở thì trang vẽ đủ nút theo hành động của hub [test: apps/workspace-web/src/platform/flow/ui/RunStepActions.test.tsx » RunStepActions]
- Kịch bản: khi nhân viên tạo yêu cầu mua hàng thì mọi bước điền và duyệt của ba phần làm được từ trang yêu cầu [test: thủ công — e2e/journey-approval/cr125-purchase-full.spec.ts chạy một lần ở đợt cuối]

## Việc còn lại
- e2e `cr125-purchase-full` chưa chạy (chạy một lần cuối đợt).
- Gộp nút đầu trang của thẻ HĐ vào `RunStepActions` (cần tách logic gắn sản phẩm / xác nhận HĐ) — chưa làm.
- Phần 2 «Ký số» cần `contract_id` (xem cr125-purchase-parent) vẫn mở.
