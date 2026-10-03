# STATE — trạng thái hiện tại

Cập nhật: 2026-10-01 · Người cập nhật: docs-architect (đóng M1)

## Đang ở đâu
- **M2 xong** (2026-10-02, trên `main`, chưa push). Lệnh xong M2 xanh sau ad96c73: `bun test` 743, `test:int` 538/538, e2e 83/83, `check:size --all` 498 file, depcruise 0 vi phạm, lock 67, trace 172, bundle JS 115,8 KB / CSS 14,3 KB, chunk lớn nhất 40,8 KB. Review: vòng 1 CHANGES REQUESTED (1 Major, 7 Minor, đã sửa); vòng 2 có 2 Major do bản sửa perf (deadlock thứ tự khoá POST/PATCH command, hàm 5 tham số), sửa ở ad96c73; điều phối tự xác minh bằng đọc diff + chạy lại lệnh (không tự chạy lại ca deadlock trên code cũ). Kết luận: `docs/specs/M2-catalog-command/spec.md` §9. Spec `status: done`.
- M1, M0 xong. Thiết kế v0.4 xong (`design/`); canvas 18 artboard. Khung quy trình xong (`CLAUDE.md`, `WORKFLOW.md`, 7 agent, Luật 2b).
- Đã chốt (M2): gói bảo mật Secrets, AC-A03 tách vế (CR-011), hoãn FR-12 (CR-012), FR-24 phần tenant (CR-013), UI editor trang riêng (CR-014). Làm và commit trực tiếp trên `main`, không push.

## Việc kế tiếp (phiên mới: làm ngay, KHÔNG hỏi — Luật 2b)
1. **M3 Phân quyền** theo `docs/ROADMAP.md` (Groups + thành viên; Grants + ma trận; Kiểm tra quyền phần feature/command; NOTIFY `config_changed`; chống ghi đè `version`; FR-32, 35, 36, 53, 55, 62; BR-11, 12; xong khi AC-A07, A10, A11 phía Admin xanh; cộng vế "≤ 5 giây" của AC-A03 hoãn từ M2, CR-011; FR-24 phần group/grant). Vòng: docs-architect tách spec `M3-…` → plan BE ∥ FE → qc test-plan → spec-readiness → tự duyệt Gate nếu đủ điều kiện (Luật 2b) → qc khoá test → BUILD → Lệnh xong M3 → reviewer (≤ 2 vòng) → docs. Trên `main`, không push.
2. Canvas: đổi `#7A7390` → `#736C89` (FE-R1, AA) khi chạm lại canvas.

## Token (đo bằng `token-report.py`, xem WORKFLOW "Đo token mỗi mốc")
- Mốc chuẩn M0–M3 (trước 2026-10-03, quy trình cũ): ≈ $756 quy đổi giá API · đọc lại cache 69% · backend-lead 38%, điều phối 23%, frontend-lead 15%, qc 13% · lần chạy lớn nhất 347 lượt / context 775K (backend-lead PLAN M3).
- Từ 2026-10-03: model theo rủi ro + một task mỗi lần gọi. Mục tiêu: cache < 40%, không lần chạy > 200K context / > 80 lượt.

## TECH-DEBT đáng chú ý (`docs/TECH-DEBT.md`)
- #13 `withScope` retry 40P01/40001: NOTIFY (M3), mail, HTTP phải đặt sau commit.
- #16 xoay khoá `SECRET_MASTER_KEY` chưa có (mất khoá = mất mọi secret, xem PRODUCTION-NOTES).
- #17 mỗi agent/worktree cần DB test riêng (e2e và test:int đụng nhau trên `ai_system_test`).
- #18 chưa có kiểm tự động độ dài hàm ≤ 50 dòng; #22 lệnh xong task FE thiếu `depcruise --all`.
- #20 chưa ghi audit (M4); #15 hàng `hub.agent_workflows` có thể mồ côi; #19 thư mục quá 10 file.
- #8 refresh token hết hạn chưa dọn; #10 nghiệm thu dùng `--all`; từ nay không sửa migration đã commit.

## Bài học cho mốc sau
- Lệnh xong của **mọi** task FE và BE phải chạy `depcruise --all` và đo độ dài hàm (hàm ≤ 50 dòng, ≤ 4 tham số).
- Bản sửa perf phải kiểm lại **thứ tự khoá** (POST/PATCH dùng chung một thứ tự, có ca tất định xen kẽ); khoá ngầm của unique index cũng tạo vòng chờ.
- Không dùng chung staging giữa các agent (migration M2 lọt vào commit i18n `878c90b`); mỗi agent một worktree/DB test.

## Độ phủ design (artboard)
18 artboard trong `docs/design/canvas/` (Login, Main, Sidebar, TenantOverview, TenantCreate, TenantQuota, Users, Groups, Access, Commands, Workflows, Secrets, Usage, Audit, ChangePassword, Enable2FA, ImportPreview, States). Màn chưa có artboard: xem `docs/specs/_design/admin-missing-screens.md`.

## Câu hỏi đang chờ người dùng
- (không)

## Bị chặn
- (không)
