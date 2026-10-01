# Gate M3 — Phân quyền (Groups, Grants, NOTIFY, chống ghi đè)

Ngày: 2026-10-02 · Trạng thái: **ĐÃ DUYỆT 2026-10-02** · Readiness: READY (`M3-permissions/readiness.md`, 3 lần)

**Tự duyệt theo Luật 2b**: spec-readiness lần 3 READY (không Chặn, không Cao); 4 câu mới (A2, A4, A6, A11) đã được người dùng chấp nhận trực tiếp tại câu hỏi Gate 2026-10-02 (CR-015…017); các mặc định kỹ thuật còn lại do backend-lead xác nhận; không thêm thư viện/dịch vụ (không ADR); không secret thật; không hard stop.

## 1. Phạm vi
Groups + thành viên (dán ≤ 500, `dry_run`, `beta-testers` bảo vệ), Grants (group; user chỉ API) + ma trận + batch ≤ 200, Kiểm tra quyền (`computeEffectiveAccess`, `effective-access`), `config_meta` + NOTIFY `config_changed` sau commit cho mọi ghi cấu hình M1–M3, `ConflictDialog` (FR-55) cho 6 thực thể, FR-24 phần group, DB test riêng mỗi agent, `check:fn`. FR: ADM-FR-24, 32, 35, 36, 53, 55, 62; BR-11, 12. AC: A07, A10, A11 (phía Admin), A03 vế 2 (CR-015), M3-AC01…10.

## 2. Quyết định người dùng (2026-10-02)
A2 → CR-015 · A4 → CR-016 · A6 + A11 → CR-017 — chấp nhận.

## 3. Áp trong BUILD (Thấp readiness lần 3)
(1) nguồn tên file = test-plan §8.1/tasks.md (D1 sửa plan §10) · (2) gán key i18n theo tiền tố (`conflict.*`→FE0; `groups.*`,`nav.groups`→FE2d; `access.*`,`users.access.*`,`commands.access.*`,`nav.access`→FE4c) · (3) FE3a hiện đủ 2 nút tab · (4) P11 dựng `Db` bằng `Object.assign(createDb(…), {notify})` · (5) bảng tóm tắt readiness.

## 4. Thứ tự BUILD
T0 (`check:fn`, `db:test:create`) → T1 → Q2 → Q3 → T2…T7 ∥ FE0…FE5 → T8 Lệnh xong M3 → reviewer (≤ 2 vòng) → D1. Mọi lệnh xong có `depcruise --all && check:fn --all`; commit theo đường dẫn; test int trên DB riêng.
