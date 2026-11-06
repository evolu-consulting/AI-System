---
id: cr122-p11f-library-launch
lát: cr122-p11f-library-launch
cr: CR-122
làn: nhanh (thẻ duyệt, luật thuần)
migration: không
phụ thuộc: cr122-p11e-confirm-flow
---
## Plan (ngắn)
e2e G1.2 vẫn đỏ trên ba360d8f3: sau "Xác nhận và lưu" không có thẻ duyệt nào (không bước, không lý do, không Mở lại).

## Bằng chứng (trace `cr122-q1-e2e/.data/evotest/20261107-003237-420-e2e`, G1.2, HĐ `01a1b1ed-c233…`)
- 17:35:14.215 `POST …/actions/approve` ⇒ `mode engine`, `note FLOW_STARTING` (submitToFlow đúng, sự kiện đã ghi).
- 17:35:14.291 GET thẻ ⇒ `engine_run_id null`, `FLOW_STARTING`; p11e tải lại chạy.
- 17:35:18.315 GET thẻ ⇒ `engine_run_id e944a71b…`, `run_status waiting_review` (bộ điều phối ĐÃ mở run, gắn lượt, task Duyệt mở) nhưng
  `steps: []`, `task_id: null`, `attention: null` ⇒ trang không có bước, không lý do (không có lỗi nên p11b không báo gì).
- Nguyên nhân: `packs/contracts/domain/approval-engine-card.rules.ts` `runCardSteps` (và tra task ở `engineCardView`/`planEngineAct`) chỉ
  nhận stage có khoá `s<i>`. Stage của run lấy khoá từ `stageMeta` (`processes/domain/runs/pack-steps.rules.ts:48`) = khoá người dựng
  đặt cho node FlowDef (`nhanh`, `duyet-lon`…), không phải `s<i>` (chỉ def dạng khe mới đặt `s<i>`) ⇒ mọi stage bị loại.
- Vì sao G2 xanh còn G1.2 đỏ: không phải "flow Thư viện vs bản công ty" hay cache cấu hình — G1.2 là ca đầu chạy qua thẻ sau P11d/e;
  thẻ dựng sai với MỌI FlowDef. (Int P11 kiểm task mở trong DB, unit P11 dùng khoá `s<i>` ⇒ không bắt được.) Không phải lỗi test.

## Đã làm
- `stageAt`/`stageIdx`: vị trí stage theo `idx` của `stepsView` (khớp `PackStepView.idx`), dự phòng khoá `s<i>`; `runCardSteps`,
  `engineCardView`, `planEngineAct` dùng chung. Thẻ dạng khe (khoá `s<i>`) giữ nguyên.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Thẻ duyệt hiện bước của lượt flow theo sự kiện
Lượt flow theo sự kiện (quy trình dựng bằng node Nếu/Duyệt…) hiện bước Duyệt đang mở cùng nút quyết cho người duyệt, bất kể khoá
node người dựng đặt.
- Kịch bản: quy trình có node khoá tự đặt ⇒ thẻ hiện "Duyệt giá trị lớn" đang mở và người duyệt quyết được [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » stepsView thật (key 'nhanh'/'duyet-lon', idx 0/1) ⇒ bước 'Duyệt giá trị lớn' idx 1 mở, task + can_act]

## Việc còn lại
- [ ] qc chạy lại e2e journey G1.2 sau gộp.
- [ ] (đề xuất) int P11 kiểm thêm thẻ (`getApproval`) chứ không chỉ task trong DB.
