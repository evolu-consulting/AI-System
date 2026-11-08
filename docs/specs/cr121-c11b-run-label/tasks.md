---
id: cr121-c11b-run-label
lát: cr121-c11b-run-label
cr: CR-121
làn: nhanh (đường đọc theo tập; không ghi dữ liệu)
migration: không
phụ thuộc: cr121-c9, cr121-c11
---
## Plan (ngắn)
`GET /process-runs` trả thêm `record_label` (nhãn nghiệp vụ bản ghi gắn lượt, vd mã HĐ thật) cho khối "Đang chạy" của Công ty › Quy trình.

## Làm
- Contract `ProcessRunListItemSchema` = `ProcessRunSummarySchema` + `record_label: string | null` (chỉ response danh sách; các response tạo/huỷ lượt giữ nguyên).
- `runs.repo.ts`: `RUN_COLS` thêm `pack_key`, `pack_record_id` (cùng câu liệt kê, không thêm câu).
- `runs/run-record-labels.ts`: gom id theo gói của TRANG, mỗi gói MỘT lần `recordLabelRegistry.labelsOf` (một nguồn với trang chi tiết; contracts dùng `contractNameSql`/`contractRecordLabel`); lượt không gắn bản ghi / gói chưa đăng ký / lỗi đọc / HĐ công ty khác ⇒ `null` (RLS tenant của gói).
- admin-web: `features/tenants/flows/lib/run-title.ts` (+ test) và `DrawerRunning.tsx`: có nhãn ⇒ nhãn là dòng chính, "tên việc · bắt đầu giờ" dòng phụ; chưa có ⇒ như cũ. Không đụng artboard (không đổi cấu trúc khối, chỉ thay chuỗi dòng chính).
- Perf: đường list có `limit`; số câu SQL trước → sau: +0 câu Hub (cột thêm vào câu liệt kê sẵn có); + (set_config role + 1 SELECT) của gói MỖI gói khác nhau trong trang (thường 1), không phụ thuộc số lượt (test so limit=2 với limit=50).

## Không làm / Chạm
Máy trạng thái run, ghi dữ liệu, `ProcessRunSummarySchema` dùng chung.

## Test tối thiểu
- int `apps/hub-api/src/modules/processes/runs/runs-record-label.int.test.ts`
- unit `apps/admin-web/src/features/tenants/flows/lib/run-title.test.ts`

## Quyết định trong lúc làm
- Nhãn chỉ ở response danh sách (`ProcessRunListItem`), không nhét vào `ProcessRunSummarySchema` để không đổi 201 `POST /process-runs` và các nơi khác.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED engine/luot-chay-nhan-ban-ghi.md
#### Yêu cầu: Lượt chạy hiện nhãn nghiệp vụ của bản ghi
Danh sách lượt chạy trả kèm nhãn nghiệp vụ của bản ghi gắn lượt (ví dụ mã hợp đồng thật); lượt không gắn bản ghi hoặc bản ghi không thuộc công ty ⇒ không có nhãn. Khối "Đang chạy" hiện nhãn này thay cho tên việc + giờ.
- Kịch bản: lượt gắn hợp đồng ⇒ nhãn = "HĐ <mã> · <tên>", lượt không gắn hoặc gắn hợp đồng công ty khác ⇒ null [test: apps/hub-api/src/modules/processes/runs/runs-record-label.int.test.ts » nhãn = mã HĐ thật, không gắn bản ghi hoặc HĐ công ty khác ⇒ null]
- Kịch bản: số câu SQL không tăng theo số lượt trong trang [test: apps/hub-api/src/modules/processes/runs/runs-record-label.int.test.ts » số câu SQL không tăng theo số lượt trong trang]
- Kịch bản: có nhãn ⇒ nhãn là dòng chính, chưa có ⇒ tên việc + giờ [test: apps/admin-web/src/features/tenants/flows/lib/run-title.test.ts » có nhãn bản ghi ⇒ nhãn là dòng chính, tên việc + giờ là dòng phụ]

## Việc còn lại
Không.