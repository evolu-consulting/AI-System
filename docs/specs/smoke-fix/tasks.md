# smoke-fix — CR-159 (sửa bài kiểm hành trình theo UI mới + gỡ khoá đăng nhập tài khoản tạm)

## Plan
S7 theo luồng «Nhập tay» của CR-157 (chờ băng nhập tay trước khi tích «Tôi đã đối chiếu…»); S18 đi đường «Tin nhắn» › chip công ty › tìm người (nhân viên không Toàn quyền không thấy khối «Công ty đã kết nối»). `smoke-server.sh setup` gỡ khoá đăng nhập Redis (`rl:auth:a:`/`rl:auth:p:`) của đúng 6 tài khoản tạm smoke-a/smoke-b.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ kiểm môi trường)

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Gỡ khoá đăng nhập tài khoản tạm ở setup | `deploy/smoke/smoke-server.sh` | [x] |
| 2 | S7 / S18 theo UI hiện tại | `e2e/smoke-journey/smoke-journey.smoke.ts` | [x] |
