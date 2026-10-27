---
id: DOC-legal
lát: A3 (backend + chút UI Cài đặt)
cr: CR-101 (Intake 2026-10-27 R48, R68 phần Pháp lý; Câu 8)
làn: nhanh (Sonnet) — ngưỡng ở Cài đặt là cấu hình thường, không tiền/RLS mới
migration: 0057_doc_legal (journal idx 53, when 1799100000000)
phụ thuộc: DOC-deals đã merge (cần `doc_type='deal'` + nghĩa vụ trên `contracts`)
---
# DOC-legal — Cảnh báo pháp lý

## Plan (ngắn)
Giao dịch đứng riêng (không thuộc HĐ NT), tổng giá trị ≥ ngưỡng (mặc định 5.000.000 đ), còn mốc thu/trả chưa xong ⇒ cảnh báo "Pháp lý": dòng trong chi tiết + nguồn mới ở Cần xử lý (Bỏ qua được). Chỉ cảnh báo, không chặn; luôn kèm dòng "cần kế toán xác nhận". Giao dịch thuộc HĐ NT không cảnh báo.

## Làm
| # | Việc |
|---|---|
| 1 | 0057: `approval_settings.legal_warn_threshold` (bigint, default 5000000, ≥ 0); chỉ `owner` sửa (guard như `allow_negative_stock`) |
| 2 | Luật thuần `domain/legal-warn.rules.ts` (test trước): điều kiện cảnh báo từ (doc_type, frame_root_id, tổng, mốc mở, ngưỡng) |
| 3 | `todo.repo.ts` nguồn mới `legal` (thêm vào cấu trúc nguồn, số câu SQL cố định như V2-K/N); Bỏ qua dùng cơ chế dismiss sẵn có |
| 4 | Chi tiết chứng từ: API trả `legal_warning: {threshold, reason}|null` (ghép vào read model chi tiết, không câu mới) |
| 5 | Cài đặt › Công ty: ô ngưỡng (chỉ owner sửa) — `CompanyPane.tsx` + `settings` API |

## Không làm
Chặn lưu/xác nhận; áp cho HĐ kinh tế; tính thuế; hiển thị trên danh sách (DOC-ui-list chỉ nhãn nếu API có sẵn).

## Chạm (lát khác KHÔNG sửa)
MG `0057_doc_legal.sql`; `H/domain/legal-warn.rules.ts`; `todo.repo.ts` (thêm nguồn `legal` trong khối riêng; REP-v3/MS-impact thêm nguồn của họ SAU lát này, mỗi nguồn một hàm riêng để dễ merge); `H/application/get-contract*` (trường cảnh báo); `W/features/settings/components/CompanyPane.tsx`; `locales/contracts/legal.*.json`.

## Test tối thiểu
Unit `legal-warn.rules.test.ts` (bảng điều kiện); một int (deal 6 triệu đứng riêng, mốc thu mở ⇒ có ở todo + chi tiết; thuộc HĐ NT ⇒ không); một test chéo tenant cho cột ngưỡng; sửa ngưỡng non-owner ⇒ 403. e2e viết, không chạy.

## Việc còn lại
- [ ] 1–5. Ghi chú: ngưỡng 5 triệu là diễn giải luật thuế, cần kế toán xác nhận (nằm trong UI chữ).
