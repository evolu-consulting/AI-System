# Admin · Ops-watch · check SLO

Cập nhật: 2026-11-09 · Gộp từ: cr117-slo-opswatch (đợt cr125-wave).

## Yêu cầu: Check SLO trong ops-watch (nguồn: cr117-slo-opswatch)
Lượt kiểm ops-watch (30 phút) có thêm check `slo`: đo contracts.list p95, chat dispatch p50, trễ timer PD-P01 và tỷ lệ lỗi log, so với giới hạn cố định; kết quả nằm ở `value.slos[]` của thẻ "SLO / hồi quy" trên `/system` và trong Gói chẩn đoán.
- Kịch bản: khi một SLO vượt giới hạn 2 lượt kiểm liên tiếp thì check chuyển warn, 4 lượt thì crit, và một lượt tốt đặt lại chuỗi [test: apps/hub-api/src/modules/ops/domain/slo.rules.test.ts » vi phạm liên tiếp cộng dồn; apps/hub-api/src/modules/ops/adapters/checks/slo.check.test.ts » lỗi log vượt 1% N lượt liên tiếp]
- Kịch bản: khi lượt kiểm thật chạy 4 lần với tỷ lệ lỗi log 5 % thì ops_checks ghi ok → warn → warn → crit và có sự kiện chuyển sang crit [test: apps/hub-api/src/modules/ops/ops.slo.int.test.ts » vượt 1% lỗi log liên tiếp]
## Yêu cầu: Tốc độ đốt ngân sách (nguồn: cr117-slo-opswatch)
Mỗi SLO giữ lịch sử 48 lượt; đốt ngân sách nhanh (≥ 6 lần mức cho phép, đủ 6 mẫu) báo warn dù chuỗi liên tiếp ngắn.
- Kịch bản: khi lịch sử có nhiều lượt xấu xen kẽ thì check warn kèm tốc độ đốt [test: apps/hub-api/src/modules/ops/domain/slo.rules.test.ts » chuỗi ngắn nhưng đốt ngân sách nhanh]
## Yêu cầu: p95 contracts.list từ access log nginx (nguồn: cr117-slo-opswatch)
Access log `web` có `rt=`/`urt=`; p95 (ms) và số request của `GET /pack/contracts/contracts` (không tính 4xx/5xx, bỏ query) vào `slo.json` `routes["contracts.list"]` mỗi 30 phút.
- Kịch bản: khi access log có 20 dòng contracts.list thì p95 = phần tử thứ 19 theo ms, dòng POST/5xx/route khác bị bỏ [test: tools/scripts/src/slo-routes.rules.test.ts » p95 contracts.list theo ms]
## Yêu cầu: Thiếu số đo không báo sai (nguồn: cr117-slo-opswatch)
Số đo thiếu (không có slo.json, file cũ, ít hơn 50 dòng log, không có job/timer) là "chưa có số đo", không tính vào chuỗi; không SLO nào đo được thì check ở trạng thái `unknown`.
- Kịch bản: khi slo.json cũ hoặc thiếu thì tỷ lệ lỗi log là null và check không ném lỗi [test: apps/hub-api/src/modules/ops/adapters/checks/slo.check.test.ts » quá ít dòng log / route ít request / file cũ / thiếu file; apps/hub-api/src/modules/ops/ops.slo.int.test.ts » không có slo.json]
