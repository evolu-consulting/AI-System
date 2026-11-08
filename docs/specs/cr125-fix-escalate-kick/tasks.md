---
id: cr125-fix-escalate-kick
lát: cr125-fix-escalate-kick
cr: CR-125
làn: nhanh (máy trạng thái run — kick)
migration: không
phụ thuộc: cr125-fix-owner-override (2 commit cherry-pick vào nhánh này)
---
## Plan (ngắn)
Lỗi qc (cr125-fix-owner-override "Việc còn lại"): flow theo sự kiện có `after.escalate` ở bước Duyệt đầu ⇒ lượt mở nhưng kick lỗi, mọi
stage `pending`, lỗi bị nuốt (`process-kick-failed` không mã). Nguyên nhân: task review chép `escalate_at` từ snapshot nhưng
`escalate_group_id` lấy thẳng `escalate.group_id` — snapshot không có id (bản công ty mất Group khi sao ⇒ `group_id: null`, hoặc chỉ có
`group_key`) ⇒ `escalate_at` có, Group null ⇒ vi phạm CHECK `review_tasks_remind_ck` trong tx kick. Sửa ở MỘT chỗ chung đường khe +
flow: `core.repo.ts reviewTimingOf` (id, vắng ⇒ `group_key` → id cùng tenant trong cùng câu; không ra Group ⇒ bỏ chuyển cấp, task vẫn mở).

## Làm
- `processes/core/core.repo.ts` `reviewTimingOf` (luật trên).
- `processes/runs/kick-failure.ts` (mới) `kickOrFlag`: log `process-kick-failed` có `run_id` + `code` (SQLSTATE:constraint / mã AppError)
  + lượt chưa chạy bước nào ⇒ `needs_decision{start_failed, code}`, stage đầu `needs_decision` + `last_error_code` (Thử lại / Huỷ).
  `start.service.ts #afterCommit` gọi nó. Lý do mới `start_failed` (contracts `DECISION_REASONS`, domain types, thread.rules, i18n process).
- Parity CR-113: mẫu Thư viện "Duyệt 2 cấp" (`flow-templates.def.ts`): 2 bước Duyệt có `after.escalate = {after_h: 72,
  group_key: contracts-owner}` (= `APPROVAL_FLOW_DUE_DEFAULT_H` + `packGroupKey(app, "owner")`, như khe mặc định Toàn quyền).
- e2e (qc): cw-cr113 ca 5 bỏ `fixme`; gỡ DIAG ở `_pm-stack.ts`; relock.

## Không làm / Chạm
DLC, UI riêng cho `start_failed` (thẻ dùng `decision.reason` + `code` sẵn có), migration (mẫu đã seed trên DB cũ không tự cập nhật — xem Việc còn lại).

## Test tối thiểu
- int `apps/hub-api/src/modules/processes/triggers/flow-escalate-kick.int.test.ts` (3 ca; ca 2 đỏ khi bỏ sửa core.repo — đã kiểm).
- int flow-owner-override, first-launch-contract, P-d d1 remind/remind-escalate, CF owner-override: xanh (evotest -Dirty).
- unit flow-templates.def.test.ts; e2e pm-checklist-pm 13/13 xanh (evotest -Dirty).

## Quyết định trong lúc làm
- Không ra Group chuyển cấp ⇒ task vẫn mở, KHÔNG chuyển cấp (thay vì chặn cả lượt): bước duyệt vẫn làm được, thiếu Group là cấu hình.
- Đánh dấu `start_failed` chỉ khi chưa stage nào chạy (`pending`/`queued`) — lượt đã chạy giữ nguyên cho vòng nền.
- Chỉ "Duyệt 2 cấp" có hạn mặc định (brief); 2 mẫu kia giữ nguyên.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Chuyển cấp trên flow theo sự kiện
Bước Duyệt của flow theo sự kiện có chuyển cấp thì mở bình thường và task có hạn chuyển cấp về Group đích (id của snapshot, vắng thì
mã Group của cùng công ty); không tìm được Group thì bước vẫn mở, không chuyển cấp. Mẫu "Duyệt 2 cấp" có hạn 72 h, quá hạn chuyển về
Toàn quyền (`contracts-owner`) như đường khe.
- Kịch bản: khi flow Thư viện có escalate theo mã ở bước đầu thì bước 0 chờ duyệt, task có hạn + Group Toàn quyền [test: apps/hub-api/src/modules/processes/triggers/flow-escalate-kick.int.test.ts » mở lượt ⇒ bước 0 chờ duyệt, task có hạn chuyển cấp về Group Toàn quyền, không có process-kick-failed]
- Kịch bản: khi bản công ty mất Group chuyển cấp thì bước 0 vẫn mở, không chuyển cấp [test: apps/hub-api/src/modules/processes/triggers/flow-escalate-kick.int.test.ts » bản công ty: escalate thiếu Group (group_id null) ⇒ bước 0 vẫn mở, không chuyển cấp (trước sửa: vi phạm review_tasks_remind_ck)]
- Kịch bản: khi mẫu "Duyệt 2 cấp" được dùng thì mọi bước Duyệt có hạn 72 h, chuyển cấp về contracts-owner [test: apps/hub-api/src/modules/processes/library/flow-templates.def.test.ts » cr125-fix-escalate-kick · Duyệt 2 cấp: mọi bước Duyệt có hạn 72 h, quá hạn chuyển cấp về contracts-owner (như đường khe)]

#### Yêu cầu: Lượt không khởi động được
Kick ngay sau khi tạo lượt lỗi thì không nuốt im lặng: log có run id + mã lỗi; lượt chưa chạy bước nào chuyển "Cần xử lý" lý do
`start_failed` (mã lỗi ở bước đầu), có Thử lại / Huỷ, thay vì chờ mãi.
- Kịch bản: khi kick lỗi thì log `process-kick-failed` có mã và lượt `needs_decision` start_failed [test: apps/hub-api/src/modules/processes/triggers/flow-escalate-kick.int.test.ts » kick lỗi ⇒ log có mã + lượt 'Cần xử lý' start_failed (không pending mãi)]

## Việc còn lại
- DB đã seed mẫu "Duyệt 2 cấp" trước đây (staging/prod) không tự có hạn/chuyển cấp (`writeLibrary` on conflict do nothing) — cần
  migration/bản xuất bản mới nếu muốn áp cho công ty cũ (quyết của điều phối).
- Các chỗ kick khác vẫn chỉ log (`launcher.ts kickOthers`, `run-control.service.ts`) — chưa gắn `kickOrFlag`.
