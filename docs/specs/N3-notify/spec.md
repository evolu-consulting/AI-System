---
id: N3-notify
title: Thông báo dùng chung (in-app + email + push web)
milestone: GĐ1 · Luồng A (lõi)
cr: CR-094
status: building
requirements: [N3-FR-01, N3-FR-02, N3-FR-03, N3-FR-04, N3-FR-05, N3-FR-06, N3-FR-07, N3-FR-08, N3-FR-09, N3-NFR-01, N3-NFR-02, N3-NFR-03]
design: [docs/platform/intake-hd.md (N3, R19), docs/adr/0023-clean-architecture.md, docs/adr/0027-smtp-webpush-libs.md]
owner: backend-lead + frontend-lead (một agent một lát, Luật 1b)
---

# N3 · Thông báo dùng chung

Nguồn: [intake-hd](../../platform/intake-hd.md) lát N3 (R19 kênh nhắc: in-app + email + push web); tham chiếu mgmt-app `contracts/remind.py` (tùy chọn từng người: `email`, `days`, `team`, `price`; khóa trạng thái `remind:<hd>:<hạn>:<mốc>:<email>`) và `settings.py:62-73` (SMTP, VAPID). Dùng bởi mọi gói (HD4 nhắc hạn dùng N3 sau — ngoài lát này).

## 1. Yêu cầu

| Mã | Nội dung |
|---|---|
| N3-FR-01 | **Cổng gửi dùng chung**: gói/Hub ghi thông báo vào `hub.notifications` qua hàm `notify.enqueue(source, lô jsonb)` **trong cùng tx nghiệp vụ** (rollback nghiệp vụ ⇒ không còn thông báo). Tenant lấy từ `app.tenant_id` của tx, không từ đầu vào. |
| N3-FR-02 | **Idempotency**: khóa `(tenant, người nhận, nguồn, dedup_key)` duy nhất; gửi lại cùng khóa ⇒ bỏ qua (không nhân đôi, không lỗi). Thiếu `dedup_key` ⇒ sinh ngẫu nhiên. |
| N3-FR-03 | **Người nhận phải cùng tenant**: id người dùng ngoài tenant của tx bị bỏ qua lặng lẽ (không lộ tồn tại). |
| N3-FR-04 | **Tùy chọn kênh mỗi người** `hub.notify_prefs` (`email`, `push`; mặc định bật); in-app luôn có. API đọc/ghi của chính mình. |
| N3-FR-05 | **Worker gửi theo lô**: fan-out (thông báo → bản gửi theo kênh theo tùy chọn + địa chỉ/đăng ký có thật) → claim lô (`FOR UPDATE SKIP LOCKED`, hạn thuê) → gửi **ngoài tx** → ghi kết quả một câu. Số câu SQL mỗi lô cố định. |
| N3-FR-06 | **Thử lại có backoff**: 1 phút, 5 phút, 30 phút, 2 giờ; quá 5 lần hoặc lỗi vĩnh viễn ⇒ `dead` (giữ lý do mã, không log nội dung). Crash giữa chừng ⇒ hết hạn thuê thì gửi lại (transport nhận khóa idempotency = id bản gửi). |
| N3-FR-07 | **Email** qua cổng `EmailTransport` (SMTP thật bật bằng cấu hình sau — ADR-0027 Proposed; dev/test dùng transport giả). **Push web** qua `PushTransport` (Web Push VAPID; giả cho test). Đăng ký push hết hạn (410) ⇒ xóa đăng ký. |
| N3-FR-08 | **Secret** (mật khẩu SMTP, khóa riêng VAPID) lưu kho secret Hub (`hub.secrets`, kind `smtp_password`, `vapid_private_key`, nền tảng); không `.env` commit; không log giá trị. |
| N3-FR-09 | **Chuông in-app S16** (contracts-web): danh sách, số chưa đọc, đánh dấu đã đọc, tùy chọn kênh. API: `GET /notifications`, `POST /notifications/read`, `GET/PUT /notifications/prefs`, `GET /notifications/push/key`, `POST/DELETE /notifications/push/subscriptions`. |
| N3-NFR-01 | Perf: lô 100 p95 ≤ 50 ms (phần DB, mỗi giai đoạn), nền 10.000 thông báo; số câu mỗi lô cố định (không theo số hàng). |
| N3-NFR-02 | Cách ly tenant: A không thấy/không gửi/không đọc bản gửi của B ở mọi bước (RLS + lọc tường minh); role gói chỉ có `EXECUTE notify.enqueue`, không đọc bảng. |
| N3-NFR-03 | Không gọi mạng trong tx; không sleep chờ trạng thái (vòng nền chỉ ngủ khi hết việc). |

## 2. Quyết định (Luật 2)

| # | Quyết định |
|---|---|
| D-01 | Cổng ghi là **hàm SECURITY DEFINER** `notify.enqueue` (schema `notify` chỉ chứa hàm), không cấp quyền bảng cho role gói ⇒ giữ PK-AC03 (role gói không USAGE `hub`). Hub dùng cùng hàm. |
| D-02 | In-app và outbox dùng **một bảng nguồn** `hub.notifications`; `hub.notification_deliveries` là bản gửi theo kênh (tạo lúc fan-out theo tùy chọn tại thời điểm gửi). |
| D-03 | SMTP/Web Push thật cần thư viện ngoài ADR-0001 ⇒ **ADR-0027 Proposed, dừng phần transport thật**; `HUB_NOTIFY_MODE=live` khi chưa có adapter ⇒ Hub không khởi động (fail-closed). `fake` cho dev/test, `off` (mặc định) tắt worker. |
| D-04 | SMTP riêng từng tenant **không làm** (secret nền tảng một bộ); "gửi theo tenant" = mỗi bản gửi mang `tenant_id` và chỉ tới người của tenant đó. |
| D-05 | Nút tùy chọn kênh chỉ hiện khi chuông đã có thông báo, để khung chuông rỗng S16 giữ nguyên ảnh baseline đã khóa. Đăng ký push (service worker) ngoài lát này; API đã sẵn. |
