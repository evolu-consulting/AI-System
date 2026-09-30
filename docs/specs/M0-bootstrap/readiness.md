# Readiness · M0-bootstrap

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-01 (lần 3, delta) | **READY** (sau vá) | 0 | 0 | 0 | Agent: 14/18 mục đóng, còn 1 Cao (test-plan AC07 ngưỡng cũ) + 3 Thấp (plan-frontend extends/ownership, T18 printf). Điều phối sửa 4 mục và tự xác minh bằng grep — không chạy lại Opus vì chỉ là sửa chữ. |
| 2026-10-01 (lần 2) | NOT READY | 0 | 3 | 15 | 20/20 lỗ hổng lần 1 + 5 mâu thuẫn đã đóng. Còn lệch chữ do vá: extends tương đối phía FE, ngưỡng thời gian AC07, câu lỗi resetTestDb. Điều phối tự sửa cả 18 mục (sửa cơ học). |
| 2026-10-01 (lần 1) | NOT READY | 1 | 11 | 8 | Không có câu hỏi cho người dùng; mọi lỗ hổng có mặc định. Giao backend-lead (#1–7, 11, 12, 14, 15, 17–20 + mâu thuẫn), frontend-lead (#8–10, 16), qc (#13 trước LOCK). |

## Lần 1 — tóm tắt lỗ hổng
- **Chặn #1** T7: lệnh migrate trên DB test mơ hồ (DATABASE_URL vs TEST_DATABASE_URL, resetTestDb, psql bị lược).
- **Cao:** #2 linker isolated thiếu devDeps `@ai/config`/`@types/bun`/`typescript` mỗi workspace · #3 depcruise coi `bun:*` là unresolvable · #4 test depcruise tự loại `__fixtures__` · #5 trace đếm mã FR mẫu trong file test là "có test" · #6 env 14 vs 16 vs 18 biến, thiếu cổng mock · #7 CI pull_request không có nhánh local `main` · #8 `web.json` thiếu `types: ["bun"]` · #9 admin-web thiếu dep `@ai/i18n`, i18n thiếu tsconfig · #10 i18n listener đụng `document` trong bun test · #11 mock `/internal/test-run` lệch HUB-FR-51 · #12 T9–T14 thiếu phụ thuộc Q2.
- **Thấp:** #13 test-plan chữ cũ · #14 tên luật depcruise · #15 mock với giá trị lạ · #16 KB = 1024, tổng hay từng file · #17 lệnh grep/until trong tasks · #18 kiểu env strict · #19 keys:dev chi tiết · #20 CORS exposeHeaders, chữ ký AppError.
- **Mâu thuẫn:** ADR-0001 mock trong compose · readiness #11 seed usage · ADR-0002 react-i18next · BA Hub §8 quyền đọc 3 bảng · HUB-FR-51.
