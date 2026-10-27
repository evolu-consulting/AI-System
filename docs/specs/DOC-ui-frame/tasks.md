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

## Việc còn lại
- [ ] 1–5.
