---
id: V2-D
title: Xác nhận mốc giao ⇒ kho + khách đang dùng (backend/API)
lane: đầy đủ (tiền/kho, bảng mới RLS, đường nóng perf)
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf §5.3, §5.7, §5.8a/b, HD-05 · intake 5.3b, 5.7a-d, 5.8a/b
---
# V2-D — tasks

## Plan
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Test trước: `tests/acceptance/V2-D/{money,access,rls,service,perf}.int.test.ts` + `perf/confirm.perf.int.test.ts` | đầy đủ | ✔ |
| 2 | Migration `0026_v2d_delivery_stock.sql`: `milestone_items` (Giao lần này / đã giao), `service_customers` + trigger trì hoãn | đầy đủ | ✔ |
| 3 | Luật thuần `domain/delivery.rules.ts` (SL lần này, dòng nhập/xuất, thông báo) + unit test | đầy đủ | ✔ |
| 4 | `settle` mốc giao ⇒ `confirmDelivery` ⇒ `applyDelivery` cùng tx; SL đã giao ghi cùng CTE xác nhận | đầy đủ | ✔ |
| 5 | Bảng SL trên `POST/PATCH …/milestones` (`items`), `GET /milestones/:id/delivery`, `POST /stock/check` | nhanh | ✔ |
| 6 | Chặn huỷ xác nhận mốc giao đã ghi SL/kho (`DELIVERY_LOCKED`) | đầy đủ | ✔ |

## Quyết định trong lúc làm
- D1 Xác nhận mốc = `POST /obligations/:id/settle` (HD-05 đã trỏ đây). Thứ tự khoá: HĐ → mốc → thành phần (`applyDelivery`). Lỗi kho/SL ⇒ huỷ cả tx, mốc giữ mở.
- D2 Mốc không có bảng SL ⇒ giao hết phần còn lại mọi dòng có SL; có bảng ⇒ chỉ dòng trong bảng (dòng trống = không giao đợt đó), `qty` null = phần còn lại của dòng. SL chung cũ (`obligations.qty`, V2-A) chỉ nhận khi HĐ đúng một dòng có SL.
- D3 Không giao vượt: kiểm khi lưu mốc (so với đã giao ở mốc ĐÃ xác nhận) và lại khi xác nhận (hai mốc mở cùng kế hoạch phần còn lại ⇒ mốc sau 422 `DELIVERY_OVER`). Dòng không ghi SL chỉ nhận 0.
- D4 Dòng gắn SP: `component_ids` rỗng ⇒ mọi thành phần của SP; đã chọn thì phải thuộc SP. Mua nhiều thành phần ⇒ đơn giá dòng chia đều (đồng lẻ vào thành phần đầu).
- D5 Mua thiếu đơn giá ⇒ 422 `DELIVERY_INVALID` (không nhập giá 0 làm lệch BQ). Gói suất: hạn = `end_date` HĐ mua, thiếu ⇒ 422.
- D6 Đặt theo khách (`order`): Mua ghi dòng sổ giá vốn đơn (kho không đổi); Bán bỏ qua (không có giá vốn đơn đáng tin; kho không đổi, không chặn). Giới thiệu / HĐ chưa có loại / dòng chưa gắn SP: chỉ ghi SL đã giao.
- D7 Phản hồi `settle` thêm `delivery: { items, stock[], notes[] }` CHỈ khi mốc giao có dòng được giao (giữ nguyên phản hồi HD7 cũ). `notes`: "kho X: a → b", "giá vốn X: a → b" khi BQ đổi, "suất X" cho gói.
- D8 Bán vượt tồn khi lưu: chưa có đường lưu HĐ gắn SP trong gd0 (V2-F/G) ⇒ cờ qua `POST /stock/check` (`over_stock`, theo thành phần stock/quota); V2-F gọi khi lưu và gắn vào phản hồi lưu.
- D9 `milestone_items` không FK tới obligations/contracts (TRUNCATE sổ của bộ test cũ không CASCADE — như V2-B D7); RLS thấy như `contract_items`; dòng đã giao (`delivered` not null) không sửa/xoá (policy). Mốc đã giao > 0 ⇒ huỷ dòng "đã giao" bị chặn 409 `DELIVERY_LOCKED` (đảo kho để V2-M).
- D10 `service_customers` (tên chốt cho V2-H): một dòng mỗi (tenant, SP, khoá khách `party_key` bên mua). Đồng bộ bằng constraint trigger TRÌ HOÃN (HĐ + dòng ghi cùng tx) khi HĐ `deal='sell'` ở trạng thái đã lưu và dòng gắn SP nhóm `service`. HĐ mới cùng khách + SP có hạn ≥ hạn cũ ⇒ thay HĐ/hạn, `renewals` + 1, `prev_contract_id`; HĐ cũ sửa lại không giành dòng. Cờ tx `contracts.v2d_sc` ⇒ một lần mỗi HĐ mỗi tx.
- D11 RLS `service_customers`: đọc cả tenant (như danh mục/tồn, V2-B D2) vì gia hạn bởi người khác phải cập nhật dòng cũ (ON CONFLICT DO UPDATE lỗi 42501 nếu dòng cũ bị lọc M1); ghi chỉ cho HĐ mình thấy; REVOKE DELETE. V2-H xem lại khi làm màn Khách.
- D12 Journal 0026 `when` = 1795300000000 (sau 0024 V2-C = 1795100000000; chừa 0025 cho V2-E).

## Số đo (evotest)
- Số câu xác nhận mốc giao: 1 dòng = 20 dòng = 1 + 8 (khoá HĐ, khoá mốc, nạp, 4 `applyDelivery`, ghi); không gắn SP = 1 + 4.
- p95 20 dòng HTTP (`perf/confirm.perf.int.test.ts`, nền 2.000 SP + 2.000 HĐ/tenant): đầu tiên p50 39,5 · p95 69,9 ms → sau tối ưu p50 22–25 · p95 42,8–51,2 ms (4 lượt). CHƯA chắc đạt ≤ 50: đuôi p95 ≈ 2× p50 do máy evotest (nice 19, CPU chung); không Seq Scan ở kế hoạch riêng lẫn chung (test kiểm).
- Tối ưu: guard tồn/BQ theo hàng (V2-B, ~14 ms/20 dòng) ⇒ trigger mức câu lệnh (~2 ms); `applyDelivery` lọc lô bị trừ `= any(mảng)` (kế hoạch chung từng Seq Scan `stock_lots`); `load` đọc mỗi bảng RLS một lần, lọc HĐ qua InitPlan. `applyDelivery` riêng (V2-B perf): p95 25 → 10–12 ms.
- Int evotest: V2-D + V2-A + HD7 82 pass; V2-B + V2-D 55 pass.

## Việc còn lại (lát sau)
- V2-F: form bảng Trên HĐ · Đã giao · Giao lần này dùng `items` + `GET /milestones/:id/delivery`; gọi `POST /stock/check` khi lưu HĐ bán (cảnh báo 5.7b/e); thông báo `delivery.notes`. e2e ở V2-F.
- V2-H: màn Khách đang dùng / nhắc gia hạn trên `service_customers`; xem lại luật thấy (D11); đổi bên mua của HĐ để lại dòng khóa cũ.
- V2-E: "Gia hạn qua mình" đọc `service_customers.renewals` / `prev_contract_id`.
- V2-M: xoá HĐ ⇒ đảo sổ kho + BQ, gỡ `milestone_items`/`service_customers` của HĐ; mở khoá huỷ xác nhận mốc giao.
