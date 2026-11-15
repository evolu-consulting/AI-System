# smoke-fix2 — CR-159 (bài kiểm hành trình: S7 chờ đúng dấu hiệu «đã gửi duyệt», chạy hết S8–S16)

## Plan
S7 sau «Gửi duyệt» chờ băng «Thông tin khoá trong lúc duyệt…» và bước «Trưởng phòng duyệt» được nạp (tải lại tới khi có), không đòi thấy trong khung nhìn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ kiểm môi trường)

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | S7 chờ theo trạng thái nạp, không theo khung nhìn | `e2e/smoke-journey/smoke-journey.smoke.ts` | [x] |
