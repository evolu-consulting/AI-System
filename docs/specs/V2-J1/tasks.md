---
id: V2-J1
title: Điểm kinh doanh + trang Sản phẩm (danh sách · chi tiết · lịch sử mua bán · HĐ)
lane: nhanh (công thức thuần + đọc); migration chỉ trigger/ràng buộc, không đụng RLS bảng mới
source: docs/platform/ba-v2/intake.md (V2-J1: KN-15, 5.2a-e, SP-01, SP-02, SP-07, CD-06) · BA v2 §2, §3.3, §5.2 · mockup-niti.html (bizScore, BIZ_DEF)
---
# V2-J1 — tasks

## Plan
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Hàm thuần `domain/business-score.rules.ts`: điểm 40/35/25, 3 kiểu tốc độ bán (kho · gói suất · đặt theo khách) + Giới thiệu, đề xuất 6 nhãn, `bizProblem`/`mergeBiz`; unit `business-score.rules.test.ts` | nhanh | xong |
| 2 | Migration `0030_v2j1_product_group.sql` (`when` 1795700000000): trigger điền `contracts.product_group` từ danh mục + điền lùi; `score_configs_v2` thêm phạm vi `business`; index dòng HĐ theo SP | nhanh | xong |
| 3 | Đọc gom theo tập `adapters/business.repo.ts` (một câu cho cả danh sách; chi tiết = 2 câu) + use case + route `/pack/contracts/business/*` | nhanh | xong |
| 4 | API CD-06: `GET/PUT /business/config` (ghi chỉ quản lý, lưu `score_configs_v2` scope `business`) | nhanh | xong |
| 5 | UI: tab "Sản phẩm" (mặc định) của `/products`; danh sách + chi tiết + tab Lịch sử mua bán / Hợp đồng · n; chỗ gắn `lib/slots.ts` | nhanh | xong |
| 6 | Test: unit công thức; int `tests/acceptance/V2-J1/business.int.test.ts` (1 đường chính mỗi endpoint + trigger nhóm SP); e2e `e2e/contracts-web/v2j1-products.cw.ts` (viết, chưa chạy) | nhanh | xong |

## API (dưới `/pack/contracts/business`)
- `GET /products[?group=&q=]` → `{ items: BizProductRow[], counts }` (mỗi SP: đang giữ, đã bán 12 th / 3 th, điểm, đề xuất, lý do, 3 yếu tố).
- `GET /products/:id` → tóm tắt + `revenue_12m`, `margin_pct`, `lots` (giá nhập, chênh so lô trước, còn lại), `sales` (giá bán, giá vốn, lãi), `contracts_count`.
- `GET /products/:id/contracts` → HĐ có dòng gắn SP (Giới thiệu kèm hoa hồng nhận / phát sinh).
- `GET /config` (quyền đọc) · `PUT /config` (quản lý; ngưỡng sai quan hệ ⇒ 422 `BUSINESS_INVALID`, ngoài khoảng ⇒ 400).

