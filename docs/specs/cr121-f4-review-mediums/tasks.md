---
id: cr121-f4-review-mediums
lát: cr121-f4-review-mediums
cr: CR-121
làn: nhanh (soát migration: Opus low sau lát)
migration: admin 0036, hub 0102
phụ thuộc: cr121-c2-tenant-profile, cr121-c3a-overview-api, R-1 (rerun_of 0098)
---
## Plan (ngắn)
Sửa các điểm Medium của review cuối đợt CR-121: PII `profile` với hub_ro, view Dify chạy theo quyền chủ, thiếu test chặn chéo công ty, kiểm vai trong service hồ sơ công ty, uuid `:id` của route điều khiển lượt chạy, FK `rerun_of`.

## Làm
1. admin 0036: `REVOKE SELECT (profile) ON admin.tenants FROM hub_ro` (grep hub-api/agent-runtime/worker: không nơi nào đọc cột `profile`, chỉ chọn cột tường minh).
2. hub 0102: gỡ view `hub.dify_run_stats`; thêm hàm DEFINER `hub.dify_run_counts(since[, until])` (chỉ số đếm theo workflow_id, status) và `hub.dify_failing_tool_count(since, streak[, until])` (chỉ một số nguyên); pin search_path, REVOKE PUBLIC, GRANT EXECUTE hub_rw. `overview.repo.ts` Q2 gọi hàm: vẫn MỘT câu SQL (8 lời gọi hàm: 7 cửa sổ ngày + 1 giờ + 24 giờ; mỗi dòng quét đúng một lần).
3. hub 0102 (gộp 0103): FK `process_runs_rerun_of_fk` đổi `ON DELETE SET NULL` (NOT VALID rồi VALIDATE).
4. `tenants.profile.service.ts`: GET kiểm vai (platform_admin/tenant_admin; công ty khác ⇒ 404), PATCH chỉ platform_admin (403) ngay trong service.
5. `gates.routes.ts`: `:id` của stop / rerun-step / rerun dùng `parseIdParam` (không phải uuid ⇒ 404 thay vì 500).
6. Test chặn chéo công ty: Community (queue, 3 decide) + `inboxOf`/nav contracts.

## Không làm / Chạm
Không sửa migration đã merge. Không đụng DLC. Các route `review-tasks/:id/*` và `process-runs/:id/{cancel,decide}` cũng dùng `c.req.param("id")` nhưng ngoài phạm vi (ghi nợ).

## Test tối thiểu
- `apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts` (hub_ro × profile, hàm đếm Dify, FK rerun_of).
- `apps/hub-api/src/modules/packs/community/adapters/community.cross-tenant.int.test.ts` (chéo công ty).
- `tests/acceptance/CF/approval-inbox-count.int.test.ts` (ghép chéo user/công ty cho inboxOf + nav).
- `apps/admin-api/src/modules/tenants/tenants.profile.authz.test.ts` (unit, quyền ở service).
- Hồi quy: `ops.overview.int.test.ts`, `ops.overview.perf.int.test.ts`, `migrate-hub.int.test.ts`, `tenants.profile.int.test.ts`.

