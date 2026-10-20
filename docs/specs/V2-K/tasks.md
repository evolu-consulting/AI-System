---
id: V2-K
title: Doanh thu / hoa hồng theo mốc (Tổng quan TQ-02) + Cần xử lý 8 nguồn (TQ-01) — API
lane: đầy đủ (tiền, đường nóng perf, bảng mới RLS)
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf §3.4 TQ-01/02, §4.1, §5.3c, §5.4, §5.9 · intake V2-K (5.4b/c, 5.9b-f, 5.3c)
---
# V2-K — tasks

## Plan
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration `0033_v2k_overview.sql` (journal `when` 1796000000000): `todo_dismissals` (RLS tenant + chỉ của mình), index `obligations_money_due_idx`, `contracts_end_idx` | đầy đủ | ✔ |
| 2 | Luật thuần `domain/overview.rules.ts` (kỳ + kỳ trước, 12 cột, 4 con số, % so kỳ trước, theo nhóm) + `domain/todo.rules.ts` (loại, số ngày, khoá, thứ tự) + unit | đầy đủ | ✔ |
| 3 | `GET /overview?period=month\|quarter\|12m` — MỘT câu SQL gom theo tháng (`adapters/overview.repo.ts`) | đầy đủ | ✔ |
| 4 | `GET /my-work/todo` (8 nguồn, một câu SQL) + `POST /my-work/todo/dismiss` {key, action: skip\|done} (`adapters/todo.repo.ts`) | đầy đủ | ✔ |
| 5 | Test: unit (2 file + dto-mirror), int `V2-K/overview` (đường chính + M1), `V2-K/todo` (đường chính + RLS chéo tenant `todo_dismissals`), perf `V2-K/perf/overview` | — | ✔ (perf 12 tháng chưa đạt, xem Số đo) |

## Quyết định trong lúc làm
- K1 Route nằm trong module "Việc của tôi" (`mywork.mount.ts`, cùng PackUow) — không sửa `packs.mount.ts`. Cần xử lý là đường MỚI `/my-work/todo` cạnh `/my-work` (W1 giữ nguyên hình phản hồi; test W1 khoá không đổi). UI V2-N dùng `/my-work/todo`.
- K2 Tiền (≡ V2-A 5.4a/5.4c): mốc trống của loại tiền CHÍNH (Thu tiền của HĐ Bán, Nhận hoa hồng của HĐ Giới thiệu) chia đều PHẦN CÒN LẠI (cơ sở − Σ số tiền đã ghi), đồng lẻ vào mốc trống đầu theo (hạn, seq, id) — khớp số tiền chi tiết HĐ. Cơ sở hoa hồng = cố định ?? giá trị × % làm tròn nửa lên. Mốc trống loại phụ = 0. Mốc huỷ/bị thay không tính. Chỉ HĐ đã xác nhận.
- K3 Doanh thu = mốc Thu tiền của HĐ **Bán**; hoa hồng = mốc Nhận hoa hồng của mọi HĐ. Dự kiến theo HẠN trong kỳ, thực nhận theo NGÀY XÁC NHẬN trong kỳ (mỗi mốc đếm một lần ở mỗi số). Chưa thu/chưa nhận = max(0, dự kiến − thực nhận). % so kỳ trước theo **thực nhận** (mockup); kỳ trước = 0 ⇒ null.
- K4 Kỳ: Tháng này = tháng lịch; Quý này = quý lịch (gồm tháng tương lai trong quý); 12 tháng = 12 tháng lịch gần nhất gồm tháng này. Kỳ trước cùng độ dài liền trước. 12 cột tháng kết thúc ở tháng cuối kỳ. Cửa sổ đọc = sớm hơn trong (cột đầu, đầu kỳ trước) — Tháng/Quý 12 tháng, 12 tháng 24 tháng.
- K5 Lãi gộp (trên doanh thu DỰ KIẾN, BA §5.4): mỗi mốc thu × (giá trước VAT − giá vốn) ÷ giá trị HĐ, làm tròn xuống; giá trước VAT = Σ SL × đơn giá dòng (không dòng ⇒ giá trị HĐ). Giá vốn HĐ = Σ dòng (giá vốn dòng sổ xuất đã giao + SL chưa giao × Σ BQ hiện tại các thành phần đã chọn). Dòng chưa gắn SP / thành phần đặt theo khách / đã giao mà không có dòng sổ ⇒ giá vốn 0 + cờ `cost_missing` (mockup "Có phần chưa có giá vốn"). Hoa hồng dự kiến cộng thẳng vào lãi gộp; biên % = (lãi gộp − hoa hồng) ÷ doanh thu dự kiến (mockup).
- K6 Hàng đang giữ = Σ `product_components.stock_value` (tồn × BQ) thành phần kho/gói — **cả tenant** (tồn/BQ thấy cả tenant theo V2-B D2); doanh thu/hoa hồng/lãi theo luật thấy M1 (RLS HĐ).
- K7 Theo nhóm: Dịch vụ có hạn / Hàng hoá = doanh thu dự kiến theo `contracts.product_group` (null ⇒ hàng hoá); Giới thiệu = hoa hồng dự kiến. Tổng kỳ + % so kỳ trước + 12 cột.
- K8 Cần xử lý — 8 nguồn, mỗi nguồn ≤ 100 (+1 ⇒ `truncated`), tổng ≤ 300; thứ tự: Quá hạn (trễ lâu trước) → nhóm có hạn gần (Sắp đến hạn, HĐ sắp hết hạn, Khách sắp hết hạn, Liên hệ mời gia hạn, Hoa hồng chưa nhận; hạn gần trước) → Đánh giá → Thiếu file (mới trước).
  - Quá hạn / Sắp đến hạn (≤ 7 ngày): mốc mở, trừ Nhắc gia hạn và Nhận hoa hồng (hoa hồng có nguồn riêng — mỗi việc một chỗ).
  - HĐ sắp hết hạn: HĐ `active|expiring`, chưa ghi kết quả, `end_date − số ngày nhắc ≤ hôm nay ≤ end_date`; số ngày nhắc = trường HĐ ?? Cài đặt (V2-H `business_settings`) ?? 60.
  - Khách sắp hết hạn: `service_customers` còn trong số ngày nhắc (của HĐ hiện tại của dòng) — gom MỘT việc mỗi SP (số khách + hạn sớm nhất), mở tab Khách đang dùng (mockup).
  - Liên hệ mời gia hạn: hẹn nhắc `renewal` (V2-H) của chính mình chưa xong; Đã xong/Bỏ qua ⇒ đóng hẹn nhắc.
  - Hoa hồng chưa nhận: mốc Nhận hoa hồng mở đã quá hạn (hạn mốc = ngày đối soát); kèm SP đầu tiên của HĐ để mở trang SP.
  - Đánh giá đối tác: HĐ không còn mốc bắt buộc mở, mốc cuối xác nhận ≤ 30 ngày, mình chưa chấm sao đối tác đó từ ngày ấy. Nhánh "30 ngày đầu quý" và cờ bật/tắt nhắc chưa có trong Cài đặt (V2-E) ⇒ luôn bật nhánh kết thúc HĐ; để V2-L.
  - Thiếu file: HĐ đã xác nhận `file_id` null (HĐ nhập tay).
