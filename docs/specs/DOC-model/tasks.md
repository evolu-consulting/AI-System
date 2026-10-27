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

## Việc còn lại
- [ ] 1–8 ở trên.
