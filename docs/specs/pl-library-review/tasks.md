---
id: pl-library-review
lát: pl-library-review
cr: CR-105
làn: đầy đủ
migration: không
phụ thuộc: pl-library-api, pl-library-fix
---
## Plan (ngắn)
Sửa theo review cuối đợt CR-105 (vùng thư viện quy trình L2a).

## Làm
- CAO: `deploy/prod-sohoptac2/setup.sh` chạy `process-library-backfill` ngay sau migrate (`--dry-run` in báo cáo rồi chạy thật; `set -e` ⇒ lỗi dừng deploy).
- TB: def thư viện đặt `slot: null` ⇒ 422 `SLOT_BODY_INVALID {issues:[{path:"slot", rule:"SLOT_LOCKED"}]}` (không thành mẫu chạy thử mọi tenant đọc được).
- Thấp: `slot-assign.repo` truyền mảng qua MỘT tham số JSON (`jsonb_array_elements_text`), không ghép chuỗi literal.
- Thấp: backfill bỏ qua tenant đã gán khe (`reason: "assigned"`) ⇒ không tạo def/release mồ côi.

## Không làm / Chạm
Không chạy gì trên prod.

## Test tối thiểu
`library.routes.int` (+1: slot null ⇒ 422), `process-library-backfill.int` (+1: tenant đã gán khe không tạo def mồ côi).

## Quyết định trong lúc làm
- 2026-10-31 backfill là bước riêng ngay sau `migrate.ts` trong cùng `setup.sh` (không nhét vào `migrate.ts`: `packages/db` không phụ thuộc `apps/hub-api`); idempotent nên deploy lại vô hại.
- 2026-10-31 không thêm regex mã/uuid trong `validateSlotBody`: tham số đã qua bind JSON; mã Group đã kiểm `CATALOG_KEY_RE` ở schema stage.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa theo review CR-105)

## Việc còn lại
- Deploy kế tiếp (chờ người dùng): đọc báo cáo `--dry-run` trong log setup.sh.
