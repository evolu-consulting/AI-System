---
id: cr125-fix-owner-override
lát: cr125-fix-owner-override
cr: CR-125
làn: đầy đủ (quyền)
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hồi quy CR-113: "Toàn quyền duyệt thay" chỉ có ở đường khe (compileDef gắn `also_group_ids`). Flow theo sự kiện (company_flows +
flow_triggers) không có ⇒ chủ app 403 NOT_REVIEWER. Sửa ở MỘT luật chung `@ai/contracts/flow` `ownerAlsoGroups`/`withOwnerOverride`:
compileDef dùng `ownerAlsoGroups`; mở lượt flow (`flow-launch.ts` → `StartService.createFromApi`) gắn Group `<app>-owner` CÙNG tenant
vào mọi stage duyệt của snapshot run. Mọi chỗ đọc (canAct gate, pack-runs-view `override`, inbox) đọc `also_group_ids` của snapshot
như cũ ⇒ thẻ ghi "duyệt thay" + `approval_override`.

## Làm
- `packages/contracts/src/flow/owner-override.ts` (+ test), `approval-flow.rules.ts` dùng luật chung.
- `processes/triggers/flow-launch.ts` (đọc Group `<app>-owner` của tenant), `runs/start.service.ts` (`flowEvent.ownerGroupIds`).
- Gỡ workaround tắt cờ flow_triggers cho evolu ở `e2e/pm-checklist/_pm-stack.ts`.

## Không làm / Chạm
DLC, UI (nhãn "duyệt thay" đã có sẵn từ CR-113), migration.

## Test tối thiểu
- unit `packages/contracts/src/flow/owner-override.test.ts`; int `flow-owner-override.int.test.ts` (đỏ khi tắt sửa, xanh khi có).
- int `flow-approve-act`, `tests/acceptance/CF/owner-act`, `approval-inbox`; e2e pm-checklist-pm, journey-approval.

## Quyết định trong lúc làm
- Flow theo sự kiện chỉ gắn Group vai owner của app (`<app>-owner`), không gắn Group cấp 2 của cài đặt HĐ (brief: "same app owner group only").
- Gắn lúc tạo run (snapshot bất biến) thay vì sửa def công ty ⇒ một nguồn: snapshot run; def/bản công ty không đổi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Toàn quyền duyệt thay trên flow theo sự kiện
Lượt duyệt HĐ mở từ flow theo sự kiện (company_flows + flow_triggers) có cùng luật "Toàn quyền duyệt thay" như đường khe: thành viên
Group chủ app (`contracts-owner`) cùng công ty quyết được mọi bước duyệt, thẻ ghi "duyệt thay" và có bản ghi `approval_override`;
người không thuộc Group bước, không Toàn quyền vẫn bị từ chối NOT_REVIEWER.
- Kịch bản: khi cờ flow_triggers bật, flow được gán, chủ app duyệt bước của Group Kế toán thì được (duyệt thay, có audit); người ngoài bị NOT_REVIEWER [test: apps/hub-api/src/modules/processes/triggers/flow-owner-override.int.test.ts » contracts-owner quyết bước của Group khác (duyệt thay, audit), người ngoài bị NOT_REVIEWER]
- Kịch bản: khi một stage duyệt đã có Group cũng quyết thì luật chung gộp thêm Group Toàn quyền, trừ chính Group gắn task [test: packages/contracts/src/flow/owner-override.test.ts » withOwnerOverride chỉ gắn stage review, gộp also sẵn có, không owner thì giữ nguyên]

## Việc còn lại
- Không.
