# Admin · Tổng quan platform (API ops/overview)

Cập nhật: 2026-11-09 · Gộp từ: cr121-c3a-overview-api, cr121-f4-review-mediums (đợt cr125-wave).

## Yêu cầu: Tổng quan admin platform chỉ cho platform_admin (nguồn: cr121-c3a-overview-api)
`GET /ops/overview` (Hub) chỉ trả cho platform_admin; tenant_admin/member bị 403, không token 401.
- Kịch bản: khi tenant_admin hoặc member gọi thì 403 FORBIDDEN, không token thì 401, platform_admin thì 200 đúng hợp đồng và tham số sai dùng mặc định [test: apps/hub-api/src/modules/ops/ops.overview.routes.int.test.ts » tenant_admin/member ⇒ 403, không token ⇒ 401, platform_admin ⇒ 200 đúng schema, tham số sai ⇒ mặc định, lần hai = cache]

## Yêu cầu: Chỉ số vận hành tính đúng, nói rõ cách tính (nguồn: cr121-c3a-overview-api)
Lượt chạy 24 giờ (kèm đang chạy/lỗi/cần quyết định), tỷ lệ lỗi hôm nay và hôm qua, p95 thời gian xử lý (trừ thời gian chờ người duyệt, ghi `p95_basis`), lỗi công cụ AI, hạn mức AI tháng, công ty hoạt động 7 ngày — mỗi KPI kèm chuỗi 7 ngày; 24 cột giờ xong/lỗi.
- Kịch bản: khi có dữ liệu mồi thì KPI, 24 cột giờ, mục cần xử lý và sức khoẻ khớp đáp án tính tay [test: apps/hub-api/src/modules/ops/ops.overview.int.test.ts » KPI, 24 cột giờ, cần xử lý, sức khoẻ khớp đáp án tính tay và qua schema hợp đồng]
- Kịch bản: khi đổi ngưỡng giờ kẹt / % hạn mức thì số "cần xử lý" đổi theo [test: apps/hub-api/src/modules/ops/ops.overview.int.test.ts » ngưỡng cấu hình: stuck_hours = 12 ⇒ chỉ còn lượt lỗi cũ hơn 12 giờ (1), quota_pct = 95 ⇒ không công ty nào]
- Kịch bản: khi tính tỷ lệ/p95/chuỗi thì mẫu số 0 ra "chưa có dữ liệu" thay vì 0% [test: apps/hub-api/src/modules/ops/domain/overview.rules.test.ts » ratePct: 1 chữ số thập phân, mẫu số 0 ⇒ null (chưa có dữ liệu, không phải 0%)]

## Yêu cầu: Tổng quan nhanh và rẻ (Luật 4c) (nguồn: cr121-c3a-overview-api)
Mỗi lần tính dùng số câu SQL cố định (≤ 8 kể cả scope) bất kể số công ty/lượt chạy; kết quả cache 60 giây trong process.
- Kịch bản: khi gọi lần hai trong 60 giây thì 0 câu SQL, hết hạn thì tính lại, thêm dữ liệu không đổi số câu [test: apps/hub-api/src/modules/ops/ops.overview.int.test.ts » số câu SQL cố định ≤ 8 (kể cả scope), lần gọi thứ hai trong 60 s dùng cache (0 câu), hết hạn ⇒ tính lại]
- Kịch bản: khi có 10.000 lượt chạy / 50 công ty thì p95 ≤ 300 ms [test: apps/hub-api/src/modules/ops/ops.overview.perf.int.test.ts » 10.000 lượt chạy / 50 công ty: p95 ≤ 300 ms, ≤ 8 câu SQL]

## Yêu cầu: Tổng quan chỉ đọc số đếm Dify qua hàm, không đọc thô bảng chạy Dify (nguồn: cr121-f4-review-mediums)
Tổng quan lấy số lần chạy/lỗi Dify qua hàm `hub.dify_run_counts` và `hub.dify_failing_tool_count` (chỉ số đếm); không còn view `hub.dify_run_stats`; `hub_rw` không đọc trực tiếp `hub.dify_runs`.
- Kịch bản: khi hub_rw đọc `hub.dify_runs` thì bị từ chối, view cũ không còn, hàm đếm trả đúng số theo (workflow, trạng thái) và chuỗi lỗi liên tiếp [test: apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts » hub_rw không đọc dify_runs, view cũ đã gỡ, dify_run_counts chỉ trả số đếm đúng]
- Kịch bản: khi hub_ro gọi hàm đếm thì bị từ chối [test: apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts » hub_ro không gọi được hàm đếm (chỉ hub_rw được EXECUTE)]
