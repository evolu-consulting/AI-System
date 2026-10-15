# Readiness · FB1-filebox-attachments

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên).

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-15 | READY (CORE-ONLY) | 0 | 0 | 0 | Scope thu hẹp CORE-ONLY 2026-10-15 — giảm phạm vi, không phát sinh câu hỏi mới; readiness trước đó READY vẫn phủ phần lõi. |
| 2026-10-15 | READY | 0 | 0 | 2 | 5 điểm đã vá & xác minh; DROP+CREATE hợp lệ Postgres + GRANT/REVOKE khớp 0023; findSecretIdByName name→id; AC-09 app-only; FILEBOX_SPILL_DIR; token cache memory-only + cờ security review. Gate + BUILD qua mock OK, HS1/HS2 không cản. 2 Thấp: security-review token cache, câu chữ §3.6 d128. |
| 2026-10-15 | NOT READY | 0 | 1 | 3 | 1 Cao: DDL definer `attach_claim_deleted_rooms` phải DROP+CREATE + re-GRANT (không CREATE OR REPLACE đổi RETURNS TABLE); 3 Thấp (#3 helper name→id, #4 câu chữ AC-09, #5 env FILEBOX_SPILL_DIR); #2 Trung = cờ security review (token cache memory-only). Sau vá: sẵn sàng Gate+BUILD qua mock; HS1/HS2 không cản mock. |
