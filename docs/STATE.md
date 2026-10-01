# STATE — trạng thái hiện tại

Cập nhật: 2026-10-01 · Người cập nhật: điều phối (Claude)

## Đang ở đâu
- **M0 xong** (nhánh `feat/M0-bootstrap`, chưa merge/push): Lệnh xong M0 xanh (`bun test` 245, `test:int` 17, e2e 1, lock 12, trace 172). Reviewer vòng 2 **APPROVED** (15/15 mục vòng 1 đóng; Minor còn lại → TECH-DEBT #6).
- Thiết kế v0.4 xong (`design/`). Design Admin UI duyệt hướng (canvas, 18 artboard, nguồn trong `docs/design/canvas/`).
- Khung quy trình xong: `CLAUDE.md`, `WORKFLOW.md`, `CONVENTIONS.md`, 7 agent, hook nhắc readiness/intake, Luật 2b (đủ context thì chạy) (`.claude/settings.json`).
- Đã chốt 2026-10-01: bỏ "Còn N lần thử"; JWT EdDSA; chấp nhận mọi mặc định trong `readiness/2026-10-01-admin-m1-m4.md`; 2FA + Import/Export vào M4 khi có artboard.
- Git repo khởi tạo ở M0 (T0). Nhánh làm việc `feat/M0-bootstrap`.

## Việc kế tiếp (phiên mới: làm ngay, KHÔNG hỏi — Luật 2b)
1. **M1 Nền tảng & danh tính** — chưa bắt đầu (lần tách spec trước bị dừng giữa chừng, chưa có file). Làm trên nhánh hiện tại `feat/M0-bootstrap`, không merge `main`, không push.
   Vòng: docs-architect tạo `docs/specs/M1-foundation-identity/` từ `_template` (FR theo dòng M1 của ROADMAP) → backend-lead PLAN ∥ frontend-lead PLAN → qc test-plan → spec-readiness (lỗ hổng lấy mặc định từ `readiness/2026-10-01-admin-m1-m4.md`) → tự duyệt Gate (`M1-gate.md`) → qc viết + khoá test → BUILD BE ∥ FE → Lệnh xong M1 → reviewer (≤ 2 vòng) → docs-architect CODEMAP/TRACE/STATE → báo cáo cuối M1.
2. Canvas: đổi `#7A7390` → `#736C89` (FE-R1, AA) khi chạm lại canvas.
3. Merge `feat/M0-bootstrap` → `main`: chỉ khi người dùng yêu cầu.

## Độ phủ design (artboard)
18 artboard trong `docs/design/canvas/` (Login, Main, Sidebar, TenantOverview, TenantCreate, TenantQuota, Users, Groups, Access, Commands, Workflows, Secrets, Usage, Audit, ChangePassword, Enable2FA, ImportPreview, States). Màn chưa có artboard: xem `docs/specs/_design/admin-missing-screens.md`.

## Câu hỏi đang chờ người dùng
- (không)

## Bị chặn
- (không)
