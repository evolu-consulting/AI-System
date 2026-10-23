---
id: K2-versions
cr: CR-097 (đợt 1), CR-097b
items: R14, R15, R16, R18 (API), X5, X8; HD-FR-101 (cập nhật = phiên bản mới), HD-FR-102 (xác nhận v2 thay v1), HD-FR-103 (cutover nghĩa vụ)
lane: đầy đủ (tiền/kho, RLS, dữ liệu khách) — test cutover + RLS viết TRƯỚC code
migration: 0049_k2_contract_versions (journal when 1797800000000)
depends: K1 (e46976be)
---
# K2 — Chuỗi phiên bản + cutover

## Plan (đã làm)
- [x] Unit `domain/versions.rules.test.ts` (19 ca: hiện hành/nháp, điều kiện tải bản cập nhật, cutover, lý do, ngày hiệu lực, xoá, diff) + int `tests/acceptance/K2/versions.int.test.ts` (4 ca) viết trước.
- [x] Migration 0049: `root_id`, `version_no`, `supersedes_id`, `superseded_at`, `superseded_by`, `obligations.cancel_reason`; backfill v1 (`root_id = id`); trigger `contracts_k2_root` (INSERT không biết chuỗi ⇒ `root_id = id`); CHECK chuỗi; FK `(root_id|supersedes_id, tenant_id)`; unique `(tenant_id, root_id, version_no)`; unique nháp mở `contracts_open_draft_uq`; index partial `contracts_current_list_idx (tenant_id, updated_at desc, id desc) where superseded_at is null`.
- [x] Trigger `contracts_k2_supersede` (AFTER UPDATE, khi v≥2 vừa khoá) = HD-FR-102/103 trong CÙNG tx của mọi đường xác nhận; trigger `contracts_k2_ro` (bản bị thay chỉ đọc ⇒ SQLSTATE `EK409` ⇒ Hub 409 `CONTRACT_SUPERSEDED`).
- [x] `POST /contracts/:id/versions` (cùng đường tải lên/FileBox/quota/AI đọc), danh sách chỉ bản hiện hành + `version_no`/`versions_count`, chi tiết `versions`/`current_id`/`superseded_*`, xoá trong chuỗi (409), mở lại khi có nháp (409), `GET /contracts/:id/versions/diff`.
- [x] V2-H: `v2d_sync_service_customers` — v(n+1) tiếp quản dòng khách của bản trước KHÔNG tính gia hạn.

