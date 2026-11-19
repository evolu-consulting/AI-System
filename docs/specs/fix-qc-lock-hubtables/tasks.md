---
id: fix-qc-lock-hubtables
lát: fix-qc-lock-hubtables
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
- Khoá lại `tests/.lock` sau CR-190 (2 e2e đổi theo UI danh bạ nhóm, xem `docs/specs/cr190-msg-list-ui/tasks.md`).
- Thêm `process_role_assignments` (hub 0159, CR-182) vào `HUB_TABLES` của `packages/db/src/migrate-hub.int.test.ts`.

## Làm
- `tests/.lock` ghi lại (1619 file), `test:lock:verify` OK.
- `migrate-hub.int.test.ts`: thêm 1 dòng `process_role_assignments`.

## Không làm / Chạm
- Không sửa code sản phẩm, không sửa migration, không sửa 9 bảng nêu ở «Việc còn lại».

## Test tối thiểu
- `packages/db/src/migrate-hub.int.test.ts` chạy trên evotest (`-Step int -Dirty`): 5 pass, 2 fail. Hai ca đỏ còn lại chỉ vì 9 bảng trong `HUB_TABLES` không có trong `information_schema` (xem «Việc còn lại»); `process_role_assignments` đã khớp.

## Quyết định trong lúc làm
- Không xoá 9 bảng khỏi `HUB_TABLES` để test xanh: chúng đã có trong danh sách từ trước, và migration của chúng có `CREATE TABLE IF NOT EXISTS`; xoá là giấu lỗi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: khoá test + danh sách bảng test; không đổi code sản phẩm).

## Việc còn lại
- qc/backend: 9 bảng `team_runs, tenant_agent_defaults, tenant_flow_settings, tool_confirmations, usage_daily, usage_daily_dim, usage_logs, user_signatures, workflow_flags` có `CREATE TABLE` trong `packages/db/migrations-hub/` nhưng không xuất hiện trong `information_schema.tables` của DB dựng sau migration (evotest, 2026-11-20). Nghi ngờ: test kết nối bằng role không có quyền trên các bảng này (information_schema chỉ liệt kê bảng có quyền), hoặc migration không chạy. Cần kiểm bằng `pg_tables` rồi quyết: đổi truy vấn trong test, hay sửa migration.
- Lát `cr190-msg-list-ui`: `e2e/cr161/ket-noi-cong-ty.spec.ts`, `e2e/cr169/tin-nhan-cong-ty.spec.ts` (dòng dùng `tab-partner`), `e2e/smoke-journey/smoke-journey.smoke.ts` vẫn dùng tab đã gỡ (đã ghi trong Delta CR-190).
