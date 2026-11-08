---
id: tool-affected-modules
lát: tool-affected-modules
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`test:affected` chọn theo MODULE thay vì "migration/file gốc đổi ⇒ gần như mọi int + mọi e2e". Luật mới nằm ở hàm thuần
(`test-affected.scope.ts`, `test-affected.sql.ts`), có `--explain` (luật chọn từng test/việc e2e) và `--strict` (hành vi cũ).

## Làm
- Migration gói (`migrations-pack-<k>`) ⇒ test/mã của gói (`PACK_MODULES`) + migrate/RLS meta + e2e của gói.
- Migration hub/admin lõi CHỈ thêm (bảng/cột/chỉ mục mới, backfill DML) ⇒ test nhắc tên bảng (+ file schema Drizzle đổi theo tên bảng/export); đổi đối tượng sẵn có (ALTER khác ADD COLUMN, policy/hàm/view, DROP, khối DO, migration cũ bị sửa, thư mục lạ) ⇒ rộng như cũ.
- File gốc theo loại: package.json (deps ⇒ rộng; chỉ scripts ⇒ test của tools), bun.lock/bunfig/turbo ⇒ rộng, biome.json ⇒ mọi unit, tsconfig ⇒ typecheck tất cả, lefthook/docs/*.md ⇒ không chọn gì; loại lạ ⇒ rộng + ghi chú.
- Mã trong `apps/*/src/modules/<m>/` hoặc vùng gói ⇒ bao đóng ngược cắt tại file lắp ráp (app.ts, *.mount.ts) + test của chính module.
- e2e: file gói không kéo `combine` của hub-api; module Community chỉ kéo e2e community-web; gói có bảng e2e riêng.

## Không làm / Chạm
Không đổi cách dựng DB mẫu/hash migration (chỉ đổi cách CHỌN). Không chạy test suite.

## Test tối thiểu
Unit bảng cho luật (`test-affected.scope.test.ts`, `test-affected.test.ts`, `test-affected.jobs.test.ts`).

## Quyết định trong lúc làm
- Lõi dùng chung (auth, packages/contracts…) vẫn kéo rộng qua đồ thị: đúng bản chất phụ thuộc; chỉ `--strict`/đêm chạy đủ.
- Mã nguồn nhắc tên bảng không lan theo importer (barrel = mọi thứ), chỉ chọn test của module/gói đó + test nhắc bảng trực tiếp.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ hạ tầng test — cách CHỌN test của `test:affected` (theo module, `--explain`, `--strict`); không đổi mã sản phẩm, không đổi cách dựng DB mẫu; luật được khoá bằng unit `tools/scripts/src/test-affected.scope.test.ts`).

## Việc còn lại
Số đo trước → sau ghi trong báo cáo của lát. Cổng đợt (`test:all`) giữ nguyên.