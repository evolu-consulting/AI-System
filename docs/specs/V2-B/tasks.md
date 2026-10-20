---
id: V2-B
title: Danh mục SP + kho lô + giá vốn BQ (backend/API)
lane: đầy đủ (tiền, bảng mới RLS, đường nóng perf)
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf §2, §5.3, §5.5, §5.7 · intake KN-09..13, 5.3a-c, 5.5a/c/d/f, 5.7f, C4
---
# V2-B — tasks

## Plan (đã làm)
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Test RLS + tiền viết trước (`tests/acceptance/V2-B/rls|money.int.test.ts`) | đầy đủ | ✔ |
| 2 | Migration `0023_v2b_products_stock.sql`: `products`, `product_components`, `product_rules`, `stock_lots`, `stock_moves`; `contract_items.product_id/component_ids` | đầy đủ | ✔ |
| 3 | Hàm thuần `domain/stock.rules.ts::planDelivery` (BQ gia quyền, giá vốn xuất, chặn vượt tồn, gói quota có hạn, `order` theo đơn) | đầy đủ | ✔ |
| 4 | `adapters/stock.repo.ts::applyDelivery(tx, moves, {tenantId, on})` cho V2-D — 4 câu SQL cố định | đầy đủ | ✔ |
| 5 | API danh mục: `GET/POST /products`, `GET /products/:id`, `POST /products/match`, `POST/DELETE /products/:id/rules[/:ruleId]` | nhanh | ✔ |
| 6 | Perf `perf/delivery.perf.int.test.ts`: 20 dòng p95 ≤ 50 ms, 1 + 4 câu, không Seq Scan | đầy đủ | ✔ |

## Quyết định trong lúc làm
- D1 Tiền bigint đồng chưa VAT; SL numeric(18,4) (domain: bigint ×10⁴). BQ = round(giá trị ÷ tồn); lưu `stock_value` (tổng đồng) ⇒ xuất hết lấy đúng giá trị còn, không trôi số làm tròn. Xuất không đổi BQ (BA 5.3b).
- D2 Thấy (M1): danh mục, tồn/BQ thành phần, lô (chỉ SL/hạn) thấy cả tenant (form HĐ cần tồn — BA 5.7e; bán từ hàng người khác nhập). Giá lô, NCC, HĐ nằm ở `stock_moves` — RLS như `cks_lots` (sees_all · mình ghi · HĐ thấy được); ghi sổ cho HĐ không thấy ⇒ 42501.
- D3 Không sửa SP/thành phần (BA 6c): REVOKE UPDATE/DELETE; chỉ cấp UPDATE cột tồn/giá trị/BQ/`last_move_id` và `stock_lots.remaining`. Trigger `product_components_guard`: tồn/BQ chỉ đổi khi `last_move_id` trỏ dòng sổ ghi trong cùng tx có số "sau" khớp.
- D4 Cách lấy hàng theo thành phần: `stock` (kho, xuất FIFO theo lô) · `quota` (gói suất, hạn bắt buộc khi nhập, xuất gói hết hạn sớm trước) · `order` (không giữ hàng: giá vốn = đơn giá người gọi đưa, không đổi tồn) · `none` (Giới thiệu, từ chối ghi kho). Kèm gói / khách tự có / NCC giao thẳng ⇒ dùng `order` (V2-D chọn).
- D5 Gói quota quá hạn (hạn < ngày giao) còn suất ⇒ dòng `expire` theo BQ, tự sinh trước khi ghi lần giao chạm thành phần đó.
- D6 Một lần giao không được vừa nhập vừa xuất cùng thành phần (HĐ mua chỉ nhập, HĐ bán chỉ xuất). Thiếu tồn ⇒ `StockError("stock_insufficient", shortages[])` báo mọi thành phần thiếu, không ghi gì.
- D7 Không FK từ bảng mới tới `contracts.contracts` (như `cks_lots`) — TRUNCATE của bộ test cũ không vướng; HĐ nguồn kiểm "thấy được" khi ghi. Xoá HĐ (5.5e, đảo sổ `reason='reversal'`, `reverses`) để V2-M.
- D8 Chữ ký: `applyDelivery(tx, moves, ctx)` — `ctx = { tenantId, on }` (ngày xác nhận theo múi tenant do V2-D tính).
- D9 Journal 0023 `when` = 1794972800000 (sau 0021, trước 0024 của V2-C). 0022 (V2-A) phải có `when` < giá trị này.

## Số đo (evotest, 2026-10-20)
- `applyDelivery` 20 dòng, 40.000 lô + 40.000 dòng sổ/tenant, chế độ `org`: trước ANALYZE p50 22,2 · p95 24,7 · max 28,7 ms; sau ANALYZE p50 22,0 · p95 25,6 · max 35,0 ms. 5 câu (1 phạm vi + 4), không Seq Scan.
- Int: `V2-B/rls` + `money` + `products` 29 pass (+ HD7 money 10 pass).

## Việc còn lại (lát sau)
- V2-D: sinh `DeliveryMove` từ mốc giao + `contract_items.product_id/component_ids`; ghi `milestone_id`; thông báo "kho X: a → b".
- V2-F/G: bắt buộc gắn SP trước khi lưu (5.5a), HĐ Giới thiệu chỉ SP nhóm Giới thiệu khi lưu (5.5c), cảnh báo bán vượt tồn khi lưu (5.7e).
- V2-M: xoá HĐ ⇒ đảo sổ + tính lại BQ; xoá SP tạo từ HĐ chưa có giao dịch khác.
- Chưa có e2e: lát không có UI (V2-F dùng API này sẽ thêm e2e).
