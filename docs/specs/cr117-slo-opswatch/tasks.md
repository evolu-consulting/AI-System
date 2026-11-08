---
id: cr117-slo-opswatch
lát: cr117-slo-opswatch
cr: CR-117
làn: nhanh
migration: không
phụ thuộc: CR-104 ops-watch (đã trên gd0)
---
## Plan (ngắn)
CR-117 thiết kế lại thành PHẦN MỞ RỘNG của ops-watch (CR-104), không hệ thống song song: thêm MỘT check `slo` vào registry
(`apps/hub-api/src/modules/ops/adapters/checks/registry.ts`). Dùng đúng vòng 30 phút, bảng `hub.ops_checks`/`ops_events`, chuông
platform_admin, trang `/system` (thẻ + ngưỡng cấu hình + Gói chẩn đoán in `value`), "Kiểm tra ngay". Không cron/bảng/route mới.
- SLO (hằng số trong `domain/slo.rules.ts`): contracts.list p95 ≤ 700 ms · chat dispatch p50 ≤ 1000 ms (job queued→dispatched, thay cho
  first-delta vì first-delta chỉ là span OTel, không có trong DB) · timer PD-P01 trễ p95 ≤ 120 s (max với trễ hẹn giờ quá hạn hiện tại) ·
  tỷ lệ lỗi log ≤ 1 %. Mục tiêu 95 % lượt kiểm trong cửa sổ 48 lượt (≈ 24 giờ).
- Trạng thái giữa các lượt nằm trong `value.slos[]` của chính check (đọc lại qua `prev`): chuỗi vi phạm liên tiếp + lịch sử 0/1.
  warn/crit khi chuỗi ≥ ngưỡng `warn`/`crit` (mặc định 2/4 lượt, đơn vị mới `runs`, chỉnh ở /system); tốc độ đốt ngân sách
  (tỷ lệ xấu / (1 − target)) ≥ 6x với ≥ 6 mẫu cũng ⇒ warn. Lượt không có số đo không tính (giữ nguyên chuỗi).
- Nguồn: DB (một câu SQL chỉ đọc, scope system, statement_timeout 5 s) + file host `ops-status/slo.json` (`ops-slo-status.sh`, đếm log).

## Làm
- contracts: key `slo`, đơn vị `runs`, `OpsSloStatusSchema`; i18n vi/en (nhãn + đơn vị).
- hub-api ops: `domain/slo.rules.ts` (thuần), `adapters/checks/slo.sources.ts` + `slo.check.ts`, đăng ký registry.
- deploy: `ops-slo-status.sh` (+ kit deploy.ps1, setup.sh, README).
- Test: unit `slo.rules.test.ts`, `slo.check.test.ts`; int `ops.slo.int.test.ts`.

## Không làm / Chạm
- Không migration, không sửa module đóng băng, không đụng DLC. Không UI mới (thẻ /system tự hiện check mới theo OPS_CHECK_KEYS; e2e
  `e2e/ops/system.ops.ts` không sửa — khoá, vẫn xanh vì chỉ kiểm 8 nhãn cũ).
- p95 theo route: nginx `web` ghi `rt=$request_time urt=$upstream_response_time` (log_format `main_rt`, giữ nguyên trường combined);
  `ops-slo-status.sh` đẩy log qua `tools/scripts/src/slo-routes.ts` (service `tool`) ⇒ `slo.json.routes` (`contracts.list`, `contracts.approval`).
  Cần deploy lại image `web` một lần; trước đó contracts.list "chưa có số đo". `setup.sh` tự cài cron 30 phút (idempotent).

## Test tối thiểu
- unit: `bun test apps/hub-api/src/modules/ops` · int: evotest `-Step int -Filter apps/hub-api/src/modules/ops/ops.slo.int.test.ts`.

