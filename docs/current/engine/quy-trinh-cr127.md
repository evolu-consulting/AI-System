# Engine · Quy trình theo CR-127 (mô hình hiện hành)

Cập nhật: 2026-11-11 · Nguồn: CR-127 (`docs/specs/CR-127/spec.md` §3–§5, §12 "Quyết định trong lúc làm"; tiến độ `progress.md`). Code còn ở working tree `staging-improve`, chưa commit. **File này thắng** các file `engine/*`, `admin/*`, `sht/*` còn nói về Thư viện, khe, sao chép, mẫu, máy duyệt cũ (các file đó có biểu ngữ trỏ về đây).

## Một nguồn: quy trình của công ty
| Chủ đề | Hiện hành (CR-127) | Đã gỡ (đừng làm theo file cũ) |
|---|---|---|
| Tạo quy trình | Chỉ từ **sơ đồ trống** (`blankStages(app)` ở hub); tên + app do admin nền tảng chọn (cách A: chọn app trước) | 11 mẫu Sổ Hợp Tác, mẫu Thư viện, sao chép/nhân bản/clone, "Sao chép để sửa", Quay về bản gốc |
| Ai soạn | **Chỉ platform_admin**, cho mọi app, ghi qua `/process-defs?tenant_id=<công ty>`; quản trị công ty **chỉ xem** (readOnly) | tenant_admin sửa/xuất bản bản công ty |
| Cài đặt vận hành | Quản trị công ty vẫn ghi `PUT /tenants/:tid/flow-settings` (`flow_triggers`, `claim_release_h`) — ngoại lệ có chủ ý (spec §12 E8) | — |
| Gán | Quy trình thuộc công ty, áp dụng từ màn soạn; **không tự gán mặc định** cho công ty mới | gán Thư viện theo khe, luật định tuyến, bản riêng nguồn thư viện |
| Khe duyệt HĐ | Không còn khe `contracts.approval`; node Duyệt/Ký số/Kết thúc trong sơ đồ; seed (`seed-niti.data.ts SLOT`, 11 int thư viện) dọn nốt ở Z3d | tool `contracts-route`/`contracts-finalize`, máy duyệt cũ, Mở lại/Thử lại (reopen/retry), thẻ «Xác nhận cấp 1/2» |
| Chưa có quy trình | **Chặn Gửi duyệt**: `409 NO_APPROVAL_FLOW`, chi tiết HĐ `submit_block: 'no_flow'`, `can.submit=false`; HĐ giữ `draft`, không tạo lượt/sự kiện. HĐ nhận từ đối tác không quy trình ⇒ người phụ trách quyết (`awaiting_decision`) | HĐ đi thẳng `done` khi không có quy trình |
| Thứ tự bước | **Nhận việc trước Duyệt** ở mọi quy trình (thẻ «Bạn đang giữ») | Duyệt không cần nhận việc |
| Màn soạn | Vẽ **theo khối** (outline, `setStages`): thêm/sắp bước bằng danh sách khối, `FinishFields`/menu theo app, thanh Lưu nói lý do bị chặn (`blocked-reasons`) | kéo thả palette/canvas làm đường tạo chính (hành vi canvas xem `engine/flow-web.md`, phần còn dùng được) |

## Hợp đồng
- Trạng thái HĐ: `draft | processing | reject | done` (không còn `active`/`needs_review`/`cancelled`…).
- HĐ `done` chỉ đọc; sửa = phiên bản mới (j05/j10). Tạm khoá, giao dịch chờ duyệt, ký cùng lúc, ủy quyền: xem spec §5–§7.
- Mốc: lấy từ trích xuất hoặc sửa ở `draft`; **HĐ thường không còn «+ Thêm mốc»** (kể cả Giao theo %); chỉ HĐ nguyên tắc còn (Nhắc gia hạn, Khác). Xác nhận mốc giao qua `FulfillDialog` (`POST /obligations/:id/fulfill`; vượt tồn ⇒ câu `STOCK_INSUFFICIENT`).
- «Tóm tắt hợp đồng»/«Tạo tóm tắt bằng AI» ⇒ **«Điều cần lưu ý»** (không còn `generate-summary`).
- PDF có dấu: [ADR-0042](../../adr/0042-pdf-viet-font-fontkit.md). Giao dịch (`doc_type='deal'`) không thuộc khoá nội dung.

