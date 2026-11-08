# Admin · Tình trạng hệ thống (ops-watch)

Cập nhật: 2026-11-09 · Gộp từ: ops-watch (đợt cr125-wave).

## Yêu cầu: Kiểm tra vận hành định kỳ không dùng AI (nguồn: ops-watch)
Hub kiểm các chỉ số vận hành mỗi 30 phút bằng code thường và lưu trạng thái mới nhất cùng lịch sử đổi trạng thái.
- Kịch bản: khi mọi provider AI ở `logged_out` thì check "Provider AI" thành `crit` trong lượt kiểm kế tiếp [test: apps/hub-api/src/modules/ops/ops.checks.int.test.ts » Provider AI: logged_out ⇒ crit trong lượt kiểm kế tiếp]
- Kịch bản: khi trạng thái một check không đổi giữa hai lượt thì không ghi thêm sự kiện [test: apps/hub-api/src/modules/ops/ops.round.int.test.ts » khi trạng thái một check không đổi giữa hai lượt]

## Yêu cầu: Cảnh báo tới quản trị nền tảng (nguồn: ops-watch)
Khi một check đổi sang `warn`/`crit` hoặc hồi phục, mọi platform_admin đang hoạt động nhận một thông báo ở chuông ai-admin.
- Kịch bản: khi check chuyển `ok` → `crit` thì mỗi platform_admin nhận đúng một thông báo [test: apps/hub-api/src/modules/ops/ops.round.int.test.ts » check chuyển ok → crit thì mỗi platform_admin nhận đúng một thông báo]
- Kịch bản: khi người không phải platform_admin gọi `/ops/status` thì nhận 403 [test: apps/hub-api/src/modules/ops/ops.routes.int.test.ts » không phải platform_admin gọi /ops/*]

## Yêu cầu: Cấu hình kiểm tra trên UI (nguồn: ops-watch)
Platform_admin chỉnh tần suất, bật/tắt và ngưỡng từng check ở trang `/system`; có hiệu lực ở lượt kế tiếp không cần restart.
- Kịch bản: khi đổi tần suất từ 30 sang 10 phút thì lượt kiểm kế tiếp chạy theo 10 phút [test: apps/hub-api/src/modules/ops/ops.round.int.test.ts » khi đổi tần suất từ 30 sang 10 phút]
- Kịch bản: khi tắt một check thì check đó không chạy và không gửi cảnh báo [test: apps/hub-api/src/modules/ops/ops.round.int.test.ts » khi tắt một check thì check đó không chạy]
- Kịch bản: khi ngưỡng nhập ngoài khoảng cho phép thì lưu bị từ chối 422 [test: apps/hub-api/src/modules/ops/ops.routes.int.test.ts » ngưỡng ngoài khoảng cho phép ⇒ lưu bị từ chối 422]

## Yêu cầu: Trang Tình trạng hệ thống (nguồn: ops-watch)
Trang `/system` của ai-admin hiện từng check, gợi ý sửa, lịch sử, nút Kiểm tra ngay và Gói chẩn đoán.
- Kịch bản: khi platform_admin bấm "Kiểm tra ngay" thì thẻ cập nhật thời điểm kiểm [test: e2e/ops/system.ops.ts]
