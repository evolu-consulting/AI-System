---
id: fix-migrate-guard
lát: fix-migrate-guard
cr:
làn: nhanh
migration: không (chỉ đổi `when` journal của hub 0064_ops_watch)
phụ thuộc:
---
## Plan (ngắn)
Sự cố deploy 3f5e6b8c (2026-10-30): prod đã có `0064_agent_hooks` (nhánh ngoài platform/gd0, when 1798900000000) ⇒ Drizzle
(chỉ so `created_at` dòng cuối) bỏ qua `0064_ops_watch` cùng `when` IM LẶNG, 0066 lỗi, cả lô rollback; deploy.ps1 vẫn báo xong.

## Làm
- [x] Journal hub: `0064_ops_watch` when 1798900000000 → 1798950000000.
- [x] `packages/db/src/migrate-guard.ts`: `assertMigrationsInSync` gọi trước mọi `migrate()` (main/dev/hub/hub-dev/packs-kit/từng gói):
  lỗi khi DB có hash không thuộc journal, hoặc entry `when` ≤ mốc cuối DB mà chưa áp. `ACCEPTED_EDITS` cho file đã sửa sau khi áp
  (hub 0048, hash prod 7aeecbb7…).
- [x] deploy.ps1: `Assert-Exit` sau mọi lệnh native; build lỗi ⇒ dừng (log `build.log`); `set -eo pipefail`; VERSION ghi SAU setup.sh;
  từ chối khi commit trong VERSION không là tổ tiên của `-Ref` (`-Force` ⇒ cảnh báo, vẫn deploy).

## Không làm / Chạm
- Không thêm migration agent_hooks (lát khôi phục agent-hooks làm: tag `0064_agent_hooks`, when 1798900000000, byte y hệt file trong
  container hub-api prod ⇒ hash 04feab4f… khớp dòng 63). Trước khi lát đó merge, `db:migrate` trên prod sẽ FAIL (đúng ý: chặn mất tính năng).
- Không ghi gì lên prod.

## Test tối thiểu
- unit `packages/db/src/migrate-guard.test.ts` (journalDrift + `when` tăng ngặt mọi thư mục migration).
- int `packages/db/src/migrate-guard.int.test.ts` (dòng lạ cùng `when` ⇒ runHubMigrations ném; đường thường 0 migration).

## Quyết định trong lúc làm
- So theo hash (đúng cách Drizzle tính) + danh sách `ACCEPTED_EDITS` thay vì so `created_at`: so `created_at` không phân biệt được
  "file sửa sau khi áp" với "hai migration trùng `when`" (chính sự cố này). Đã đối chiếu 174 dòng theo dõi của prod: chỉ hub 0048 (sửa
  idempotent 6a0d535d) và dòng 63 (agent_hooks) lệch.
- Hạn chế kiểm tổ tiên: VERSION hiện trên prod ghi 3f5e6b8c dù container chạy bản cũ (deploy.ps1 cũ ghi trước build/migrate).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chặn lỗi migration/deploy)

## Việc còn lại
- Lát agent-hooks: thêm `0064_agent_hooks` (idx 62, when 1798900000000, SQL byte y hệt), đẩy idx 0064_ops_watch/0065/0066 lên 1.
- DB dev local đã áp 0066 sẽ báo thiếu `0064_agent_hooks` khi lát đó merge ⇒ áp tay hoặc reset DB dev.
