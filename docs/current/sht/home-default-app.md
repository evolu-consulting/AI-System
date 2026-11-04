# Web gộp · trang chủ theo default_app

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-fg-home). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Trang chủ web gộp theo default_app (nguồn: cr118-fg-home)
`/` và đích sau đăng nhập theo `home` của `/pack/me` (default_app của user, rồi của công ty, chỉ khi user mở được); không có hoặc không mở được thì SHT trước, rồi Community.
- Kịch bản: khi default_app là community và user mở được cả hai thì home là /community [test: apps/sohoptac-web/src/platform/auth/domain/login-machine.test.ts » home theo default_app của /pack/me: chỉ khi module đó mở được, không thì home cũ]
