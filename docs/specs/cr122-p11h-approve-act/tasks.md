---
id: cr122-p11h-approve-act
lát: cr122-p11h-approve-act
cr: CR-122
làn: đầy đủ (máy trạng thái run — quyết bước)
migration: không
phụ thuộc: cr122-p11g-confirm-facts
---
## Plan (ngắn)
e2e G1.2: người duyệt Kế toán bấm Đạt ở "Duyệt giá trị lớn" (lượt flow) ⇒ bước vẫn `open` sau 15 s.

## Bằng chứng
- Trace `cr122-q1-e2e/.data/evotest/20261107-005731-6188-e2e` (G1.2, HĐ `01a1b204-8b82…`, ngữ cảnh người duyệt): GET thẻ ⇒ `mode engine`,
  bước `duyet-lon` open, `task_id ca077882…`, `can_act: true`; `POST …/tasks/ca077882…/actions/approve` ⇒ **404 `NOT_FOUND`** (không
  lỗi engine, không 409) ⇒ không quyết, trang không tải lại.
- 404 = `actApproval` trả `"not_found"` qua `submitOrNull` → `submitToFlow` (`packs/contracts/application/flow-submit.usecase.ts`, P11d):
  hàm này khoá HĐ (`state(id, {lock: true})`, `FOR UPDATE` KHÔNG cờ duyệt) TRƯỚC khi biết lượt đã ở engine. Người duyệt ngoài cây
  (chế độ thấy `org`, Kế toán không thấy HĐ của KD theo cây — CR-109) bị RLS ghi lọc mất HĐ khi khoá ⇒ null ⇒ "not_found".
  (Đường engine `decideInTx` khoá với cờ duyệt nên không dính.) Int mới tái hiện đúng: không sửa ⇒ `"not_found"`.

## Đã làm
- `submitToFlow`: đọc trước KHÔNG khoá; lượt không phải máy cũ `level1` ⇒ null ngay (đi đường engine); chỉ khoá khi đúng là nhân viên
  "Xác nhận và lưu" lượt máy cũ.

## Test
- `processes/triggers/flow-approve-act.int.test.ts`: chế độ thấy `org`, người duyệt chỉ đọc gói + thuộc phòng Kế toán; gửi duyệt ⇒
  `getApproval` (người duyệt) thấy bước mở + `can_act` ⇒ `actApproval` approve với task của thẻ ⇒ bước qua ⇒ node Kết thúc ⇒ HĐ
  `active`, lượt `done`. Đỏ trước sửa (`not_found`), xanh sau sửa; first-launch-contract / flow-branch-facts / not-launched xanh.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Người duyệt quyết bước Duyệt của lượt flow theo sự kiện
Người duyệt thuộc phòng của bước (kể cả không thấy hợp đồng theo cây tổ chức) bấm Đạt trên thẻ duyệt thì bước được duyệt, quy trình
chạy tiếp tới Kết thúc và hợp đồng được khoá Đã duyệt.
- Kịch bản: người duyệt ngoài cây bấm Đạt ⇒ bước qua, HĐ khoá [test: apps/hub-api/src/modules/processes/triggers/flow-approve-act.int.test.ts » getApproval ⇒ bước mở + task, act approve (người duyệt) ⇒ passed ⇒ Kết thúc ⇒ HĐ khoá]

## Việc còn lại
- [ ] Soát Opus low (máy trạng thái run).
