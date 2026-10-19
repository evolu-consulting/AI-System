---
id: N3-notify
---

# Plan · N3 thông báo dùng chung (≤ 1 trang)

## Dữ liệu (migration `migrations-hub/0040_n3_notify.sql` + `migrations-packs/0004_n3_notify.sql`)
- `hub.notifications` (id uuid, seq identity, tenant, user, source, kind, title ≤ 200, body ≤ 2000, link ≤ 500 bắt đầu `/`, dedup_key, created_at, read_at, fanout_at; UNIQUE tenant+user+source+dedup). Index: feed `(tenant,user,seq desc)`, chưa đọc (partial), chờ fan-out (partial).
- `hub.notification_deliveries` (bigint id, notification_id + tenant FK kép, channel email|push, status pending|sending|sent|dead, attempts, next_attempt_at, last_error mã ≤ 64, sent_at; UNIQUE notification+channel). Index chờ gửi `(next_attempt_at,id) WHERE status IN ('pending','sending')` — `sending` giữ `next_attempt_at` = hết hạn thuê.
- `hub.notify_prefs` (PK tenant+user), `hub.push_subscriptions` (endpoint duy nhất).
- RLS: `hub_rw` theo `app.scope` (system thấy hết; user chỉ hàng của mình). `notification_deliveries`: chỉ system. Không INSERT trực tiếp vào `notifications` (chỉ qua hàm).
- `notify.enqueue(p_source, p_batch)` DEFINER, `search_path` cố định; kit migration `packs.install` cấp `USAGE notify` + `EXECUTE` cho `<k>_rw` (và backfill gói đã cài). Mở rộng `hub.secrets.kind`.

## Mã (hub-api `modules/notify/`, 4 lớp ADR-0023)
- `domain/notify.rules.ts`: backoff, kết cục (`sent|retry|dead`), chuẩn hóa tin, nội dung email/push, ánh xạ lỗi.
- `application/ports.ts` (Email/Push transport, Store, Clock), `dispatch.usecase.ts` (`dispatchOnce`), `inbox.usecase.ts`.
- `adapters/notify.repo.ts` (SQL), `transport.fake.ts`, `transports.ts` (chọn theo mode), `credentials.ts` (đọc secret qua `HubSecretReader`), `notify.routes.ts`.
- `notify.mount.ts`: nối route + vòng worker (`HUB_NOTIFY_MODE`).
- Gói: `kit/application/notify.ts` (cổng `Notifier`), `kit/adapters/notify.repo.ts`; `createPackUow` thêm `notify` vào repo trong tx.

## Thiết kế hiệu năng (Luật 4c)
| Bước | Câu SQL | Ghi chú |
|---|---|---|
| enqueue | 1 mỗi lô (jsonb một tham số) | gọi hàm; rỗng ⇒ 0 câu |
| fan-out | 1 CTE (picked FOR UPDATE SKIP LOCKED → want → insert deliveries → set fanout_at) | lô ≤ 100 |
| claim | 1 CTE (due SKIP LOCKED → update sending → join nội dung + email + đăng ký push) | lô ≤ 100 |
| gửi | 0 SQL; `Promise.all` theo kênh, transport nhận cả lô | ngoài tx |
| settle | 1 CTE (`jsonb_to_recordset` → update; xóa đăng ký hết hạn) | một tham số JSON |
Mỗi pha một tx (+1 `set_config`); tổng cố định 6 câu/lô bất kể số hàng. Ngưỡng: mỗi pha lô 100 p95 ≤ 50 ms, nền 10.000.

## Rủi ro/Làn
Cao (làm test cách ly **trước**): enqueue/tenant/RLS/role gói, secret, gửi theo tenant. Thường: UI chuông, định dạng email/push, tùy chọn kênh.
