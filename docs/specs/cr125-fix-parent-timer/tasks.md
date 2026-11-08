---
id: cr125-fix-parent-timer
lát: cr125-fix-parent-timer
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hai lỗi từ lượt e2e cuối CR-125: (1) lượt cha «Quy trình mua hàng» (phiếu → 3 Quy trình con → Kết thúc) đứng `waiting_timer` sau Phần 3;
(2) lưu flow có bước «cùng duyệt» (`after.parallel`, `group_id: null`) bị 422 `PROCESS_DEF_INCOMPLETE stages.N.after.group_id`.

## Làm
- (2) `defs/def-group-keys.rules.ts` `reviewHasGroup`: bước có `after.parallel.groups` (mỗi nhóm có `group_id` hoặc `group_key`) ⇒ đủ Group.
- (1) int tái hiện: cha 3 Quy trình con nối tiếp, con xong lần lượt bằng vòng hẹn giờ thật (`fireTimer` + trigger 0129) ⇒ cha `done`.

## Không làm / Chạm
- Không đổi hẹn canh 10 phút, không sửa 0129, không migration mới (chưa có lỗi SQL được chứng minh).

## Test tối thiểu
- unit `def-group-keys.rules.test.ts`; int `subprocess.int.test.ts`, `library-flow-publish.int.test.ts` (evotest -Dirty: 23 pass).

## Quyết định trong lúc làm
- (1) int 3 con nối tiếp XANH ngay trên code hiện tại ⇒ đường engine (launch → trigger 0129 → `finishWait` → bước kế → Kết thúc) đúng khi
  con kết thúc bằng hẹn giờ; không sửa engine khi chưa tái hiện được (timebox 0d.11c).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/duyet-cung-luc.md
#### Yêu cầu: Lưu bước cùng duyệt không cần Group của bước
Bước Duyệt có `after.parallel.groups` (mỗi nhóm có `group_id` hoặc `group_key`) được coi là đã có Group duyệt; `after.group_id` của bước để `null` không còn bị 422 `PROCESS_DEF_INCOMPLETE`.
- Kịch bản: khi bước cùng duyệt có nhóm (id hoặc mã) và `group_id: null` thì đủ Group; một nhóm thiếu cả id lẫn mã thì INCOMPLETE [test: apps/hub-api/src/modules/processes/defs/def-group-keys.rules.test.ts » cr125-fix-parent-timer · bước cùng duyệt (`after.parallel`) có nhóm ⇒ đủ Group dù `group_id: null`, thiếu nhóm ⇒ INCOMPLETE]
- Kịch bản: khi tạo flow Thư viện bật có bước cùng duyệt theo mã nhóm thì 201 [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » CR-125 · flow Thư viện có bước cùng duyệt (`after.parallel`, group_id null) ⇒ 201 bật]

### MODIFIED sht/quy-trinh-con.md
#### Yêu cầu: Lượt cha nhiều Quy trình con nối tiếp chạy tới Kết thúc
Lượt cha có nhiều bước Quy trình con nối tiếp: mỗi lượt con kết thúc ⇒ bước cha tương ứng chốt, bước kế chạy; con cuối xong ⇒ lượt cha tới Kết thúc và `done`, không còn hẹn mở.
- Kịch bản: khi cha có 3 Quy trình con và các con xong lần lượt thì cha `done` [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » cr125-fix-parent-timer · cha 3 Quy trình con nối tiếp, con xong lần lượt (đường hẹn giờ thật) ⇒ cha tới Kết thúc, lượt `done`]

## Việc còn lại
- (1) CHƯA tái hiện được lỗi e2e: int 3 con nối tiếp xanh (con kết thúc qua vòng hẹn giờ, `fireTimer` từng hàng). Còn khác e2e: con kết thúc
  bằng Duyệt của người (tx user, launcher kick Kết thúc), vòng hẹn giờ chạy theo lô (`fireBatch`/`kickMany`). Bước kế: lấy DB stack e2e khi
  lỗi xảy ra — `process_timers` của stage Phần 3 (fired_at/cancelled_at/due_at), log `process-timer-fire-failed`, trạng thái lượt con Phần 3 —
  rồi mở rộng int sang `fireDueTimers` (lô) + Duyệt thật.
