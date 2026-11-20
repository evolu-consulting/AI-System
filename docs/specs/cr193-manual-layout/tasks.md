---
id: cr193-manual-layout
lát: cr193-manual-layout
cr: CR-193
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
Trạng thái gộp: chưa gộp

### ADDED sht/chi-tiet-hd-nhap-tay-bo-cuc.md
#### Yêu cầu: Bố cục chi tiết HĐ nhập tay
Đầu trang thẳng mép với lưới; khoang rộng tối đa 1680px; cột form 460px, ô Loại hợp đồng tự về 2 cột khi hẹp; lý do chặn gửi duyệt xuống hàng riêng, tiêu đề giữ leading.
- Kịch bản: khi mở HĐ nhập tay ở 1920px thì đầu trang thẳng mép với lưới và khung tệp rộng hơn 900px [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-193 · nhập tay: đầu trang thẳng mép với lưới]

## Việc còn lại
Baseline mới `cr193-manual-light|mobile` trong scenes.cw.ts: điều phối chụp (-Capture cw).
