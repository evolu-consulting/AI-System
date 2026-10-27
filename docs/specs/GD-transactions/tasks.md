---
id: GD-transactions
lát: G1 (backend) · G2 (UI)
cr: CR-097 (đợt 2) · intake 2026-10-23 R9, R10, R27–R32
fr: GD-FR-01…05
làn: G1 đầy đủ (tiền/kho, Opus) · G2 nhanh
migration: 0051_g1_transactions (journal idx 47, when 1798000000000)
---

> **CR-101 (2026-10-27) — THAY THẾ MỘT PHẦN.** Giao dịch hợp nhất vào `contracts` (`doc_type='deal'`), sửa trực tiếp không nháp/ghi sổ, mốc + kho như HĐ, xoá theo luồng HĐ, nâng thành HĐ giữ id; bảng G1 `transactions*` thành chỉ đọc và hàng được chuyển (giữ id) bởi [`DOC-deals`](../DOC-deals/tasks.md). **Bị thay:** D2 (kho không `contract_id`), D3 (ghi sổ), D4 (một đợt thanh toán), D5, D6 (điều chỉnh `rev+1`), D7 (huỷ/xoá nháp), toàn bộ UI G2 (`/transactions*` chuyển hướng; xem [`DOC-ui-list`](../DOC-ui-list/tasks.md)). **Còn hiệu lực:** D1 (hướng buy/sell, thêm referral), D8, tái dùng `deliveryMoves`/`applyDelivery`. Lịch sử bên dưới giữ nguyên.
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

- G2 · Màn Giao dịch dựng theo khuôn contracts-web (BA không có mock): `features/transactions/` (lib thuần + test, api, components, pages), route `/transactions`, `/transactions/new`, `/transactions/$id`; mục menu "Giao dịch" cạnh Hợp đồng (nav + bottom nav, bố cục `board`). Chuỗi vi/en ở `locales/contracts/g2.*.json` (`contracts.txn.*`).
- G2 · Ghi sổ: API chỉ trả `stock` SAU khi ghi sổ nên luồng = hộp xác nhận (tổng, số dòng, hệ quả) → gọi `/post` → hộp "kho trước → sau" từ `stock`; điều chỉnh/huỷ cũng hiện hộp này (kèm số dòng sổ kho đã đảo). Hộp kết quả do trang chi tiết giữ (sau ghi sổ form nháp bị gỡ). Nút Ghi sổ tắt khi form chưa lưu.
- G2 · Lỗi: 409 TRANSACTION_STOCK và 422 TRANSACTION_INVALID hiện nguyên văn thông điệp máy chủ (câu tiếng Việt soạn sẵn); 409 TRANSACTION_STATE dùng chuỗi i18n "tải lại trang". Lý do điều chỉnh/huỷ bắt buộc 3–500 ký tự (như `Reason` API).
- G2 · Form: đối tác nhập tên + MST (chưa tra danh bạ — `partner_name` là chuỗi tự do theo contract); HĐ liên kết chọn trong 100 HĐ đầu của danh sách; dòng chọn SP + 1 thành phần (nhiều thành phần ⇒ chọn), hoặc để trống = dòng không SP. Điều chỉnh chỉ đổi ngày/hạn/dòng (bên/loại/HĐ cố định theo D6). Tạm tính thành tiền chỉ để hiện, số chính thức do máy chủ tính.
- G2 · Trang HĐ: khối "Giao dịch liên kết" dùng `GET /transactions?contract_id=` (có sẵn từ G1) — 5 giao dịch mới nhất + link danh sách đã lọc (`/transactions?contract=`) + "Tạo giao dịch cho HĐ này" (cần quyền ghi); lỗi/rỗng+không quyền ghi ⇒ ẩn.
- G2 · Test: unit `transactions.test.ts` (lọc, form→thân API, kho, lỗi); e2e `e2e/contracts-web/transactions.cw.ts` đã viết, CHƯA chạy (chạy một lần cuối đợt). Nav test cập nhật 5 mục.

## Việc còn lại (G2 UI + sau)
- [x] G2 (xong, chưa chạy e2e): màn Giao dịch theo khuôn danh sách/form hiện có — danh sách (lọc trạng thái/loại/đối tác/HĐ/ngày, phân trang), form nháp (dòng SP chọn từ danh mục, thành phần, dòng không SP), Ghi sổ (hiện kho trước → sau từ `stock`), Mô tả (ghi chú/người giữ/nhãn lô), Điều chỉnh (lý do bắt buộc), Huỷ (lý do), liên kết HĐ, dòng thời gian `events`. Lỗi: 409 `TRANSACTION_STATE`/`TRANSACTION_STOCK`, 422 `TRANSACTION_INVALID`.
- [ ] Sau G2: đưa nghĩa vụ giao dịch lên bảng Thanh toán + "đánh dấu đã thu/trả" (cần `PaymentRow.contract_id` nullable + `transaction_id`, `ledger-write.repo.ts` hiện khoá HĐ của đợt). Đến lúc đó đợt giao dịch chỉ xem ở chi tiết giao dịch.
- [ ] Chạy int GD + `rls-packs.int.test.ts` một lần cuối đợt (chưa chạy trong lát).
- [ ] G2 còn lại: tra danh bạ đối tác khi nhập (hiện tên tự do), chọn HĐ liên kết bằng tìm kiếm khi > 100 HĐ, đánh dấu đã thu/trả nghĩa vụ giao dịch (chờ mục Sau G2).
