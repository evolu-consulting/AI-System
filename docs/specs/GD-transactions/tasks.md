---
id: GD-transactions
lát: G1 (backend) · G2 (UI)
cr: CR-097 (đợt 2) · intake 2026-10-23 R9, R10, R27–R32
fr: GD-FR-01…05
làn: G1 đầy đủ (tiền/kho, Opus) · G2 nhanh
migration: 0051_g1_transactions (journal idx 47, when 1798000000000)
---
# Giao dịch — tasks

## Plan G1 (xong)
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | 0051: `transactions`, `transaction_lines`, `transaction_events` (secure_table, RLS M1), guard trạng thái mức hàng; `stock_moves.transaction_id`; `obligations.transaction_id` + `contract_id` nullable + CHECK một-trong-hai; policy thấy nghĩa vụ theo giao dịch; ô uy tín nghĩa vụ giao dịch | đầy đủ | [x] |
| 2 | Luật thuần `domain/transactions.rules.ts` (test trước) — trạng thái, dòng/tổng, dòng kho qua `deliveryMoves` V2-D, nghĩa vụ, mô tả | đầy đủ | [x] |
| 3 | `stock.repo.ts`: `applyDelivery` nhận `transactionId`; `reverseTransactionStock` (cùng đường đảo V2-M, lọc theo giao dịch) | đầy đủ | [x] |
| 4 | API `/pack/contracts/transactions` (list/detail/tạo/sửa nháp/xoá nháp/ghi sổ/mô tả/điều chỉnh/huỷ) + zod `pack-contracts/transactions.ts` | đầy đủ | [x] |
| 5 | Test: unit `transactions.rules.test.ts`; int `tests/acceptance/GD/transactions.int.test.ts` (viết, CHƯA chạy — chạy cuối đợt); chéo tenant 3 bảng mới qua `rls-packs-v2.ts` | đầy đủ | [x] |

## Quyết định trong lúc làm
- D1 Giao dịch = `deal` buy|sell (khớp `contracts.deal`); "nghĩa vụ lẻ" (R27) = giao dịch không dòng SP. Không mở lại HD9 (Câu 7).
- D2 Kho tái dùng nguyên `deliveryMoves` + `applyDelivery` + `planReversal`; dòng sổ kho mang `transaction_id`, KHÔNG `contract_id` (xoá HĐ V2-M / cutover K2 không đụng kho giao dịch). Lý do sổ kho giữ `delivery`/`reversal` (không đổi CHECK). Thêm cột `stock_moves.transaction_id` (cộng thêm) để đảo theo giao dịch.
- D3 Ghi sổ: ngày kho = `occurred_on` (không được ở tương lai theo múi tenant); mua gói suất cần `valid_until` (hạn gói). Kho thiếu ⇒ 409 `TRANSACTION_STOCK`, không ghi gì.
- D4 Nghĩa vụ: MỘT đợt thanh toán (`kind=payment`, bán ⇒ thu, mua ⇒ trả, hạn = `due_on` ?? ngày phát sinh, `seq = rev+1`, `source=manual`). Điều chỉnh: đợt mở cũ ⇒ `cancelled` + lý do; đợt mới = tổng mới − Σ đã xong (≤ 0 ⇒ không sinh). Huỷ: đợt mở ⇒ `cancelled`, sự kiện đối tác gắn nghĩa vụ của giao dịch ⇒ `partner_event_voids` (lý do); đợt đã xong giữ.
- D5 partner_events: G1 KHÔNG ghi sự kiện lúc ghi sổ — điểm uy tín tính qua nghĩa vụ (có `rep_cell` theo loại × nhóm SP của giao dịch, engine đọc `obligations` theo ô); tránh đụng U1.
- D6 Điều chỉnh = bản dòng `rev+1` (bản cũ giữ nguyên), đảo toàn bộ kho còn hiệu lực rồi ghi kho bản mới trong cùng tx. Bên/loại/HĐ liên kết cố định sau ghi sổ (đổi ⇒ huỷ + tạo mới). Trigger `g1_transactions_guard` (EG409 ⇒ 409) là lưới an toàn khi đua.
- D7 Quyền: GET = `read`; mọi ghi (kể cả huỷ, xoá nháp) = `write` như sửa HĐ (huỷ không xoá dữ liệu nên không cần `admin`). Thấy (M1): thấy hết · mình tạo · HĐ liên kết thấy được.
- D9 Route gắn trong `products.mount.ts` (giao dịch dùng danh mục SP + kho chung) vì `packs.mount.ts` chạm trần 400 dòng.
- D8 Bảng Thanh toán HĐ (`confirmedOf`) loại tường minh nghĩa vụ giao dịch (`contract_id` null) — contract `PaymentRow.contract_id` hiện không null.

## Việc còn lại (G2 UI + sau)
- [ ] G2: màn Giao dịch theo khuôn danh sách/form hiện có — danh sách (lọc trạng thái/loại/đối tác/HĐ/ngày, phân trang), form nháp (dòng SP chọn từ danh mục, thành phần, dòng không SP), Ghi sổ (hiện kho trước → sau từ `stock`), Mô tả (ghi chú/người giữ/nhãn lô), Điều chỉnh (lý do bắt buộc), Huỷ (lý do), liên kết HĐ, dòng thời gian `events`. Lỗi: 409 `TRANSACTION_STATE`/`TRANSACTION_STOCK`, 422 `TRANSACTION_INVALID`.
- [ ] Sau G2: đưa nghĩa vụ giao dịch lên bảng Thanh toán + "đánh dấu đã thu/trả" (cần `PaymentRow.contract_id` nullable + `transaction_id`, `ledger-write.repo.ts` hiện khoá HĐ của đợt). Đến lúc đó đợt giao dịch chỉ xem ở chi tiết giao dịch.
- [ ] Chạy int GD + `rls-packs.int.test.ts` một lần cuối đợt (chưa chạy trong lát).
