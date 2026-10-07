# Readiness X2a

| Lần | Ngày | Kết quả | Ghi chú |
|---|---|---|---|
| R1 | 2026-10-07 | NOT READY | 10 lỗ hổng (1 Chặn, 4 Cao, 3 Trung, 2 Thấp); mặc định Luật 2b đã áp vào spec §10, plan, plan-db, plan-frontend, tasks. test-plan 30,6 KB < trần 30 KB (30720 B), không cắt |
| R2 | 2026-10-07 | NOT READY | 1 Cao + 4 Thấp, không câu hỏi người dùng; mặc định đã áp: stub `GET /rooms` trả `{items:[],next_cursor:null,unread_total:0}` (spec Q7, tasks B3); chữ ký `parseMeStreamEvent(event, data)` (plan-frontend); spec-isolation trỏ test-plan §4; plan §12 mục 9 (RLS UPDATE rooms/left_at, reviewer đánh giá). **Việc của qc ở QC1** (test-plan là của qc, chưa sửa): đánh dấu G1–G8, G10 đã đóng; T12 dùng `pingMs: 500`, chờ ≤ 2 s |
| R3 | 2026-10-07 | **READY** | Xác minh diff `21a4443..04ab356`; còn 2 Thấp: xoá dấu `[chờ plan BE…]` ở plan-frontend:64 (frontend-lead F2); việc QC1 ở trên (qc). Gate tự duyệt: `docs/specs/X2a-gate.md` |
