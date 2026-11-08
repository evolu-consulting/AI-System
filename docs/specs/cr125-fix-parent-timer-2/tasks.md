---
id: cr125-fix-parent-timer-2
lát: cr125-fix-parent-timer-2
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-fix-parent-timer
---
## Plan (ngắn)
Lấy bằng chứng thật cho lỗi «lượt cha Quy trình mua hàng đứng `waiting_timer`»: e2e `cr125-purchase-full` khi hỏng in lượt cha + con,
stage, hẹn, đuôi log hub. Log hub-api của stack journey ghi ra `.data/ja-hub/hub.{out,err}`.

## Làm
- `e2e/journey-approval/_ja-stack.ts`: hub-api stdout/stderr ⇒ `.data/ja-hub/hub.out|err`.
- `e2e/journey-approval/cr125-purchase-full.spec.ts`: `afterEach` khi test 2 hỏng ⇒ `dumpParent()`; dừng sớm sau 20 vòng không ai có việc.

## Quyết định trong lúc làm
- Hai lượt evotest (HEAD 84e58d6b0 + chẩn đoán): cha dừng ở Phần 1, KHÔNG tới Phần 3. Dump: cha stage 1 `waiting_timer` + đúng MỘT hẹn canh
  `sub:<stage>:1:1:1` (due +10 phút, chưa bắn); lượt con Phần 1 `waiting_review`, stage 0 (bước điền) `waiting_review` có output — nhưng
  không ai trong 3 tài khoản thấy dòng ở «Chờ tôi duyệt» ⇒ không ai làm được. `cr125-form-step-card` đỏ cùng chỗ (thẻ bước 1 không hiện).
  ⇒ Phía engine của cha đúng (hẹn canh đúng, không trùng khoá); chỗ kẹt hiện tại là bước điền của lượt con không hiện cho người làm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ thêm chẩn đoán khi e2e hỏng và ghi log hub của stack test ra tệp).

## Việc còn lại
- Bước điền (form) đầu của lượt con Phần 1 ở `waiting_review` nhưng không vào «Chờ tôi duyệt» / thẻ bước 1 không hiện (đỏ cả
  `cr125-form-step-card`) — nghi hồi quy từ `cr125-request-steps` (61b40e07e) / `cr125-contract-from-step`; giao vùng contracts-web/requests.
- Lỗi gốc «cha đứng sau Phần 3» chưa tái hiện được (e2e không qua nổi Phần 1); chạy lại e2e có dump sau khi sửa mục trên.
