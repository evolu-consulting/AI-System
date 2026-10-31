---
id: pl-seed-sample
lát: pl-seed-sample
cr: CR-105
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Seed quy trình thư viện mẫu "QT thử" (`qt-thu`, khe `contracts.approval`) chỉ cho dev/test: "Quy trình HĐ mặc định" (hub 0069) + bước
"Kế toán duyệt" (nhóm theo mã `pb-ke-toan`). Release v1 đã xuất bản, không gán tenant, không làm mặc định khe.

## Làm
- `apps/hub-api/src/modules/seed/seed.library-sample.ts`: body = `defaultSlotBody()` + bước `accounting`; kiểm `validateSlotBody`, stages =
  `compileSlotStages` (đúng hàm gói contracts dùng cho `SlotSpec`); ghi def (id cố định) + release v1, `ON CONFLICT DO NOTHING`.
- `seed.ts` (`runHubSeed`): gọi `writeLibrarySample` khi `libSampleEnabled(appEnv, fixtures)`.
- Lệnh: `HUB_SEED_FIXTURES=1 bun run hub:seed` (APP_ENV development/test); `scripts/dev-up.ps1` và e2e `_pa-stack.ts` đã đặt cờ này.

## Không làm / Chạm
Không sửa migration 0068/0069, không UI, không gán tenant, không đụng `process_slots`. Chạm: thư mục `modules/seed` của hub-api.

## Test tối thiểu
`seed.library-sample.int.test.ts`: production hoặc tắt fixtures ⇒ không tạo; chạy 2 lần ⇒ 1 def + 1 release, 0 slot_assignments, 0 mặc định.

## Quyết định trong lúc làm
- Dùng cơ chế sẵn có `HUB_SEED_FIXTURES` (CR-081, opt-in dev) thay vì yaml/migration: `deploy/prod-sohoptac2/setup.sh` chạy `hub:seed` KHÔNG đặt cờ ⇒ prod không chạy; thêm chặn thứ hai `appEnv !== "production"` ở `libSampleEnabled` phòng ai đó bật cờ nhầm trên prod.
- Không qua `LibraryService` (cần user + registry khe chỉ có khi mount gói; CLI seed không mount) — gọi trực tiếp hàm thuần `validateSlotBody`/`compileSlotStages` để body hợp lệ như UI.
- Id cố định `0c105000-0000-4000-8000-000000000105` để idempotent (như 0069).
- Nhóm `pb-ke-toan` lấy từ seed demo (`deploy/tenants/demo.yaml`); tenant thiếu nhóm thì lúc gán mới báo `SLOT_GROUPS_MISSING` (hành vi sẵn có).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ dữ liệu seed dev/test, không đổi hành vi sản phẩm hay production)

## Việc còn lại
Gộp qua `slice:merge`.
