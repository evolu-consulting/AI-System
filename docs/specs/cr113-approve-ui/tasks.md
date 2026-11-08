---
id: cr113-approve-ui
lát: cr113-approve-ui
cr: CR-113
làn: nhanh
migration: không
phụ thuộc: cr113-approve-rules (trường contract tuỳ chọn)
---
## Plan (ngắn)
Hiện 2 luật duyệt trên UI: Toàn quyền duyệt thay mọi bước; bước có hạn quá hạn tự chuyển cấp (mặc định Toàn quyền).

## Làm
- contracts: trường tuỳ chọn `owner_can_override`, `owner_group_name`, `escalate_default` (approval-flow), `decided_as`, `overdue`, `escalated_to` (thẻ duyệt).
- contracts-web Cài đặt › Quy trình duyệt: hộp "Luật duyệt" (FlowRules), nhãn "(mặc định)" trên node/danh sách, mục chú giải.
- contracts-web thẻ duyệt: huy hiệu "Duyệt thay · Toàn quyền", "Quá hạn", "Đã chuyển cho <nhóm>".
- admin-web editor Form: ghi chú 2 luật gần danh sách bước.

## Không làm / Chạm
Backend (lát cr113-approve-rules).

## Test tối thiểu
Unit current-flow (ruleFacts, ánh xạ), engine-card (timelineRows); e2e approval-current.cw.ts (chạy trên server).

## Quyết định trong lúc làm
- Hộp luật 2 luôn hiện; luật 1 ẩn khi `owner_can_override === false`. Trường vắng ⇒ coi như luật chung (owner true).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Hộp "Luật duyệt" ở Cài đặt › Quy trình duyệt
Dưới sơ đồ có hộp nêu: Toàn quyền duyệt thay được mọi bước (lượt duyệt thay được ghi rõ) và bước có hạn quá hạn tự chuyển cho nhóm chuyển cấp (mặc định Toàn quyền); node bước có hạn ghi "Quá hạn ⇒ chuyển <nhóm>" kèm "(mặc định)" khi nhóm là mặc định.
- Kịch bản: khi mở Cài đặt › Quy trình duyệt thì thấy hộp Luật duyệt và nhãn chuyển cấp (mặc định) [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]
- Kịch bản: khi GET trả owner_group_name và escalate_default thì ánh xạ đúng [test: apps/workspace-web/src/features/settings/lib/current-flow.test.ts » owner_* và escalate_default ánh xạ, vắng ⇒ mặc định luật chung]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt hiện duyệt thay và quá hạn
Bước do Toàn quyền duyệt thay hiện "Duyệt thay · Toàn quyền"; bước quá hạn hiện "Quá hạn" và "Đã chuyển cho <nhóm>".
- Kịch bản: khi bước có decided_as = owner_override thì dòng thời gian đánh dấu duyệt thay [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.test.ts » CR-113 · duyệt thay Toàn quyền và overdue/escalated_to từ server]

## Việc còn lại
- e2e chạy trên server (evotest), relock test.
