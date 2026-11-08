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

#### Yêu cầu: Số chứng từ không ký tự đặc biệt
Số chứng từ chỉ gồm chữ không dấu, số và dấu gạch ngang, tối đa 50 ký tự; web chuẩn hoá khi gõ/dán/AI đọc và báo lỗi dưới ô; server chặn 422 path `number`; số cũ chưa sửa không chặn lưu.
- Kịch bản: số "2026/11-xyz" chuẩn hoá thành "2026-11-XYZ" [test: packages/contracts/src/pack-contracts/doc-number.test.ts]
- Kịch bản: tạo tay / PATCH với số có "/" ⇒ lỗi path number; PATCH không có khoá number không bị ảnh hưởng [test: packages/contracts/src/pack-contracts/doc-number.test.ts]
- Kịch bản: AI đọc số có "/" và dấu ⇒ form xác nhận điền bản chuẩn hoá [test: apps/workspace-web/src/features/contract-form/lib/review-model.test.ts]

#### Yêu cầu: Đọc hợp đồng scan và ảnh bằng AI (FLOW2-FR-27)
PDF không có lớp chữ và ảnh JPG/PNG được gửi thẳng cho AI đọc bằng thị giác thay vì dừng ở "cần OCR". Tệp từ 50 trang trở xuống được đọc hết (giới hạn cấu hình được).
- Kịch bản: khi PDF scan thì agent được gọi kèm tệp và hợp đồng sang "Chờ rà soát", không còn PDF_NEEDS_OCR [test: apps/hub-api/src/modules/packs/contracts/application/extraction-pdf.test.ts » CR-122 p9 · PDF scan ⇒ KHÔNG còn PDF_NEEDS_OCR: agent được gọi kèm TỆP (không văn bản) ⇒ needs_review]
- Kịch bản: khi PDF scan đúng 50 trang thì đọc hết [test: apps/hub-api/src/modules/packs/contracts/application/extraction-pdf.test.ts » CR-122 p9 · PDF scan 50 trang (đúng trần) ⇒ đọc hết]

#### Yêu cầu: Từ chối tệp quá số trang ngay khi tải lên (FLOW2-FR-27)
Tệp PDF (hoặc nhiều ảnh ghép lại) trên 50 trang bị từ chối ngay lúc tải lên bằng 422 `FILE_TOO_MANY_PAGES` kèm `{pages, limit}`: không lưu FileBox, không tạo hợp đồng nháp, không gọi AI. Chỗ chọn tệp hiện "Tệp có 72 trang, vượt giới hạn 50 trang. Hãy tách thành tệp ngắn hơn (ví dụ tách phụ lục) rồi tải lại."
- Kịch bản: khi tải PDF 72 trang thì 422 và không chạm quota, FileBox hay hợp đồng [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-formats.test.ts » PDF 72 trang (trần 50) ⇒ 422 FILE_TOO_MANY_PAGES {pages, limit}, KHÔNG quota/FileBox/HĐ]
- Kịch bản: khi hợp đồng cũ đã lưu quá trần thì báo quá lớn, không gọi AI [test: apps/hub-api/src/modules/packs/contracts/application/extraction-pdf.test.ts » CR-122 p9 · PDF scan 72 trang đã lưu từ trước (trần 50) ⇒ extract_failed PDF_TOO_LARGE, agent KHÔNG được gọi]

#### Yêu cầu: Tải nhiều ảnh chụp trang cho một hợp đồng (FLOW2-FR-27)
Tải lên được nhiều ảnh JPG/PNG cho MỘT hợp đồng; máy chủ ghép thành một PDF để lưu rồi đọc như PDF scan. Ghép nhiều ảnh chỉ nhận JPG/PNG; HEIC báo rõ "Định dạng HEIC chưa đọc được — hãy lưu sang PDF hoặc JPG".
- Kịch bản: khi tải 3 ảnh thì lưu 1 PDF vào FileBox và hợp đồng đọc như PDF [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-formats.test.ts » PDF ghép đi qua tải lên: FileBox nhận đúng 1 tệp PDF, hàng HĐ mime pdf, trích được xếp lượt]
- Kịch bản: khi tải 3 ảnh qua route multipart thật thì chỉ một PDF được lưu FileBox [test: tests/acceptance/HD1/ingest-formats.int.test.ts » 3 ảnh PNG ⇒ 201, MỘT PDF lưu FileBox (1 lần post), 1 hợp đồng mime pdf đang 'extracting']
- Kịch bản: khi tải ảnh HEIC thì báo chưa đọc được HEIC [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-formats.test.ts » HEIC ⇒ FILE_TYPE kèm format=heic (không chạm FileBox)]