## Quyết định trong lúc làm
- Hàm đếm nhận thêm `p_until` (mặc định vô hạn) so với brief `(since)`: để Q2 không quét `dify_runs` nhiều lần chồng nhau (cửa sổ ngày rời nhau, mỗi dòng đọc một lần — Luật 4c). Gọi một đối số vẫn hợp lệ.
- Chuỗi lỗi liên tiếp cần thứ tự thời gian nên không suy ra được từ số đếm: thêm hàm thứ hai chỉ trả MỘT số nguyên (không lộ workflow nào).
- 0103 gộp vào 0102 (đều chạm hub, nhỏ, cùng lát).
- Test chéo công ty Community: admin công ty B được cấp ĐỦ quyền gói (entitle + role owner của B) để chứng minh chính RLS/tenant chặn, không phải thiếu quyền gói.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/ho-so-cong-ty.md
#### Yêu cầu: Hồ sơ công ty chứa PII không lộ cho Hub, quyền kiểm ngay ở service
Cột `profile` (jsonb) của công ty không còn đọc được bằng role `hub_ro`. Đọc hồ sơ: platform_admin mọi công ty, tenant_admin chỉ công ty mình; sửa hồ sơ chỉ platform_admin — kiểm trong service, không chỉ ở route.
- Kịch bản: khi hub_ro đọc cột `profile` thì bị từ chối (42501), các cột khác vẫn đọc được [test: apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts » đọc cột profile (kể cả select *) bị từ chối, cột còn lại vẫn đọc được]
- Kịch bản: khi member gọi đọc hoặc tenant_admin công ty khác gọi đọc thì 403 / 404, và tenant_admin gọi sửa thì 403 không ghi gì [test: apps/admin-api/src/modules/tenants/tenants.profile.authz.test.ts » GET: member ⇒ FORBIDDEN, tenant_admin công ty khác ⇒ NOT_FOUND]

### ADDED admin/tong-quan-platform.md
#### Yêu cầu: Tổng quan chỉ đọc số đếm Dify qua hàm, không đọc thô bảng chạy Dify
Tổng quan lấy số lần chạy/lỗi Dify qua hàm `hub.dify_run_counts` và `hub.dify_failing_tool_count` (chỉ số đếm); không còn view `hub.dify_run_stats`; `hub_rw` không đọc trực tiếp `hub.dify_runs`.
- Kịch bản: khi hub_rw đọc `hub.dify_runs` thì bị từ chối, view cũ không còn, hàm đếm trả đúng số theo (workflow, trạng thái) và chuỗi lỗi liên tiếp [test: apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts » hub_rw không đọc dify_runs, view cũ đã gỡ, dify_run_counts chỉ trả số đếm đúng]
- Kịch bản: khi hub_ro gọi hàm đếm thì bị từ chối [test: apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts » hub_ro không gọi được hàm đếm (chỉ hub_rw được EXECUTE)]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Admin công ty khác không xem/quyết được hàng đợi duyệt, yêu cầu tham gia, báo cáo
Người gọi thuộc công ty B (kể cả admin đủ quyền gói) không thấy hàng của công ty A trong hàng đợi/danh sách và không quyết được (403/404); dữ liệu công ty A không đổi.
- Kịch bản: khi admin công ty B quyết bài/yêu cầu tham gia/báo cáo của công ty A thì 403 hoặc 404 và dữ liệu A giữ nguyên [test: apps/hub-api/src/modules/packs/community/adapters/community.cross-tenant.int.test.ts » admin công ty B: không thấy hàng đợi của A, quyết bài/yêu cầu tham gia/báo cáo của A ⇒ 403/404 và dữ liệu A không đổi]

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Hộp "Chờ tôi duyệt" của Sổ Hợp Tác không lẫn công ty; điều khiển lượt chạy với id sai ⇒ 404; chạy lại không chặn xoá run gốc
`inboxOf` và mục nav contracts ghép người công ty này với công ty khác ⇒ 0 việc, không vai duyệt, không ghi gì. `POST /process-runs/:id/{stop,rerun-step,rerun}` với `:id` không phải uuid trả 404. Xoá run gốc không bị chặn bởi run chạy lại (`rerun_of` về NULL).
- Kịch bản: khi ghép người A với công ty B (và ngược lại) thì 0 việc, không approver, không cap nav [test: tests/acceptance/CF/approval-inbox-count.int.test.ts » F-4 · ghép chéo (người A + công ty B, người B + công ty A) ⇒ 0 việc, không vai duyệt, không cap nav, không ghi gì]
- Kịch bản: khi xoá run gốc thì FK `rerun_of` là ON DELETE SET NULL [test: apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts » FK đổi sang ON DELETE SET NULL (đã VALIDATE)]

## Việc còn lại
- Soát migration admin 0036 + hub 0102 (Opus low).
- Ghi nợ: `c.req.param("id")` không kiểm uuid ở `review-tasks/:id/*`, `process-runs/:id/{cancel,decide}`.
