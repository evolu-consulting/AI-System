# L1 — Giới hạn đăng nhập admin-api (TECH-DEBT #224)

Làn: **đầy đủ về rủi ro (auth)** nhưng chạy theo Luật 0b (một agent, một lát, review gộp cuối đợt). Điều kiện cứng trước khi import hash mgmt-app thật (N5 security L1, N5b security L1).

## Plan ngắn
| # | Việc | Trạng thái |
|---|------|-----------|
| 1 | Luật thuần `auth/limit/limit.rules.ts` (ngưỡng, backoff, cửa sổ IP, khoá băm) + unit | xong |
| 2 | Adapter Redis `limit.redis.ts`: 3 script Lua (pre = IP +1 & kiểm khoá; fail; clear), giờ do app truyền | xong |
| 3 | `limit.service.ts`: 429/423/503, audit `login_lockout`, `hashSlot` (semaphore `lib/semaphore.ts`) | xong |
| 4 | Nối: `login` (trước mọi phép băm), `/auth/totp/verify` + `/auth/change-password` (trần IP), băm trong forced/self change qua semaphore | xong |
| 5 | Admin `POST /admin/users/:id/unlock` xoá khoá Redis + audit `unlock` `summary.op=login_lockout_clear` | xong |
| 6 | Contract bổ sung `AUTH_LIMIT_ERRORS` (`RATE_LIMITED` 429 + `Retry-After` + `details.retry_after_s`, `AUTH_UNAVAILABLE` 503) | xong |
| 7 | env `REDIS_URL` (bắt buộc ở production), `TRUST_PROXY_HOPS`, `LOGIN_HASH_CONCURRENCY` | xong |
| 8 | Test: unit (rules, semaphore, client-ip, service) · int evotest `limit.int.test.ts` · perf `limit.perf.int.test.ts` | xong |

## Giới hạn chọn
- Tài khoản: 5 lần sai liên tiếp ⇒ khoá 15' (giống M1, lần 6 thấy 423); khoá lặp lại ⇒ 30', 1h, 2h, 4h (trần); không khoá thêm 24h ⇒ bậc về 0; đúng mật khẩu ⇒ xoá bộ đếm.
- IP: 30 lượt / cửa sổ cố định 10' (đếm mọi lượt login/TOTP/đổi mật khẩu) ⇒ 429.
- CPU: tối đa `số lõi` (≥ 2) phép băm cùng lúc, hàng đợi 100 ⇒ quá thì 503 `Retry-After: 1`.

## Quyết định trong lúc làm
- **Redis lỗi ⇒ 503 đóng an toàn** (phương án khuyến nghị): không đăng nhập được khi Redis chết; ioredis không xếp hàng lệnh, `commandTimeout` 500 ms.
- **Không lộ tài khoản:** khoá Redis theo SHA-256(tenant_key ‖ NUL ‖ username) cho cả tài khoản không tồn tại ⇒ cùng chuỗi 401×5 → 423 cùng `until`; 423/429/503 trả trước mọi phép băm. Audit khoá chỉ có cho tài khoản thật (một tx nhỏ ở lần khoá, cùng lớp thời gian — argon2 chiếm phần lớn).
- **Contract:** không thêm vào `API_ERRORS` (test khoá `M2/error-codes` đếm mã ngoài M1/M3/M4 = 9, `common.test` đếm 46) ⇒ bảng riêng `AUTH_LIMIT_ERRORS` như `CHAT_API_ERRORS`; 423 `TEMP_LOCKED` giữ nguyên. Không có Tranh chấp test.
- **Tương thích test khoá:** `loginLimiter` vắng ⇒ không giới hạn (test in-process M1–M4); `server.ts` luôn điền khi có `REDIS_URL`, production thiếu ⇒ không khởi động.
- **Q6 (M1) thay đổi:** gỡ khoá tạm bởi admin nay ghi audit `unlock` (`summary.op=login_lockout_clear`, actor = admin) — yêu cầu L1.
- **IP:** chỉ tin `X-Forwarded-For` khi `TRUST_PROXY_HOPS ≥ 1` (lấy phần tử thứ hops từ cuối); không thì IP socket Bun. Production sau reverse proxy phải đặt biến này, nếu không mọi người dùng chung một xô IP của proxy.
- Bộ đếm Redis hết hạn 28h không hoạt động (DB counter M1 không hết hạn) — chênh nhỏ, chấp nhận.

## Kết quả (evotest, 2026-10-20)
- Unit 26/26. Int `limit.int.test.ts` 8/8; hồi quy 14 file (M1 auth/users/error-codes, M2 error-codes, M3 notify, M4 audit/TOTP, H1 auth, auth.service/legacy) 241 pass / 0 fail.
- Perf login p95: không limiter 66.8 ms → có limiter 80.7 ms (NFR < 150 ms, đạt). N5b legacy perf vẫn đạt (58.0 / 49.3 / 44.9 ms).
- Không lộ tài khoản: median 401 có thật 46.9 ms · lạ 47.1 ms.

## L1c — sửa sau review A (cr095-wave-A) và C (cr095-wave-C)
- **A-3 (Trung):** PRE giữ chỗ lượt đang verify trong zset `p:<acct>` (điểm = hạn giữ chỗ 30 s theo `now` app), nguyên tử cùng kiểm khoá: `lần sai đã ghi + lượt đang chạy ≥ 5` ⇒ 429 `RATE_LIMITED {retry_after_s: 1}` trước mọi phép băm (tài khoản lạ cũng vậy). FAIL/SUCCESS nhả chỗ trong cùng lệnh; lượt dừng giữa chừng (khoá DB, lỗi) nhả bằng `finally`; tiến trình chết ⇒ chỗ tự hết hạn. Một đợt song song nay tối đa 5 lần verify mỗi chu kỳ khoá (trước: ~ hashSlots + 100).
- **A-6 (Thấp):** XFF ít phần tử hơn `TRUST_PROXY_HOPS` ⇒ không tin (xô `unknown`); IPv6 gộp theo /64 trong `ipId`.
- **A-7 (Thấp, đánh đổi đã biết — ghi nhận):** ai biết (tenant_key, username) cũng khoá tạm được tài khoản (5 lần sai, backoff tới 4h, đúng mật khẩu vẫn 423). Chấp nhận vì không lộ tài khoản và chặn đoán mật khẩu; vận hành: admin gỡ khoá qua `POST /admin/users/:id/unlock` (xoá cả Redis), audit `login_lockout` cho biết tài khoản bị nhắm. Chưa làm: gỡ khoá hàng loạt, không tăng bậc khi lượt sai đến từ IP đã 429.
- **T-10:** `limit.int.test.ts` sắp audit theo `seq` (không theo uuid ngẫu nhiên). Tệp nằm ngoài `tests/.lock` (chỉ khoá `tests/acceptance/**`, `e2e/**`) ⇒ không cần relock.
- **Review C:** `limit.rules.ts` không còn import `crypto` — cổng `Hasher` + `accountIdWith`, adapter SHA-256 ở `limit.keys.ts` (depcruise rules-must-be-pure xanh cho L1); `check:fn` hết vi phạm L1 (`authRoutes` tách `metaOf`/`ipGate`/`refreshRoute`, `recordLoginFail` gom tham số, helper test `post`/`login` nhận object, tách 2 `describe` > 50 dòng).

## Việc còn lại
- Deploy staging/production: đặt `REDIS_URL`, `TRUST_PROXY_HOPS` cho admin-api (đã ghi trong `docs/guides/deploy.md` §5 ở L1b).
