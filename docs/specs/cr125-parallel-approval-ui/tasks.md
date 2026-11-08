---
id: cr125-parallel-approval-ui
lát: cr125-parallel-approval-ui
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-parallel-approval-engine (đã gộp gd0 90d840e09)
---
## Plan (ngắn)
Giao diện «A + B cùng duyệt» cho bước Duyệt: cấu hình `after.parallel` (hình chốt ở `docs/specs/cr125-parallel-approval-engine/tasks.md` "Cấu hình cho lát UI")
ở panel bước Duyệt, tóm tắt trên canvas, lỗi lưu theo mã mới, và kiểm thẻ người duyệt (workspace-web) với lượt chạy thật.

## Làm
- Panel bước Duyệt (`components/editor/StageApproveParallel.tsx`, nhúng vào `StageApproveBasics`): công tắc «Duyệt cùng lúc nhiều nhóm» → danh sách nhóm (2–5, mỗi hàng: nhóm + tên hiện trên thẻ, thêm/bỏ) → luật Tất cả / Một trong số / Ít nhất N. Tắt công tắc: nhóm đầu thành «Ai duyệt».
- Nháp ⇄ `after.parallel`: `lib/parallel-form.ts` + `StageDraft.parallel` + `stage-convert` (đi về nguyên vẹn; mẫu Thư viện giữ `group_key`; nhãn trống ⇒ «Nhóm n»).
- Lỗi: hiện NGAY bằng `parallelStageIssues` của contract (cùng luật máy chủ) + hàng chưa chọn nhóm khi bật; lỗi lưu `PARALLEL_GROUPS_MIN2|PARALLEL_RULE_INVALID` map vào `STEP_ERR` (`def-form.ts`) ⇒ câu `process.admin.parallel.err.<MÃ>` cạnh ô.
- Canvas: dòng tóm tắt «Cùng duyệt: A + B · Tất cả» (`FlowNodeBody`, `process.admin.parallel.summary`).
- i18n vi/en `process.admin.parallel.*`.

## Không làm / Chạm
- Không đổi engine/contract. Soạn Thư viện theo khe (FlowFormEditor, bước `review` theo mã nhóm) chưa có «cùng duyệt» — chỉ bản công ty / trình sửa canvas.

## Test tối thiểu
- unit `lib/parallel-form.test.ts` (nháp ⇄ def, lỗi hiện ngay, tóm tắt, stage-convert).
- e2e `e2e/journey-approval/cr125-parallel-approval-ui.spec.ts`: (1) quản trị công ty bật Cùng duyệt Tất cả cho 2 nhóm → lưu → canvas nói rõ → kế toán duyệt (bước còn mở) → giám đốc duyệt → bước qua; (2) một nhóm Từ chối → thẻ nhóm kia đóng, hiện lý do. Chạy evotest `-Step e2e -Filter journey-approval -Dirty`.

## Quyết định trong lúc làm
- Nhãn mỗi nhóm tự lấy tên nhóm khi chọn (sửa tay được); chưa gõ ⇒ «Nhóm n».
- Thẻ đóng `superseded`: hub lưu lý do ở `review_tasks.feedback` (hằng `PARALLEL_CLOSED_BY_QUORUM` và «Đã có người từ chối/trả lại»); thẻ HĐ đã hiện `feedback` của bước (xem Kết quả e2e bên dưới).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### ADDED sht/duyet-cung-luc-giao-dien.md
#### Yêu cầu: Cấu hình «Duyệt cùng lúc nhiều nhóm» ở trình sửa quy trình
Bước Duyệt có công tắc «Duyệt cùng lúc nhiều nhóm»: chọn 2–5 nhóm (mỗi nhóm một tên hiện trên thẻ) và luật Tất cả / Một trong số / Ít nhất N; sơ đồ nói «Cùng duyệt: A + B · luật»; lưu sai (ít hơn 2 nhóm, N vượt số nhóm, trùng nhóm) báo câu có cách sửa ngay cạnh ô.
- Kịch bản: khi bật Cùng duyệt thì nháp đi về `after.parallel` nguyên vẹn (nhóm, nhãn, luật) [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » nháp ⇄ after.parallel]
- Kịch bản: khi một nhóm, N vượt số nhóm hoặc trùng nhóm thì báo mã lỗi ngay tại ô [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » lỗi hiện ngay]
- Kịch bản: khi bật Cùng duyệt thì sơ đồ hiện «Cùng duyệt: A + B · Tất cả» [test: apps/admin-web/src/features/processes/lib/parallel-form.test.ts » tóm tắt trên canvas]
- Kịch bản: quản trị công ty đặt Tất cả cho 2 nhóm, cả hai lần lượt duyệt thì bước qua [test: e2e/journey-approval/cr125-parallel-approval-ui.spec.ts » quản trị công ty bật Cùng duyệt]
- Kịch bản: khi một nhóm Từ chối thì thẻ nhóm kia đóng và nói lý do [test: e2e/journey-approval/cr125-parallel-approval-ui.spec.ts » một nhóm Từ chối]

## Việc còn lại
- Cùng duyệt ở soạn Thư viện theo khe (mã nhóm) — lát sau nếu cần.
