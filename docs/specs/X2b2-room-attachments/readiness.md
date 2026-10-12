# Readiness · X2b2-room-attachments

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-12 | NOT READY (lần 2) | 0 | 2 | 10 | 14/16 lỗ hổng lần 1 đóng. 2 Cao: B7 sửa `e2e/**` khoá; E05 `#fake:out`. Mặc định chấp nhận (2026-10-12): [`spec-decisions.md`](spec-decisions.md) #14–#19. Chờ chạy lại |
| 2026-10-12 | NOT READY (lần 1) | 0 | 7 | 9 | 16 lỗ hổng (7 Cao: nhóm quyết định #1–#6, #11 ở spec-decisions; 9 Thấp còn lại). Điều phối đã chấp nhận mọi mặc định (2026-10-12): [`spec-decisions.md`](spec-decisions.md). Chờ chạy lại |
- 2026-10-12 · lần 3 · **READY** — 12/12 lỗ hổng lần 2 đóng; còn 3 Thấp (B7 `--env-file` cho bảng `done:x2b2`; op `/rt/output` thuộc Q1; F1 map 400 path `attachment_ids` ⇒ `process.composer.error.noAttach` + unit `send-error`).
