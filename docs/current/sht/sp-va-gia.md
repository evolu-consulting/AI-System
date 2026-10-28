# Sổ Hợp Tác · SP & Giá (giá đã ghi nhận)

Cập nhật: 2026-10-28 · Gộp từ: com-c7-save-quote (CR-102b), com-c7b. Nguồn Báo giá từ Community: `current/community/nghiep-vu.md` §8.

## 1. Giá đã ghi nhận (`product_supplier_prices`, contracts 0066)
- Cột mới: `vat_included` (gồm/chưa VAT), `expires_on` (hạn), `replaced_at`, `removed_at`, `origin_ref` (id bài + mặt hàng). Hiển thị: VAT gồm/chưa, hạn, nhãn "Đã hết hạn".
- Giá `source='quote'` cùng NCC + cùng SP: giá mới thay giá cũ (`replaced_at` ở giá cũ).
- Nút **Xoá** trên dòng giá = **gỡ mềm** (`removed_at`), không xoá cứng.
- Giá đã thay / đã gỡ chuyển xuống **"Lịch sử giá"** (nhãn "Đã thay" / "Đã gỡ").
- So sánh, gợi ý, dò giá, chatbot: **bỏ** giá hết hạn / đã thay / đã gỡ.
- Policy UPDATE nhánh `source='quote'` chỉ cho đặt `replaced_at` trên dòng còn sống (`removed_at IS NULL`).
- Lưu báo giá không đổi kho, giá vốn, điểm uy tín; không có màn mới.

## Chưa rõ
1. Quy đổi đơn vị (thùng/lốc/kg) chưa tự động; chủ quản sửa trong form.
2. Nút "Xem" từ bài về SP & Giá chưa có (đích chưa chốt).