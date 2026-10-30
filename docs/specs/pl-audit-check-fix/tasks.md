---
id: pl-audit-check-fix
lát: pl-audit-check-fix
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: pl-library-api (hub 0069)
---
## Plan (ngắn)
`hub-k1.int` "HUB-FR-131 · 0029 idempotent" đỏ từ 0069: 0069 mở rộng `hub_audit_log_action_check`, test chạy lại 0029 (reset CHECK)
nhưng chuỗi chạy lại chưa có 0069 ⇒ ảnh chụp khác. Sửa như 0036/0037 đã làm: thêm `0069_process_library_seed.sql` vào chuỗi chạy lại.

## Làm
- `packages/db/src/hub-k1.int.test.ts`: chuỗi 0029 → 0030 → 0036 → 0037 → 0069 (test không nới; so ảnh chụp như cũ).

## Quyết định trong lúc làm
- 2026-10-31 không đổi 0069 (guard `LIKE '%set_default%'` + `ON CONFLICT DO NOTHING` đã idempotent); lỗi là chuỗi chạy lại của test thiếu file.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa test idempotent migration CR-105)

## Việc còn lại
- Migration sau này mở rộng `hub_audit_log_action_check` phải thêm vào chuỗi chạy lại của test này.
