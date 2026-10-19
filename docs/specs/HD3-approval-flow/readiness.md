# Readiness HD3 — vòng 1 (duy nhất, Luật 1b) · 2026-10-19

Kết luận agent: NOT READY — 3 Chặn, 10 Cao, 2 Trung, 1 Thấp; mọi mục có mặc định. Theo Luật 1b (Cao có mặc định ⇒ áp luôn, không vòng 2) đã áp:

| # | Mức | Xử lý |
|---|---|---|
| 1 | Chặn | `tasks.md` (bảng task + Làn + test) |
| 2 | Chặn | spec §3 bảng endpoint/quyền/mã lỗi |
| 3 | Chặn | D3-08: người bắt đầu bị chặn mọi kết quả review cấp 2 (hỏi lại người dùng trong báo cáo nếu muốn khác) |
| 4, 5, 9, 10 | Cao | AC33c, AC34d–g ở spec §2 |
| 6, 7 | Cao | spec §4 ngưỡng; D3-09 thiết kế quét |
| 8 | Cao | D3-10 (fail-closed) |
| 11 | Cao | ghi có điều kiện trạng thái (idempotent); `EXTRACT_BUSY`, `APPROVAL_NOT_OPEN` ở §3 |
| 12 | Cao | nhãn FE ở `tasks.md` T7 |
| 13 | Cao | D3-11 |
| 14, 15 | Trung | AC D3-04 ở test; bảng FR→test ở `tasks.md` |

Câu hỏi để người dùng (đã áp mặc định): (1) người bắt đầu có được Từ chối ở cấp 2? mặc định KHÔNG; (2) Redis lỗi khi đếm trần? mặc định chặn (503).
