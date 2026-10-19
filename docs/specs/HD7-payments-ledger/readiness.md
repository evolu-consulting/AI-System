# HD7 · Readiness

## Vòng 1 — 2026-10-19 (spec-readiness, một vòng theo Luật 1b)
Kết luận gốc: NOT READY, 13 lỗ hổng Chặn/Cao, mỗi lỗ hổng có mặc định đề xuất. Luật 1b: lỗ hổng Cao đã có mặc định thì áp luôn.
Đã áp cả 13 (ghi vào plan §6, D7-12…D7-20) ⇒ **READY**, không chạy vòng 2.

| # | Lỗ hổng | Mặc định đã áp |
|---|---|---|
| 1 | Sổ và bảng huỷ thiếu `tenant_id`, không bật được RLS | Cả hai bảng có `tenant_id`; `UNIQUE (id, tenant_id)` trên sổ; FK kép từ bảng huỷ sang sổ (D7-12) |
| 2 | Tập "đã duyệt" chưa rõ | Tập HD4 `active expiring expired renewed terminated` (D7-13) |
| 3 | Giá trị HĐ âm làm hỏng CHECK trong trigger | `amount` = giá trị nếu 0…10¹⁵, ngược lại null; trigger không ném lỗi (D7-13) |
| 4 | `overdue_for ≠ due` với NULL | `IS DISTINCT FROM` |
| 5 | Index quét quá hạn | Index một phần `(tenant_id, due_date, id) WHERE status='open' AND party_key IS NOT NULL` + điều kiện `overdue_for` (D7-14) |
| 6 | Thứ tự khoá trong một câu join | Hai câu: khoá HĐ, rồi khoá đợt và đọc lại (D7-15) |
| 7 | Huỷ song song hoàn tác hai lần | `INSERT … ON CONFLICT (event_id) DO NOTHING RETURNING`; 0 hàng ⇒ không hoàn tác; khoá HĐ trước (D7-16) |
| 8 | Trường hoàn tác chưa đủ | Theo `obligations.py:97-103` (D7-16) |
| 9 | Đợt không có đối tác | Đợt vẫn cập nhật, không ghi sổ; `party_key` của sổ NOT NULL (D7-17) |
| 10 | Công thức stats | Không phụ thuộc filter; mọi đợt payment đang mở; null = 0; `due_7d` = chưa trễ và hạn ≤ hôm nay + 7 (múi tenant); `of` = mọi đợt trừ `replaced` (D7-18) |
| 11 | Thân `POST /partner-events` | `{party, role, type, at?, note?, delta?, contract_id?, days_late?}`, strict, sai ⇒ 400 (D7-19) |
| 12 | "Chưa biết bên" | `direction` ∉ {sale, purchase} ⇒ không lập; `party_key` null vẫn lập |
| 13 | `saneSchedule` dùng ở đâu | Chỉ là hàm thuần có test; PUT không gọi (D7-20) |

Trung bình (đã áp): PUT cho cả HĐ chưa duyệt và `rows=[]`; `settle.at` nhận mọi ngày hợp lệ; DDL có NOT NULL/default/CHECK enum;
số chữ ký × giá của CKS > 10¹⁵ ⇒ null; `paid`: `cancelled` tính là chưa xong, `replaced` bị loại.
