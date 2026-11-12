---
id: cr139a-starter-head
cr: CR-139 (Q1)
lane: Opus (lõi giao việc/quyền duyệt) · không UI
---
# CR-139a · engine: kiểu người duyệt «Trưởng phòng của người đề xuất»

## Plan ngắn
| Phần | Làm |
|---|---|
| Contract | `APPROVER_MODES = ["group","user","starter_head"]` (`@ai/contracts/chat`); bước Duyệt thêm `after.approver_mode?` (vắng ⇒ suy như cũ từ `group_id`/`approver_user_id`, snapshot cũ không đổi). |
| Luật thuần | `domain/tasks/starter-head.rules.ts`: `isStarterHead(after)`, `pickStarterHead(depts, memberOf, starter, usable)`, `starterHeadFallback(starter, esc)`, hằng `STARTER_HEAD_MISSING`, `STARTER_HEAD_MAX_DEPTH = 32`. |
| Phân giải | `core/starter-head.sql.ts` `resolveStarterHead(tx, tenantId, stageRunId)` — MỘT câu (CTE đệ quy + `update … returning`): phòng của `started_by` (mọi phòng, cùng tenant) → leo `parent_group_id`; chọn trưởng gần nhất ≠ người gửi, active, không khoá; ghi vào snapshot run `stages[i].after.approver_user_id` (không ai ⇒ gỡ khoá). |
| Mở việc | `core/review-timing.sql.ts` `reviewTimingOf`: chỉ việc `review` của bước `starter_head` ⇒ gọi resolver; cửa = người được chọn (`need='head'`, giao đích danh qua `gateOnly`, uỷ quyền tự áp); không ai ⇒ giao dự phòng như R#15 (đích «Quá hạn chuyển cho» ≠ người gửi, rồi quản trị công ty trừ người gửi; hàng `via='escalated'`). |
| Kiểm def | `reviewHasGroup` + SQL `no_group` (company-flows) coi `starter_head` là đã có người duyệt (cả mẫu Thư viện); preview không cảnh báo «chưa chọn phòng». |
| Perf | +1 câu SQL mỗi lần mở việc, CHỈ ở bước `starter_head` (bước khác 0 câu thêm); không vòng lặp; tra PK `stage_runs`/`process_runs`/`departments(group_id)`, `group_members` theo (tenant, user). |

## Quyết định trong lúc làm
- Lưu kết quả ở **snapshot run** (`after.approver_user_id`), không thêm cột: mọi chỗ đọc cửa duyệt (`headGateSql`/`approverSql`, `assertHeadGate`, `task-view` `head_gate`/`can_act`, hộp việc, Nhận việc, uỷ quyền, `pack-runs-*`) đã đọc snapshot ⇒ đúng mà không sửa từng nơi; một nguồn sự thật cho «ai duyệt bước này của lượt này». Mở lại bước (làm lại) ⇒ phân giải lại, ghi đè.
- Người gửi thuộc nhiều phòng: lấy trưởng **gần nhất** tính từ mọi phòng (bậc nhỏ nhất); cùng bậc ⇒ `group_id` nhỏ nhất (xác định, không có `sort_order` ở `departments`).
- Trưởng phòng là người gửi / không còn dùng được (inactive, bị khoá) ⇒ bỏ qua, leo tiếp (tôn trọng «người gửi không tự duyệt»).
- Không ai tới gốc ⇒ không thêm `DecisionReason` (cần migration CHECK `review_tasks_reason_ck`); việc **không treo**: giao dự phòng như R#15. Mã `STARTER_HEAD_MISSING` là luật/hằng; trạng thái suy ra được: bước `approver_mode='starter_head'` mà snapshot không có `approver_user_id`.
- `approver_mode` cùng có `group_id` ⇒ việc giao phòng đó nhưng chỉ người được chọn quyết (như head_only); editor nên để `group_id = null`.
- Cảnh báo readiness «công ty chưa có phòng nào có trưởng» **chưa làm** ở lát này: mã readiness mới cần khoá i18n web (`check:error-codes`) ⇒ chuyển lát UI.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Bước Duyệt có kiểu người duyệt «Trưởng phòng của người đề xuất»
Bước Duyệt `approver_mode='starter_head'` giao cho trưởng phòng của người gửi, phân giải một lần khi mở việc: phòng không có trưởng hoặc trưởng là người gửi ⇒ lên phòng cha; không ai ⇒ giao quản trị công ty (không treo); uỷ quyền của người được chọn vẫn áp; không bao giờ lấy người của công ty khác; bước kiểu cũ chạy như cũ.
- Kịch bản: nhân viên phòng A gửi ⇒ chỉ trưởng phòng A quyết được [test: apps/hub-api/src/modules/processes/core/starter-head.int.test.ts » NV phòng A gửi]
- Kịch bản: phòng không có trưởng ⇒ trưởng phòng cha [test: apps/hub-api/src/modules/processes/core/starter-head.int.test.ts » phòng không có trưởng]
- Kịch bản: trưởng phòng tự gửi ⇒ trưởng phòng cấp trên [test: apps/hub-api/src/modules/processes/core/starter-head.int.test.ts » trưởng phòng tự gửi]
- Kịch bản: không tìm được ai ⇒ giao quản trị công ty, việc không treo [test: apps/hub-api/src/modules/processes/core/starter-head.int.test.ts » không ai]
- Kịch bản: trưởng phòng đã uỷ quyền ⇒ người được uỷ quyền quyết thay [test: apps/hub-api/src/modules/processes/core/starter-head.int.test.ts » uỷ quyền của trưởng A]
- Kịch bản: người gửi công ty khác không lấy trưởng phòng công ty này [test: apps/hub-api/src/modules/processes/core/starter-head.int.test.ts » chéo tenant]
- Kịch bản: bước người duyệt cụ thể (kiểu cũ) chạy như cũ [test: apps/hub-api/src/modules/processes/core/starter-head.int.test.ts » hồi quy]
- Kịch bản: chọn trưởng gần nhất khi thuộc nhiều phòng, bỏ người gửi và người bị khoá [test: apps/hub-api/src/modules/processes/domain/tasks/starter-head.rules.test.ts » pickStarterHead]

## Việc còn lại (lát UI · Sonnet)
- Editor bước Duyệt (admin): lựa chọn «Trưởng phòng của người đề xuất» ⇒ ghi `after.approver_mode='starter_head'`, `group_id=null`, bỏ `approver_user_id`/`head_only`.
- Thẻ duyệt / tiến trình: hiển thị tên người được chọn (đọc snapshot `approver_user_id` như người duyệt cụ thể); bước `starter_head` không có `approver_user_id` ⇒ câu «Không tìm thấy trưởng phòng của người gửi — quản trị công ty duyệt thay; đặt trưởng phòng ở Phòng ban».
- Readiness/preview: cảnh báo khi công ty chưa có phòng nào có trưởng (mã mới + khoá i18n).
- e2e hành trình (viết, chạy cuối đợt): NV gửi ⇒ trưởng phòng thấy thẻ và duyệt.
