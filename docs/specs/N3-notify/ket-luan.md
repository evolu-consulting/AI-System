# Kết luận lát N3 Thông báo dùng chung (2026-10-19)

Quyết định: **đóng N3** (CR-094 đợt 2; làn đầy đủ cho phần tenant/RLS/secret, làn nhanh cho route + FE chuông). Cổng gộp và số đo: [`wave2-gate.md`](../wave2-gate.md). Số perf là số Windows dev. Không làm tròn ngưỡng.

## 1. Phạm vi đã giao

Cổng `notify.enqueue` cùng tx với nghiệp vụ (schema `notify`, migration hub 0040 + kit 0004) · worker lô fan-out/claim `FOR UPDATE SKIP LOCKED`, lease 120 s, backoff, trần 5 lần · kênh in-app, email (nodemailer) và Web Push (web-push) **thật** (`HUB_NOTIFY_MODE=live`), transport giả cho test · kho secret nền tảng (`smtp_password`, `vapid_private_key` tách khỏi `HUB_SECRET_KINDS`) · route inbox/prefs/push · `Notifier` cho gói · FE chuông S16 (danh sách, chưa đọc, đã đọc, tùy chọn kênh) + e2e `bell.cw.ts`. [ADR-0027](../../adr/0027-smtp-webpush-libs.md) Accepted.

## 2. Kết quả

| Hạng mục | Kết quả |
|---|---|
| Review (`review.md`) | Vòng 1 **CHANGES_REQUESTED** (`50e473cb`): 1 Cao (C1 test khoá H4b1 đỏ do đổi `HUB_SECRET_KINDS`), 4 Trung, 9 Thấp → sửa `ee75909d` (C1, fencing `settle`, trần 5 lần, hạn transport 60 s) và `ff91e4b8` (transport thật). Không có vòng 2 riêng: các mục Trung/Cao đã có test (`lease.int.test.ts`) |
| Cổng gộp 2026-10-19 | e2e `e2e:contracts` 25/25 ×3 lượt liền sau khi sửa flake (xem dưới); `check:fn`, `i18n:check`, `check:bundle` xanh; int N3 xanh khi chạy riêng |
| Flake bell "tùy chọn kênh" | Không phải chập chờn mà **đỏ 3/3 lượt** (trước sửa). Nguyên nhân ở test: `uncheck()` kiểm trạng thái ngay sau bấm, ô controlled cập nhật lạc quan qua react-query nên báo "did not change its state". Sửa trong `bell.cw.ts`: bấm rồi `expect(...).not.toBeChecked()` (`d8a4a54a`); hành vi sản phẩm đúng |
| Perf N3-NFR-01 (`PERF=1`, lô 100, nền 10.000) | ghi cổng p95 5,62 ms · chia kênh p95 10,08 ms · nhận p95 4,51 ms · ghi kết cục p95 3,70 ms (ngưỡng 50 ms; `max` 51,4 / 61,7 ms ở lượt đầu); 300 câu SQL / 100 lô (cố định); 10.000 gửi xong 1,47 s |

Commit: `126e6b08` · `42536033` · `ee75909d` · `ff91e4b8` · `d8a4a54a` (sửa flake).

## 3. Quyết định chính

Hàm cổng ở schema `notify` để role gói giữ nguyên "không USAGE hub" · `notify.enqueue` bỏ qua lặng lẽ người nhận ngoài tenant · hạn thuê lưu vào `next_attempt_at` · SMTP/VAPID tạm MỘT bộ nền tảng (#222) · migration hub đánh 0040 (journal đã có `0041_n2_engine` trước khi file SQL N2 tồn tại ở `126e6b08`; bisect phải migrate từ `42767d4f`).

## 4. Nợ liên quan

| # | Nội dung |
|---|---|
| 222 | SMTP/VAPID theo tenant |
| 223 | Thấp của review: L1 `p_source`, L2 `fanout_at`, L4 CHECK `link`, L7 user khóa giữa chừng, dọn dữ liệu cũ, FK, perf backlog lớn, UI tạo secret |

## 5. Việc còn lại

| Việc | Ai | Khi |
|---|---|---|
| Cấp SMTP và VAPID thật để chạy `HUB_NOTIFY_MODE=live` ngoài dev | Người dùng | Trước khi bật thông báo thật |
| Cấu hình SMTP riêng theo tenant (#222) | backend-lead | Khi có tenant cần miền gửi riêng |