#### Yêu cầu: Đường dự phòng đọc định dạng khác (FLOW2-FR-27)
Định dạng chưa có đường riêng vẫn được đọc theo bảng "định dạng → cách đọc": ảnh model nhận (WEBP, GIF) gửi thẳng; tệp chữ và zip-office lấy chữ; định dạng còn lại báo rõ "Định dạng X chưa đọc được — hãy lưu sang PDF hoặc JPG" kèm gợi ý nhập tay.
- Kịch bản: khi tải WEBP/GIF thì gửi thẳng AI như ảnh [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » WEBP/GIF được nhận ra và nằm trong danh sách MIME đính kèm]
- Kịch bản: khi tải tệp chữ (txt, csv, html, rtf, json) thì lấy chữ [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » txt/csv/json nhận theo đuôi + UTF-8]
- Kịch bản: khi tải xlsx/pptx/odt thì lấy chữ trong các XML [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » nhận ra theo tên phần và lấy chữ]
- Kịch bản: khi tải HEIC/TIFF/BMP thì báo chưa đọc được kèm tên định dạng [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » HEIC/TIFF/BMP/doc cũ ⇒ có tên định dạng để báo 'chưa đọc được — hãy lưu sang PDF hoặc JPG']

#### Yêu cầu: Lý do không đọc được hợp đồng
Khối "Không đọc được hợp đồng này" nêu lý do nghiệp vụ (tệp hỏng / quá lớn / định dạng chưa hỗ trợ / hết lượt AI) kèm gợi ý "Nhập tay".
- Kịch bản: khi lượt đọc lỗi PDF_TOO_LARGE thì trang rà soát nói tệp quá lớn và gợi ý Nhập tay [test: thủ công — chỉ đổi câu chữ hiển thị theo mã lỗi (ReviewParts.tsx FAIL_REASON)]

#### Yêu cầu: Mở lại quy trình duyệt khi công ty dùng flow theo sự kiện
Lượt chờ flow chưa có run hoặc có run đã kết thúc bất thường ⇒ "Mở lại" phát lại sự kiện gửi duyệt và nói đúng lý do; run đang chạy ⇒ báo bước duyệt đã đổi, không đụng. Thẻ báo đúng lý do (kể cả lỗi mở quy trình / thiếu phòng ban) bằng câu nghiệp vụ.
- Kịch bản: Mở lại khi run flow đã kẹt ⇒ lượt mở lại bằng flow, không rơi sang máy cũ [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » p24 · Mở lại khi lượt đã có run kẹt]
- Kịch bản: Mở lại khi run flow còn chạy ⇒ not_stalled, run giữ nguyên [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » p24 · Mở lại khi lượt đã có run kẹt]
- Kịch bản: chưa gán quy trình ⇒ thẻ nêu lý do + Mở lại [test: e2e/journey-approval/cr122-p24-not-assigned.spec.ts » chưa gán quy trình: thẻ nói rõ lý do]

#### Yêu cầu: Xác nhận và lưu giữ sản phẩm chọn lúc xác nhận khi bật flow
Cờ flow bật ⇒ hộp "Gắn sản phẩm" luôn mở ở nháp (không tuỳ ngưỡng giá trị), SP lưu ở lượt và gắn khi flow Đã duyệt. Sau khi gửi duyệt, thẻ cũ không còn nút Xác nhận và lưu.
- Kịch bản: xác nhận kèm SP ⇒ pending_links có SP, thẻ báo hộp SP [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » p24 · cờ flow bật: thẻ nháp luôn mở hộp SP]
- Kịch bản: thẻ cũ sau xác nhận ẩn nút [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » p24 · đã gửi duyệt]
- Kịch bản: push theo run engine [test: apps/workspace-web/src/features/contract-approval/lib/advance-wait.test.ts » pushRunIdOf (p24)]

#### Yêu cầu: Chi tiết lượt chạy nêu dữ liệu còn thiếu
Lượt dừng vì `missing_fact` ⇒ đầu trang nêu "Thiếu <trường> — điền rồi Thử lại".
- Kịch bản: RunDetail mang decision_missing [test: apps/hub-api/src/modules/processes/runs/run-detail.map.test.ts » missingOf (p24 · missing_fact)]

