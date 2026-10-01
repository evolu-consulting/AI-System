# STATE — trạng thái hiện tại

Cập nhật: 2026-10-01 · Người cập nhật: docs-architect (đóng M1)

## Đang ở đâu
- **M1 xong** (2026-10-01, trên `main`, chưa push). Lệnh xong M1 xanh tại e53d51b: `bun test` 462, `test:int` 266, e2e 38/38, `check:size --all` 295 file, depcruise 0 vi phạm, lock 39, trace 172, bundle JS 106,9 KB / CSS 13,5 KB. Review: vòng 1 CHANGES REQUESTED (3 Major + 10 Minor, đã sửa); vòng 2 còn 1 Major N1 (deadlock `FOR UPDATE`/`FOR KEY SHARE`), sửa ở 3931d80, điều phối tự xác minh bằng đọc diff + chạy lại lệnh, không có vòng 3. Kết luận: `docs/specs/M1-foundation-identity/spec.md` §9. Spec `status: done`.
- M0 xong (Lệnh xong M0 xanh, review APPROVED).
- Thiết kế v0.4 xong (`design/`); canvas 18 artboard (`docs/design/canvas/`). Khung quy trình xong (`CLAUDE.md`, `WORKFLOW.md`, 7 agent, Luật 2b).
- Đã chốt: bỏ "Còn N lần thử"; JWT EdDSA; chấp nhận mọi mặc định `readiness/2026-10-01-admin-m1-m4.md`; 2FA + Import/Export vào M4 khi có artboard. Làm và commit trực tiếp trên `main`, không push.

## Việc kế tiếp (phiên mới: làm ngay, KHÔNG hỏi — Luật 2b)
1. **M2 Catalog & command** — Gate đã duyệt 2026-10-01 (`docs/specs/M2-gate.md`, readiness lần 2 READY). Đang BUILD: T1 contract → Q2 qc viết + sửa test khoá M0/M1 → Q3 khoá → T2…T6 ∥ FE0…FE7 → T7 Lệnh xong M2 → reviewer (≤ 2 vòng) → D1. Làm trên `main`, không push.
2. Canvas: đổi `#7A7390` → `#736C89` (FE-R1, AA) khi chạm lại canvas.

## TECH-DEBT đáng chú ý (`docs/TECH-DEBT.md`)
- #13 `withScope` retry 40P01/40001: từ M2, callback gửi gì ra ngoài (NOTIFY, mail, HTTP) phải đưa ra sau commit.
- #11/#12 seam test `beforeVerify` nằm trong `AuthCtx` production; test khoá tạm #3 không tất định.
- #8 refresh token hết hạn chưa dọn; #9 audit từ M4; #10 `check:size`/`depcruise` nghiệm thu phải dùng `--all`.
- `packages/db/migrations/0002_admin_rls.sql` từng sửa tại chỗ; từ M2 không sửa migration đã commit.

## Độ phủ design (artboard)
18 artboard trong `docs/design/canvas/` (Login, Main, Sidebar, TenantOverview, TenantCreate, TenantQuota, Users, Groups, Access, Commands, Workflows, Secrets, Usage, Audit, ChangePassword, Enable2FA, ImportPreview, States). Màn chưa có artboard: xem `docs/specs/_design/admin-missing-screens.md`.

## Câu hỏi đang chờ người dùng
- (không)

## Bị chặn
- (không)
