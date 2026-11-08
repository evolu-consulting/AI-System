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

- Sau rebase (e8b8aa844): int mới — bước điền đầu của lượt con nằm trong `/me/review-tasks` (`listTaskPage`) của thành viên nhóm ⇒ XANH
  (backend đúng). Ảnh lượt hỏng: nhân viên THẤY form bước 1 trên trang yêu cầu. Nguyên nhân kẹt ở Phần 1 = spec e2e: `actOnWaiting`
  đếm `requests-waiting-row` ngay sau `goto`, trước khi danh sách việc tải xong ⇒ 0 việc ⇒ không ai làm. Sửa: chờ `requests-waiting` hoặc
  `requests-waiting-empty` rồi mới đếm.
- Lượt e2e thứ 3 (sau sửa): test 2 hỏng ở bước đăng nhập (8,5 s, «Target page, context or browser has been closed») — lỗi hạ tầng trình
  duyệt, chưa tới Phần 1–3 ⇒ chưa có dump cho Phần 3.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ thêm chẩn đoán khi e2e hỏng và ghi log hub của stack test ra tệp).

## Việc còn lại
- Chạy lại job journey MỘT lần (lượt trước hỏng đăng nhập do trình duyệt đóng) để dump tới Phần 3; lỗi gốc «cha đứng sau Phần 3» chưa
  tái hiện được.
