---
id: cr126-inbox-draft-row
lát: cr126-inbox-draft-row
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-one-inbox
---
## Plan (ngắn)
Dòng duyệt HĐ trong «Việc của tôi» mở thẻ HĐ còn nháp (không có nút duyệt); việc duyệt thật nằm ở trang yêu cầu của run.

## Làm
- `approvalTarget` (hàm thuần, overview/lib/approvals.ts): task có run ⇒ `/contracts/requests/<runId>`, không có ⇒ thẻ HĐ.
- `useInbox` dựng `runByTask` từ `GET /me/review-tasks` đã tải (không truy vấn thêm); `ApprovalRowList` nhận `runByTask`.

## Không làm / Chạm
- Không đổi API, không đổi dedupe theo task id. Không chạm DLC.

## Test tối thiểu
- unit approvals.test.ts » approvalTarget.

## Quyết định trong lúc làm
- Giữ một dòng cho một việc (dedupe theo task id); chỉ đổi nơi mở.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Một hộp «Việc của tôi»
Dòng duyệt mà task thuộc một run quy trình/yêu cầu (vd HĐ tạo từ bước «Tạo hợp đồng từ hồ sơ») mở trang yêu cầu của run, nơi có nút duyệt; dòng duyệt HĐ không thuộc run vẫn mở thẻ HĐ.
- Kịch bản: khi task duyệt thuộc một run thì dòng mở trang yêu cầu của run, không thì mở thẻ HĐ [test: apps/workspace-web/src/features/overview/lib/approvals.test.ts » CR-126 · task thuộc run mở trang yêu cầu của run, không có run mở thẻ HĐ]