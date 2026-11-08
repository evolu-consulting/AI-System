---
id: cr113-approve-rules
lát: cr113-approve-rules
cr: CR-113
làn: đầy đủ (chạm hành vi run duyệt)
migration: không
phụ thuộc:
---
## Plan (ngắn)
Người dùng 2026-11-03 ("làm theo recommend"): (1) chủ gói (Toàn quyền, `also_group_ids`) GIỮ quyền quyết mọi bước nhưng ghi rõ
"duyệt thay"; (2) bước duyệt có hạn mà không đặt nhóm chuyển cấp ⇒ quá hạn tự chuyển cấp về Toàn quyền. Hai luật hiện trên
`GET /pack/contracts/approval-flow` và thẻ duyệt (UI: lát song song `cr113-approve-ui`).

## Làm
- `domain/approval-owner.rules.ts` (mới): `escalateOrder` (Group vai owner `contracts-owner` trước, rồi Group cấp 2),
  `defaultEscalateOf`, `decidedAsOf`, `OVERRIDE_EVENT = "approval_override"`.
- `compileDef(..., owners, escalateTo)`: bước review có `due_h` > 0, `escalate_group_id` null ⇒ `after.escalate = {after_h: due_h,
  group_id: Toàn quyền đầu tiên ≠ Group gắn task}`; đặt tường minh thắng; không `escalateTo` (thư viện `compileSlotStages`) ⇒ như cũ.
  `compiled()` truyền `escalateTo` ⇒ def tenant đổi `source_ref` ⇒ lượt MỚI nhận luật; run đang chạy giữ snapshot.
- Engine `stepsView` (chỉ đọc): `task.override` = người xem quyết được CHỈ nhờ `also_group_ids` (không grant, không Group duyệt/cửa
  trưởng phòng/người cụ thể, không Group chuyển cấp); `task_ref` = id task gần nhất của stage.
- `engineAct`: quyết xong (pass/fail/reject) với `override` ⇒ `contract_events` `approval_override` {run_id = lượt, engine_run_id,
  task_id, stage, action} (sau khi engine nhận; lỗi ghi chỉ log). `state()` đọc thêm danh sách task "duyệt thay" của lượt (1 subquery).
- Thẻ (`ApprovalCardStep`): `decided_as: "member" | "owner_override"` (bước đã quyết), `overdue` (bước mở, giờ server),
  `escalated_to` (tên Group khi đã chuyển cấp; gọi `groups.list` chỉ khi có bước đã chuyển cấp).
- `GET /approval-flow`: mỗi bước review `escalate_default` (+ `escalate_group_name` = Toàn quyền khi mặc định); top-level
  `owner_can_override: true`, `owner_group_name`.

## Không làm / Chạm
Không migration, không đổi máy trạng thái engine (escalation CR-085 có sẵn), không đổi quyền (`canAct` giữ nguyên). Bước Ký số
(esign-sweep) không đổi.

## Test tối thiểu
- unit `domain/approval-owner.rules.test.ts`; int `adapters/approval-flow-current.int.test.ts` (GET);
  int `tests/acceptance/CF/owner-override.int.test.ts` (duyệt thay / member, chuyển cấp bằng `escalate_at` quá khứ + `remindOnce`).

## Quyết định trong lúc làm
- "Duyệt thay" ghi ở `contract_events` của gói (không thêm cột engine): bền với đổi thành viên Group sau này; thẻ khớp theo task id.
- Quyết qua Group chuyển cấp (kể cả chuyển cấp mặc định về Toàn quyền) = `member` (đích chuyển cấp hợp lệ của bước), thẻ hiện `escalated_to`.
- Đích mặc định ưu tiên Group vai owner (`contracts-owner`), rồi Group cấp 2; trùng Group của bước ⇒ lấy Group kế; hết ⇒ không chuyển cấp.
- File test mới dưới `tests/acceptance/CF/` ⇒ qc cần relock (`test:lock:write`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Chủ gói duyệt thay được mọi bước, ghi rõ "duyệt thay"
Thành viên Group Toàn quyền quyết được mọi bước duyệt engine; khi không phải người của bước (Group duyệt / trưởng phòng / người
cụ thể / Group chuyển cấp) thì lần quyết được ghi `approval_override` và thẻ hiện `decided_as = owner_override`.
- Kịch bản: khi Toàn quyền ngoài Group cấp 1 Đạt bước 1 thì ghi duyệt thay và thẻ hiện owner_override; người của bước Đạt thì member [test: tests/acceptance/CF/owner-override.int.test.ts » H (Toàn quyền, ngoài Group cấp 1) Đạt ⇒ owner_override được ghi, B (người của bước) Đạt ⇒ member]
- Kịch bản: khi task đã ghi duyệt thay thì decided_as = owner_override, còn lại member [test: apps/hub-api/src/modules/packs/contracts/domain/approval-owner.rules.test.ts » task đã ghi duyệt thay ⇒ owner_override, còn lại member, chưa quyết ⇒ vắng]
#### Yêu cầu: Quá hạn mặc định chuyển cấp về Toàn quyền
Bước duyệt có hạn (`due_h`) không đặt nhóm chuyển cấp ⇒ quá hạn chuyển cấp về Group Toàn quyền; đặt tường minh thắng; bước không
hạn không chuyển cấp; lượt đang chạy giữ snapshot.
- Kịch bản: khi biên dịch bước có hạn không đặt nhóm thì escalate về Group owner [test: apps/hub-api/src/modules/packs/contracts/domain/approval-owner.rules.test.ts » bước có hạn, không đặt nhóm chuyển cấp ⇒ escalate về Group owner sau due_h]
- Kịch bản: khi đặt nhóm chuyển cấp tường minh thì giữ nhóm đó [test: apps/hub-api/src/modules/packs/contracts/domain/approval-owner.rules.test.ts » đặt tường minh vẫn thắng]
- Kịch bản: khi bước không hạn thì không chuyển cấp [test: apps/hub-api/src/modules/packs/contracts/domain/approval-owner.rules.test.ts » bước không hạn (due_h vắng/0) ⇒ không chuyển cấp]
- Kịch bản: khi task quá hạn và vòng nhắc chạy thì chuyển cấp tới Toàn quyền, thẻ overdue + escalated_to [test: tests/acceptance/CF/owner-override.int.test.ts » bước có hạn không đặt nhóm ⇒ quá hạn chuyển cấp về Toàn quyền (đồng hồ giả, không ngủ)]
#### Yêu cầu: Cài đặt › Quy trình duyệt hiện hai luật
`GET /pack/contracts/approval-flow` trả `owner_can_override`, `owner_group_name` và mỗi bước review `escalate_default`.
- Kịch bản: khi bước có hạn không đặt nhóm thì escalate_default=true và tên nhóm = Toàn quyền [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts]

## Việc còn lại
- qc relock cho file mới `tests/acceptance/CF/owner-override.int.test.ts`.
- UI (lát `cr113-approve-ui`) đọc các trường trên.
