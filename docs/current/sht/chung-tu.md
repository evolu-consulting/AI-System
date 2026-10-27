# Sổ Hợp Tác · Chứng từ (HĐ · HĐ nguyên tắc · Giao dịch)

Cập nhật: 2026-10-27 · Gộp từ: DOC-model, DOC-deals, DOC-ui-list, DOC-ui-frame, DOC-ui-gaps, K4-reopen-version, CR-097/101/101a.

## 1. Ba loại chứng từ
Bảng `contracts.contracts`, cột `doc_type` ∈ `contract` (HĐ kinh tế, mặc định hàng cũ) · `framework` (HĐ nguyên tắc, "HĐ NT") · `deal` (Giao dịch). `deal` ∈ {buy, sell, referral}.
Nguồn: DOC-model, DOC-deals (CR-101). Code: `H/domain/doc-types.rules.ts`, `H/domain/deal.rules.ts`, `MG/0055_doc_model.sql`, `MG/0056_doc_deals.sql`, `C/doc-types.ts`.

## 2. HĐ nguyên tắc
- Chứng từ cha: **không** có mốc mặc định, kho, doanh thu, điểm uy tín, đếm HĐ. Có hạn mức (`credit_limit`, tuỳ chọn), cách đặt hàng (`order_terms`), bảng SP = "Bảng giá thoả thuận · không ảnh hưởng kho".
- Giá trị HĐ NT = Σ giá trị con (bỏ con `rejected`, bỏ trống); % hạn mức = Σ/hạn mức (1 chữ số lẻ; không hạn mức ⇒ không %). Giai đoạn theo hiệu lực: Chưa/Đang/Hết hiệu lực. Ngày con ngoài hiệu lực ⇒ chỉ cảnh báo, không chặn. (`frameSummary`, `dateOutsideFrame` trong `doc-types.rules.ts`.)
- Mốc của HĐ NT chỉ `renewal` (Nhắc gia hạn) + `other`; mốc tự sinh bị bỏ qua, ghi tay loại khác ⇒ 422 `FRAME_MILESTONE_KIND`. Nhắc gia hạn vẫn chạy (`reminders.repo`).
- Con (HĐ kinh tế, giao dịch) gắn qua `frame_root_id` = `root_id` chuỗi phiên bản của HĐ NT (HĐ NT lên v2 vẫn giữ con). Con phải **cùng đối tác + cùng hướng** khi cả hai phía đã biết; kiểm bằng trigger `contracts.doc_frame_check` (lúc gắn và lúc xác nhận con) ⇒ 422, mã = message (`FRAME_INVALID`, `FRAME_PARTNER_MISMATCH`). Không kiểm lúc AI đọc.
- Gắn/gỡ: `POST /contracts/:id/attach {ids}` (`:id` = bản bất kỳ của HĐ NT; quyền `write`), `DELETE /contracts/:id/frame` (`:id` = con). HĐ NT còn con ⇒ không đổi `doc_type` (409 `FRAME_HAS_CHILDREN`). Con hợp lệ = HĐ kinh tế hoặc giao dịch; HĐ NT hoặc phụ lục làm con ⇒ không hợp lệ (`attachVerdict`).
- Xoá HĐ NT (chỉ khi chuỗi một phiên bản): con giữ, `frame_root_id` = null (đứng riêng); xem trước xoá ghi số con.
- Người dùng không thấy HĐ NT (RLS) ⇒ API trả `frame: {restricted:true}`; UI "HĐ nguyên tắc (không có quyền xem)".
- Chi tiết HĐ NT (UI): khối "Chứng từ con" trên cùng (giá trị Σ, số chứng từ, hạn mức + thanh %, cảnh báo ngoài hiệu lực, gỡ liên kết), diễn biến xen mốc + con theo ngày, menu "Thêm vào diễn biến" (HĐ kinh tế / Giao dịch qua `/contracts/new?frame=<id>&type=…`, gắn chứng từ có sẵn nhiều id, mốc). Code: `W/features/frame-panel/**`, `W/features/contract-review/**`. Nguồn: DOC-ui-frame.
- Loại HĐ NT khỏi: tổng quan, business, điểm đối tác, việc của tôi, sourcing, xuất tệp, todo (mỗi chỗ một điều kiện `doc_type`).