#### Yêu cầu: Thẻ duyệt hiển thị Ký số là một dòng
Bước Ký số (gửi + chờ ký xong) hiện MỘT dòng "Ký số" với trạng thái Đang chờ ký · Đã ký · Từ chối · Hết hạn, không tách "Chờ ký xong".
- Kịch bản: khi cụm gửi+chờ ở trạng thái chờ/đã ký/từ chối/hết hạn thì thẻ có đúng một dòng Ký số với trạng thái tương ứng [test: apps/hub-api/src/modules/processes/runs/pack-runs-modules.test.ts » gửi + chờ = MỘT dòng 'Ký số' (không còn 'Chờ ký xong')]

#### Yêu cầu: Bước tool của flow được gán chạy được không cần cấp quyền thủ công
Flow Thư viện được gán cho công ty có bước Ký số: sau khi duyệt xong, bước gửi ký chạy như flow bản công ty; thẻ duyệt hiện MỘT dòng Ký số: Đang chờ ký rồi Đã ký, kèm người ký.
- Kịch bản: duyệt xong thì Ký số Đang chờ ký kèm người ký, người ký bấm Ký ngay thì Đã ký [test: thủ công — e2e/journey-approval/cr123-u6-run-card.spec.ts (job journey-approval)]

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Thẻ ký số theo lượt người xem (nguồn: cr125-x2-sign-card)
Người ký thấy banner "Đến lượt bạn ký — hạn <ngày>" và một nút "Ký ngay"; thẻ tự cập nhật sau khi ký; "Huỷ ký" trong menu "…" có xác nhận; người khác thấy "Đang chờ <tên> ký" không có nút.
- Kịch bản: HĐ chờ ký, người ký mở thẻ ⇒ banner + Ký ngay, không có Làm mới trạng thái; giám đốc không phải người ký ⇒ Đang chờ tên người ký, không Ký ngay [test: thủ công — e2e/journey-approval/cr123-u6-run-card.spec.ts (job journey-approval), ảnh docs/specs/CR-125/shots/x2]

