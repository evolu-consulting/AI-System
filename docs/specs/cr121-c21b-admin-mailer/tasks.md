---
id: cr121-c21b-admin-mailer
lát: cr121-c21b-admin-mailer
cr: CR-121
làn: đầy đủ (auth dịch vụ + secret; Sonnet viết, Opus low soát phần auth/secret)
migration: không
phụ thuộc: c21 (kho secret mail của Hub); spec docs/specs/cr121-c/spec.md D4
---
## Plan (ngắn)
Nguồn mail thứ hai (admin-api `SMTP_URL`/`MAIL_FROM`) gỡ: admin-api gửi QUA Hub bằng đường nội bộ ĐÃ CÓ — `ADMIN_HUB_URL` + `HUB_INTERNAL_TOKEN` làm Bearer (cùng cơ chế `/internal/test-run`, `/internal/tenants/:tid/process-slots`; so hằng thời gian `serviceTokenMatches`). Không tạo cơ chế auth mới. Hub thêm `POST /internal/mail` dùng đúng transport email của thông báo (c21: cấu hình + mật khẩu đọc từ kho secret).

## Làm
- Contract `packages/contracts/src/hub-internal/mail-relay.ts` (`MailRelayRequest {to[1..50], subject, text}` strict, không html; `MailRelayResponse {sent, skipped}`) + mã lỗi `MAIL_SEND_FAILED: 502` (`errors.ts`).
- Hub `modules/internal/mail-relay.{service,routes}.ts`: quyền kiểm Ở SERVICE (token dịch vụ; Hub chưa có token ⇒ 503 kể cả khi người gọi gửi token; sai/thiếu/JWT ⇒ 401 một thân + `WWW-Authenticate`); thân sai ⇒ 400; thông báo tắt hoặc kho chưa có cấu hình/sai định dạng ⇒ 409 `NOT_CONFIGURED`; SMTP lỗi ⇒ 502; miền dành riêng ⇒ `skipped` (như worker). Mọi phản hồi `no-store`. Không log token/thân/địa chỉ/chủ đề (chỉ mã cố định).
- `notify.mount.ts` trả `{email}` (transport đang dùng); `app.ts` `mountNotifyAndRelay` nối `/internal/mail` với transport đó.
- admin-api `lib/mailer/index.ts`: `createMailer({url, token})` gọi Hub (bỏ nodemailer/SMTP_URL/MAIL_FROM); Hub 409 NOT_CONFIGURED ⇒ `MAIL_DISABLED` (alert quota giữ `pending` như khi chưa có SMTP), còn lại ⇒ `MAIL_SEND_FAILED`; thiếu URL/token ⇒ `MAIL_DISABLED`. `config/env.ts`, `server.ts` bỏ env cũ.
- Gỡ `SMTP_URL`/`MAIL_FROM` khỏi `.env.example`, `.env.production.example`, `turbo.json`; ghi chú deploy trong `deploy/prod-sohoptac2/README.md`.
- Chỗ đọc env mail của admin-api (grep): chỉ `config/env.ts` + `server.ts` + `lib/mailer/index.ts`; người dùng của mailer: `quotas.evaluator.ts` (cảnh báo quota). Không có chỗ nào gửi mail đặt lại mật khẩu trong code hiện tại (mẫu chưa tồn tại) — endpoint nhận `subject/text` chung nên mẫu tương lai dùng được không cần đổi Hub.

## Không làm / Chạm
Không đụng DLC, không migration, không UI. `nodemailer` còn trong `apps/admin-api/package.json` (bỏ cần cập nhật `bun.lock`; để lát dọn deps). `html` của `MailMessage` không được chuyển (Hub gửi text; không nơi gọi nào dùng html).

## Test tối thiểu
- unit `apps/admin-api/src/lib/mailer/mailer.test.ts` (Hub giả bằng `Bun.serve` ở ranh giới HTTP): Bearer + thân đúng, 409→MAIL_DISABLED, 502/mạng→MAIL_SEND_FAILED, thiếu cấu hình, thư không hợp lệ không gọi Hub.
- int `apps/hub-api/src/modules/internal/mail-relay.int.test.ts` (DB): đường chính dùng cấu hình từ kho; 401 cho mọi người gọi không phải dịch vụ admin; 503 khi Hub chưa có token; 409 kho trống; 400 thân sai.
- Perf: không đường nóng; mỗi yêu cầu = 1 tra id + 1 đọc bản mã (+ giải mã) lần gửi đầu của tiến trình (transport cache) và một `sendBatch` cho cả danh sách người nhận.