## Việc của tôi / uỷ quyền
`/my-work` có `delegated_from`; web gọi `/me/delegations` (prod: nginx proxy `deploy/prod-sohoptac2/nginx.conf`).

## Bằng chứng, nhận việc, uỷ quyền — gộp 2026-11-12 (sec-fix-1112, fix-sec-seed)
- **Bằng chứng chỉ gắn tệp/chữ ký của chính người ghi.** Tệp của người khác ⇒ từ chối, không ghi gì, việc vẫn mở; API trả 422 `EVIDENCE_FILE_NOT_OWNED` (DB: 42501), cả khi duyệt qua cổng duyệt kèm tệp. Code: `apps/hub-api/src/modules/processes/gates/`. Web có câu cho mã này (`claim.ts`, `api-exec.ts`).
  - Kịch bản: A gắn tệp/chữ ký của B ⇒ từ chối; tệp của A thì ghi được [test: apps/hub-api/src/modules/processes/gates/evidence-owner.int.test.ts » A gắn tệp / chữ ký của B]
  - Kịch bản: duyệt qua cổng kèm tệp của B ⇒ 422, việc vẫn mở [test: apps/hub-api/src/modules/processes/gates/evidence-owner.int.test.ts » duyệt qua cổng duyệt kèm tệp của B]
- **Người gửi không nhận việc ở bước «loại người gửi».** Kể cả thành viên phòng hay nhóm Toàn quyền ⇒ 403 `STARTER_CANNOT_REVIEW`, việc vẫn chưa ai giữ; bước không bật cờ thì nhận bình thường.
  - Kịch bản: người gửi thuộc phòng [test: apps/hub-api/src/modules/processes/gates/claim-starter.int.test.ts » người gửi thuộc phòng]
  - Kịch bản: người gửi chỉ thuộc Group Toàn quyền [test: apps/hub-api/src/modules/processes/gates/claim-starter.int.test.ts » người gửi chỉ thuộc Group Toàn quyền]
  - Kịch bản: bước không bật exclude_starter [test: apps/hub-api/src/modules/processes/gates/claim-starter.int.test.ts » bước không bật exclude_starter]
- **Uỷ quyền chỉ giữa nhân viên nội bộ còn hoạt động**; user đối tác ⇒ `DELEGATE_NO_ACCESS`, không ghi.
  - Kịch bản: uỷ quyền cho user đối tác bị chặn [test: apps/hub-api/src/modules/processes/delegations/delegations-external.int.test.ts » A uỷ quyền cho user đối tác]
- Tin nhắn không gắn được tệp hợp đồng: [pack-contracts/tin-nhan.md](../pack-contracts/tin-nhan.md) mục 4.

## e2e hiện hành
Hành trình thật: `e2e/cr127/j01–j14` (soạn → áp dụng, uỷ quyền, thực hiện/giao thiếu/phạt, tạm khoá, giao dịch chờ duyệt, hai công ty gửi/nhận, ký cùng lúc, phiên bản, nhận việc, chưa có quy trình). Các e2e `cr121-*`/`cr122-*`/`cr123-*`/`cr124-q5,q6`/`cr125-*` (mẫu thư viện, sao chép, kéo thả, phiếu máy cũ…) **đã xoá** (progress.md Q9–Q11); các dòng Kịch bản trỏ tới chúng đã bị gỡ khỏi `docs/current`.

## Chưa rõ / còn hoãn
- Perf DOC-model list-frame (p95 51–100 ms > 50), `/payments` 158 ms, E6 sweep 60–76 ms: **chưa đạt, hoãn**.
- Các file cũ chỉ có biểu ngữ, **chưa viết lại từng mục** (đợt gộp riêng): `engine/thu-vien-quy-trinh.md`, `company-flows*.md`, `flow-templates.md`, `cong-ty-quy-trinh.md`, `seed-cau-hinh-cong-ty.md`, `manual-start-ui.md`, `admin/thu-vien-*.md`, `admin/trinh-sua-quy-trinh-chi-xem.md`, `sht/duyet-ky-so.md`, `sht/chung-tu.md`, `sht/onboarding-cong-ty.md`.
