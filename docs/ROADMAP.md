# ROADMAP

Trạng thái: **đề xuất** (chưa qua Gate). Phạm vi FR theo `design/admin/ba-admin.md` v0.4. Mặc định lấy từ `readiness/2026-10-01-admin-m1-m4.md`.

| Mốc | Nội dung | FR / NFR | Điều kiện xong | Trạng thái |
|---|---|---|---|---|
| **M0 Bootstrap** | Bun + Turborepo monorepo; Biome, lefthook, check:size, dependency-cruiser; Docker Compose (Postgres, Redis, Mailpit); mock Dify/Hub; migration `hub-stub`; CI; script `trace`, `test:lock:verify`; ADR-0001 | NFR-06 | `bun install && bun run check && docker compose up` chạy sạch | Code xong, đang review (2026-10-01). ADM-NFR-06: M0 chỉ phủ migration, seed để M1 |
| **M1 Nền tảng & danh tính** | DB schema admin + RLS + seed (tenant `platform`, feature `core`, platform_admin); Auth (mã công ty, JWT, refresh xoay vòng, khoá tạm, đổi mật khẩu); Tenants; Users; App shell web + i18n | ADM-FR-01–07, 60, 61, 63, 04, 05; BR-05, 08, 09; NFR-01, 07 | AC-A01, A02, A09 xanh | **Xong (2026-10-01)**, spec `M1-foundation-identity` done. Số liệu: bun test 462, test:int 266, e2e 38/38, `check:size --all` 295 file, depcruise 0 vi phạm, lock 39, trace 172, bundle JS 106,9 KB / CSS 13,5 KB gzip. Review 2 vòng (vòng 2: 1 Major N1 deadlock, đã sửa, điều phối xác minh bằng lệnh). Nợ: TECH-DEBT #8–#13 |
| **M2 Catalog & command** | Secrets; Workflows (catalog, Chưa gắn, mô tả bắt buộc); Commands (không có nút Test); Features + entitlement | ADM-FR-10–15, 20–22, 24, 30, 31, 33, 34, 50; BR-01, 02, 04, 06, 10, 13, 14 | AC-A03 (phía Admin), A05, A06, A13 xanh | Đã tách spec `M2-catalog-command` (draft, 2026-10-01); kế tiếp plan BE ∥ FE → test-plan → readiness. FR-12 (COULD) và FR-24 phần group/grant chưa làm ở M2 (xem spec §9) |
| **M3 Phân quyền** | Groups + thành viên; Grants + ma trận; Kiểm tra quyền (phần feature/command); NOTIFY `config_changed`; chống ghi đè `version` | ADM-FR-32, 35, 36, 53, 55, 62; BR-11, 12 | AC-A07, A10, A11 (phía Admin) xanh | Chưa làm |
| **M4 Chi phí & vận hành** | Quota + cảnh báo (email, banner); màn Chi phí & quota (đọc `hub.usage_logs` stub); Audit + khôi phục; Tổng quan; **Import/Export; 2FA** (cần artboard trước Gate M4) | ADM-FR-40–42, 51, 52, 54, 08 | AC-A12 (phía Admin) xanh | Chưa làm |
| **M5 Cần Hub** | Nút Test command (FR-23), cấp agent cho group (FR-37), Kiểm tra quyền phần agent | ADM-FR-23, 37 | Khi có Hub | Chờ Hub |
