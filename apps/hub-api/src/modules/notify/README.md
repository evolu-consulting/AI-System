# modules/notify — cổng thông báo dùng chung (N3)

FR: N3-FR-01…09, N3-NFR-01…03 · spec `docs/specs/N3-notify/` · ADR-0027 (Proposed: SMTP/Web Push thật).

| Lớp | File | Việc |
|---|---|---|
| domain | `notify.rules.ts` | backoff 1′/5′/30′/2h (tối đa 5 lần), kết cục, mã lỗi an toàn, nội dung email/push |
| application | `ports.ts`, `dispatch.usecase.ts`, `inbox.service.ts` | `dispatchOnce`/`drain` (chia kênh → nhận lô → gửi ngoài tx → ghi kết cục), chuông/tùy chọn |
| adapters | `dispatch.repo.ts`, `inbox.repo.ts`, `notify.routes.ts`, `transport.fake.ts`, `transports.ts`, `credentials.ts` | SQL (3 câu/lô), route `/notifications*`, transport giả, chọn theo `HUB_NOTIFY_MODE`, secret qua `hub.secrets` |
| mount | `notify.mount.ts` | nối route + vòng worker |

Ghi thông báo: gói dùng `uow.tenant(who, (r) => r.notify.enqueue([...]))` (`modules/packs/kit`, cùng tx nghiệp vụ); Hub gọi SQL `notify.enqueue(source, lô)` trong tx của mình.
`HUB_NOTIFY_MODE`: `off` (mặc định, không worker) · `fake` (dev/e2e) · `live` (chưa có adapter ⇒ Hub không khởi động).
