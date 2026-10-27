---
id: DOC-model
lát: A1 (backend)
cr: CR-101 (Intake 2026-10-27 R3, R4, R30 API, R36, R43–R46; Câu 9)
làn: đầy đủ (migration, RLS, đọc dữ liệu chung; Opus)
migration: 0055_doc_model (journal idx 51, when 1798900000000)
phụ thuộc: không (chạy đầu tiên của đợt A)
---
# DOC-model — Loại chứng từ + HĐ nguyên tắc (backend)

## Plan (ngắn)
`contracts.doc_type` ∈ {`contract` (HĐ kinh tế), `framework` (HĐ nguyên tắc), `deal` (giao dịch; hàng giao dịch do DOC-deals thêm)}. Mặc định hàng cũ = `contract`. HĐ NT là chứng từ cha: không mốc mặc định, không kho/doanh thu/điểm/đếm HĐ. Chứng từ con (HĐ kinh tế, giao dịch) gắn HĐ NT qua `frame_root_id` = `root_id` của chuỗi phiên bản HĐ NT (v2 của HĐ NT tự tiếp quản con).

## Làm
| # | Việc | Ghi chú |
|---|---|---|
| 1 | 0055: `doc_type` (CHECK 3 giá trị, default `contract`), `frame_root_id` (FK `(frame_root_id, tenant_id)` tới `contracts.root_id`), `credit_limit`, `order_terms`; index `(tenant_id, frame_root_id)`; trigger/CHECK: con cùng đối tác + cùng hướng với HĐ NT (R43); `framework` không có hàng `obligations` | secure_table, RLS M1 giữ nguyên |
| 2 | Luật thuần `domain/doc-types.rules.ts` (test trước): giai đoạn HĐ NT theo hiệu lực (Chưa/Đang/Hết hiệu lực), giá trị = Σ giá trị con, % hạn mức, cảnh báo ngày ngoài hiệu lực (không chặn), mốc HĐ NT chỉ `renewal_reminder` + `other` | R44–R46 |
| 3 | API: tạo/upload nhận `doc_type`, `frame_root_id`, `credit_limit`, `order_terms` (zod `pack-contracts/doc-types.ts`); HĐ NT: bảng SP thành "Bảng giá thoả thuận" (không kho); `POST /contracts/:id/attach` (gắn chứng từ có sẵn, nhiều id, cùng đối tác + hướng); gỡ liên kết | R30 API, R42 API |
| 4 | AI gợi ý loại chứng từ khi upload (`extract-prompt.rules.ts` thêm trường `doc_type_suggest`); người dùng chọn lại được (Câu 9) | trường tô vàng "AI" |
| 5 | Xoá HĐ NT: giữ con, `frame_root_id` = null (con thành đứng riêng); V2-M xem trước tác động ghi số con | R36 |
| 6 | Loại HĐ NT khỏi: `overview.repo`, `business.repo`, `rep.sql`/`partners-data.repo`, `mywork.repo`, `sourcing.repo`, xuất tệp, `todo.repo` (chỉ thêm điều kiện `doc_type`, không thêm câu SQL); `reminders.repo` vẫn nhắc gia hạn HĐ NT | mỗi chỗ một điều kiện (như K2b) |
| 7 | `list-contracts*`: lọc `doc_type`, phân trang theo dòng cha, con của cha trong trang lấy bằng MỘT câu `= any(array)` (số câu cố định 3); facets giữ p95 ≤ 50 ms | Luật 4c; số đo thật trước → sau |
| 8 | Xác nhận lên v2 của HĐ NT: con theo `frame_root_id` nên không mất (kiểm bằng int) | R4 + rủi ro phiên bản |

## Không làm
Giao dịch (DOC-deals), cảnh báo pháp lý (DOC-legal), mọi UI, mở lại/phụ lục/"-SĐn" (K4), chuyển dữ liệu G1.

## Chạm (file/khu vực — lát khác KHÔNG sửa)
MG `0055_doc_model.sql` + journal; `H/domain/doc-types.rules.ts`; `H/application/create-contract*`, `upload-contract*`, `list-contracts*`, `delete-contract*`; `H/domain/extract-prompt.rules.ts`; các repo đọc ở mục 6; `@ai/contracts pack-contracts/doc-types.ts`. Là chủ duy nhất của `upload-contract*`/`upload-version*` (kế thừa `doc_type` qua phiên bản) trong đợt A.

## Test tối thiểu (Luật 0b)
Unit `doc-types.rules.test.ts`; MỘT int đường chính (tạo HĐ NT → gắn con → xác nhận v2 vẫn thấy con → xoá HĐ NT giữ con) + một ca lệch đối tác/hướng ⇒ 422; MỘT test chéo tenant cho cột/FK mới qua `rls-packs-v2.ts`; perf: list có con, p95 ≤ 50 ms + đếm số câu SQL cố định. Không chạy e2e.

## Quyết định (mặc định đã chốt)
Câu 9: con theo chuỗi `root_id`; HĐ NT không có giá trị riêng (= Σ con), hạn mức tuỳ chọn. RLS: con thấy được mà cha không ⇒ API trả `frame: {restricted:true}`.

