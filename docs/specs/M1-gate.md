# Gate M1 — Nền tảng & danh tính

Ngày: 2026-10-01 · Trạng thái: **ĐÃ DUYỆT 2026-10-01** · Readiness: READY (`M1-foundation-identity/readiness.md`, 4 lần)

**Tự duyệt theo Luật 2b**: spec-readiness lần 4 READY (không Chặn, không Cao); mọi mục Cao (b) đã được người dùng chấp nhận trực tiếp tại câu hỏi Gate 2026-10-01 (4 câu, xem `readiness.md` mục "Gate 2026-10-01"); ADR-0004 (thư viện mới) đã được người dùng duyệt trong cùng lượt hỏi. Không còn câu hỏi mới, không hard stop.

## 1. Phạm vi
DB schema `admin` (tenants, users, refresh_tokens, features) + RLS qua role `admin_api` + seed (tenant `platform`, feature `core`, platform_admin). Auth: mã công ty, JWT EdDSA, refresh xoay vòng (ân hạn 10 s), khoá tạm, đổi mật khẩu. Tenants (không Xoá), Users. App shell web + i18n VI/EN. FR: ADM-FR-01–07, 60, 61, 63; BR-05, 08, 09; NFR-01, 06, 07. AC: AC-A01, A02, A09, M1-AC01…08.

## 2. Quyết định người dùng (2026-10-01)
1. Luật bảo mật đăng nhập/mật khẩu (R01, R03, R04, R06, R17, R20, khoá tạm khi sai mật khẩu hiện tại, role ở Hub ≤ 15', ân hạn 10 s) — chấp nhận (CR-009, CR-010).
2. Cách ly tenant bằng role `admin_api` + 2 hàm SECURITY DEFINER — chấp nhận.
3. Không Xoá tenant v1; key/username bất biến; BR-08 đếm cả tenant khoá — chấp nhận (CR-006, CR-007).
4. `VERSION_CONFLICT` `details:{current, updated_at}` (CR-008); ADR-0004 Accepted.

## 3. Áp sau READY (mặc định Thấp của readiness lần 4, không đổi hành vi)
tasks.md: T2 chạy thêm M0 `migrate.int` + kiểm migration bằng `git diff --quiet`/`ls-files`; T3 chạy `ci-workflow.test`; FE1b stub route tenants/users; E4 `m1-flow` → FE6. Còn lại (#5 `.env.local`, #6 `jose` gốc, #7 sửa M0 migrate 4 chỗ + bỏ ca logo smoke) áp trong BUILD, ghi "Quyết định trong lúc làm".

## 4. Thứ tự BUILD
T1 (contract) → Q2 (qc viết test, đỏ) → Q3 (khoá) → T2…T7 ∥ FE0…FE6 → T8 Lệnh xong M1 → reviewer (≤ 2 vòng) → D1 docs.
