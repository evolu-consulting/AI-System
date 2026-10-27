---
id: DOC-ui-list
lát: A4 (UI)
cr: CR-101 (Intake 2026-10-27 R31, R32, R33, R51, R30 UI, R40 UI; Câu 3, 12)
làn: nhanh (Sonnet)
migration: không
phụ thuộc: DOC-model + DOC-deals đã merge (API). Chạy song song với DOC-ui-frame và DOC-legal (khác thư mục).
---
# DOC-ui-list — Danh sách "Hợp đồng & giao dịch", nav 4 mục, form dùng chung

## Plan (ngắn)
Gộp hai danh sách: lọc Tất cả / HĐ nguyên tắc / HĐ kinh tế / Giao dịch (kèm số); con thụt dưới HĐ NT; cột số + nguồn + nhãn loại chứng từ; bản đã thay ẩn (vN giữ). Menu về 4 mục (Tổng quan, Hợp đồng & giao dịch, Đối tác, SP & Giá); `/transactions*` chuyển hướng về danh sách lọc Giao dịch. Form dùng chung `contract-form` cho giao dịch (nguồn, tệp tuỳ chọn, thuộc HĐ NT, ghi chú; nhãn Tên giao dịch/Số chứng từ/Ngày giao dịch). Upload chọn loại chứng từ (AI gợi ý, tô vàng, chọn lại được; ô "Thuộc HĐ nguyên tắc" điền sẵn khi upload từ HĐ NT). Ô đối tác: có ⇒ hiện điểm; chưa ⇒ "Đối tác mới · sẽ tạo khi lưu".

## Làm
| # | Việc |
|---|---|
| 1 | `features/contracts-list`: bộ lọc loại + số, hàng con thụt, cột nguồn/loại, nhãn "Giao dịch"/"HĐ nguyên tắc"; nút Thêm giao dịch + Upload |
| 2 | `features/contract-form`: chế độ `deal` (đổi nhãn/trường), chọn "Thuộc HĐ NT" (tìm kiếm, không giới hạn 100), ghi nguồn; dòng SP + ô "Đã giao / đã thanh toán ngay" (Câu 4) |
| 3 | Upload dialog: chọn loại chứng từ + trường HĐ NT (hạn mức, cách đặt hàng, bảng giá thoả thuận) |
| 4 | `features/shell/lib/nav.ts` + bottom nav: 5 → 4 mục; router chuyển hướng `/transactions`, `/transactions/new`, `/transactions/$id` |
| 5 | Gỡ `features/transactions` (trang riêng) sau khi form/danh sách thay thế; khối "Giao dịch liên kết" ở trang HĐ đổi thành "Chứng từ con/ liên quan" — chỉ nối API, KHÔNG sửa trang chi tiết HĐ NT (thuộc DOC-ui-frame) |
| 6 | Cập nhật `shell-lib.test.ts` (4 mục), e2e `transactions.cw.ts` → viết lại, `hd5-list.cw.ts` (viết, không chạy) |

## Không làm
Trang chi tiết HĐ NT, nút Nâng thành HĐ, cảnh báo pháp lý (chỉ hiện nhãn nếu API sẵn), thay đổi API, Cài đặt.

## Chạm (lát khác KHÔNG sửa)
`W/features/contracts-list/**`, `contract-form/**`, `contract-source/**` (upload), `transactions/**` (gỡ), `shell/lib/nav.ts`, router; locales `locales/contracts/doclist.*.json`. Chi tiết HĐ (`contract-detail/**`) thuộc DOC-ui-frame.

## Test tối thiểu
Unit lib thuần (lọc, thụt, form deal → thân API, nav 4 mục); e2e viết không chạy. Không chạy bộ khác.

