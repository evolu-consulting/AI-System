---
id: cr121-c21-mail-config
lát: cr121-c21-mail-config
cr: CR-121
làn: đầy đủ (phần secret: Sonnet high viết, Opus low soát diff secret/RLS)
migration: không
phụ thuộc: c20 (cùng registry.ts); spec docs/specs/cr121-c/spec.md D4
---
## Plan (ngắn)
Cấu hình gửi mail MỘT nguồn = kho secret Hub. Dùng kind sẵn có `smtp_password` (secret nền tảng, `tenant_id NULL`); giá trị là JSON `{v:1, host, port, secure, user, from, password}` (mã hoá AES-GCM như mọi secret) ⇒ KHÔNG thêm kind, KHÔNG migration (CHECK `secrets_kind_ck` giữ nguyên). Env `HUB_SMTP_*` + `SMTP_PASSWORD` chỉ thành `mailSeed`: `seedMailSecret` chèn MỘT lần khi kho chưa có secret `smtp_password` nền tảng (một câu `INSERT … WHERE NOT EXISTS` dưới `pg_advisory_xact_lock` ⇒ nhiều instance vẫn đúng một hàng; có sẵn ⇒ không đụng, không ghi đè). Mọi lần gửi đọc kho qua `mailConfigReader` → `createStoredSmtpTransport` (lấy cấu hình ở lần gửi đầu, dựng transport một lần).

## Làm
- `notify/adapters/mail-config.ts` (mới): codec JSON (zod strict, lỗi ⇒ `MailConfigInvalid` message cố định), `seedMailSecret`, `mailConfigReader`.
- `notify/adapters/{smtp.transport,transports}.ts`: `createStoredSmtpTransport`; `LiveNotifyConfig` đổi `{smtp, smtpPassword}` → `{mail}`.
- `notify/notify.mount.ts`: bỏ `smtp`/`smtpPassword` khỏi `LiveEnv`, thêm `mailSeed`; seed chạy trước lượt drain đầu (worker `await seeded`), lỗi seed chỉ log cảnh báo (không chặn khởi động).
- `config/env-deps.ts` + `config/env.ts` (chú thích): env mail → `mailSeed` (chỉ khi có `SMTP_PASSWORD`).
- Ops check `notify_config` (`ops/adapters/checks/notify-config.check.ts` + `registry.ts` + `OPS_CHECK_KEYS/META` + i18n vi/en): kho chưa có secret mail ⇒ warn "Chưa cấu hình mail" + hint; có ⇒ ok. Một câu `count(*)` trên cột công khai (không giải mã).
- `.env.example`, `deploy/prod-sohoptac2/README.md`: mô tả nguồn mới (không giá trị secret).
- Chỗ đọc env mail (grep): chỉ `config/env-deps.ts` (`HUB_SMTP_*`, `SMTP_PASSWORD`) → nay chỉ seed; `config/env.ts` (khai báo zod, giữ cho seed); `notify.mount.ts` (đã bỏ `e.smtpPassword`). KHÔNG gỡ `n3_notify`: schema pack chứa hàng đợi thông báo, không chứa cấu hình mail (packs 0004 không có cột cấu hình mail).

## Không làm / Chạm
Không đụng DLC. VAPID (`vapid_private_key`, `HUB_VAPID_*`) giữ nguyên (ngoài D4). Không thêm UI tạo secret nền tảng (nợ TD-223). Không migration. Không e2e. Mailer riêng của admin-api (`apps/admin-api/src/lib/mailer`, env `SMTP_URL`/`MAIL_FROM`; cảnh báo quota, đặt lại mật khẩu) là NGUỒN MAIL THỨ HAI chưa chuyển — admin-api không có quyền đọc schema `hub`; cần quyết định riêng (xem Việc còn lại).

## Test tối thiểu
- unit `mail-config.test.ts` (codec), `notify-config.check.test.ts`, `transports.test.ts` (env → `mailSeed`, không còn `smtp` trong live).
- int `notify/adapters/mail-config.int.test.ts`: seed kho trống; lần 2 không ghi đè; có sẵn (tên khác) giữ nguyên; hai seed đồng thời một hàng; check warn khi trống → ok sau seed.
- Perf: seed = 1 câu SQL (+1 khoá advisory) mỗi lần khởi động; check = 1 câu `count(*)`; gửi mail: 1 tra id + 1 đọc bản mã ở lần gửi đầu (transport cache), không SQL theo hàng.

