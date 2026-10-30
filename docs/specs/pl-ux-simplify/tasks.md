---
id: pl-ux-simplify
lát: pl-ux-simplify
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: L3, pl-editor-uatfix
---
## Plan (ngắn)
Chỉ giao diện (người dùng: "sửa giao diện cho user dễ làm"), không đổi API/hành vi chạy. Danh sách thư viện: Nhân bản mở hộp thoại nhập tên (ký hiệu tự sinh từ tên, thử `-n` khi trùng), bỏ cột Ký hiệu (tooltip tên), cột Trạng thái (Nháp / Đã xuất bản vN / Có thay đổi chưa xuất bản) + "Tenant đang dùng" bằng chữ, mặc định ghim đầu, "Tạo từ quy trình mặc định", ẩn chọn tenant ở tab Thư viện, mô tả mới, xoá được bản nháp chưa từng xuất bản. Editor khe: thống nhất "Bước duyệt" (Sơ đồ / Danh sách), một nút "Thêm bước duyệt", route/finalize là viên thuốc xám, bỏ cạnh "Quay lại"/nhãn "Rẽ nhánh", mỗi bước hiện phòng ban + hạn + điều kiện bằng lời; thanh trên: trạng thái, Xuất bản (nút chính), Gán, Xem trước; "Lưu nháp" tách khỏi "Xuất bản".

## Quyết định trong lúc làm
- "Có thay đổi chưa xuất bản": Hub chưa trả cờ ⇒ UI đọc `has_unpublished_changes` tuỳ chọn (khe hở hợp đồng); thiếu ⇒ "Đã xuất bản vN".
- Tên tenant ở ô "đang dùng" tải lười qua `GET …/assignments` chỉ với dòng có gán.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: chỉ giao diện CR-105)