## Quyết định (làm xong)
- Danh sách: lọc loại qua `?type=` (framework|contract|deal; Tất cả không ghi URL). Tất cả/HĐ NT gửi `nest=1` (+`doc_type=framework`); HĐ kinh tế/Giao dịch gửi `doc_type` phẳng, KHÔNG `nest` (con phải đứng riêng). Số trên ô lọc = 3 truy vấn `page_size=1` (chỉ đọc `total`; "Tất cả" = tổng 3) vì facets chưa có `doc_type`.
- Không thêm cột "Nguồn": `docs` của list API không trả `source` ⇒ TODO(API) nếu cần cột; nhãn loại (HĐ nguyên tắc/Giao dịch) nằm trong cột "Loại" cạnh Mua/Bán/Giới thiệu (giữ 7 cột cũ, không vỡ e2e/baseline).
- Con nhóm theo `frame_root_id` = id hàng HĐ NT. HĐ NT từ phiên bản 2 trở đi có `id` khác `root_id` mà `docs` không trả `root_id` ⇒ con không khớp được cha: hiện ở cuối danh sách (không mất dòng, `orphan`). TODO(API): trả `root_id` trong `docs`.
- Form Giao dịch = `/contracts/new?type=deal[&frame=<id>]` (khớp link của doc-ui-frame); `type` khác/vắng ⇒ trang upload cũ. Dùng chung FieldsGrid/ItemTable/DealTiles (`dealMode`: nhãn Tên giao dịch/Số chứng từ/Ngày giao dịch, bỏ ô kết thúc/nhắc hạn/người ký). Nguồn bắt buộc; ô "Đã giao / đã thanh toán ngay" ⇒ `settled_now`.
- `settle_error`/lỗi gắn HĐ NT: giao dịch ĐÃ lưu ⇒ ở lại màn "Đã lưu" báo lý do + nút Mở giao dịch (không tự chuyển trang). Gắn HĐ NT = `POST /contracts/:frame/attach {ids:[id]}` sau khi tạo (API tạo chưa nhận `frame_root_id`); chọn HĐ NT có tìm kiếm (mỗi lần 20 khớp, `doc_type=framework&q=`).
- G2 gỡ: xoá `features/transactions/*` (+ khối `ContractTxBlock` ở `ContractReviewPage`). `/transactions` → `/contracts?type=deal`; `/transactions/new` → `/contracts/new?type=deal`; `/transactions/$id` → `/contracts/$id`. Nav còn 4 mục, nhãn "Hợp đồng & giao dịch" (đổi cả tiêu đề trang); khoá i18n `contracts.txn.*` (g2.*.json) để lại, không dùng nữa. Xoá `ManualContractForm` (chết) thay bằng `DealNewPage`.
- Locale: `doclist.{vi,en}.json` thêm vào CUỐI `contracts-locales.ts` Parts (khi ghép: chèn trước docframe/rep3, tăng tuple).

## Việc còn lại
- [x] 1, 2, 4, 5, 6 (e2e `transactions.cw.ts` viết lại + `doc-list.cw.ts` mới, chạy xanh 12/12; `hd5-list.cw.ts` không đụng).
- [ ] 3 Upload chọn loại chứng từ + trường HĐ NT (hạn mức, cách đặt hàng, bảng giá thoả thuận), AI gợi ý `doc_type_suggest` tô vàng: CHƯA làm (ngoài phạm vi lượt này).
- [ ] TODO(DOC-legal): cảnh báo pháp lý ở form Giao dịch — tự tính theo ngưỡng `legal_warn_threshold` (GET /company), chỉ cảnh báo không chặn, chỉ khi không thuộc HĐ NT, chuỗi `contracts.legal.*`; chờ trường/locale của DOC-legal có trong nhánh (lát này tách trước khi DOC-legal merge).
- [ ] Cột "Nguồn", ô Ghi chú giao dịch: chờ trường API (list `docs.source`; `DealCreateRequest.note`).
- [ ] Baseline ảnh scenes/shell (nav 4 mục) cần chụp lại bằng `e2e:contracts:capture` (không chạy trong lát này).