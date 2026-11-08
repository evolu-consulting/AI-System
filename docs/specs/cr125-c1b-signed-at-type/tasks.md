---
id: cr125-c1b-signed-at-type
lát: cr125-c1b-signed-at-type
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-c1-esign-one-source
---
## Plan (ngắn)
Đóng rủi ro của c1: `signed_at` khai kiểu `date` nhưng mang mốc ISO đầy đủ. Chọn cách 2 (giữ `date`, quy mốc về ngày lịch VN qua MỘT hàm trước khi so): thêm kiểu `datetime` phải chạm ≥ 8 chỗ kiểm `date` (If, tool-output, set, branch, wait-def, start-inputs, form, manifest) — vượt ~40 dòng.

## Làm
`asCalendarDate` (`domain/runs/start-inputs.rules.ts`): mốc ISO ⇒ `YYYY-MM-DD` giờ Việt Nam, còn lại giữ nguyên. Dùng ở If (`plainHit`: đầu ra mốc đầy đủ so với vế phải là ngày) và hẹn giờ (`waitDueAt`: gốc là mốc ⇒ ngày VN).

## Không làm / Chạm
Không đổi sổ module (`node.ts` vẫn `date`), không thêm kiểu mới, không migration. Tham số tool kiểu `date` lấy từ đầu ra Ký số vẫn nhận mốc đầy đủ (chưa có tool nào cần).

## Test tối thiểu
Unit `domain/runs/as-calendar-date.test.ts`: hàm chuẩn hoá (ranh giới 00:00 VN), If trên `signed_at` (eq/ge/gt/lt), hẹn giờ lấy `signed_at` làm gốc.

## Quyết định trong lúc làm
So theo ngày chỉ khi vế phải là ngày lịch `YYYY-MM-DD`; vế phải khác ⇒ so nguyên như cũ.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Điều kiện và hẹn giờ theo ngày ký tính theo ngày Việt Nam
Điều kiện Nếu và bước Chờ tới dùng ngày ký (đầu ra mốc đầy đủ) tính theo ngày lịch Việt Nam.
- Kịch bản: ký lúc 01:30 ngày 07/11 giờ VN thì điều kiện ngày ký bằng 07/11 đúng và hẹn giờ tính từ 07/11 [test: apps/hub-api/src/modules/processes/domain/runs/as-calendar-date.test.ts » ký 01:30 ngày 07/11 giờ VN: = 2026-11-07 đúng, = 2026-11-06 sai (cắt UTC sẽ ra ngược lại)]