---
id: gap-d1
title: Sản phẩm & Giá — thêm SP tay/nhập lô, cách lấy hàng, quy tắc nhận diện, báo giá, thêm vào Đối tác (#18–#22)
lane: nhanh + phần kho/RLS (bảng mới) — một agent, Luật 0b
---
# gap-d1 — tasks

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Contracts 0043 (`when` 1797300000000, sau 0044): `products.spec`, `stock_moves.reason` + `manual`, bảng `product_sources` (RLS secure_table, ghi theo người tạo) | xong |
| 2 | #18 `POST /products` nhận `spec`; `POST /products/:id/lots` (nhập lô tay qua `applyDelivery`, dòng sổ `manual`, BQ/FIFO giữ nguyên) | xong |
| 3 | #19 `GET/POST /products/:id/sources`, `DELETE …/:sourceId` + bảng rủi ro (`dependencyRisk`) | xong |
| 4 | #20 UI quy tắc nhận diện trên `POST/DELETE /products/:id/rules` (tab Nhận diện) | xong |
| 5 | #21 `POST /products/:id/supplier-prices/read-quote` (PDF chữ/văn bản ≤ 5 MiB → AI client chung, usage `contracts.quote_read`, parse chặt, chưa lưu); FE Nhập giá tay + Tải báo giá + Lưu làm giá tham khảo (nguồn quote) | xong |
| 6 | #22 "Thêm vào Đối tác" trên dòng giá (`POST /companies`); giá từ HĐ mua đã nằm sẵn trong bảng so sánh (nguồn purchase, nay gồm cả lô tay) | xong |
| 7 | Test: unit (rules, mirror, FE lib), int `tests/acceptance/gap-d1` (4 pass), e2e `e2e/deployed/11-gap-d1.deployed.ts` (viết, chưa chạy) | xong |

## Quyết định
- Báo giá ảnh/PDF scan chưa đọc (415/422) — OCR ngoài phạm vi. Không dùng agent Hub mới: gọi AI client chung với lệnh cố định trong code.
- Lô tay không có HĐ ⇒ dòng sổ chỉ người tạo/người thấy hết nhìn thấy (luật M1 sẵn có).