## Quyết định trong lúc làm (2026-10-27)
- FK `contracts_frame_fk (frame_root_id, tenant_id) → contracts(id, tenant_id) ON DELETE SET NULL (frame_root_id)`: `root_id` không unique nên FK trỏ `id` của v1 (= `root_id` chuỗi); trigger kiểm cha là v1 + `doc_type = framework`. Xoá HĐ NT chỉ được khi chuỗi một phiên bản (X5 giữ nguyên) ⇒ FK SET NULL = "con giữ, đứng riêng" (chạy quyền chủ bảng ⇒ cả con người xoá không thấy).
- R43 kiểm trong DB (`contracts.doc_frame_check`, SQLSTATE `EK422` ⇒ Hub 422 mã = message) khi GẮN (INSERT/đổi `frame_root_id`) và khi con được XÁC NHẬN (khoá); KHÔNG kiểm lúc AI đọc (bên chưa chắc, luồng đọc không được vỡ). Bên/hướng trống ở một phía ⇒ cho qua. Đối tác = cột sinh `partner_key`, hướng = `direction`; cha so theo bản hiện hành của chuỗi HĐ NT.
- Mốc HĐ NT: brief ghi `renewal_reminder` — DB gọi là `renewal`; cho `renewal` + `other`. Mốc tự sinh (`default`/`ai`/`cks`) cho HĐ NT bị BỎ QUA (trigger BEFORE trả NULL, không làm hỏng lệnh duyệt); ghi tay ⇒ 422 `FRAME_MILESTONE_KIND`.
- HĐ NT còn con ⇒ không đổi `doc_type` (409 `FRAME_HAS_CHILDREN`).
- Gắn: `POST /contracts/:id/attach {ids}` (`:id` = bản bất kỳ của HĐ NT; con gắn cả chuỗi phiên bản); gỡ: `DELETE /contracts/:id/frame` (`:id` = con). Quyền `write`. HĐ NT không thấy/tenant khác ⇒ 404; con không thấy/không hợp lệ ⇒ 422 `FRAME_INVALID`. Event `frame_attached`/`frame_detached` trên bản hiện hành.
- Tải lên: `doc_type`, `frame_root_id` (id bản bất kỳ, repo quy về `root_id`), `credit_limit`, `order_terms` (chỉ HĐ NT). Không thấy cha / tenant khác ⇒ 422 `FRAME_INVALID` (không lộ tồn tại). Bản cập nhật (K2, `insertVersion`) kế thừa 4 cột từ bản cũ — chạm `upload-contract.repo.ts` (chủ duy nhất theo bảng trên), KHÔNG chạm `upload-version*`.
- ListRow giữ 22 khoá (test khoá HD1/HD5): thông tin chứng từ đi ở `docs` (cùng thứ tự `items`) + `children`, chỉ khi `nest=1` hoặc lọc `doc_type` (phản hồi cũ không đổi). `nest=1`: con có HĐ NT THẤY ĐƯỢC không đứng riêng; cha không thấy ⇒ con đứng riêng + `frame_restricted: true`. Con của các HĐ NT trong trang lấy trong CÙNG câu danh sách (`frame_root_id = any(array(...))`) ⇒ số câu SQL không đổi (2).
- Chi tiết: thêm khoá `doc` (optional trong zod để fixture cũ hợp lệ; Hub luôn trả): `frame` (`{restricted:true}` khi RLS không cho thấy cha), `summary` (giai đoạn theo hiệu lực, giá trị = Σ con bản hiện hành trừ `rejected`, % hạn mức), `children` (≤ 500, `outside_frame` theo ngày bắt đầu con). `json_build_object` đã đủ 100 tham số ⇒ nối `jsonb ||`.
- Loại HĐ NT (mỗi chỗ một điều kiện, không thêm câu): `overview.repo` (k), `business.repo` (rc, contracts_count), `rep.sql` (cv0), `partners-data.repo` (bCte, facts), `mywork.repo` (dl), `sourcing.repo` (loadQ), `todo.repo` (ce), xuất tệp (`exportRows`). `reminders.repo` không đổi (vẫn nhắc gia hạn HĐ NT).
- AI gợi ý: `doc_type_suggest` (tuỳ chọn) trong đầu ra agent + `ai_read`; chuẩn hoá bằng `parseDocTypeSuggest`; UI tô vàng/chọn lại ở DOC-ui-*.
- Test chéo tenant cho cột/FK mới đặt trong `tests/acceptance/DOC-model/doc-model.int.test.ts` (bộ `rls-packs-v2.ts` là theo BẢNG — 0055 không thêm bảng; `contracts` đã có trong bộ RLS).

## Việc còn lại
- [x] 1–8 (backend). Perf: `tests/acceptance/DOC-model/perf/list-frame.perf.int.test.ts` (số đo trong báo cáo lát).
- [ ] DOC-deals: hàng `doc_type = 'deal'` (file tuỳ chọn, Lưu là có hiệu lực, nâng thành HĐ giữ id) — cột/CHECK/trigger 0055 đã cho `deal` làm con HĐ NT; cần thêm luật mốc/kho cho deal + chuyển G1.
- [ ] UI (DOC-ui-list, DOC-ui-frame): dùng `nest=1`/`docs`/`children`, `detail.doc`, `POST …/attach`, `DELETE …/frame`, `ai.doc_type_suggest`, `delete-preview.frame_children`.
- [ ] Review cuối đợt: trigger `doc_frame_check` khi xác nhận con mà cha đổi đối tác sau khi gắn ⇒ 422 lúc xác nhận (thông báo lỗi ở màn duyệt cần mã `FRAME_PARTNER_MISMATCH`).