## Quyết định trong lúc làm
- Endpoint chung `{to, subject, text}` (admin giữ mẫu nội dung quota) thay vì mẫu ở Hub: Hub không phải biết nghiệp vụ quota/đặt lại mật khẩu.
- Một token dịch vụ dùng chung hai chiều (`HUB_INTERNAL_TOKEN`) như hiện có — không thêm khoá riêng cho mail (TECH-DEBT #263).
- Trần 30 lần/phút (`mail-relay.limit.ts`, cùng mẫu cửa sổ phút INCR+EXPIRE Redis của `link-check-limit`/`community-quota`; Redis vắng/lỗi ⇒ đếm trong tiến trình), xét SAU xác thực; vượt ⇒ 429 `MAIL_RELAY_LIMIT` + `Retry-After`, admin map ⇒ `MAIL_SEND_FAILED` (alert giữ pending). `text` tối thiểu 1 ký tự.
- Deploy: hub-api phải lên trước/cùng admin-api; prod đã có `ADMIN_HUB_URL` + `HUB_INTERNAL_TOKEN` (gen-env.sh) nên không cần đổi env; kho chưa có cấu hình mail ⇒ mail quota chưa gửi (alert `pending`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/gui-mail-qua-hub.md
#### Yêu cầu: Admin gửi mail qua Hub, cấu hình mail chỉ ở kho secret
Các email do Admin phát (cảnh báo hạn mức…) được gửi thông qua Hub, dùng đúng cấu hình mail trong kho secret của Hub. Admin không còn tự giữ cấu hình máy chủ gửi mail. Chỉ dịch vụ Admin (có token dịch vụ) gọi được đường gửi này; người khác bị từ chối và không có thư nào được gửi. Khi kho chưa có cấu hình mail thì thư không gửi được, cảnh báo hạn mức được giữ lại để gửi sau.
- Kịch bản: khi kho secret có cấu hình mail và Admin gọi Hub kèm token dịch vụ thì mọi người nhận đều được gửi bằng máy chủ và địa chỉ người gửi trong kho [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » đường chính: kho có cấu hình ⇒ 200 {sent:2}, host/from/mật khẩu lấy từ kho]
- Kịch bản: khi người gọi không phải dịch vụ Admin (thiếu hoặc sai token) thì bị từ chối và không có thư nào được gửi [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » người gọi không phải dịch vụ admin ⇒ 401, KHÔNG gửi (thiếu header, sai scheme, sai token, JWT)]
- Kịch bản: khi Hub chưa có token dịch vụ thì đường gửi không dùng được và thân thư sai bị từ chối [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » Hub chưa cấu hình token dịch vụ ⇒ 503 kể cả khi gửi token, thân sai ⇒ 400]
- Kịch bản: khi kho chưa có cấu hình mail thì Hub báo chưa cấu hình và Admin coi là mail đang tắt [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » kho trống ⇒ 409 NOT_CONFIGURED (không gửi)]
- Kịch bản: khi Hub báo lỗi gửi hoặc mất kết nối thì Admin báo gửi thất bại, còn khi Hub báo chưa cấu hình thì Admin báo mail tắt [test: apps/admin-api/src/lib/mailer/mailer.test.ts » Hub 409 NOT_CONFIGURED ⇒ MAIL_DISABLED, Hub 502/lỗi mạng ⇒ MAIL_SEND_FAILED]

## Việc còn lại
- Gỡ `nodemailer` khỏi `apps/admin-api/package.json` + `bun.lock` (lát dọn deps).
- Mẫu mail đặt lại mật khẩu chưa có trong code; khi làm, gửi qua `createMailer` (đã đi Hub).
- Hiệu lực đổi cấu hình mail trong kho cần restart Hub (c21).
