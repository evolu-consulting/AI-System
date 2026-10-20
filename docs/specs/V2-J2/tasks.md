---
id: V2-J2
title: NCC & giá — tab "Nhà cung cấp & giá" của chi tiết sản phẩm (so sánh, AI tìm giá, gợi ý hợp tác)
lane: nhanh (Luật 0b; API đọc + màn hình; không đụng sổ tiền; 1 bảng mới)
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf §3.3 SP-04/05/06, §4.4 · intake V2-J2 + §4 Q8 · mockup-niti.html (`cmpPanel`, `supEvalPanel`, dữ liệu)
---
# V2-J2 — tasks

## Plan (đã làm)
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Migration `0031_v2j2_supplier_prices.sql` (`when` 1795800000000, idx 30): bảng `contracts.product_supplier_prices` (SP × NCC × Mua mới/Gia hạn × giá × nguồn market/quote/manual × url × ngày), RLS tenant, tạo `created_by` = phiên, không sửa, xoá: người tạo hoặc người thấy hết | xong |
| 2 | contracts: `pack-contracts/supplier-prices.ts` (schema + kiểu + mã lỗi `SEARCH_UNAVAILABLE` 503 / `SEARCH_CAP` 429 / `SEARCH_FAILED` 502) | xong |
| 3 | Domain thuần: `supplier-advice.rules.ts` (giá vốn BQ, % chênh, bảng so sánh, 4 gợi ý), `price-search.rules.ts` (lời nhắc chỉ có tên SP, đọc chặt kết quả AI) + `supplier-prices.rules.test.ts` | xong |
| 4 | API (`/pack/contracts`): `GET /products/:id/suppliers`, `POST /products/:id/suppliers/search`, `POST /products/:id/supplier-prices`, `DELETE /products/:id/supplier-prices/:priceId`; repo 1 câu SQL mỗi lệnh | xong |
| 5 | AI client chung: cờ `webSearch` (CLI gói: `--tools WebSearch --allowedTools WebSearch`, 8 lượt; API: tool `web_search`), tính năng `contracts.price_search` | xong |
| 6 | Gỡ `/cks/scans` (route + `CksScanSchema`/`CksScanJob` + nút "Dò giá", dải dò, khoá i18n `scan*`/`strip` của tab giá CKS) | xong |
| 7 | FE `features/product-suppliers`: `SupplierPricesTab` (cổng tab) = `ComparePanel` + `EvalPanel` + `SearchDialog`; gắn vào slot tab của J1; i18n `contracts.psup.*` (`v2j2.vi/en.json`) | xong |
| 8 | Test: unit `supplier-prices.rules.test.ts` (6) + `lib/suppliers.test.ts` (4); int `tests/acceptance/V2-J2/suppliers.int.test.ts` (3: đường chính + quyền + tenant khác + Giới thiệu); e2e `e2e/contracts-web/v2j2-suppliers.cw.ts` viết, CHƯA chạy | xong |

