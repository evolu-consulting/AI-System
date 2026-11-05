---
id: cr121-r4-run-links
lát: cr121-r4-run-links
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: R-1, R-2, R-3 (đã merge)
---
## Plan (ngắn)
Trang chi tiết lượt chạy có liên kết hai chiều: lượt gắn hợp đồng → "Mở lại quy trình" + link tới hợp đồng; lượt đã chạy lại → link tới lượt mới.

## Làm
- Contract `RunDetail`: thêm `source {kind,id,label,app_key}|null` (từ `pack_key`/`pack_record_id`) và `rerun_by` (uuid|null, theo `rerun_of`).
- `run-detail.repo.ts`: gộp 2 cột + subquery `rerun_by` vào câu header sẵn có (không thêm câu SQL; vẫn 3 câu, ≤ 4). `run-detail.map.ts` `sourceOf`.
- admin-web: nút "Mở lại quy trình" (thẻ xác nhận + lý do) gọi `POST /pack/contracts/contracts/:id/reopen`; link hợp đồng ở "Kích hoạt bởi" (URL app từ `/me/apps`); lượt cũ hiện "đã chạy lại" + link. i18n vi+en.

## Không làm / Chạm
Không đọc bảng gói từ Hub ⇒ nhãn hợp đồng là "HĐ <8 ký tự đầu id>" (mã HĐ thật cần cổng đọc của gói — việc sau). Không migration.

## Test tối thiểu
Unit `run-detail.map.test.ts`, `run-detail-view.test.ts`; int `run-detail.int.test.ts` (source + rerun_by + ≤ 4 SQL). Không chạy e2e.

## Quyết định trong lúc làm
- API gói chạy theo tenant của người gọi ⇒ nút chỉ hiện cho tenant_admin của đúng công ty của lượt (platform_admin không có tenant gói).
- Lý do của thẻ xác nhận gửi lên API gói dưới dạng câu chữ của chip đã chọn (API gói nhận lý do tự do).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/processes-run-links.md
#### Yêu cầu: Liên kết nguồn và lượt chạy lại
Lượt gắn hợp đồng hiện nhãn hợp đồng (có liên kết khi biết URL app) cạnh "Kích hoạt bởi" và nút "Mở lại quy trình" (thẻ xác nhận + lý do) cho quản trị công ty; lượt đã được chạy lại hiện câu "đã chạy lại" kèm liên kết tới lượt mới.
- Kịch bản: khi lượt gắn hợp đồng và đã được chạy lại thì chi tiết trả `source` và `rerun_by` [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » R-4 · nguồn hợp đồng và lượt đã chạy lại]
- Kịch bản: khi chỉ quản trị đúng công ty và lượt gắn hợp đồng thì mới có nút Mở lại quy trình [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » R-4 · Mở lại quy trình: chỉ tenant_admin của đúng công ty, lượt gắn hợp đồng]

## Việc còn lại
- Nhãn mã HĐ thật (cần cổng đọc của gói contracts); e2e hành trình mở lại ở cuối đợt.
