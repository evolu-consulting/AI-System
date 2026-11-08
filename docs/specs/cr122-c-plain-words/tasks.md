---
id: cr122-c-plain-words
lát: cr122-c-plain-words
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chữ đời thường trên trình sửa flow và danh sách flow công ty; chỉ chữ và bố cục, không đổi logic.

## Làm
- Đổi chữ vi/en: Chuẩn bị dữ liệu (nhóm Nâng cao), Sau đó đi tiếp, Thông tin hồ sơ, Các bước, Tên bước, Tính năng chưa bật cho công ty.
- Canvas flow bỏ hàng tiêu đề cột Bước; thêm bước qua nút Thêm bước.
- Danh sách flow công ty: kéo thả và câu hướng dẫn nằm trong mục Nâng cao đóng sẵn; trạng thái ngắn.
- Cảnh báo và chip cầu nối hiện nhãn nghiệp vụ, chưa có nhãn thì dùng khoá.

## Không làm / Chạm
Không đổi logic, không đổi hub-api.

## Test tối thiểu
Unit của processes và tenants.

## Quyết định trong lúc làm
Nhãn cầu nối rơi về khoá cho tới khi lát A cấp label.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

Không thay đổi hành vi (lý do: chỉ đổi chữ hiển thị và bố cục trình sửa flow, không đổi luật hay dữ liệu)

## Việc còn lại
Qc sửa e2e theo danh sách chữ và testid đã đổi.
