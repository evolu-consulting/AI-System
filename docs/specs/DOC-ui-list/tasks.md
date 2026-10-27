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

## Việc còn lại
- [ ] 1–6.
