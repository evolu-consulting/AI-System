---
id: cr113-fix
lát: cr113-fix
cr: CR-113
làn: đầy đủ (audit duyệt + migration chỉ cộng index)
migration: pack contracts 0071_override_once (when 1800300000000)
phụ thuộc: cr113-approve-rules (9dda1706), cr113-approve-ui (e8b24653)
---
## Plan (ngắn)
Sửa 6 điểm review cuối đợt CR-113 + test còn thiếu.

## Làm
1. [TB] Audit "duyệt thay" ghi WRITE-AHEAD trong tx gói TRƯỚC khi engine nhận quyết (`engineAct` → `noteOverride` → `recordOverride`);
   ghi lỗi ⇒ ném, không gọi engine (không còn quyết duyệt thay thiếu audit). Thẻ chỉ tính bản ghi của ĐÚNG người quyết task
   (`overrideKey(task, người)`) ⇒ bản ghi của người bấm thua đua không làm sai nhãn.
2. [TB] Nhãn: tách `overrideOnly` (processes `task-access.rules`) dùng ở `stepsView`.
3. [TB] Preview `GET /approval-flow` (`ownerView`, export): nhóm chuyển cấp tường minh trỏ Group đã xoá ⇒ `escalate_group_missing`
   (UI dòng cảnh báo `escalateMissing` vi/en), không hiện mặc định. Engine `ownerGroupIds` dùng CÙNG `escalateOrder` (owner trước,
   rồi cấp 2) cho `owners` lẫn `escalateTo` ⇒ Group gắn task của bước chỉ có người cụ thể xác định, preview khớp compileDef.
4. [Thấp] Migration 0071: unique index một phần `(tenant_id, run_id, task_id, actor_user_id) where type='approval_override'` + `on conflict do nothing`.
5. [Thấp] `approval_override` vào `CONTRACT_EVENT_TYPES`, lịch sử contracts-web (`KNOWN`) + nhãn vi/en; `eventDataOut` bỏ `task_id`,
   `engine_run_id` khỏi `data` trả ra (chi tiết HĐ, hoạt động).
6. [Thấp] Tên Group (`escalated_to`, `escalate_group_name`, `owner_group_name`) cắt an toàn ≤ 200 ký tự.

## Không làm / Chạm
Không đổi máy trạng thái engine, không đổi quyền (`canAct`). Không backfill dữ liệu.

## Test tối thiểu
unit: `domain/approval-owner.rules.test.ts`, `application/approval-flow-owner.test.ts`, `application/approval-engine-override.test.ts`,
`processes/domain/tasks/task-override.rules.test.ts`, contracts-web `current-flow.test.ts`; int: `tests/acceptance/CF/owner-override.int.test.ts`.

## Quyết định trong lúc làm
- QUYẾT ĐỊNH (điều phối 2026-11-03): owner quyết khi bước CHƯA chuyển cấp ⇒ `owner_override`; SAU khi bước đã chuyển cấp cho chính
  nhóm owner ⇒ `member` (thẻ đã có "Đã chuyển cho …" giải thích).
- Write-ahead thay vì cùng tx với engine (engine là tx hub riêng): ghi audit lỗi ⇒ không quyết; engine từ chối sau khi ghi (đua) ⇒
  bản ghi còn là "lần bấm duyệt thay" trong lịch sử (hiếm); thẻ không tính vì người quyết khác.
- Unique index thêm `actor_user_id` (khác đề xuất `(run_id, task_id)`): hai chủ gói cùng bấm một task — nếu chỉ theo task, bản ghi
  của người thắng có thể bị `do nothing` nuốt.
- Người duyệt ngoài cây đọc `a_ovr`: policy RESTRICTIVE `contract_events_visible` dựa vào thấy HĐ — người đọc thẻ đã thấy HĐ (CR-109)
  ⇒ thấy event; có test int chế độ org.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Duyệt thay được ghi trước khi quyết, không mất audit
