---
id: DOC-deals
lát: A2 (backend + chuyển dữ liệu)
cr: CR-101 (Intake 2026-10-27 R1, R5–R10, R37, R40 API; X1–X3; Câu 1, 3, 4, 7, 12)
làn: đầy đủ (tiền/kho, chuyển dữ liệu khách thật; Opus)
migration: 0056_doc_deals (journal idx 52, when 1799000000000)
phụ thuộc: DOC-model đã merge
---
# DOC-deals — Giao dịch hợp nhất vào chứng từ + nâng thành HĐ

## Plan (ngắn)
Giao dịch = hàng `contracts` với `doc_type='deal'` (file không bắt buộc, có `source`). Dùng chung mốc/kho/điểm/xoá/danh sách. Lưu là có hiệu lực, sửa trực tiếp, máy ghi lịch sử (không bắt lý do). Nâng thành HĐ = đổi `doc_type` → `contract` + gắn file ký + số HĐ, giữ id/mốc/kho/điểm, khoá ngay (K1). Bảng G1 `transactions*` thành chỉ đọc sau khi chuyển.

## Số liệu prod (điều phối đọc 2026-10-27)
`transactions`: demo 2, tenant khác 0. `contracts` kind=contract: demo 17 (`file_id` null 16, có file 1), titi-group-company 3 (null 2, có 1), nitigroup 0. Phụ lục (`parent_id`) 0.
**Lưu ý:** `file_id` null KHÔNG chắc là "HĐ nhập tay không file" (file có thể nằm ở bảng phiên bản/nơi khác). Script dry-run phải xác định đúng tập "không có file" theo NGUỒN THẬT (file_id, bảng phiên bản/tài liệu, `source`/K3 nhãn "Chưa có văn bản") rồi mới chuyển; mơ hồ ⇒ không chuyển, báo.

## Làm
| # | Việc | Ghi chú |
|---|---|---|
| 1 | 0056: `contracts.source` (invoice\|verbal\|message\|quote\|other), `file_id` cho phép null với `deal` (CHECK: `contract`/`framework` vẫn bắt buộc file hoặc nhãn K3), `deal` ∈ {buy,sell,referral}; `contract_edit_log` (ai, khi nào, trường, cũ→mới); `obligations.transaction_id`/`stock_moves.transaction_id` trỏ lại `contract_id` trong cùng tx; bỏ CHECK "đúng một trong contract_id/transaction_id" cho hàng chuyển; bảng G1 chỉ đọc (trigger chặn ghi) | giữ cột cũ để đối chiếu |
| 2 | Script `scripts/migrate-transactions-to-contracts.ts`: `--dry-run` (mặc định) in đếm: giao dịch cần chuyển, dòng, nghĩa vụ, `stock_moves`, HĐ nhập tay không file (theo nguồn thật, kèm danh sách id); `--apply` chạy trong một transaction mỗi tenant, giữ id, lặp lại vô hại (idempotent), kết thúc in đếm trước = sau | Opus; set-based, số câu SQL cố định |
| 3 | Chuyển hàng G1: nháp → giao dịch chưa xác nhận mốc; đã ghi sổ → mốc thanh toán + đợt giao đã xác nhận (kho không chạy lại, không đảo); huỷ → giữ trạng thái huỷ; `partner_event_voids` giữ | D2–D7 của GD-transactions bị thay |
| 4 | HĐ nhập tay cũ không có file → `deal` (nguồn "Khác", giữ id/mốc/kho); nâng lại khi có file ký (Câu 7). **Chỉ sau khi người dùng xem số dry-run**; mơ hồ ⇒ giữ nguyên | CHỜ số thật |
| 5 | Mốc mặc định giao dịch như HĐ cùng hướng (giao hàng + thu/trả; Giới thiệu: nhận hoa hồng); kho chạy khi xác nhận mốc giao; ô "Đã giao / đã thanh toán ngay" tự xác nhận mốc khi lưu (Câu 4) | tái dùng `delivery-opts` (vượt tồn chung) |
| 6 | API: `POST /contracts` nhận `doc_type='deal'` + `source` + file tuỳ chọn; `PATCH` sửa trực tiếp (ghi `contract_edit_log`); `POST /contracts/:id/promote` (file ký + số HĐ bắt buộc); xoá deal = luồng V2-M (xem trước, đảo kho, chỉ owner) | Câu 3, X2/X3 |
| 7 | `/pack/contracts/transactions*` giữ làm lớp tương thích đọc (GET) → map sang `contracts`; ghi ⇒ 410 `USE_CONTRACTS` | G2 UI cũ gỡ ở DOC-ui-list |
| 8 | Đối tác tự tạo/nhận vai theo hướng (V2-C) áp cho giao dịch; HĐ NT làm cha: cùng đối tác + hướng (DOC-model) | R40 |

## Không làm
Cảnh báo pháp lý/ngưỡng (DOC-legal), mọi UI, lọc/nav, xoá bảng G1, HD9.

## Chạm (lát khác KHÔNG sửa)
MG `0056_doc_deals.sql`; `scripts/migrate-transactions-to-contracts.ts`; `H/domain/transactions.rules.ts` (đóng băng, chỉ tái dùng luật sang `deal.rules.ts`); `H/application/transactions*` (thành lớp tương thích), `create-contract*` (chỉ phần `deal`, sau DOC-model), `promote-contract.usecase.ts` (mới), `delete-contract*`, `stock.repo.ts`, `products.mount.ts` (route transactions), `tests/acceptance/GD/*`.

## Test tối thiểu
Unit `deal.rules.test.ts`; int đường chính: tạo deal → xác nhận mốc giao (kho đổi) → sửa trực tiếp (có log) → nâng thành HĐ (id/mốc/kho giữ) → xoá (kho đảo); int script: dry-run đếm đúng + apply idempotent (chạy 2 lần, số hàng không đổi); một test chéo tenant cho `contract_edit_log`; GD int cũ viết lại hoặc xoá. Không chạy e2e.

## Việc còn lại
- [ ] 1–8; dry-run chạy trên DB prod chỉ đọc, gửi số cho điều phối trước `--apply` (hard stop dữ liệu khách).
