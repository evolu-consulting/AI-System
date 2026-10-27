# approval-inbox · tasks (Luật 0b, làn nhanh)

## Nguyên nhân
Chuông gói (hub 0059/0060, `notify.enqueue_pack_runs`) gửi cho đúng người nhận notice: assignee ∪ thành viên `assignee_group_id` (hoặc trưởng phòng nếu `head_only`) — `loadNoticeTask`/`noticeRecipients`. Nhóm chủ HĐ (`after.also_group_ids`, "Toàn quyền", prod-fix2) chỉ được dùng cho quyền quyết (`canAct`, `alsoGroupsOf`), KHÔNG nằm trong danh sách người nhận ⇒ không có notice/chuông.

## Làm
- [x] `loadNoticeTask` thêm `also_member_ids` (cùng câu SQL, `= any(array(...))`); `noticeRecipients` gộp `alsoMemberIds` (bỏ trùng, loại người thao tác).
- [x] Migration hub `0061_approval_bells`: `notify.resolve_pack_tasks(uuid[])` (DEFINER, một UPDATE cho lô) đánh dấu `read_at` chuông "cần duyệt" của task cho mọi người nhận; notifier gọi khi `taskClosed` của run gắn gói (đóng/huỷ).
- [x] Test: unit `approval-recipients.test.ts`; int `tests/acceptance/CF/approval-inbox.int.test.ts` (nhóm bước + nhóm chủ nhận, beta không thấy, quyết ⇒ đã đọc). Chạy thêm head-only-bells + bells-batch: xanh.

## Quyết định
- Hạ tầng chỉ có trạng thái "đã đọc" ⇒ "đã xử lý" = `read_at`. Link/tiêu đề: giữ bell sẵn có (`/contracts/<record_id>`, "Cần duyệt: <bước>"; tiêu đề HĐ nằm ở trang HĐ, không đổi mẫu tiêu đề).
- `head_only` giữ nguyên: nhóm bước chỉ trưởng phòng nhận; nhóm chủ vẫn nhận.
- Không email.

## Còn lại
- Nhắc/chuyển cấp (`review-tasks.repo.ts`, `remindOnce`) vẫn chưa tính nhóm chủ (ngoài phạm vi).
- Tiêu đề chuông chưa chứa tên HĐ (cần đổi payload notice/engine).
