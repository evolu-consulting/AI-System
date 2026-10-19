# HD9 — readiness (1 vòng, CR-094 đợt 3, làn đầy đủ)

## Vòng 1 — 2026-10-19 · spec-readiness (subagent)
Kết luận: NOT READY nhưng mọi lỗ hổng Chặn/Cao có mặc định an toàn ⇒ áp luôn (Luật 1b), không vòng 2 ⇒ **READY sau khi áp**.

| # | Mức | Lỗ hổng | Áp |
|---|---|---|---|
| G1 | Chặn | Tệp > 20 MB / sai đuôi: 413 hay đếm? | D9-16 |
| G2 | Cao | Bỏ lọc theo người xem của mgmt (`access.view`) chưa ghi quyết định | D9-17 |
| G3 | Cao | Độ chi tiết nhật ký giá, kiểu `old_value` | D9-18 |
| G4 | Trung | AC08 ghi 7 bảng, DDL có 8 | sửa spec AC08 = 8 |
| G5 | Trung | Trường HĐ CKS dựng ra chưa chốt | D9-19 (port nguyên `sales.py:27-39`, `lots.py:27-32`) |
| G6 | Trung | Nhãn lô mặc định | D9-19 (`YYYY-MM` của `bought_at`) |
| G7 | Trung | Chuẩn hoá MST khoá khách | D9-20 |
| G8 | Trung | Ngày tương đối trong test | ngày tương đối theo Asia/Ho_Chi_Minh ở cả test và server (đồng hồ thật; HD9 không có vòng nền) |
| G9 | Trung | Số câu SQL cố định cho mọi lệnh ghi | D9-21 + AC09 |
| G10 | Trung | Nguồn chuỗi EN | dịch thẳng VI; so màn hình chỉ VI |
| G11 | Thấp | Xoá văn bản đã ký | thêm vào "Không làm" |
| G12 | Thấp | Serial trùng trong cùng lệnh; `lost` lượt đã đóng | 409 `CKS_SERIAL_TAKEN`; `lost` không `open` ⇒ 404 như mgmt |
| G13 | Thấp | `customer_id` bắt buộc; thiếu tasks.md | giữ bắt buộc; plan §6 là test-plan; `tasks.md` có cột Làn |