## 3. Giao dịch (`doc_type = 'deal'`)
- Hàng `contracts`; **file không bắt buộc**, có `source` ∈ invoice|verbal|message|quote|other. Dùng chung mốc/kho/điểm/xoá/danh sách với HĐ.
- Tạo: `POST /contracts/deals` (JSON; `deal` + `source` bắt buộc; `settled_now` tuỳ chọn). Luôn `active` (bỏ qua luồng duyệt), sự kiện `created_deal`. Chưa nhận file khi tạo (gắn file = nâng). Gắn HĐ NT từ UI = `attach` sau khi tạo.
- `settled_now` ("đã giao / đã thanh toán ngay"): xác nhận lần lượt mốc mặc định qua lệnh settle (giao trước ⇒ kho chạy, vượt tồn theo công tắc). Lỗi ⇒ giao dịch vẫn lưu, trả `settle_error`, mốc còn lại mở.
- Mốc mặc định như HĐ cùng hướng (giao hàng + thu/trả; Giới thiệu: nhận hoa hồng). Kho chạy khi xác nhận mốc giao.
- **Lưu là có hiệu lực, không khoá (K1 bỏ qua `deal`)**; sửa trực tiếp bằng `PATCH /contracts/:id/fields`, không bắt lý do; máy ghi `contract_edit_log` (ai, khi nào, trường, cũ→mới) bằng trigger; đọc `GET /contracts/:id/edit-log`.
- **Nâng thành HĐ:** `POST /contracts/:id/promote` multipart (`file` ký + `number` bắt buộc; thiếu ⇒ 422 `PROMOTE_NEEDS_FILE|NUMBER`; không phải giao dịch hiện hành ⇒ 409 `NOT_A_DEAL`). Đổi `doc_type` → `contract`, **giữ id/mốc/kho/điểm**, khoá K1 ngay, không AI đọc lại; sự kiện `promoted`. UI: `W/features/promote-deal/**`.
- Xoá: luồng xoá HĐ (§7). Đối tác/vai (V2-C) tự theo trigger `contracts_v2c_roles_*`.
- Giao dịch cũ G1 (`transactions*`): đã chuyển thành `deal` bằng script `tools/scripts/src/migrate-transactions-to-contracts.ts` (chạy thử mặc định, `--apply` một transaction, idempotent); bảng G1 chỉ đọc (trigger `EG410 USE_CONTRACTS`). `/pack/contracts/transactions*`: GET đọc từ `deal` (hình DTO cũ), POST/PATCH/PUT/DELETE ⇒ 410 `USE_CONTRACTS`. Trên prod chỉ chạy thử, xem "Chưa rõ" cuối file.
- Nguồn: DOC-deals. Code: `H/adapters/deals.{repo,routes}.ts`, `H/application/promote-contract.usecase.ts`, `H/adapters/transactions-read.sql.ts`.

## 4. HĐ kinh tế: tạo, phiên bản, khoá
- **HĐ chỉ từ văn bản:** tải file ⇒ AI đọc ⇒ người kiểm. Nhập tay HĐ mới bị chặn (410); HĐ nhập tay cũ giữ, nhãn "Chưa có văn bản" (K3). Nguồn: CR-097.
- Tải lên (`POST /contracts` multipart) nhận `doc_type`, `frame_root_id`, `credit_limit`, `order_terms`; hộp chọn loại chứng từ ở UI trước khi vào hàng đợi (Giao dịch không tải file). AI gợi ý loại: có `doc_type_suggest` ở `ai_read` nhưng **UI chưa hiện** (xem "Chưa rõ"). Code: `H/adapters/upload.routes.ts`, `H/application/upload-contract.usecase.ts`.
- **Chuỗi phiên bản v1→vN** (K2): "Tải bản cập nhật" (`POST /contracts/:id/versions`) ⇒ nháp v(n+1) Chờ duyệt; xác nhận v2 ⇒ v1 superseded (giữ ngày riêng); cutover nghĩa vụ; bản kế thừa `doc_type`/`frame_root_id`/hạn mức/điều khoản. Danh sách chỉ bản hiện hành + nhãn vN; so sánh `GET /contracts/:id/versions/diff`.
- **Số phiên bản "-SĐn":** khi AI không đọc được số trên bản mới, điền sẵn "số gốc-SĐn" (n = version_no − 1; số gốc = số v1, hậu tố cũ bị thay), `verified=false`, sửa được; chỉ điền sẵn, không ép. Code: `H/domain/version-number.rules.ts`, gọi ở `run-extraction.usecase` (`prefillVersionNumber`).
- **Khoá cứng (K1):** xác nhận = khoá; mọi trường pháp lý (kể cả `notice_days`), thêm/sửa/xoá mốc, gắn SP, gắn HĐ gốc ⇒ 409. Còn được: giao việc, ghi nhận xử lý, xác nhận xong mốc, hoãn/nhắc, ghi việc với đối tác, tóm tắt AI. Code: `H/domain/lock.rules.ts`. Chi tiết quy trình ở `duyet-ky-so.md`.
- **Mở lại HĐ đã khoá:** `POST /contracts/:id/reopen`; quyền = **người phụ trách HĐ hoặc owner gói** (`canReopen`); lý do bắt buộc (thiếu ⇒ 400 `VALIDATION_ERROR`); không được phép ⇒ 403 `REOPEN_FORBIDDEN`; viewer ⇒ 403 `PACK_FORBIDDEN`; HĐ không thấy ⇒ 404. Về Chờ duyệt, có log. Một tx, 2 câu SQL. UI: link "Mở lại" theo `reopenRight` (`W/features/contract-lock/lib/lock-view.ts`). Nguồn: K4-reopen-version (CR-101a). Code: `H/application/reopen-contract.usecase.ts`, `H/adapters/reopen.repo.ts`.
- **Phụ lục chỉ đọc:** ngừng tạo phụ lục mới (sửa đổi = bản cập nhật ở trên). Gắn làm phụ lục `PATCH /contracts/:id/parent` ⇒ 410 `USE_VERSIONS`; **gỡ** (`parent_id: null`) vẫn được; phụ lục cũ vẫn đọc trong chi tiết; `AppendixPanel` chỉ đọc (chưa gắn vào trang). Gia hạn vẫn là HĐ mới nối tiếp. Số phụ lục prod = 0. Code: `H/adapters/appendix.routes.ts`, `W/features/appendix/**`.