## Quyết định trong lúc làm
- Điểm tính khi đọc, không lưu (đổi cấu hình đổi ngay). Mặc định = `BIZ_DEF` của mockup: trọng số 40/35/25, Mua thêm khi tồn đủ bán < 45 ngày (và điểm ≥ hi − 5), Xả hàng > 150 ngày hoặc điểm < lo − 5; gói suất ≥ 120% / < 70%; Đẩy mạnh ≥ 70, Cân nhắc dừng < 45; mục tiêu 6 / 3 tháng; báo sắp hết hạn 60 ngày (`soon`, chỉ lưu — V2-H/V2-N đọc).
- Cấu hình CD-06 lưu ở `score_configs_v2` (scope `business`) thay vì bảng `business_settings` riêng như dự kiến ở intake C5: cùng khuôn một-hàng-mỗi-tenant, version, quản lý ghi; không thêm bảng ⇒ không cần RLS/test cách ly tenant mới.
- "Bán" = SL ĐÃ GIAO của HĐ Bán (`milestone_items.delivered` của mốc giao đã xác nhận), ngày = ngày xác nhận mốc. 3 tháng = 91 ngày; 3 tháng trước = 91 ngày liền kề; 12 tháng = 365 ngày. Giới thiệu: đếm HĐ Giới thiệu đã xác nhận (`confirmed_at`), hoa hồng nhận / phát sinh từ mốc `commission` (HĐ nhiều SP Giới thiệu: hoa hồng tính cho từng SP — chấp nhận).
- Giá vốn bán = dòng sổ xuất của đúng mốc + dòng HĐ (V2-D). Đặt theo khách không ghi sổ khi bán (V2-D D6) ⇒ không có giá vốn ⇒ yếu tố Biên lãi bỏ khỏi điểm (trọng số còn lại chuẩn hoá lại, như mockup). Biên lãi chỉ tính trên các dòng bán CÓ giá vốn và giá bán.
- "Đang nắm giữ" của SP nhiều thành phần = thành phần ít nhất (điểm nghẽn của gói); loại SP = gói suất nếu có thành phần `quota`, kho nếu có `stock`, không thì đặt theo khách; gói suất không có hạn ⇒ dùng công thức kho.
- Quyền thấy: danh mục/tồn thấy cả tenant (V2-B D2); số bán, lô có giá, HĐ theo luật thấy HĐ M1 ⇒ điểm của người xem hạn chế có thể thấp hơn của người xem tất cả (nhất quán với "Đã bán" họ thấy).
- Trigger `contract_items_v2j1_*` (mức câu lệnh): HĐ có dòng gắn SP dịch vụ ⇒ `service`, còn lại có hàng hoá ⇒ `goods`; chỉ SP Giới thiệu ⇒ giữ nguyên (ô 5 theo `deal`). Ô uy tín của mốc tự chép (trigger V2-E). HĐ chưa gắn SP vẫn null (⇒ hàng hoá theo V2-E). Chỉ cộng thêm trigger/điền lùi, không đổi dữ liệu khách ngoài cột `product_group`.
- Chi tiết SP Giới thiệu: không có tab Lịch sử mua bán (không lô/bán); tab mặc định là "Hợp đồng · n" kèm hoa hồng nhận / phát sinh (thay "Lịch sử giới thiệu" của mockup).
- UI: `/products` có tab mới "Sản phẩm" là MẶC ĐỊNH (trước đó So sánh giá). `/prices` và các liên kết nội bộ ghi rõ `tab=prices`. Chi tiết ở `?sp=<id>` (`?ht=` tab chi tiết, `?g=` nhóm danh sách).
- Chỗ gắn: `features/products/lib/slots.ts::DETAIL_SLOTS` — V2-H thêm `users` ("Khách đang dùng", nhóm service), V2-J2 thêm `suppliers` ("NCC & giá", service + goods); tab chèn giữa Lịch sử mua bán và Hợp đồng.

## Kiểm
- unit: `business-score.rules.test.ts` (9) + `features/products/lib/{business,tabs}.test.ts` xanh; typecheck hub-api + contracts-web sạch; i18n:check OK.
- int (evotest, `-Step int -Dirty -Filter tests/acceptance/V2-J1`): list, detail, contracts, config, trigger nhóm SP.
- Chưa chạy: e2e `v2j1-products.cw.ts` và e2e/baseline nav-v2 (tab mặc định `/products` đổi — scenes chụp So sánh giá cần `?tab=prices`; chạy MỘT lần ở cuối đợt); không có perf test (câu gom một lần, chưa phải đường nóng có ngưỡng).

## Việc còn lại
- V2-H: tab "Khách đang dùng" (slot `users`). V2-J2: tab "NCC & giá" (slot `suppliers`). V2-N: Tổng quan đọc `GET /business/products` (3 nhóm Mua thêm / Giữ / Xả).
- UI chỉnh cấu hình điểm KD (CD-06) ở Cài đặt — V2-L (API đã có).
- Cập nhật baseline e2e nav-v2 cho tab mặc định mới của `/products`.
- Nợ quy ước (như V2-E): application import type từ adapters/`@ai/contracts` (depcruise báo `ca-application-inward-only`); mountContracts > 50 dòng.