## Quyết định trong lúc làm
- Không thêm kind `smtp_config` (cần migration sửa CHECK; lát không có số migration): dùng JSON trong `smtp_password`. Hệ quả: secret `smtp_password` kiểu cũ (chỉ là mật khẩu thô) KHÔNG còn dùng được — lúc gửi ném `MailConfigInvalid`/retry; chưa có secret như vậy ở prod (notify `off`, tài khoản gửi để trống).
- Seed chỉ khi có `SMTP_PASSWORD` (env zod có mặc định host/port nên không phân biệt được "đã đặt" với "mặc định"); relay không xác thực phải tạo secret thủ công.
- Đổi cấu hình trong kho CẦN KHỞI ĐỘNG LẠI Hub (transport cache một lần, như mật khẩu trước đây; không thêm TTL).
- Secret sai định dạng: `mailConfigReader` bật cờ trong tiến trình (`lib/mail-config-state.ts`, mã `mail_config_invalid`, không giá trị); check `notify_config` đọc cờ ⇒ warn "Cấu hình mail không đọc được — tạo lại secret" (cờ chỉ có sau lần gửi/đọc đầu của instance đó). Không giải mã trong check. Thiếu `hubSecretsKey` khi có `mailSeed` ⇒ log warn `notify_mail_secret_seed_skipped` code `hub_secrets_key_missing`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cau-hinh-gui-mail-mot-nguon.md
#### Yêu cầu: Cấu hình gửi mail chỉ có một nguồn là kho secret của Hub
Máy chủ gửi, cổng, tài khoản, địa chỉ người gửi và mật khẩu mail được lưu trong kho secret của Hub (secret nền tảng). Biến môi trường mail cũ chỉ dùng để khởi tạo kho đúng một lần khi kho chưa có cấu hình; sau đó không đọc lại và không ghi đè cấu hình đã có. Mọi email của hệ thống được gửi theo cấu hình trong kho. Khi kho chưa có cấu hình mail, trang Tình trạng hệ thống hiện cảnh báo "Chưa cấu hình mail" kèm cách sửa, nhưng hệ thống vẫn khởi động bình thường.
- Kịch bản: khi kho secret chưa có cấu hình mail và môi trường có mật khẩu mail thì lần khởi động đầu chép cấu hình vào kho, lần sau với giá trị khác không ghi đè, và cấu hình đọc lại đúng [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » kho trống ⇒ seeded (đọc lại đúng), lần 2 giá trị khác ⇒ exists, KHÔNG ghi đè]
- Kịch bản: khi người vận hành đã tạo sẵn cấu hình mail trong kho thì khởi tạo từ môi trường không thêm hay đổi gì [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » đã có secret mail sẵn (tên khác do người vận hành tạo) ⇒ giữ nguyên, seed không thêm hàng]
- Kịch bản: khi hai máy chủ Hub khởi động cùng lúc thì kho chỉ có một cấu hình mail [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » hai instance seed đồng thời ⇒ đúng một hàng]
- Kịch bản: khi kho chưa có cấu hình mail thì kiểm tra vận hành báo cảnh báo "Chưa cấu hình mail", có cấu hình thì hết cảnh báo [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » kho trống ⇒ warn 'Chưa cấu hình mail', sau seed ⇒ ok]
- Kịch bản: khi giá trị cấu hình mail trong kho sai định dạng thì báo lỗi cấu hình không lộ giá trị [test: apps/hub-api/src/modules/notify/adapters/mail-config.test.ts » không phải JSON / thiếu trường / thừa trường / sai kiểu ⇒ MailConfigInvalid, message không chứa giá trị]

## Việc còn lại
- NGUỒN MAIL THỨ HAI (điều phối sẽ xếp lát): admin-api (`SMTP_URL`, `MAIL_FROM`) — chuyển sang kho Hub (cần cổng đọc secret hoặc gọi Hub) hay chấp nhận hai nơi (vi phạm Luật GỐC 1).
- UI tạo/sửa secret nền tảng `smtp_password` (TD-223); hiện chỉ qua seed env hoặc SQL.
- Hiệu lực khi đổi cấu hình trong kho cần khởi động lại Hub (giữ cache, không thêm TTL).