## Quyết định trong lúc làm
- Worktree cũ `cr117-slo` (bản song song: collector bash 5 phút, slo.json riêng, ops:check, ngân sách trên slo.log) bỏ; chỉ giữ ý:
  định nghĩa SLO, ngân sách lỗi/đốt, cổng "nodata". Không tái dùng code (luật chạy trên mẫu 5 phút từ file log, khác mô hình).
- Chuỗi tính theo lượt kiểm, kể cả "Kiểm tra ngay" (≤ 1 lần/phút) — chấp nhận.
- Trạng thái `unknown` (chưa có số đo nào) không phát chuông (luật CR-104 sẵn có).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/ops-watch-slo.md
#### Yêu cầu: Check SLO trong ops-watch
Lượt kiểm ops-watch (30 phút) có thêm check `slo`: đo contracts.list p95, chat dispatch p50, trễ timer PD-P01 và tỷ lệ lỗi log, so với giới hạn cố định; kết quả nằm ở `value.slos[]` của thẻ "SLO / hồi quy" trên `/system` và trong Gói chẩn đoán.
- Kịch bản: khi một SLO vượt giới hạn 2 lượt kiểm liên tiếp thì check chuyển warn, 4 lượt thì crit, và một lượt tốt đặt lại chuỗi [test: apps/hub-api/src/modules/ops/domain/slo.rules.test.ts » vi phạm liên tiếp cộng dồn; apps/hub-api/src/modules/ops/adapters/checks/slo.check.test.ts » lỗi log vượt 1% N lượt liên tiếp]
- Kịch bản: khi lượt kiểm thật chạy 4 lần với tỷ lệ lỗi log 5 % thì ops_checks ghi ok → warn → warn → crit và có sự kiện chuyển sang crit [test: apps/hub-api/src/modules/ops/ops.slo.int.test.ts » vượt 1% lỗi log liên tiếp]
#### Yêu cầu: Tốc độ đốt ngân sách
Mỗi SLO giữ lịch sử 48 lượt; đốt ngân sách nhanh (≥ 6 lần mức cho phép, đủ 6 mẫu) báo warn dù chuỗi liên tiếp ngắn.
- Kịch bản: khi lịch sử có nhiều lượt xấu xen kẽ thì check warn kèm tốc độ đốt [test: apps/hub-api/src/modules/ops/domain/slo.rules.test.ts » chuỗi ngắn nhưng đốt ngân sách nhanh]
#### Yêu cầu: p95 contracts.list từ access log nginx
Access log `web` có `rt=`/`urt=`; p95 (ms) và số request của `GET /pack/contracts/contracts` (không tính 4xx/5xx, bỏ query) vào `slo.json` `routes["contracts.list"]` mỗi 30 phút.
- Kịch bản: khi access log có 20 dòng contracts.list thì p95 = phần tử thứ 19 theo ms, dòng POST/5xx/route khác bị bỏ [test: tools/scripts/src/slo-routes.rules.test.ts » p95 contracts.list theo ms]
#### Yêu cầu: Thiếu số đo không báo sai
Số đo thiếu (không có slo.json, file cũ, ít hơn 50 dòng log, không có job/timer) là "chưa có số đo", không tính vào chuỗi; không SLO nào đo được thì check ở trạng thái `unknown`.
- Kịch bản: khi slo.json cũ hoặc thiếu thì tỷ lệ lỗi log là null và check không ném lỗi [test: apps/hub-api/src/modules/ops/adapters/checks/slo.check.test.ts » quá ít dòng log / route ít request / file cũ / thiếu file; apps/hub-api/src/modules/ops/ops.slo.int.test.ts » không có slo.json]

## Việc còn lại
- Deploy lại image `web` + `setup.sh` trên server (cài cron, có `routes`) — chỉ khi người dùng xác nhận deploy. `nginx -t` đã xanh (nginx:stable-alpine, evotest).
- Xoá worktree/nhánh `cr117-slo` (bản cũ) sau khi điều phối đồng ý.
