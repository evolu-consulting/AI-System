---
id: cr126-child-task-visible
lát: cr126-child-task-visible
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
e2e `cr125-purchase-full` test 2: lượt con Phần 1 `waiting_review` bước 0 nhưng «Chờ tôi duyệt» trống với cả 3 người. Tái hiện bằng int đi đúng
đường thật (seed `writeCr125Config` → `ManualStartService.start` → `listReviewTasks` với `ConfigCache` thật).

## Làm
- Nguyên nhân: engine đúng (lượt con kế thừa người bắt đầu, nhóm theo mã đổi đúng id công ty, task + assignee nhóm có). e2e gán thành viên
  nhóm bằng SQL SAU `writeCr125Config` mà không báo cache cấu hình ⇒ Hub giữ `groupIds` cũ của tài khoản đã đăng nhập (tài khoản dùng chung
  của công ty journey) ⇒ `/me/review-tasks` lọc theo nhóm không ra việc. Màn thành viên nhóm thật (admin-api) có bump `config_meta`.
- `seed.cr125-config.ts`: tách `notifyConfigChanged(tx, keys)` (bump admin + hub config, `pg_notify config_changed`) — một luật dùng cho seed và e2e.
- e2e spec: gọi `notifyConfigChanged` sau khi gán nhóm; sửa câu dump `hub.process_tasks` (không có) ⇒ `hub.review_tasks` + `review_task_assignees`,
  thêm dump thành viên nhóm.

## Không làm / Chạm
Không đổi engine/endpoint. Không chạy e2e (đợt cuối).

## Test tối thiểu
`apps/hub-api/src/modules/processes/nodes/subprocess/purchase-child-task.int.test.ts` (evotest xanh).

## Quyết định trong lúc làm
- Sửa ở bước chuẩn bị e2e (đường SQL bỏ qua admin-api), không thêm đọc nhóm trực tiếp DB ở hub (giữ một nguồn: cache cấu hình).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

Không thay đổi hành vi (lý do: engine/endpoint giữ nguyên; chỉ tách hàm báo cache của seed và sửa bước chuẩn bị + câu dump của e2e).

## Việc còn lại
- Chạy lại `e2e/journey-approval/cr125-purchase-full.spec.ts` ở lượt e2e cuối đợt.