## Quyết định trong lúc làm
- D1 Nguồn bảng so sánh: (a) giá nhập gần nhất từ sổ kho `stock_moves` (`in`/`delivery`, NCC theo `supplier_party_key`) = "Đã mua", kiểu Mua mới; (b) dòng đã lưu trong `product_supplier_prices` (AI / báo giá / nhập tay), có kiểu Mua mới hoặc Gia hạn. Giá HĐ chưa giao chưa đưa vào (việc còn lại).
- D2 Giá vốn của mình = BQ của THÀNH PHẦN CHÍNH (thành phần đầu có cách lấy hàng ≠ `none`); chưa có kho (0) ⇒ không so (`own_avg_cost` null). Giá nhập/tỉ trọng cũng chỉ tính trên thành phần chính (SP nhiều thành phần: chỉ thành phần đầu).
- D3 4 gợi ý (hằng số trong `supplier-advice.rules.ts`): đã mua + (uy tín CHÚ Ý hoặc giá cao hơn NCC rẻ nhất > 15%) ⇒ **Tìm nguồn thay thế**; đã mua + tỉ trọng chi ≥ 50% + chênh ≤ 5% ⇒ **Hợp tác tiếp**; đã mua, còn lại ⇒ **Duy trì nguồn phụ**; chưa mua + uy tín không CHÚ Ý + chênh ≤ 5% ⇒ **Có thể mua thử**; không đủ cơ sở ⇒ null ("Tham khảo"). Ngưỡng 50% theo mockup (`share>=50`); 5%/15% là mặc định đề xuất, đổi một chỗ.
- D4 Uy tín NCC lấy từ bảng điểm V2-E vai `supplier` (`reputationModule::supplierScores`, tính khi đọc, khớp theo khoá đối tác; NCC AI chỉ có tên ⇒ khoá `name:`).
- D5 "Tìm giá trên thị trường": chỉ khi bấm "Tìm" trong hộp thoại (nói rõ chỉ gửi tên SP); thân request `{}` strict; lời nhắc = `Tìm giá nhà cung cấp cho sản phẩm: "<tên>"` (JSON-quote). Không gửi MST/HĐ/tên đối tác (Q8). Qua AI client chung (gói `ai-sub`, `AI_PROVIDER_CONTRACTS_PRICE_SEARCH` ghi đè), có trần token/tenant + trần thao tác AI/ngày dùng chung bộ đếm với trích HĐ (Redis).
- D6 Kết quả AI là dữ liệu không tin: parse chặt từng dòng; bỏ dòng không có URL http(s), giá < 1.000 hoặc > 10¹², ngày tương lai; gộp trùng (NCC + loại) giữ rẻ nhất; tối đa 10. Kết quả KHÔNG tự lưu — người dùng tick rồi `POST /supplier-prices` (nguồn `market`, ngày mặc định = hôm nay theo múi tenant).
- D7 Thấy dữ liệu: bảng giá thị trường thấy cả tenant (như danh mục SP); dòng giá nhập đọc từ `stock_moves` nên theo luật thấy HĐ của M1 (người không thấy HĐ nguồn thì không thấy dòng đó). Xoá dòng đã lưu: người tạo hoặc người thấy hết.
- D8 SP nhóm Giới thiệu: mọi lệnh ⇒ 404 (không có tab); FE `supplierTabVisible(group)` + `SupplierPricesTab` trả null.
- D9 Gỡ `/cks/scans` hẳn (route 404 thay vì 503): chưa từng có lượt dò nào chạy được; FE cks-prices bỏ nút "Dò giá" + dải dò. Mock `/scans` trong `e2e/contracts-web/dataset-cks.ts` còn nằm đó (file khoá e2e — qc dọn khi relock).
- D10 Mount: slot `suppliers` trong `features/products/lib/slots.ts` của V2-J1 (nhóm service + goods; Giới thiệu không có tab), tab `/products?sp=<id>&ht=suppliers`. Route tạm đã gỡ; `routeTree.gen.ts` không đổi.
- D11 Số migration 0031 / `when` 1795800000000 theo giao; nếu V2-I đã lấy 0031 thì đổi sang 0032 / `when` 1795900000000 (đổi tên tệp + 1 dòng journal, idx 31).

## Kết quả test (2026-10-21)
- Unit: hub-api `supplier-prices.rules.test.ts` 6 + ai-client + cks domain 38 pass; contracts-web `product-suppliers` + `cks-prices` 6 pass; typecheck hub-api, contracts, contracts-web, `tsconfig.tests.json` (phần V2-J2) sạch; `i18n:check` OK; `rsbuild build` OK.
- Int (evotest slot 1, `-Dirty`): `V2-J2/suppliers.int.test.ts` 3 pass.
- e2e: viết, chưa chạy.

## Việc còn lại
- Giá trong HĐ mua đã duyệt nhưng chưa giao (HD8 `compareGoods`) chưa gộp vào bảng; `GET /prices/compare` giữ cho `/prices` tới V2-I.
- Nhập tay / báo giá từ UI (API `POST /supplier-prices` đã nhận nguồn `quote`/`manual`, chưa có form).
- Gợi ý "Thêm vào Đối tác" (mockup, NCC chưa theo dõi uy tín) chưa làm — NCC chưa có uy tín hiện "Chưa giao dịch".
- Chạy e2e `v2j2-suppliers.cw.ts` + chụp baseline (nếu có) ở cuối đợt; qc relock `tests/.lock` cho `tests/acceptance/V2-J2/**` và `e2e/contracts-web/v2j2-suppliers.cw.ts`.
