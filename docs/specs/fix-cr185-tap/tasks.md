---
id: fix-cr185-tap
lát: fix-cr185-tap
cr: CR-185
làn: nhanh
migration: không
phụ thuộc: cr185-avatar
---
## Plan (ngắn)
Chạm avatar người ký (390px) không hiện họ tên. Gốc: `touchmove` bất kỳ (ngón rung) bị coi là cuộn ⇒ bỏ cú chạm; lệnh đóng của Radix (pointerleave/click) chen vào. Sửa trong `TouchTip`.

## Làm
- [x] Ngưỡng cuộn 10px; mở bằng chạm thì bỏ mọi lệnh đóng của Radix tới hết 2,5 s; dọn timer khi unmount
- [x] Phụ trách trên điện thoại (popover tên + «Đổi người phụ trách») giữ nguyên

## Không làm / Chạm
Không đổi PersonAvatar/SignersStrip (đã `interactive` đúng).

## Test tối thiểu
`touch-tip.test.ts`; `tsc`, `check:ui-kit`.

## Quyết định trong lúc làm
- Chưa tái hiện được trên máy cảm ứng thật; nguyên nhân là suy từ chuỗi sự kiện, cần người thử lại ở 390px.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/person-avatar-cham.md
#### Yêu cầu: Chạm avatar hiện họ tên
Trên điện thoại, chạm một cái vào avatar người (kể cả khi ngón rung nhẹ) hiện họ tên trong 2,5 s; kéo xa hơn 10px là cuộn, không hiện.
- Kịch bản: khi ngón tay lệch dưới 10px thì vẫn là chạm, trên 10px là cuộn [test: packages/web-kit/src/ui/kit/touch-tip.test.ts » ngón tay rung vài px vẫn là chạm, kéo xa là cuộn]

## Việc còn lại
qc: thêm e2e chạm avatar người ký ở 390px (hasTouch) ⇒ thấy tooltip họ tên.
