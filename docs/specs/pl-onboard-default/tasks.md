---
id: pl-onboard-default
lát: pl-onboard-default
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: L2a pl-library-api (API gán); int test chờ L2a
---
## Plan (ngắn)
Yaml tenant thêm `approval_process: <key>` (tuỳ chọn). Sau `enablePack('contracts')` gán khe `contracts.approval` qua `ProcessAssignPort`
(adapter HTTP `adapters/hub-assign.adapter.ts`). Lỗi (không có, chưa xuất bản, thiếu Group, không có gói) ⇒ `approval.error`, tenant vẫn tạo.
Không có trường ⇒ không làm gì (tenant chạy mặc định).

## Quyết định trong lúc làm
- 2026-10-31: env `ADMIN_HUB_URL` + `ONBOARD_HUB_ACCESS_TOKEN` cho adapter — tạm; security review cuối đợt xét lại.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: Delta của lát nằm trong `docs/specs/process-library/tasks.md` mục "Gán quy trình khi onboarding tenant").

## Việc còn lại
- Bật int test `onboard-approval-process.int.test.ts` khi L2a merge; khớp shape list/assign với L2a.