- K9 Bỏ qua / Đã xong việc suy ra = hàng `todo_dismissals` của RIÊNG người bấm, khoá `<tiền tố>:<uuid>:<ngày>` (ngày = hạn/ngày kết thúc/ngày xong/ngày tạo ⇒ hạn đổi thì việc hiện lại; mốc dùng chung tiền tố `milestone` nên trễ hạn sau khi Bỏ qua lúc "sắp đến hạn" vẫn ẩn tới khi đổi hạn). Chỉ kiểm dạng khoá (khoá sai ⇒ 400); không đổi dữ liệu nghiệp vụ, không lộ gì (chỉ ẩn danh sách của chính mình). Quyền `read` như hẹn nhắc W1.
- K10 Số câu SQL: Tổng quan 1 + set_config; Cần xử lý 1 + set_config; Bỏ qua 1 (+1 khi là hẹn nhắc).

## Số đo (evotest, 10.000 mốc acme + 10.000 nền beta, sau ANALYZE)
- Số câu `/overview`: 2 (set_config + 1), như dữ liệu 7 HĐ.
- Câu gom (12 tháng, role gói + RLS): đầu 434 ms (EXPLAIN; nested loop CTE ước lượng 1 hàng) → p50 73,4 · p95 89,0 ms.
- HTTP p95: Tháng 92,7 → 83,7 ms; Quý 96,4 → 84,1 ms; **12 tháng 109,2 → 105,9–110,5 ms (p50 84–85) — CHƯA ĐẠT ≤ 100** trên evotest (nice 19, CPU chung; p95 ≈ p50 + 25). Đã làm: cửa sổ đọc theo kỳ, giá vốn gom từ bảng gốc (hash join), một lượt cửa sổ cho 5.4a, bỏ semi-join CTE. Còn lại ~20 ms là cửa sổ 5.4a trên mọi mốc chính của HĐ trong kỳ (phải xếp theo hạn để chia đồng lẻ). Hướng tiếp: lưu sẵn số tiền tính của mốc trống (trigger khi ghi mốc / đổi giá trị HĐ) — đụng mọi đường ghi mốc V2-A, để quyết định riêng.

## Việc còn lại (lát sau)
- V2-N: UI Tổng quan dùng `/overview` + `/my-work/todo` (6 việc + Xem thêm, nút Bỏ qua/Đã xong).
- V2-L: cờ nhắc đánh giá (kết thúc HĐ / đầu quý) + nhánh đầu quý của nguồn Đánh giá.
- V2-M: xoá HĐ ⇒ số Tổng quan tự đổi (đọc khi gọi); `todo_dismissals` không cần gỡ.
- Perf 12 tháng (xem Số đo).
