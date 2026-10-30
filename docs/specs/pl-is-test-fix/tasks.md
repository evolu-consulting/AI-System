---
id: pl-is-test-fix
lát: pl-is-test-fix
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: pl-slot-preview
---
## Plan (ngắn)
Sửa theo review: `is_test` không dựa vào key `flow-showcase`.

## Làm
- `StartDefRow.from_template` (bản sao của def `tenant_id NULL AND slot NULL` qua `source_template_id`) ⇒ `fromAdmin` đặt `isTest`.
- `run-is-test.int.test.ts` thêm ca: def tenant trùng key `flow-showcase` ⇒ không phải lượt thử.

## Không làm / Chạm
`runs.repo.ts`, `start.service.ts`, test. Không UI, không migration.

## Test tối thiểu
`run-is-test.int.test.ts`.

## Quyết định trong lúc làm
- Chạy def mẫu trực tiếp (`tenant_id NULL`) vốn 404 nên cờ dựa vào bản sao mẫu (`source_template_id`), không mở quyền chạy mẫu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa theo review CR-105)

## Việc còn lại
