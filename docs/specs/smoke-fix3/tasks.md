# smoke-fix3 — CR-159 (bài kiểm hành trình: S8 chờ tệp bằng chứng lên xong rồi mới Duyệt; S18 chọn chip công ty A phía B)

## Plan
S8: chờ POST /attachments xong trước khi bấm Duyệt của ô bằng chứng (CR-170/173). S18: phía B chọn chip công ty A trong «Tin nhắn» (CR-172 mặc định lọc công ty mình).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ kiểm môi trường)

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | S8 chờ tệp lên xong | e2e/smoke-journey/smoke-journey.smoke.ts | [x] |
| 2 | S18 chip công ty A phía B | e2e/smoke-journey/smoke-journey.smoke.ts | [x] |
