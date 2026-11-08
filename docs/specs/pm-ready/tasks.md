---
id: pm-ready
lát: pm-ready
cr: CR-112, CR-113
làn: nhanh (seed + tài liệu, không đổi hành vi)
migration: không
phụ thuộc:
---
## Plan (ngắn)
PM clone `platform/gd0`, chạy `bun run pm:setup` trên Windows và test CR-112/113 bằng dữ liệu seed, không dựng tay. Mở rộng fixture
`seed.tenant-fixtures` (commit 9a248727), không tạo seed song song.

## Làm
- `docs/PM-SETUP.md` (+ link ở `docs/INDEX.md`): cài đặt, URL, tài khoản, dữ liệu seed, checklist CR-112/113, reset, lỗi hay gặp.
- `package.json`: `pm:setup` (= `dev-up.ps1 -SeedDemo`), `pm:down`, `pm:reset`, `seed:cr113`.
- `seed.cr113-flow.ts` (gọi từ `writeTenantFixtures`): Group `pb-phap-che` (edgar, rowan) + def thư viện "Duyệt HĐ 2 cấp (mẫu CR-113)" đã
  xuất bản + gán cho `evolu` (bước 1 có `due_h` không đặt nhóm chuyển cấp ⇒ mặc định Toàn quyền; bước 2 chuyển cấp tường minh).
- `tools/scripts/src/seed-cr113-samples.ts` (gọi từ `dev-up.ps1` sau `demo-packs`): 3 HĐ `[CR-113]` qua đường thật của hub (lượt kẹt
  chưa có run → "Mở lại quy trình" → "duyệt thay" bằng chủ gói; HĐ 3: `escalate_at` lùi quá khứ, vòng nhắc 300 s của hub chuyển cấp).

## Không làm / Chạm
Không đổi hành vi, migration, engine, DLC (`tests/external-owned.json`, ngoài phạm vi), không tạo tenant/dữ liệu NitiGroup. Vai theo app
(CR-112) đã có do `enablePack` của `demo-packs` (9 vai evolu), không seed thêm.

## Test tối thiểu
- int `apps/hub-api/src/modules/seed/seed.cr113-flow.int.test.ts` (Group, def/release/gán, chủ gói tách khỏi người duyệt, chạy 2 lần).
- int `tests/acceptance/CF/pm-seed-cr113.int.test.ts` (3 HĐ: chờ / duyệt thay / quá hạn + chuyển cấp; chạy 2 lần y nguyên).

## Quyết định trong lúc làm
- Đường tạo HĐ: `POST /contracts/manual` bị 410 (CR-097) và AI trích không có ở máy dev ⇒ hàng HĐ + lượt `mode='engine'` kẹt chưa có
  run ghi bằng SQL (đúng trạng thái `markStalled`), engine mở run bằng `reopen` thật.
- HĐ quá hạn chuyển cấp bằng vòng nhắc nền của hub (không ép SQL `escalated_at`) ⇒ chờ tối đa 5 phút, ghi trong PM-SETUP.
- Người ghi def thư viện: platform admin, không có thì tenant_admin của evolu.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: seed + tài liệu)

## Việc còn lại
- qc relock cho file test mới `tests/acceptance/CF/pm-seed-cr113.int.test.ts` (`bun run test:lock:write`).
