---
id: cr125-c4-date-input-all
lát: cr125-c4-date-input-all
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)
### MODIFIED sht/chung-tu.md
#### Yêu cầu: Mọi ô ngày dùng một bộ chọn ngày chung
Mọi ô nhập ngày ở Sổ Hợp Tác, Admin và Chat (lọc, mốc, thanh toán, báo giá, form quy trình) là một ô duy nhất: hiện dd/mm/yyyy, gõ hoặc chọn lịch (thứ Hai đầu tuần, tháng tiếng Việt); giá trị lưu vẫn là yyyy-mm-dd. Không còn ô ngày gốc của trình duyệt (mm/dd theo máy Mỹ).
- Kịch bản: khi gõ "3/9/2027" thì ô hiểu là 03/09/2027 [test: packages/web-kit/src/date-math.test.ts » hiển thị lại bằng viDate (một bộ định dạng) khớp phần đọc]
- Kịch bản: khi có `type="date"` trong mã giao diện ngoài component chung thì cổng check:date-input đỏ [test: tools/scripts/src/check-date-input.rules.test.ts » bắt type=date và datetime-local trong .tsx]
- Kịch bản: khi người dùng chọn ngày ở form quy trình chat thì nút "Chọn ngày" hiện và gửi yyyy-mm-dd [test: e2e/P-d/chat-labels.pd.ts » PD-E08(d) · form '!pd-wait-input']
## Việc còn lại
