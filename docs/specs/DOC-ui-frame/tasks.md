---
id: DOC-ui-frame
lát: A5 (UI)
cr: CR-101 (Intake 2026-10-27 R10 UI, R33, R42, R44, R45, R47)
làn: nhanh (Sonnet)
migration: không
phụ thuộc: DOC-model + DOC-deals đã merge (API). Song song với DOC-ui-list, DOC-legal.
---
# DOC-ui-frame — Chi tiết HĐ nguyên tắc + Nâng thành HĐ

## Plan (ngắn)
Trang chi tiết nhận `doc_type`: đầu trang nhãn loại chứng từ, hướng, đối tác, liên kết "thuộc HĐ nguyên tắc" (không có quyền xem ⇒ "HĐ nguyên tắc (không có quyền xem)"); dòng File ký (HĐ) hoặc Nguồn · tệp · ghi chú (giao dịch). HĐ NT: khối "Chứng từ con" full chiều ngang trên cùng (tên, nhãn, ngày, giá trị, giai đoạn), % hạn mức, tổng đã đặt / đã thanh toán / số chứng từ, cảnh báo ngày ngoài hiệu lực; diễn biến xen chứng từ con theo ngày với mốc; SP → "Bảng giá thoả thuận · Không ảnh hưởng kho"; menu "Thêm vào diễn biến": HĐ kinh tế (upload, tự gắn) / Giao dịch (form điền sẵn) / Gắn chứng từ có sẵn (chọn nhiều, cùng đối tác + hướng) / Mốc. Giao dịch: nút "Nâng thành hợp đồng" (hộp: file ký + số HĐ bắt buộc; sau đó khoá).

## Làm
| # | Việc |
|---|---|
| 1 | `features/contract-detail`: tiêu đề + dòng nguồn/file theo loại |
| 2 | Mới `features/frame-panel/` (khối chứng từ con, % hạn mức, bảng giá thoả thuận, diễn biến xen, gắn chứng từ có sẵn) |
| 3 | Mới `features/promote-deal/` (hộp Nâng thành HĐ, gọi `POST /contracts/:id/promote`) |
| 4 | Mốc HĐ NT chỉ Nhắc gia hạn + Khác (ẩn loại khác trong form mốc) |
| 5 | Chuỗi i18n riêng; e2e viết không chạy |

## Không làm
Danh sách/nav/form chung (DOC-ui-list), cảnh báo pháp lý (DOC-legal hiển thị riêng), API.

## Chạm (lát khác KHÔNG sửa)
`W/features/contract-detail/**`, `frame-panel/**` (mới), `promote-deal/**` (mới), `contract-milestones/components/MilestoneForm*` (chỉ lọc loại cho HĐ NT); locales `locales/contracts/docframe.*.json`. Cảnh báo pháp lý: DOC-legal thêm dải riêng trong `contract-detail` — nếu cả hai chạm file trang chi tiết, DOC-legal đặt dải trong component mới `LegalBanner.tsx` và chỉ một dòng gắn vào trang (merge DOC-ui-frame trước).

## Test tối thiểu
Unit lib thuần (tổng, % hạn mức, trộn dòng thời gian, lọc loại mốc); e2e viết không chạy.

## Quyết định trong lúc làm (2026-10-27)
- Trang chi tiết thật nằm ở `features/contract-review` (không có `features/contract-detail`): sửa `DetailLead` (nhãn loại + liên kết «thuộc HĐ nguyên tắc» / «HĐ nguyên tắc (không có quyền xem)» + dòng File ký / Tệp), `DetailGrid` (HĐ NT: `FrameDiary` thay `Timeline`, `ProductsPanel priceList`), `ContractReviewPage` (gắn `FramePanel`, `PromoteDeal`, `EditLogPanel`). `MilestoneDialog` thêm prop `kinds` (mặc định đủ 7 loại; HĐ NT = Nhắc gia hạn + Khác); DOC-legal gắn `LegalBanner` ở cùng trang ⇒ merge lát này trước.
- `frame-panel/`: luật thuần `lib/frame-view.ts` (% hạn mức + vượt ⇒ cảnh báo không chặn, `mergeDiary` xen mốc/con theo ngày, `kindsFor`, `attachCandidates`, `docErrorText` ánh xạ FRAME_*/PROMOTE_*/NOT_A_DEAL ⇒ câu tiếng Việt, KHÔNG hiện thông điệp thô). `FramePanel` (giá trị Σ con, số chứng từ, hạn mức + thanh %, cảnh báo ngoài hiệu lực, gỡ liên kết `DELETE /:id/frame`), `AttachDialog` (tìm `nest=1`, chọn nhiều, `POST /:id/attach`; cùng đối tác + hướng do máy chủ kiểm ⇒ 422 hiện câu).
- Diễn biến HĐ NT: danh sách chỉ đọc xen mốc + con; mốc sửa bằng bút (chỉ chưa xác nhận); KHÔNG có nút «Xác nhận xong» cho mốc nhắc gia hạn (chưa có yêu cầu).
- `promote-deal/`: `PromoteDeal` (hộp: file ký + số HĐ bắt buộc ⇒ multipart `POST /:id/promote`, xong làm tươi chi tiết ⇒ HĐ khoá), `EditLogPanel` (dòng thời gian từ `GET /:id/edit-log`, nhãn trường). Sửa trực tiếp giao dịch dùng lại PATCH `/fields` sẵn có của trang (giao dịch không bị khoá).
- Menu «Thêm vào diễn biến»: HĐ kinh tế / Giao dịch chỉ là liên kết `/contracts/new?frame=<id>&type=contract|deal`; form + đọc tham số `frame`/`type` thuộc DOC-ui-list. Gắn có sẵn + Mốc làm trọn ở lát này.
- i18n: `locales/contracts/docframe.{vi,en}.json` đăng ký trong `packages/i18n/src/contracts-locales.ts` (chạm 1 chỗ chung; lát khác cũng thêm tệp sẽ xung đột nhẹ, ghép tay).

## Việc còn lại
- [x] 1–3, 5 (UI + unit `frame-view.test.ts`, `edit-log.test.ts`; e2e `e2e/contracts-web/doc-frame.cw.ts` 5 ca xanh).
- [x] 4 Mốc HĐ NT chỉ Nhắc gia hạn + Khác (lọc trong `MilestoneDialog` qua `kinds`).
- [ ] TODO (API thiếu): «Nguồn» của giao dịch (`source`) không có trong `detail.doc` ⇒ dòng Tệp chỉ hiện tên tệp; «tổng đã thanh toán» của HĐ NT chưa có trường ⇒ chỉ hiện tổng đã đặt + số chứng từ. Cần DOC-model bổ sung `doc.source` / `summary.paid`.
- [ ] TODO (DOC-legal): cảnh báo pháp lý chờ trường API; `LegalBanner.tsx` do lát DOC-legal gắn.
- [ ] TODO (DOC-ui-list): trang `/contracts/new` đọc `?frame=&type=`; gỡ `ContractTxBlock` (G1 chỉ đọc).