Lần quyết của chủ gói ngoài người của bước được ghi `approval_override` TRƯỚC khi engine nhận; ghi lỗi thì không quyết; ghi lặp không nhân bản.
- Kịch bản: khi ghi duyệt thay lỗi thì không gọi engine [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-override.test.ts » recordOverride ném ⇒ lỗi lan ra, KHÔNG gọi engine (không quyết thiếu audit)]
- Kịch bản: khi Từ chối hoặc Trả lại bằng quyền Toàn quyền thì cũng ghi duyệt thay [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-override.test.ts » Từ chối / Trả lại cũng ghi duyệt thay (kèm hành động)]
- Kịch bản: khi người bấm thua đua có bản ghi thì thẻ vẫn ghi member cho người quyết thật [test: apps/hub-api/src/modules/packs/contracts/domain/approval-owner.rules.test.ts » task đã ghi duyệt thay ⇒ owner_override, còn lại member, chưa quyết ⇒ vắng]
#### Yêu cầu: Nhãn duyệt thay theo chuyển cấp
Owner quyết khi bước chưa chuyển cấp ⇒ duyệt thay; bước đã chuyển cấp cho nhóm owner ⇒ người của bước; owner thuộc Group bước ⇒ người của bước; bước head_only hoặc người cụ thể mà owner quyết ⇒ duyệt thay.
- Kịch bản: khi bước đã chuyển cấp cho nhóm owner thì owner quyết là member [test: apps/hub-api/src/modules/processes/domain/tasks/task-override.rules.test.ts » quyết định: bước ĐÃ chuyển cấp cho chính nhóm owner ⇒ owner là người của bước (member), chưa chuyển ⇒ duyệt thay]
- Kịch bản: khi bước head_only và owner không phải trưởng phòng thì duyệt thay [test: apps/hub-api/src/modules/processes/domain/tasks/task-override.rules.test.ts » bước head_only: owner thuộc phòng nhưng không phải trưởng ⇒ duyệt thay, trưởng phòng ⇒ không]
- Kịch bản: khi bước có người cụ thể mà owner quyết thì duyệt thay [test: apps/hub-api/src/modules/processes/domain/tasks/task-override.rules.test.ts » bước người cụ thể - task gắn Group Toàn quyền, cửa là người đó: owner quyết ⇒ duyệt thay, người cụ thể ⇒ không]
- Kịch bản: khi owner cũng thuộc Group bước thì member [test: tests/acceptance/CF/owner-override.int.test.ts » review · A (Toàn quyền CŨNG thuộc Group bước) Đạt ⇒ member, không ghi]
- Kịch bản: khi người duyệt ngoài cây đọc thẻ thì thấy owner_override, lịch sử không lộ id nội bộ [test: tests/acceptance/CF/owner-override.int.test.ts » review · chế độ org: T là người duyệt ngoài cây không sees_all, đọc thẻ thấy owner_override, lịch sử không lộ id nội bộ]
#### Yêu cầu: Preview chuyển cấp khớp biên dịch
Nhóm chuyển cấp tường minh đã xoá ⇒ Cài đặt › Quy trình duyệt báo lỗi cấu hình; bước chỉ có người cụ thể dùng cùng thứ tự Toàn quyền như biên dịch.
- Kịch bản: khi nhóm chuyển cấp tường minh đã xoá thì báo lỗi cấu hình [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-owner.test.ts » (a) escalate_group_key trỏ Group đã xoá ⇒ escalate_group_missing, không rơi về mặc định Toàn quyền]
- Kịch bản: khi bước chỉ có người cụ thể thì preview bằng compileDef [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-owner.test.ts » (b) bước chỉ có người cụ thể: thứ tự xác định (Map đảo vẫn vậy) ⇒ preview = compileDef]

## Việc còn lại
- qc relock `tests/acceptance/CF/owner-override.int.test.ts` nếu `test:lock:write` chưa chạy trong lát.