## Quyết định trong lúc làm
- **K2-01 cutover ở DB (trigger) như K1-01:** "xác nhận" có nhiều đường ("Lưu" khi tắt duyệt `review.repo`, finalize `approval.repo`, contract-flow). Trigger AFTER UPDATE `WHEN supersedes_id is not null and superseded_at is null and OLD.locked_at is null and NEW.locked_at is not null` (K1 BEFORE đã lấp `locked_at`) chạy 3 câu theo tập, số câu cố định: ① `superseded_at/by` cho mọi bản trước chưa bị thay của chuỗi ② huỷ nghĩa vụ ③ event. Không đụng ngày/trường của v1 (decision 5).
- **K2-02 chọn nghĩa vụ cutover:** của bản bị thay, `status='open'` và `due_date ≥ ngày hiệu lực v(n+1)` ⇒ `cancelled` + `cancel_reason = 'thay bằng phiên bản N'`. `done`/`replaced`/`cancelled` không đụng; hạn trước ngày hiệu lực giữ (nợ cũ vẫn thu/trả, kể cả đã hoãn — xét `due_date` gốc). Ngày hiệu lực = `start_date` của v(n+1), trống ⇒ `current_date`.
- **K2-03 kho:** nghĩa vụ có dòng kho (`stock_moves.milestone_id`) ⇒ GIỮ (không huỷ, không đảo kho) và ghi vào kết quả. Kết quả = event `version_cutover` trên v(n+1) `{superseded:[id], cancelled:[id], kept_stock:[id], effective_from, version_no}` + event `superseded {by, version_no}` trên bản bị thay (lịch sử HĐ). Phản hồi API xác nhận giữ nguyên hình (K3 đọc lịch sử nếu cần hiện).
- **K2-04 bản hiện hành / nháp:** hiện hành = bản chưa bị thay có `version_no` nhỏ nhất; bản chưa bị thay lớn hơn = nháp mở (≤ 1/chuỗi, index unique là lưới đua). v2 mở lại (K1) sau khi đã thay v1 vẫn là hiện hành.
- **K2-05 danh sách = `superseded_at is null`:** nháp v(n+1) CŨNG hiện (là việc "Chờ duyệt" cần thấy để duyệt; badge v2) cạnh bản hiện hành tới khi xác nhận. Facets + xuất tệp cùng lọc. `versions_count` đếm cả nháp (subquery theo index chuỗi, chỉ cho hàng của trang).
- **K2-06 RLS / kế thừa:** v(n+1) lấy `owner_user_id` của bản cũ (luật thấy M1 theo phụ trách) ⇒ ai thấy chuỗi thấy v2. Bản cũ không có phụ trách ⇒ `created_by` của v2 = `created_by` bản cũ (không mở rộng tập người thấy cho cấp trên của người tải). Không thấy bản cũ ⇒ câu ghi không thấy hàng ⇒ 404 (FileBox đã ghi được gỡ + hoàn quota như lỗi tải lên khác). Phiên bản chỉ cho `kind=contract` (phụ lục ⇒ 422 `VERSION_NOT_ALLOWED`, decision 9); không đụng `parent_id`.
- **K2-07 bản bị thay chỉ đọc:** trigger chặn đổi `fields, owner_user_id, locked_at, commission_*, deal, direction, parent_id, handled, title, file_id, superseded_*, root_id, version_no` ⇒ 409 `CONTRACT_SUPERSEDED` (map chung ở `lib/errors.ts::dbGuardCode`). Đổi `status` (vòng quét hạn) KHÔNG chặn để lô theo tập không vỡ. Nghĩa vụ còn mở của bản bị thay (hạn trước ngày hiệu lực, có kho) vẫn ghi sổ được (settle/hoãn) — là nợ thật.
- **K2-08 mở lại khi có nháp:** owner mở lại bản hiện hành trong lúc chuỗi có nháp ⇒ 409 `VERSION_DRAFT_EXISTS` (bỏ nháp trước); mở lại bản bị thay ⇒ 409 `CONTRACT_SUPERSEDED`.
- **K2-09 xoá (CR-097b):** `versions_count = 1` hoặc bản là nháp mở ⇒ xoá như V2-M; còn lại (hiện hành/đã thay trong chuỗi) ⇒ 409 `CONTRACT_HAS_VERSIONS` (cả `delete-preview`).
- **K2-10 dịch vụ (V2-H):** khi v(n+1) cùng chuỗi tiếp quản dòng `service_customers` ⇒ `renewals`/`prev_contract_id` giữ nguyên và luôn tiếp quản (kể cả hạn mới sớm hơn).
- **K2-11 tiêu đề v2:** trường `title` multipart tuỳ chọn; trống ⇒ giữ tiêu đề bản cũ.

