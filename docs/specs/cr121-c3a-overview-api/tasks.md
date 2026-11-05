---
id: cr121-c3a-overview-api
lát: cr121-c3a-overview-api
cr: CR-121
làn: nhanh
migration: có (hub 0100: view hẹp dify_run_stats + 2 chỉ mục, không đổi dữ liệu)
phụ thuộc:
---
## Plan (ngắn)
`GET /ops/overview` (hub-api, chỉ platform_admin — cùng guard `/ops/*`) trả DTO `OpsOverview` (`packages/contracts/src/hub-admin/ops-overview.ts`) cho trang
"Tổng quan admin platform" theo mockup đã duyệt. Số liệu chính nằm ở Hub (process_runs, dify_runs, jobs, usage_logs, ops_checks) nên endpoint đặt ở
`modules/ops` của hub-api; UI lát sau gọi qua `hubUrl("/ops/overview")` như `features/hub`. `GET /admin/overview` (admin-api) giữ nguyên cho tenant_admin.

## Làm
- Contract `OpsOverviewSchema` + query (`stuck_hours` 1–72 mặc định 4, `quota_pct` 50–100 mặc định 80; sai ⇒ mặc định, không 4xx).
- `adapters/overview.repo.ts`: SÁU câu SQL văn bản cố định (Luật 4c) — runs / dify / quota / companies / infra / flow_coverage. Cộng 2 câu scope của `systemRead` = 8 câu mỗi lần tính.
- `application/overview.service.ts`: gộp + cache 60 s trong process theo (stuck_hours, quota_pct), một lượt tính bay mỗi khoá. `domain/overview.rules.ts`: tỷ lệ, p95 phút, chuỗi 7 ngày/24 giờ (thuần, có unit).
- Migration hub 0100: view hẹp `hub.dify_run_stats(workflow_id, status, created_at)` + `GRANT SELECT` view cho hub_rw (KHÔNG cấp bảng `dify_runs`: tránh lộ error_message/id Dify mọi tenant) + chỉ mục `dify_runs(created_at)`, `process_runs(started_at)` (cửa sổ toàn nền tảng; không có thì quét toàn bảng).
- Test: unit luật thuần; int dữ liệu mồi có đáp án tính tay (+ đếm SQL + cache); int route (403/401/200 + schema); perf 10.000 lượt chạy.

## Không làm / Chạm
- Không UI (lát sau). Không đổi `/admin/overview`. Không đụng đường dẫn DLC.
- Link đích của "Cần xử lý ngay" (`/runs?filter=attention&hours=N`, `/tenants?filter=unrouted|near_quota`, `/workflows?filter=failing`, `/system`) do UI/trang đích lát sau hiện thực bộ lọc.

## Test tối thiểu
- `apps/hub-api/src/modules/ops/domain/overview.rules.test.ts` (unit), `ops.overview.int.test.ts`, `ops.overview.routes.int.test.ts`, `ops.overview.perf.int.test.ts` (perf).

## Quyết định trong lúc làm
- **Định nghĩa số liệu** (cũng nằm trong comment contract): lượt chạy = `hub.process_runs` của công ty khách (bỏ tenant `platform`), tính theo `started_at`; cửa sổ trượt 24 giờ so `generated_at` (không theo lịch). Lỗi = `failed` + `expired`; tỷ lệ lỗi = lỗi / (xong + lỗi + hết hạn) kết thúc trong cửa sổ (huỷ không tính). "Đang chạy" = running + waiting_review + waiting_answer.
- **p95**: tính được "trừ thời gian chờ người duyệt" (tổng khoảng `review_tasks.created_at → decided_at/finished_at` của lượt, kẹp ≥ 0) ⇒ `p95_basis = excluding_review_wait`; chỉ lượt `done`. Chưa có lượt xong ⇒ `null`.
- **Lỗi công cụ AI** = `hub.dify_runs.status = 'failed'` (Dify workflow = "công cụ AI" theo i18n). Brief ghi "hub.runs/jobs" nhưng đó là run chat/agent CLI, không phải công cụ AI của quy trình; `dify_runs` là nguồn duy nhất có trạng thái lỗi theo workflow. "Lỗi liên tục" = 3 lần chạy gần nhất (trong 24 giờ) của cùng workflow đều lỗi (`OVERVIEW_AI_TOOL_STREAK`).
- **Kẹt/lỗi quá N giờ**: `running`/`needs_decision` không cập nhật quá N giờ + lượt `failed`/`expired` kết thúc quá N giờ (≤ 7 ngày) mà chưa có lượt chạy lại (`rerun_of`). `waiting_review`/`waiting_answer` là chờ người ⇒ không tính kẹt.
- **Hạn mức AI tháng**: hạn mức TOÀN công ty (`tenant_quotas.feature_id is null`); % mỗi công ty = lớn nhất của lượt/token/USD (cùng `quotaPct` admin-api); KPI gộp = tổng USD đã dùng / tổng `max_usd` của công ty có hạn mức USD. `series` = chi phí USD mỗi ngày (không phải %).
- **Công ty hoạt động 7 ngày** = có lượt chạy quy trình HOẶC dòng dùng AI (Hub). Đăng nhập không dùng được: `admin.users.last_login_at` không cấp cho `hub_ro`.
- **Công ty chưa gán quy trình / cấu hình nửa vời** đọc từ check `flow_coverage` (ops-watch, `hub.ops_checks`) — không tính lại; chưa có lượt kiểm nào ⇒ 0. Danh sách bị cắt (≥ 20) ⇒ dùng `gap_count` (cận trên).
- **Sức khoẻ**: trễ hàng đợi nền = max(việc `queued` chờ lâu nhất, hẹn giờ quá hạn lâu nhất); Dify 1h = failed/tổng `dify_runs` 1 giờ (< 1 lần ⇒ `null`); DB = `pg_stat_activity` của role hub_api (truy vấn đang chạy lâu nhất, kết nối), `pg_database_size`; phiên bản = `deploy_ref` trong `host.json` do host ghi (dòng đầu file VERSION).
- Query sai ⇒ mặc định thay vì 422 (màn hình chủ không được hỏng vì tham số).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/tong-quan-platform.md
#### Yêu cầu: Tổng quan admin platform chỉ cho platform_admin
`GET /ops/overview` (Hub) chỉ trả cho platform_admin; tenant_admin/member bị 403, không token 401.
- Kịch bản: khi tenant_admin hoặc member gọi thì 403 FORBIDDEN, không token thì 401, platform_admin thì 200 đúng hợp đồng và tham số sai dùng mặc định [test: apps/hub-api/src/modules/ops/ops.overview.routes.int.test.ts » tenant_admin/member ⇒ 403, không token ⇒ 401, platform_admin ⇒ 200 đúng schema, tham số sai ⇒ mặc định, lần hai = cache]

