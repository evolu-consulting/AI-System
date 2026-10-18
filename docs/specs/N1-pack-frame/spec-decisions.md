# Quyết định · N1-pack-frame

Nơi duy nhất ghi quyết định của N1; spec/plan trỏ mã D-xx.

| Mã | Ngày · ai | Quyết định | Hệ quả |
|---|---|---|---|
| D-01 | 2026-10-18 · người dùng | Backend gói hợp đồng **và** dịch vụ tri thức (N4) là **module trong `hub-api`** (schema DB riêng, Clean Architecture ADR-0023); **không** thêm app backend mới | Không cần ADR app mới; PK-FR-09; Q1 đóng; Q2 nghiêng cùng DB Hub |
| D-02 | 2026-10-18 · người dùng | UI gói là **app web riêng** (`contracts-web`), port nguyên giao diện mgmt-app (màn, component, màu, menu, đường dẫn, câu chữ) — khách thấy như cũ; mỗi lát UI có e2e chụp màn hình so với mgmt-app thật theo danh sách màn (lệch = lỗi); thẻ chờ duyệt/nhắc hiện ngay trong màn hợp đồng; trợ lý chung nhúng vào app; app gọi thẳng `hub-api`, đăng nhập qua admin-api | PK-FR-10; app dựng ở HD5 |
| D-03 | 2026-10-18 · người dùng | **Giao tiếp nội bộ:** không gọi HTTP đồng bộ giữa app nội bộ trên đường nóng — đọc qua role DB chỉ-đọc, sự kiện qua NOTIFY/Redis; test perf đếm số bước nhảy (DB/Redis/HTTP) mỗi request | PK-BR-01, PK-NFR-05, Q8 |

## Trong lúc làm (Luật 2)
- (chưa có)
