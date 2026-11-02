---
id: e2e-stack-server
lát: e2e-stack-server
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Job e2e `community-web-stack` luôn đỏ (ERR_CONNECTION_REFUSED :3400+lane) vì cấu hình không có `webServer`. Cho tự đủ trong evotest, theo mẫu P-a/P-b2.

## Làm
- `e2e/community-web/_cs-stack.ts`: reset DB riêng việc → migrate main/hub/gói → `hub:seed` → tenant `demo` + demo-owner + `seed-community-demo` (gọi thẳng `runSeed`/`ensureDemoTenant`/`ensureOwnerInGroup`: CLI từ chối host DB `pg` của evotest; stack tự chặn nếu không phải APP_ENV=test + DB `*_test`) → admin-api → hub-api → cổng sẵn sàng.
- `playwright.stack.config.ts`: `webServer` x2 (stack + build/preview community-web `PUBLIC_COMMUNITY_API=http`, proxy /auth, /pack), cổng 3400..3403 dịch theo làn, mật khẩu demo-owner sinh ngẫu nhiên mỗi lượt, `CS_EXTERNAL=1` để trỏ vào stack có sẵn.
- `test-e2e-par.rules.ts` META: DB `cs` + Redis DB `CS_REDIS_DB`.
- `roles.cs.ts`: mở ô soạn bài (thu gọn từ CR-110) trước khi kiểm `partner-note` của đối tác (spec cũ chưa theo UI mới; `feed.cm.ts` đã sửa).
- Phần B (staging smoke image prod): `deploy/stg-sohoptac2/*` + `e2e/stg/*` (không thuộc test:all).

## Không làm / Chạm
Không đổi hành vi app. Chỉ e2e + hạ tầng test.

## Test tối thiểu
`run-tests.ps1 -Step e2e -Ref HEAD -Dirty -Filter community-web-stack -All` ⇒ 4 pass (17.6 s).

## Quyết định trong lúc làm
- Gọi hàm thư viện thay vì CLI seed (guard host `pg`).
- `||=` (không `??=`) cho env mặc định vì `.env.example` đặt DEMO_OWNER_PW rỗng.
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ e2e + hạ tầng test, không đổi mã app).

## Việc còn lại