#### Yêu cầu: Chỉ số vận hành tính đúng, nói rõ cách tính
Lượt chạy 24 giờ (kèm đang chạy/lỗi/cần quyết định), tỷ lệ lỗi hôm nay và hôm qua, p95 thời gian xử lý (trừ thời gian chờ người duyệt, ghi `p95_basis`), lỗi công cụ AI, hạn mức AI tháng, công ty hoạt động 7 ngày — mỗi KPI kèm chuỗi 7 ngày; 24 cột giờ xong/lỗi.
- Kịch bản: khi có dữ liệu mồi thì KPI, 24 cột giờ, mục cần xử lý và sức khoẻ khớp đáp án tính tay [test: apps/hub-api/src/modules/ops/ops.overview.int.test.ts » KPI, 24 cột giờ, cần xử lý, sức khoẻ khớp đáp án tính tay và qua schema hợp đồng]
- Kịch bản: khi đổi ngưỡng giờ kẹt / % hạn mức thì số "cần xử lý" đổi theo [test: apps/hub-api/src/modules/ops/ops.overview.int.test.ts » ngưỡng cấu hình: stuck_hours = 12 ⇒ chỉ còn lượt lỗi cũ hơn 12 giờ (1), quota_pct = 95 ⇒ không công ty nào]
- Kịch bản: khi tính tỷ lệ/p95/chuỗi thì mẫu số 0 ra "chưa có dữ liệu" thay vì 0% [test: apps/hub-api/src/modules/ops/domain/overview.rules.test.ts » ratePct: 1 chữ số thập phân, mẫu số 0 ⇒ null (chưa có dữ liệu, không phải 0%)]

#### Yêu cầu: Tổng quan nhanh và rẻ (Luật 4c)
Mỗi lần tính dùng số câu SQL cố định (≤ 8 kể cả scope) bất kể số công ty/lượt chạy; kết quả cache 60 giây trong process.
- Kịch bản: khi gọi lần hai trong 60 giây thì 0 câu SQL, hết hạn thì tính lại, thêm dữ liệu không đổi số câu [test: apps/hub-api/src/modules/ops/ops.overview.int.test.ts » số câu SQL cố định ≤ 8 (kể cả scope), lần gọi thứ hai trong 60 s dùng cache (0 câu), hết hạn ⇒ tính lại]
- Kịch bản: khi có 10.000 lượt chạy / 50 công ty thì p95 ≤ 300 ms [test: apps/hub-api/src/modules/ops/ops.overview.perf.int.test.ts » 10.000 lượt chạy / 50 công ty: p95 ≤ 300 ms, ≤ 8 câu SQL]

## Việc còn lại
- UI "Tổng quan" (lát sau): gọi `GET /ops/overview`; trang đích + bộ lọc cho các link (`/runs`, `/tenants?filter=…`, `/workflows?filter=failing`).
- Quy mô lớn: `process_runs`/`dify_runs` cần 2 chỉ mục của hub 0100 (đã thêm); `usage_logs` dùng `usage_logs_at_idx` + `usage_logs_tenant_at_idx` sẵn có.
- Số migration 0100 chọn tạm — đối chiếu với lát song song (c3c, f1, b2) trước khi merge.