#### Yêu cầu: Danh sách hợp đồng (nguồn: cr125-x1-waiting-for-me, cr125-x8-date-picker)
Giám đốc thấy ngay việc chờ chính mình: thẻ "Chờ bạn: N ký · M duyệt" đầu Tổng quan và mục "Chờ tôi" số đỏ ở thanh dưới điện thoại, cùng một nguồn với trang "Chờ tôi duyệt"; mọi ngày trong app hiện dd/mm/yyyy qua một bộ định dạng.
- Kịch bản: khi người dùng là người ký công ty đã tới lượt của một phong bì còn mở thì HĐ đó nằm trong danh sách chờ ký của họ, người khác và tenant khác không thấy [test: apps/hub-api/src/modules/packs/contracts/adapters/mywork-signing.int.test.ts » chỉ phong bì còn mở, mình là người ký chưa ký và đã tới lượt]
- Kịch bản: khi có việc ký và duyệt thì số hiển thị là tổng hợp từ một đọc, bằng 0 thì ẩn [test: apps/workspace-web/src/features/overview/lib/waiting.test.ts » 2 ký + 1 duyệt ⇒ tổng 3]
- Kịch bản: khi hiển thị ngày thì luôn dd/mm/yyyy theo giờ Việt Nam [test: apps/workspace-web/src/components/shared/format-datetime.test.ts » ngày ISO ⇒ dd/mm/yyyy (30/09 chứ không 09/30)]
- Kịch bản: khi giám đốc đăng nhập lúc có HĐ chờ duyệt thì thẻ Chờ bạn và số đỏ ở thanh dưới điện thoại hiện [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

Mọi ô ngày của app Sổ Hợp Tác dùng một bộ chọn ngày tiếng Việt: hiện dd/mm/yyyy qua bộ định dạng chung, tuần bắt đầu thứ Hai, tên tháng tiếng Việt.
- Kịch bản: khi nhập hoặc đọc ngày thì dd/mm/yyyy (kể cả d/m và ISO) đúng, ngày kiểu mm/dd không có thật bị từ chối [test: apps/workspace-web/src/components/shared/date-picker/date-math.test.ts » dd/mm/yyyy (kể cả d/m, dấu - hoặc .) và ISO ⇒ ISO]
- Kịch bản: khi mở lịch tháng 9/2027 thì hàng đầu bắt đầu thứ Hai 30/08 [test: apps/workspace-web/src/components/shared/date-picker/date-math.test.ts » tháng 9/2027 (1/9 là thứ Tư): hàng đầu bắt đầu 30/08 (T2) và có ô thứ Tư = 1]
- Kịch bản: khi nhân viên mở form hợp đồng thì ô ngày hiện dd/mm/yyyy và lịch có tháng tiếng Việt, thứ Hai đầu tuần [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

#### Yêu cầu: Thẻ ký số tự cập nhật bằng sự kiện đẩy (nguồn: cr125-x6-sign-push)
Thẻ ký số của người gửi/người ký cập nhật trong khoảng một giây khi phong bì đổi trạng thái, nhờ sự kiện đẩy; không hỏi trạng thái định kỳ; quay lại cửa sổ thì tải lại một lần.
- Kịch bản: phong bì ký xong qua webhook/đồng bộ thì người gửi và người ký nhận sự kiện esign.updated, người khác thì không [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-push.int.test.ts » esign.updated chỉ tới người gửi và người ký của đúng HĐ]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Một mô hình trạng thái và một luật ký số (nguồn: cr125-c1-esign-one-source)
Thẻ duyệt và khối Ký số dùng cùng nhãn trạng thái ký; "đã ký" có một định nghĩa; ngày ký hiển thị theo giờ Việt Nam; luật và câu lỗi bước Ký số dùng chung giữa máy chủ và màn hình quản trị.
- Kịch bản: ký lúc 01:30 giờ VN thì ngày hiển thị là ngày VN và đầu ra giữ mốc đầy đủ [test: apps/hub-api/src/modules/packs/contracts/domain/esign-outputs.rules.test.ts » ký 00:00–07:00 giờ VN (UTC hôm trước): đầu ra giữ mốc UTC, ngày hiển thị là ngày VN]

#### Yêu cầu: Điều kiện và hẹn giờ theo ngày ký tính theo ngày Việt Nam (nguồn: cr125-c1b-signed-at-type)
Điều kiện Nếu và bước Chờ tới dùng ngày ký (đầu ra mốc đầy đủ) tính theo ngày lịch Việt Nam.
- Kịch bản: ký lúc 01:30 ngày 07/11 giờ VN thì điều kiện ngày ký bằng 07/11 đúng và hẹn giờ tính từ 07/11 [test: apps/hub-api/src/modules/processes/domain/runs/as-calendar-date.test.ts » ký 01:30 ngày 07/11 giờ VN: = 2026-11-07 đúng, = 2026-11-06 sai (cắt UTC sẽ ra ngược lại)]

#### Yêu cầu: Mọi ô ngày dùng một bộ chọn ngày chung (nguồn: cr125-c4-date-input-all)
Mọi ô nhập ngày ở Sổ Hợp Tác, Admin và Chat (lọc, mốc, thanh toán, báo giá, form quy trình) là một ô duy nhất: hiện dd/mm/yyyy, gõ hoặc chọn lịch (thứ Hai đầu tuần, tháng tiếng Việt); giá trị lưu vẫn là yyyy-mm-dd. Không còn ô ngày gốc của trình duyệt (mm/dd theo máy Mỹ).
- Kịch bản: khi gõ "3/9/2027" thì ô hiểu là 03/09/2027 [test: packages/web-kit/src/date-math.test.ts » hiển thị lại bằng viDate (một bộ định dạng) khớp phần đọc]
- Kịch bản: khi có `type="date"` trong mã giao diện ngoài component chung thì cổng check:date-input đỏ [test: tools/scripts/src/check-date-input.rules.test.ts » bắt type=date và datetime-local trong .tsx]
- Kịch bản: khi người dùng chọn ngày ở form quy trình chat thì nút "Chọn ngày" hiện và gửi yyyy-mm-dd [test: e2e/P-d/chat-labels.pd.ts » PD-E08(d) · form '!pd-wait-input']

#### Yêu cầu: Trang yêu cầu hiện toàn bộ bước của lượt và lượt con, làm việc ngay tại đó (nguồn: cr125-request-steps)
Trang một yêu cầu (không phải hợp đồng) hiện đầy đủ các bước của lượt và các lượt con lồng dưới lượt cha; việc đang mở của người xem (điền thông tin rồi «Gửi», Duyệt, Trả lại, Từ chối) làm ngay trên trang. Việc của lượt con mở trang của yêu cầu gốc. Người không được xem lượt hoặc công ty khác nhận 404.
- Kịch bản: khi người gửi mở yêu cầu có Quy trình con thì thấy bước của lượt cha và lượt con lồng nhau; người ngoài và công ty khác nhận 404 [test: apps/hub-api/src/modules/processes/triggers/request-steps.int.test.ts » CR-125 · cây bước của yêu cầu (cha + lượt con)]
- Kịch bản: khi bước mở là bước điền thì người làm thấy một việc «Gửi», khi là bước duyệt thì thấy Duyệt, Trả lại, Từ chối [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.run.test.ts » flowViewOfRun]
- Kịch bản: khi mở việc của lượt con từ Chờ tôi duyệt thì trang chuyển sang yêu cầu gốc [test: apps/workspace-web/src/features/requests/lib/request-tree.test.ts » request-tree]
- Kịch bản: khi task duyệt mở thì trang vẽ đủ nút theo hành động của hub [test: apps/workspace-web/src/platform/flow/ui/RunStepActions.test.tsx » RunStepActions]
- Kịch bản: khi nhân viên tạo yêu cầu mua hàng thì mọi bước điền và duyệt của ba phần làm được từ trang yêu cầu [test: thủ công — e2e/journey-approval/cr125-purchase-full.spec.ts chạy một lần ở đợt cuối]

#### Yêu cầu: Danh sách hợp đồng (nguồn: cr125-ux-s4-contract-card)
Máy chủ trả mã bước của lượt duyệt (`step_label.code` + tên người ký / tên bước), không trả chữ tiếng Việt; trang web dịch bằng i18n và so sánh theo mã.
- Kịch bản: khi bước duyệt đang mở thì hub trả mã waiting_step kèm tên bước [test: apps/hub-api/src/modules/packs/contracts/domain/approval-step-label.rules.test.ts » bước duyệt đang mở ⇒ waiting_step + tên bước]
- Kịch bản: khi lượt duyệt kết thúc Đã duyệt thì dòng danh sách ghép Đã duyệt với trạng thái HĐ theo mã approved [test: apps/workspace-web/src/features/contracts-list/lib/approved-label.test.ts » mã approved ⇒ ghép với trạng thái HĐ]

#### Yêu cầu: Tải hợp đồng lên khi đã bật ký số (nguồn: cr125-ux-s4-contract-card)
Công ty đã bật ký số chỉ nhận tệp PDF lúc tải lên; tệp khác bị giữ lại kèm câu cách khắc phục.
- Kịch bản: khi ký số bật và chọn tệp .md thì tệp không đi tiếp và hiện câu cần PDF [test: apps/workspace-web/src/features/contracts-list/lib/pdf-gate.test.ts » ký số bật ⇒ tệp không phải PDF bị giữ lại, PDF đi tiếp]

#### Yêu cầu: Thẻ hợp đồng theo vai (nguồn: cr125-ux-s4-contract-card)
Người duyệt thấy thẻ tóm tắt cùng ba nút, form sửa gập lại; sau gửi duyệt thẻ nói gửi cho ai và hạn bao lâu; bước hệ thống chỉ chủ HĐ thấy; Lịch sử thay đổi nằm ngay dưới các bước duyệt; ký thử có dòng giải thích.
- Kịch bản: khi người duyệt mở thẻ thì chỉ thấy tóm tắt và nút Duyệt, form sửa gập trong khối Xem và sửa chi tiết [test: e2e/contracts-web/cr125-s4-card.cw.ts » người duyệt thấy thẻ tóm tắt, form sửa gập lại]
- Kịch bản: khi bước kế có hạn thì sau gửi duyệt hiện Đã gửi <bước> · hạn N giờ [test: apps/workspace-web/src/features/contract-approval/lib/moved-to.test.ts » hạn của bước vừa mở]

#### Yêu cầu: Tiêu đề thông báo duyệt có tên hợp đồng (nguồn: cr125-ux-s4-contract-card)
Chuông/thư "Cần duyệt" của run gắn hợp đồng nêu hợp đồng nào, để hai thư cùng bước không trùng tiêu đề.
- Kịch bản: khi run gắn HĐ có nhãn thì tiêu đề là Cần duyệt: <nhãn> · <bước> [test: apps/hub-api/src/modules/processes/domain/notify/pack-bell.rules.test.ts » có record_label ⇒ Cần duyệt: <nhãn> · <bước>]

#### Yêu cầu: Điện thoại và Tổng quan (nguồn: cr125-ux-s4-contract-card)
Nút chính cao ≥ 44 px ở điện thoại, nút trợ lý nổi ẩn trên thẻ hợp đồng; công ty chưa có số liệu thấy thẻ Bắt đầu nhanh; nhãn đăng nhập là Tên đăng nhập.
- Kịch bản: khi công ty chưa có số liệu thì Tổng quan hiện thẻ Bắt đầu nhanh [test: apps/workspace-web/src/features/overview/components/QuickStartCard.test.ts » công ty chưa có số liệu ⇒ rỗng]

