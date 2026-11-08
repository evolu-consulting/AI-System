# Engine · Nhãn nghiệp vụ của lượt chạy

Cập nhật: 2026-11-09 · Nguồn: cr121-c11b-run-label (CR-121). Code: `apps/hub-api/src/modules/processes/runs/` (runs-record-label), `apps/admin-web/src/features/tenants/flows/lib/run-title`.

#### Yêu cầu: Lượt chạy hiện nhãn nghiệp vụ của bản ghi (nguồn: cr121-c11b-run-label)
Danh sách lượt chạy trả kèm nhãn nghiệp vụ của bản ghi gắn lượt (HĐ ⇒ "HĐ <mã> · <tên>"); lượt không gắn bản ghi hoặc bản ghi thuộc công ty khác ⇒ không có nhãn (null). Số câu SQL không tăng theo số lượt trong trang. Khối "Đang chạy" hiện nhãn làm dòng chính (tên việc + giờ là dòng phụ); chưa có nhãn ⇒ tên việc + giờ.