## 5. Danh sách "Hợp đồng & giao dịch"
- Lọc loại qua `?type=framework|contract|deal` (Tất cả không ghi URL), có số trên từng ô (3 truy vấn `page_size=1`). Tất cả/HĐ NT gửi `nest=1`: con thụt dưới HĐ NT; HĐ kinh tế/Giao dịch lọc phẳng (không nest).
- Con nhóm theo `root_id` của HĐ NT (API `docs[]` có `root_id` + `source`); con không khớp cha ⇒ hiện cuối (`orphan`); cha không thấy ⇒ con đứng riêng + `frame_restricted`.
- Cột mặc định 7 cột; nhãn loại (HĐ nguyên tắc/Giao dịch) nằm trong cột "Loại"; cột "Nguồn" **chỉ hiện khi lọc Giao dịch**.
- List API `ListRow` giữ 22 khoá; thông tin chứng từ ở `docs` (cùng thứ tự `items`) + `children`, chỉ khi `nest=1` hoặc có `doc_type`. Số câu SQL list = 2; con lấy trong cùng câu (`= any(array)`).
- Menu 4 mục: Tổng quan, Hợp đồng & giao dịch, Đối tác, SP & Giá. `/transactions` → `/contracts?type=deal`, `/transactions/new` → `/contracts/new?type=deal`, `/transactions/$id` → `/contracts/$id`. Form giao dịch `/contracts/new?type=deal[&frame=<id>]` dùng chung `contract-form` (`dealMode`: nhãn Tên giao dịch / Số chứng từ / Ngày giao dịch; nguồn bắt buộc; ô đã giao/đã thanh toán ngay; chọn HĐ NT có tìm kiếm 20/lần). Cảnh báo pháp lý ở form: xem `phap-ly-va-can-xu-ly.md`.
- Nguồn: DOC-ui-list, DOC-ui-gaps. Code: `W/features/contracts-list/**`, `W/features/contract-form/**`, `W/features/contract-source/**`, `W/features/shell/lib/nav.ts`, `H/application/list-contracts.usecase.ts`.

## 6. Chi tiết chứng từ (`GET /contracts/:id`)
Khoá `doc` (optional ở zod): `frame` (`restricted`), `summary` (giai đoạn, giá trị Σ con, % hạn mức), `children` (≤ 500, `outside_frame`). Đầu trang: nhãn loại, hướng, đối tác, liên kết "thuộc HĐ nguyên tắc"; dòng File ký (HĐ) hoặc Tệp (giao dịch). Giao dịch có `EditLogPanel` (lịch sử sửa). `legal_warning` xem `phap-ly-va-can-xu-ly.md`.

## 7. Xoá chứng từ
`GET /contracts/:id/delete-preview` (xem trước tác động, gồm số con của HĐ NT) rồi `DELETE /contracts/:id`; quyền `admin` (owner gói). Chỉ xoá được chứng từ **một phiên bản** hoặc nháp mới nhất trong chuỗi (`has_versions` ⇒ không). Kho đảo theo `contract_id`; thiếu tồn để đảo ⇒ `stock_blocked`. Code: `H/application/delete-contract.usecase.ts`, `W/features/contract-delete/**`. Nguồn: V2-M, CR-097.

## Chưa rõ
1. HĐ nhập tay cũ không file ⇒ Giao dịch (Câu 7): **chưa có cờ ghi**, chờ số chạy thử prod. Số prod (2026-10-27): demo 17 HĐ (16 `file_id` null), titi-group-company 3 (2 null). Không biết cuối cùng chuyển hay giữ.
2. Upload `kind=appendix`: code `upload-contract.usecase.ts` vẫn nhận `kind: "contract" | "appendix"` (chưa 410 `USE_VERSIONS` như K4 dự định); UI không có đường tải phụ lục nên người dùng không tạo được, nhưng API vẫn cho.
3. AI gợi ý loại chứng từ (`doc_type_suggest`): API đổi `doc_type` sau tải lên không có; chip "AI gợi ý" ở màn kiểm chưa làm.
4. `detail.doc` chưa có `source` và `summary.paid`: dòng Tệp giao dịch chỉ hiện tên tệp; HĐ NT chưa hiện tổng đã thanh toán. Ghi chú giao dịch (`DealCreateRequest.note`) chưa có.
5. Trigger `doc_frame_check` lúc xác nhận con khi cha đổi đối tác sau khi gắn: mã lỗi hiển thị ở màn duyệt (`FRAME_PARTNER_MISMATCH`) chưa kiểm.
