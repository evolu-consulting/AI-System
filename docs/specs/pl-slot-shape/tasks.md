---
id: pl-slot-shape
lát: pl-slot-shape
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Phần thuần của L2b: `fromStages` (nghịch `compileDef`), kiểm dạng tuần tự (`SLOT_SHAPE_UNSUPPORTED`), `previewPath`.

## Làm
- `approval-flow-stages.rules.ts` (+ test), `compileDef` ghi thêm `stage.slot` (bước nguyên vẹn) và `finalize.slot.esign`.

## Không làm / Chạm
- Không route preview HTTP, `is_test`, lọc danh sách lượt, migration (chờ L1) — xem "Việc còn lại".

## Test tối thiểu
- `bun test apps/hub-api/src/modules/packs/contracts/domain/approval-flow-stages.rules.test.ts` (+ `approval-flow.rules.test.ts` giữ xanh).

## Quyết định trong lúc làm
- 2026-10-31 `compileDef` mất `key/when/due_h/esign` nên không nghịch được ⇒ điều phối chốt mở rộng cộng thêm: mỗi stage người dùng có `slot` = bước, `finalize.slot.esign` = bước Ký số; engine không đổi (route/branch giữ nguyên).
- Schema stage engine (`packages/contracts/src/hub-admin/processes.ts`) thêm đúng một trường tuỳ chọn `slot: record` (engine bỏ qua); L1 sẽ sửa cùng file cho `*_key` ⇒ giữ diff tối thiểu.
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: hàm thuần mới chưa nối vào route nào; trường `slot` của stage engine bỏ qua)

## Việc còn lại
- `POST /process-defs/:id/preview` (`processes/library/preview.routes.ts`), `is_test` khi start từ mẫu, lọc danh sách lượt — chờ L1.
