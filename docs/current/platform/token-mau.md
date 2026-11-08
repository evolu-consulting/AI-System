# token mau

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Một gói token màu cho mọi app (nguồn: cr125-g4-tokens)
Admin, workspace, chat và studio dùng chung một gói token màu (sáng + tối); màu chính là Indigo #4f46e5, app không tự khai lại token.
- Kịch bản: khi mở bất kỳ app nào ở bản sáng thì `--primary` là #4f46e5 [test: apps/workspace-web/src/styles/theme-parity.test.ts » gói token chung (CR-125 G4)]
- Kịch bản: khi một app chép token vào globals.css của mình thì kiểm tra parity báo đỏ [test: apps/workspace-web/src/styles/theme-parity.test.ts » 4 app dùng chung gói token]

