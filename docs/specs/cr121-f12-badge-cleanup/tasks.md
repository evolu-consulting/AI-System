---
id: cr121-f12-badge-cleanup
lát: cr121-f12-badge-cleanup
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Người dùng chỉ ra cột Trạng thái tab Ứng dụng lệch: "Đang bật" là viên xanh thẳng mép, "Đang tắt" nhìn như chữ trơn thụt vào. Cùng một component trạng thái, căn mép đúng; gỡ badge số sidebar.

## Làm
- Nguyên nhân: cả hai đã dùng `StatusBadge` nhưng biến thể `off` (nền `bg-muted`) trùng màu nền thẻ nên viên tắt "tàng hình", chữ thụt theo đệm của viên. `Badge` biến thể `off` thêm viền (`border-border`) ⇒ viên xám rõ, mép trái thẳng tiêu đề cột. Một khái niệm = một component: bảng Công ty › Quy trình đã dùng cùng `StatusBadge` (Chưa dùng ứng dụng = tắt).
- Bảng Ứng dụng: cột Thành viên rộng 5.5rem + `whitespace-nowrap` (không xuống 2 dòng), mọi hàng cao tối thiểu 3.5rem, nội dung căn giữa dọc; bỏ tiêu đề khối "Ứng dụng" trùng tên tab.
- Bảng Quy trình: chip bước có viền (viên rõ, mép trái thẳng tên quy trình); ẩn dòng "0/0 việc có quy trình" khi chưa có việc nào tính.
- Gỡ badge số sidebar: prop `badges`/`badge` và chấm số trong `SidebarNav`.

## Đã soát căn mép (ảnh 1440px, devicePixelRatio 2; `…\scratchpad\uat-cr121c\f12\shots\`)
- Tab Ứng dụng: Ứng dụng · Quyền truy cập · Trạng thái · Thành viên · Quy trình — ô và tiêu đề cùng mép trái từng cột (đo `left` tiêu đề = ô: Trạng thái, Thành viên, Quy trình trùng nhau); viên "Đang bật" và "Đang tắt" cùng mép trái với tiêu đề "Trạng thái"; "Thành viên" một dòng; 5 hàng cao bằng nhau (57px) và căn giữa dọc.
- Tab Quy trình: Việc · Quy trình · Trạng thái · Luật cùng mép trái với ô; viên "Chưa dùng ứng dụng" thẳng mép tiêu đề; chip bước thẳng mép tên quy trình.
- Ảnh: `ung-dung-bang.png`, `ung-dung-trang-thai-zoom.png`, `quy-trinh-bang.png` (+ `-full`).

## Không làm / Chạm
Không sửa e2e.

## Test tối thiểu
- unit: bộ unit admin-web hiện có (846 pass); thay đổi là giao diện nên kiểm bằng ảnh.

## Ca e2e cần đổi (qc, không chạy)
- Ca đọc dòng "0/0 việc có quy trình" (nay ẩn khi chưa có việc nào tính) và ca tìm chấm số sidebar (không còn).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/trang-thai-badge-thong-nhat.md
#### Yêu cầu: Trạng thái bật/tắt dùng một kiểu viên thống nhất
Mọi bảng trong trang công ty hiển thị trạng thái bằng cùng một viên (bật xanh, tắt xám có viền), mép trái thẳng tiêu đề cột; thanh bên không có chấm số.
- Kịch bản: thanh bên không còn chấm số [test: thủ công — soát ảnh UAT f12 (tab Ứng dụng, tab Quy trình) và đọc mã SidebarNav]

## Việc còn lại
- e2e (qc) theo danh sách trên.