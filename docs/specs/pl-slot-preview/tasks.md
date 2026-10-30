---
id: pl-slot-preview
lát: pl-slot-preview
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: L1, L2b-pure
---
## Plan (ngắn)
`POST /process-defs/:id/preview` (platform_admin, không ghi) + cờ `is_test` khi chạy mẫu showcase + lọc danh sách lượt.

## Làm
- `processes/library/preview.routes.ts` (mount 1 dòng sau vòng route ở `processes.mount.ts`); `SlotSpec.preview?` (engine không import gói), gói contracts gắn `previewPath`.
- `is_test` ghi ở `insertRun`; `GET /process-runs?include_test=true` (mặc định ẩn).

## Không làm / Chạm
Không CRUD/xuất bản/gán thư viện (L2a), không UI.

## Test tối thiểu
`library-preview.int.test.ts`, `run-is-test.int.test.ts`, `routes-mode.int.test.ts` (xanh).

## Quyết định trong lúc làm
- Mẫu chạy thử = def `flow-showcase` chạy qua `POST /process-defs/:id/run` (RunDialog/Showcase đều đi đường này; chạy def mẫu `tenant_id NULL` vốn 404) ⇒ `is_test = (key === FLOW_SHOWCASE_KEY)` ở `StartService.fromAdmin`; bản sao mẫu do tenant tự đặt tên thì không đánh dấu.
- Preview qua `SlotSpec.preview` (pack-boundary), khe chưa đăng ký/không có preview ⇒ 400.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-105)

Không thay đổi hành vi (lý do: Delta ở docs/specs/process-library/tasks.md)

## Việc còn lại
UI nút xem trước + tab "Mẫu · chạy thử" (L3).