## Endpoint / DTO cho K3
- `POST /pack/contracts/contracts/:id/versions` (quyền `write`, multipart `file` + `title?`) ⇒ 201 `UploadVersionResponse {id, status: extracting|extract_failed, version, version_no, root_id, supersedes_id}`. Lỗi: 404 không thấy/tenant khác; 409 `CONTRACT_NOT_LOCKED` (bản chưa xác nhận), `CONTRACT_SUPERSEDED`, `VERSION_DRAFT_EXISTS`; 422 `VERSION_NOT_ALLOWED` (phụ lục); 413/415/429/503 như tải lên. Sau đó v2 đi như HĐ mới: AI đọc ⇒ Chờ duyệt ⇒ "Lưu"/duyệt ⇒ v1 bị thay.
- `GET /contracts` ListRow (22 khoá): + `version_no`, `versions_count` (badge "vN" khi `versions_count > 1`).
- `GET /contracts/:id` Detail: + `version_no`, `versions_count`, `root_id`, `current_id`, `superseded_at`, `superseded_by`, `versions: [{id, version_no, status, superseded_at, number, effective_from, effective_to, total_value}]` (≤ 100, tăng dần). `superseded_at != null` ⇒ banner "Đã thay thế bởi phiên bản N" (N = `versions.find(v => v.id === superseded_by).version_no`) + nút "Mở bản hiện hành" (`current_id`), ẩn mọi nút ghi.
- `GET /contracts/:id/versions/diff?a=&b=` (read) ⇒ `{a:{id,version_no}, b:{id,version_no}, changes:[{key, a, b}]}` (23 trường pháp lý, chỉ khoá khác). 404 khi bản không thấy / khác chuỗi.
- Lỗi mới (`VERSION_ERRORS` ở `@ai/contracts` `pack-contracts/versions.ts`): `CONTRACT_SUPERSEDED` 409, `VERSION_DRAFT_EXISTS` 409, `CONTRACT_HAS_VERSIONS` 409, `VERSION_NOT_ALLOWED` 422.
- Lịch sử HĐ: event `version_cutover` (v mới), `superseded` (bản cũ), `uploaded.data.version_no/supersedes_id`.
- K3: nút "Tải bản cập nhật" chỉ khi `locked && superseded_at == null && !versions.some(v => v.version_no > version_no)`; nháp v2 xoá được = "Bỏ bản cập nhật". Fixture e2e `e2e/contracts-web/dataset-contract.ts` thiếu khoá mới.

## Tranh chấp test / đổi theo CR-097 (qc trong lát, relock `tests/.lock`)
| File | Đổi |
|---|---|
| `tests/acceptance/HD1/list.int.test.ts` | ListRow 20 ⇒ 22 khoá (`version_no`, `versions_count`) |
| `tests/acceptance/HD5/hd5.int.test.ts` | ListRow 20 ⇒ 22 khoá |
| `apps/hub-api/.../upload-contract.usecase.test.ts`, `upload-review-fixes.test.ts` | repo giả thêm `insertVersion` (không dùng) |

## Còn lại (ngoài lát)
- Các màn/vòng đọc khác vẫn tính bản đã bị thay như HĐ đang chạy (trạng thái giữ `active`): mywork/todo (`mywork.repo`, `todo.repo`), tổng quan V2-K, nhắc hạn HD4 (`contract_schedule` của v1), sổ đối tác/uy tín (HĐ bị thay vẫn là sự kiện thật). Đề xuất K3/D1: thêm `superseded_at is null` vào mywork/todo/overview + bỏ lịch nhắc của bản bị thay trong trigger 0049 (một câu theo tập). Chưa làm vì ngoài phạm vi brief (danh sách/chi tiết).
- UI (K3), e2e, `test:all` cuối đợt; review + security gộp cuối đợt.

## Kết quả
- Unit: `versions.rules.test.ts` 19 pass; gói contracts unit xanh.
- Int (`test:int:par`): K2 4/4; HD1 (cả thư mục), HD2, HD5, HD7, K1, HD3 reverify/guard, V2-D service/rls, V2-H, V2-M, products-confirm, V2-G review — xanh sau khi sửa 2 test đếm khoá ListRow.
- Perf danh sách `HD1/perf/list.perf.int.test.ts` (3 × 10.000 HĐ + nền 70.000, n=200): 45/45 pass, SQL=2, không Seq Scan. Danh sách p95 cao nhất 28.84 ms (page_size 100, sau ANALYZE; trước ANALYZE 27.72 ms); facets p95 45.74 ms trước / 44.64 ms sau ANALYZE (ngưỡng 50 — sát ngưỡng, chưa có số trước K2 cùng máy để so).
