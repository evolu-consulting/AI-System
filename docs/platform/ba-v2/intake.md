---
id: intake-ba-v2
title: Intake Đầy đủ — "Sổ Hợp Tác" BA v2 (NITI GROUP) + mockup-niti.html
date: 2026-10-20
by: intake-analyst (chỉ đọc code)
inputs: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf (20 trang, @Chieucasmen, 2026-10-20) · docs/platform/ba-v2/mockup-niti.html (dữ liệu ngoài, chỉ đối chiếu)
base: platform/gd0 @ f0d9d331 · gói contracts (hub-api packs/contracts, contracts-web, migrations-pack-contracts 0001–0021)
status: chốt theo mặc định (điều phối 2026-10-20: người dùng muốn app khớp CẢ BA lẫn mockup; không chặn ở câu hỏi — mặc định đề xuất = quyết định áp dụng)
---
# Intake BA v2 — Sổ Hợp Tác

Ngoài phạm vi intake này: lát **nav-v2** (đang chạy) — khung 4 trang + avatar/Cài đặt mở từ avatar + Tổng quan bản đầu + thiết kế
giao diện shell và Tổng quan theo mockup. Kế hoạch dưới đây chỉ **nối dữ liệu** vào Tổng quan của nav-v2, không vẽ lại.

## Tóm tắt
**103 ý** (15 khái niệm · 35 use case · 53 quy tắc/quyết định mục 5–6) · **Đã có 5** · **Có một phần 36** · **Chưa có 45** · **Khác 17**.
(Theo khuôn intake-analyst: Đã có 5 · Mâu thuẫn 17 · Mới 45 · Mở rộng 36 · Ngoài phạm vi: 5 mục BA §6e + 7 điểm mockup vượt BA, xem C10.)

Kết luận ngắn: app hiện tại là bản port mgmt-app (HĐ có trạng thái duyệt, sổ đợt thanh toán, điểm uy tín 2 vai kiểu mgmt, module CKS
riêng). BA v2 đổi **trục dữ liệu**: HĐ 3 loại → mốc 7 loại → (kho lô + giá vốn BQ, điểm uy tín theo vai × nhóm SP, điểm kinh doanh,
doanh thu/hoa hồng theo mốc). Phần lớn là **mới** (danh mục SP, kho, điểm KD); phần còn lại **mở rộng** bảng đang có (`obligations`,
`partner_events`, `companies`, mywork).

## 1. Bảng khoảng cách (một dòng mỗi ý BA)
Effort: S ≤ ½ ngày · M ½–2 ngày · L > 2 ngày. Đường dẫn: `H` = `apps/hub-api/src/modules/packs/contracts`, `MG` = `packages/db/migrations-pack-contracts`, `W` = `apps/contracts-web/src`.

### 1a. Khái niệm (BA §2)
| ID | Ý BA | Trạng thái | Bằng chứng | Effort |
|---|---|---|---|---|
| KN-01 | Loại HĐ Mua / Bán / Giới thiệu (mình là bên mua/bán/giới thiệu; tiền chi/thu/hoa hồng) | Khác | `MG/0001_init.sql:69,93` `direction` sale\|purchase + `type` purchase/service/framework/principle; không có Giới thiệu, % hoa hồng | M |
| KN-02 | HĐ có dãy mốc; mỗi mốc có hạn, việc của ai, ngày hoàn thành thực tế | Có một phần | `MG/0008_hd7_ledger.sql:18-51` `obligations` (due_date, done_at, direction pay\|receive) — không có "việc của ai" | M |
| KN-03 | Mốc đối tác xác nhận ⇒ dữ liệu uy tín; mốc trễ chọn lỗi đối tác/mình/chưa rõ, chỉ lỗi đối tác trừ điểm | Có một phần | settle ghi `partner_events` days_late (`MG/0008:69-96`); không có trường lỗi do ai | S |
| KN-04 | Giai đoạn suy từ mốc: Chưa bắt đầu / Đang thực hiện / Đã xong | Khác | `MG/0001:111` status extracting…active/expiring/expired/renewed; `H/domain/status.rules.ts` | M |
| KN-05 | Việc phát sinh theo danh mục "Loại việc" tự định nghĩa | Có một phần | `partner_events.type` cố định (có `complaint`) `MG/0008:88`; không danh mục | M |
| KN-06 | 7 loại mốc (Giao hàng+SL, Thu tiền, Thanh toán, Nhận HH+tiền, Cấp serial, Nhắc gia hạn, Khác) ↔ tiêu chí uy tín | Chưa có | `obligations_kind_ck` chỉ payment\|delivery `MG/0008:43` | M |
| KN-07 | Chỉ sửa/xoá mốc chưa xác nhận; mốc đã xác nhận giữ nguyên | Có một phần | `obligations.status` done/replaced, REVOKE DELETE `MG/0008:122`; luật sửa ở `H/domain/ledger.rules.ts` | S |
| KN-08 | Đối tác nhiều vai: NCC / khách / bên trả HH; điểm riêng từng vai | Có một phần | role customer\|supplier `MG/0008:87`, `MG/0015_hd8_partners.sql:36`; thiếu vai bên trả HH | M |
| KN-09 | Cách lấy hàng theo SP (kho, gói quota có hạn, đặt theo khách, kèm gói, khách tự có, NCC giao thẳng) | Chưa có | `sourcing_choices` (`MG/0013:6`) chỉ nối dòng bán ↔ dòng mua | M |
| KN-10 | Mỗi lần nhập = một lô giá riêng; giá vốn = BQ gia quyền lô còn tồn | Chưa có | chỉ `cks_lots` (CKS, không BQ) `MG/0004_cks.sql:24` | L |
| KN-11 | SP không giữ hàng: giá vốn theo từng đơn đặt | Có một phần | W1 sourcing chọn dòng mua cho dòng bán (`H/domain/sourcing.rules.ts`) | S |
| KN-12 | Nhóm SP (Dịch vụ có hạn / Hàng hoá / Giới thiệu) + danh mục SP | Chưa có | chỉ `contract_categories` (`MG/0001:51`), `price_quotes.product_key` text (`MG/0015:85`) | M |
| KN-13 | SP nhiều thành phần (CKS DN = chứng thư + USB Token) | Chưa có | — | M |
| KN-14 | Điểm uy tín 0–100, mức TỐT/KHÁ/CHÚ Ý, MỚI khi thiếu dữ liệu | Khác | `H/domain/scoring.rules.ts:38` band good/fair/watch, ngưỡng 80/60 `scoring-config.rules.ts:38-46` | S |
| KN-15 | Điểm kinh doanh 0–100 + đề xuất Mua thêm/Giữ/Xả hoặc Đẩy mạnh/Duy trì/Cân nhắc dừng | Chưa có | — | L |

### 1b. Use case Hợp đồng (BA §3.1)
| ID | Use case | Trạng thái | Bằng chứng | Effort |
|---|---|---|---|---|
| HD-01 | Thêm HĐ thủ công, chọn loại, mốc mặc định tự sinh theo loại | Có một phần | `H/application/create-manual.usecase.ts`; mốc mặc định chỉ 1 đợt khi duyệt (trigger `MG/0008:126-159`) | M |
| HD-02 | Upload, AI trích trường + tóm tắt, gắn dòng với SP, Lưu/Huỷ | Có một phần | HD2 `H/application/upload-contract.usecase.ts`, `run-extraction.usecase.ts` (trường + trích dẫn + verified); thiếu tóm tắt, mốc AI, gắn SP | M |
| HD-03 | Danh sách: loại, giá trị, hiệu lực, giai đoạn + bước hiện tại (đỏ quá hạn) | Có một phần | `H/application/list-contracts.usecase.ts`, `W/features/contracts-list`; thiếu loại 3 giá trị + giai đoạn | S |
| HD-04 | Chi tiết: thông tin, dòng thời gian mốc, SP Nhập/Xuất, tóm tắt | Có một phần | `H/application/get-contract.usecase.ts`, `W/features/contract-review`, `W/features/ledger` | M |
| HD-05 | Xác nhận mốc ⇒ cập nhật kho, tính lại uy tín "X: a → b" | Có một phần | `POST /obligations/:id/settle` `H/adapters/ledger.routes.ts:99`; không kho, không báo điểm trước/sau | M |
| HD-06 | Ghi việc phát sinh vào dòng thời gian, tính tiêu chí | Có một phần | `POST /partner-events` `ledger.routes.ts:116`; loại cố định | S |
| HD-07 | Xoá HĐ hẳn + hộp xác nhận liệt kê tác động | Khác | D-08: `REVOKE DELETE` `MG/0001:217`; sổ chỉ thêm `MG/0008:120`; không route xoá | L |
| HD-08 | Gắn hoặc tạo SP từ dòng HĐ (AI gợi ý) | Chưa có | — | M |
| HD-09 | Sửa HĐ; mốc đã xác nhận giữ; loại không đổi; tên đối tác mới ⇒ tạo đối tác | Có một phần | `H/application/patch-fields.usecase.ts`; loại chưa khoá | S |
| HD-10 | Gắn/tạo đối tác khi gõ tên; hiện điểm hoặc "Đối tác mới · sẽ tạo khi lưu" | Có một phần | `contracts.party_key` `MG/0008:7`, `companies` `MG/0015:137`; chưa có ô gợi ý + điểm inline | S |
| HD-11 | Thêm/sửa/xoá mốc (loại, tên, hạn, việc của ai, SL/số tiền) | Có một phần | `PUT /contracts/:id/schedule` `ledger.routes.ts:94` (thay cả lịch, đợt cũ `replaced`) | M |

### 1c. Use case Đối tác (BA §3.2)
| ID | Use case | Trạng thái | Bằng chứng | Effort |
|---|---|---|---|---|
| DT-01 | Danh sách đối tác, điểm theo từng vai | Có một phần | `GET /partners` `H/adapters/partners.routes.ts:63`, `W/features/partners`; 2 vai, không theo nhóm | S |
| DT-02 | Chi tiết điểm: bấm tiêu chí xem việc góp điểm | Có một phần | `breakdown` `H/domain/scoring.rules.ts:27-35`; chưa liệt kê từng việc | M |
| DT-03 | Diễn biến điểm 3/6/12 tháng | Chưa có | `score_snapshots` chỉ chụp khi lưu cấu hình `MG/0015:62` | M |
| DT-04 | Đánh giá thủ công 1–5 sao từng tiêu chí, lý do khi lệch | Có một phần | tiêu chí `kind: manual` + `PUT /partners/ratings` `partners.routes.ts:74`; không trộn tỷ trọng s, không bắt lý do | M |
| DT-05 | Ghi chú về đối tác, lịch sử theo người + ngày, xoá được | Chưa có | — | S |
| DT-06 | Tab HĐ liên quan, lọc theo giai đoạn | Có một phần | `GET /contracts/:id/partner` `ledger.routes.ts:91`; lọc giai đoạn chưa có | S |
| DT-07 | Tìm đối tác trên internet, lưu dòng vào ghi chú | Có một phần | chỉ tra Cục Thuế `POST /companies/refresh` `H/adapters/companies.routes.ts:50` | M |

### 1d. Use case Sản phẩm & Giá (BA §3.3)
| ID | Use case | Trạng thái | Bằng chứng | Effort |
|---|---|---|---|---|
| SP-01 | Danh sách SP lọc 4 nhóm; đang giữ, đã bán, điểm KD | Chưa có | `/prices/products` chỉ từ báo giá `partners.routes.ts:95` | M |
| SP-02 | Lịch sử Mua (lô, giá, so lần trước, còn lại) / Bán (giá, giá vốn, lãi) | Chưa có | `/cks/lots` chỉ CKS `H/cks/adapters/cks.routes.ts:91` | M |
| SP-03 | Khách đang dùng: Hết hạn/Sắp/Còn hạn, Nhắc gia hạn ⇒ Cần xử lý | Khác | `cks_certificates`/`cks_renewals`/`cks_followups` theo chứng thư, chỉ CKS `MG/0004:48,101,133` | M |
| SP-04 | So sánh giá NCC (Mua mới/Gia hạn) với giá vốn mình giữ | Có một phần | `GET /prices/compare` `partners.routes.ts:96`, `H/domain/goods-prices.rules.ts`; thiếu Mua mới/Gia hạn + giá vốn BQ | S |
| SP-05 | Tìm giá thị trường (AI), lưu vào bảng so sánh | Có một phần | `market_observations` `MG/0015:116`; `POST /cks/scans` chỉ CKS `cks.routes.ts:100` | M |
| SP-06 | Đánh giá nên hợp tác tiếp với NCC nào (4 gợi ý) | Chưa có | — | S |
| SP-07 | Tab HĐ liên quan SP | Chưa có | cần danh mục SP | S |

### 1e. Use case Tổng quan (BA §3.4) — UI do nav-v2; dưới đây là phần dữ liệu
| ID | Use case | Trạng thái | Bằng chứng | Effort |
|---|---|---|---|---|
| TQ-01 | Cần xử lý (8 nguồn §5.9), bấm đi thẳng chỗ xử lý | Có một phần | `H/domain/mywork.types.ts:8` 4 loại followup/obligation/deadline/reminder; 7 ngày `MYWORK_AHEAD_DAYS` | M |
| TQ-02 | Kinh doanh theo kỳ: 4 con số + biểu đồ theo nhóm | Chưa có | `/payments` chỉ danh sách đợt `ledger.routes.ts:76` | M |
| TQ-03 | 3 nhóm Mua thêm / Giữ / Xả → SP | Chưa có | phụ thuộc KN-15 | S |
| TQ-04 | Đối tác CHÚ Ý hoặc giảm ≥ 3 điểm trong 3 tháng | Chưa có | cần lịch sử điểm (DT-03) | S |

### 1f. Use case Cài đặt (BA §3.5)
| ID | Use case | Trạng thái | Bằng chứng | Effort |
|---|---|---|---|---|
| CD-01 | Tên công ty, tên app, logo, màu chủ đạo (6), sáng/tối | Có một phần | sáng/tối/máy `W/features/shell/components/ThemeMenu.tsx`; `tenants.profile` admin 0015 chỉ đọc; logo/màu chưa | M |
| CD-02 | Tiêu chí uy tín theo nhóm × vai (5 ô), bật/tắt, trọng số, tự thêm, thử tính | Khác | `score_configs` một hàng/vai `MG/0015:25`; tối đa 12 tiêu chí `scoring-config.rules.ts:47`; preview `partners.routes.ts:84` | M |
| CD-03 | Khoảng tính điểm + giảm theo độ cũ | Khác | `window_months` 12 + `recency_boost` ×2 trong 3 tháng `scoring-config.rules.ts:38-46` | S |
| CD-04 | Quản lý Loại việc, gắn tiêu chí | Chưa có | — | S |
| CD-05 | Ngưỡng TỐT/KHÁ, số việc tối thiểu, tỷ trọng đánh giá, khi nào nhắc, kỳ chốt | Có một phần | `good_from/fair_from/min_events/manual_adjust` `scoring-config.rules.ts:12-20` | M |
| CD-06 | Trọng số + ngưỡng điểm KD, mục tiêu bán, ngày báo sắp hết hạn | Chưa có | — | S |

### 1g. Quy tắc (BA §5) và quyết định (BA §6)
| ID | Quy tắc | Trạng thái | Bằng chứng | Effort |
|---|---|---|---|---|
| 5.1a | Điểm theo đối tác × vai × nhóm SP; điểm vai = BQ theo giá trị giao dịch từng nhóm | Chưa có | điểm theo (party_key, vai) `H/domain/scoring-agg.rules.ts` | M |
| 5.1b | 4 bước: việc → tiêu chí (BQ theo hệ số độ cũ h) → dữ liệu (BQ trọng số w, bỏ tiêu chí trống) → cuối = (1−s)·dữ liệu + s·sao×20 | Khác | `onTime` = 100·on/w − 2·lateDays, `scoring.rules.ts:50-71` | M |
| 5.1c | Tiêu chí mặc định cho 5 ô nhóm × vai | Khác | `DEFAULTS` customer/supplier (thanh toán, gia hạn CKS, nhắc, lịch hẹn, gắn bó…) `scoring-config.rules.ts:63` | S |
| 5.1d | Tiêu chí tự thêm ≤ 8/ô, 3 kiểu: đếm việc xấu / tỷ lệ đúng hạn một loại mốc / chấm tay | Có một phần | chỉ `custom:` kiểu chấm tay `scoring-config.rules.ts:49-50` | S |
| 5.1e | Khoảng tính: DV có hạn 24 th, hàng hoá 12, giới thiệu 12 | Khác | một `window_months` = 12 | S |
| 5.1f | Giảm bậc thang <6 th 100% · 6–12 th 50% · >12 th 20% | Khác | ×2 cho 3 tháng gần | S |
| 5.1g | Ngưỡng TỐT ≥ 85, KHÁ ≥ 70 | Khác | 80 / 60 | S |
| 5.1h | < 3 việc ⇒ MỚI, chưa xếp mức | Đã có | `min_events: 3` `scoring-config.rules.ts:41` | S |
| 5.1i | Đánh giá thủ công 20% (≤ 50%), lệch > 25 bắt lý do, nhiều người ⇒ TB lượt mới nhất mỗi người | Chưa có | `rating` không được tính (`scoring-agg.rules.ts:60`) | M |
| 5.1j | Chốt điểm hằng tháng; đổi cài đặt không đổi điểm đã chốt | Chưa có | điểm tính khi đọc, không lưu (`MG/0015:3`) | M |
| 5.2a | Điểm KD = 40% tốc độ bán + 35% biên lãi + 25% xu hướng | Chưa có | — | M |
| 5.2b | Tốc độ bán 3 kiểu (kho: ngày tồn; gói có hạn: suất dự kiến/suất giữ; đặt theo khách: bán 3 th / mục tiêu 6) | Chưa có | — | S |
| 5.2c | Biên lãi ×400 (25% = 100); Giới thiệu: HH đã nhận / HH phát sinh | Chưa có | — | S |
| 5.2d | Xu hướng = 50 + (3 th gần − 3 th trước)/3 th trước × 50 | Chưa có | — | S |
| 5.2e | Quy tắc đề xuất: Mua thêm / Xả / Giữ; Đẩy mạnh ≥ 70 / Cân nhắc dừng < 45 / Duy trì | Chưa có | — | S |
| 5.3a | Nhập lô: BQ = (tồn cũ × giá cũ + lô × giá) / tổng tồn | Chưa có | — | M |
| 5.3b | Xuất bán: trừ tồn, giá vốn đơn = BQ lúc bán | Chưa có | — | S |
| 5.3c | Hàng đang giữ = Σ tồn × BQ các SP có giữ hàng | Chưa có | — | S |
| 5.4a | Số tiền mốc = trường Số tiền; không có ⇒ chia đều giá trị HĐ cho các mốc thu | Có một phần | 1 đợt toàn giá trị `hd7_default_schedule` `MG/0008:126-146` | S |
| 5.4b | Doanh thu dự kiến theo hạn mốc thu / thực nhận theo ngày xác nhận; chênh = "chưa thu"; lãi gộp trên dự kiến | Có một phần | `obligations` due_date/done_at, `obligations_done_idx` `MG/0008:66` | M |
| 5.4c | Hoa hồng dự kiến (phí gốc × %, hoặc cố định) / thực nhận | Chưa có | — | M |
| 5.4d | Bán lẻ nhiều khách nhỏ = một HĐ bán theo tháng nhiều mốc thu | Đã có | chỉ là cách nhập; mốc thu nhiều đợt có sẵn (`obligations.seq`) | S |
| 5.5a | Mọi dòng SP có tên phải gắn SP danh mục trước khi lưu | Chưa có | `contract_items` không có product_id `MG/0001:132` | S |
| 5.5b | Gợi ý: quy tắc nhận diện của SP → trùng từ → Tạo mới | Chưa có | — | M |
| 5.5c | SP mới lấy tên + đơn vị từ dòng, người chọn nhóm; HĐ Giới thiệu chỉ gắn SP nhóm Giới thiệu | Chưa có | — | S |
| 5.5d | HĐ Mua: NCC thành NCC chính của SP mới; kho chỉ tăng khi mốc giao xác nhận | Chưa có | — | S |
| 5.5e | Xoá HĐ: SP tạo từ HĐ chưa có giao dịch khác thì xoá theo | Chưa có | đi cùng HD-07 | S |
| 5.5f | Thành phần: dòng chọn thành phần, AI gợi ý theo từ, tồn theo thành phần | Chưa có | — | M |
| 5.6a | Tên đối tác khớp (không phân biệt hoa thường) ⇒ gắn | Đã có | mạnh hơn: `party_key` MST hoặc fold(tên) `MG/0008:7-12` | S |
| 5.6b | Không khớp ⇒ tạo đối tác khi lưu, vai theo loại HĐ (Mua→NCC, Bán→Khách, GT→Bên trả HH) | Có một phần | `companies.created_from` `MG/0015:151`; vai suy từ direction, không có vai HH | S |
| 5.6c | Đối tác có sẵn chưa có vai ⇒ thêm vai | Có một phần | vai suy theo HĐ, không lưu | S |
| 5.6d | Đối tác / vai mới nhãn MỚI tới đủ số việc tối thiểu | Đã có | `min_events` | S |
| 5.7a | Mốc giao mang SL; nhiều đợt; bảng Trên HĐ · Đã giao · Giao lần này; không giao vượt | Chưa có | `obligations` không có SL | M |
| 5.7b | Bán vượt tồn: cảnh báo khi lưu, chặn khi xác nhận mốc giao | Chưa có | — | S |
| 5.7c | Xác nhận giao HĐ Mua: + kho / + suất gói (hạn gói = ngày kết thúc HĐ) + tính lại BQ; Bán: trừ; đặt theo khách: không đổi kho | Chưa có | — | M |
| 5.7d | Thông báo sau xác nhận: kho trước → sau, giá vốn trước → sau | Chưa có | — | S |
| 5.7e | Form HĐ hiện tồn dưới dòng; "Bán vượt tồn" | Chưa có | — | S |
| 5.7f | Kho + BQ tính riêng từng thành phần | Chưa có | — | M |
| 5.8a | HĐ bán DV có hạn tạo dòng "khách đang dùng" ngay khi lưu, hết hạn = ngày kết thúc HĐ | Khác | tạo chứng thư qua `POST /cks/sales` `cks.routes.ts:111`, theo serial | M |
| 5.8b | Gia hạn = HĐ bán mới nối tiếp; thay dòng cũ; tính "Gia hạn qua mình" | Có một phần | `cks_renewals.new_contract_id` `MG/0004:101-123`, sự kiện `cks_renewed` | M |
| 5.8c | Một nguồn nhắc: "Nhắc trước khi hết hạn" mỗi HĐ, mặc định 60 từ Cài đặt | Có một phần | `notice_days` + `deadline_of` `MG/0003_hd4_reminders.sql:22-27`; mặc định Cài đặt chưa có | S |
| 5.8d | Khách còn < 60 ngày ⇒ Sắp hết hạn + Cần xử lý | Có một phần | HD4 nhắc hạn HĐ; CKS followups | S |
| 5.9a | Cần xử lý: Quá hạn, Sắp đến hạn 7 ngày | Đã có | mywork `obligation` + `MYWORK_AHEAD_DAYS = 7` | S |
| 5.9b | Cần xử lý: HĐ sắp hết hạn (theo ngày nhắc HĐ) | Có một phần | mywork `deadline` (`contracts_deadline_idx` `MG/0013:28`) | S |
| 5.9c | Cần xử lý: Khách sắp hết hạn, Liên hệ mời gia hạn (Đã xong) | Có một phần | `cks_followups`, `followups` `MG/0013:40` | S |
| 5.9d | Cần xử lý: Hoa hồng chưa nhận (quá ngày đối soát) | Chưa có | — | S |
| 5.9e | Cần xử lý: Đánh giá đối tác (HĐ xong 30 ngày / đầu quý) | Chưa có | — | S |
| 5.9f | Cần xử lý: Thiếu file (HĐ nhập tay chưa có file gốc), Bỏ qua | Chưa có | `contracts.file_id` null có sẵn để lọc `MG/0001:80` | S |
| 6a | Xoá HĐ: kho/giá vốn về như trước các lần giao; doanh thu/HH/điểm hiện tại tính lại; điểm kỳ đã chốt giữ | Khác | xem HD-07, C6 | (HD-07) |
| 6b | Đổi Cài đặt: chỉ điểm hiện tại tính lại | Có một phần | "Lưu & tính lại" chụp `score_snapshots` `MG/0015:61` | S |
| 6c | Không sửa SP / đối tác / dòng SP của HĐ — sai thì xoá HĐ tạo lại | Khác | `contract_items.edited`, sửa dòng qua patch-fields `MG/0001:151` | S |
| 6d | Bỏ "ai được đánh giá" và "điểm riêng từng HĐ" khỏi Cài đặt | Khác | mockup vẫn có (C10) | — |
| 6e | Ngoài phạm vi: lịch sử nhiều năm, phân quyền chi tiết, push email/Zalo, công nợ/hoá đơn/kế toán, màn cấu hình cách lấy hàng | Khác | hiện CÓ push (N3), approvals (HD3) — giữ, không mở rộng | — |

Đếm: Đã có 5 (5.1h, 5.4d, 5.6a, 5.6d, 5.9a) · Khác 17 · Chưa có 45 · Có một phần 36.

## 2. Mâu thuẫn với cái đã xây — mặc định đề xuất (= quyết định áp dụng)
| # | Mâu thuẫn | BA v2 | Hiện tại | Mặc định áp dụng |
|---|---|---|---|---|
| C1 | **Điểm uy tín** | §5.1: đối tác × vai (3) × nhóm SP (3), 5 ô tiêu chí riêng, giảm bậc 100/50/20, khoảng 24/12/12 th, ngưỡng 85/70, sao trộn s = 20%, chốt tháng | HD8 port nguyên mgmt `engine.py` (`H/domain/scoring*.rules.ts`, parity test khoá `tests/acceptance/HD8`): 2 vai, 1 cấu hình/vai, ×2 gần đây, 80/60, tiêu chí Gắn bó/Lịch hẹn, tính khi đọc | **Thay engine bằng §5.1** (engine mới `scoring-v2`, set-based SQL, Luật 4c). Giữ `partner_events` làm nguồn "việc" (thêm cột nhóm/tiêu chí/lỗi do ai); điểm hiện tại tính khi đọc + bảng mới `score_locks` (chốt tháng, chỉ thêm). Bảng `score_configs` cũ chỉ đọc; cấu hình mới `score_configs_v2` khoá (tenant, nhóm, vai). Test parity HD8 ⇒ qc gỡ khoá, thay bằng test §5.1 (công thức BA + 3 việc mẫu). Bỏ ngưỡng parity mgmt |
| C2 | **Loại HĐ + mốc vs sổ đợt** | Mua/Bán/Giới thiệu; mốc 7 loại, việc của ai, SL/số tiền, lỗi do ai; giai đoạn suy từ mốc; mốc mặc định khi **lưu** | `direction` + `type`; `obligations` payment\|delivery; mặc định 1 đợt khi **duyệt** (trigger HD7); `status` vòng đời mgmt | **Mở rộng `obligations` thành "mốc"** (không bảng mới — giữ /payments, mywork, vòng quá hạn): thêm `kind` 7 loại, `owner` ours\|partner, `fault`, `title`, bảng con `milestone_items` (SL từng dòng SP). Thêm `contracts.deal` buy\|sell\|referral (backfill từ direction) + `commission_pct/commission_fixed`. Giai đoạn = cột tính khi đọc từ mốc; `status` giữ cho đường trích AI (extracting/needs_review) |
| C3 | **Duyệt HĐ (HD3) + trạng thái** | Lưu ⇒ "Chưa bắt đầu"; không có duyệt | Duyệt 2 cấp theo ngưỡng (`MG/0005`, `H/application/approval*.ts`); mốc mặc định chỉ sinh khi duyệt | **Tắt duyệt cho tenant dùng v2** (cờ theo tenant, mặc định tắt cho nitigroup + demo); HĐ lưu = hiệu lực; code HD3 giữ, không phát triển |
| C4 | **Kho lô + giá vốn BQ** (mới) | Danh mục SP + thành phần, lô, BQ gia quyền, xuất theo BQ lúc bán, suất gói có hạn | Chỉ `cks_lots` (CKS, không BQ); không danh mục | **Mới hoàn toàn**: `products`, `product_components`, `product_rules` (quy tắc nhận diện), `stock_lots`, `stock_moves` (chỉ thêm, có `reversed_by` cho xoá HĐ). BQ lưu cột trên thành phần + tính lại trong cùng tx khi xác nhận mốc giao (khoá `FOR UPDATE` thành phần theo thứ tự id). Tiền bigint đồng; SL numeric(18,4) |
| C5 | **Điểm kinh doanh + đề xuất** (mới) | §5.2: 3 yếu tố, 2 bộ đề xuất theo có/không giữ hàng | Không có | **Mới**: hàm thuần `business-score.rules.ts` + một câu SQL gom theo tập (bán 3+3 tháng, tồn, giá vốn, HH); tính khi đọc, không lưu; cấu hình `business_settings` một hàng/tenant |
| C6 | **Khách CKS vs "khách đang dùng"** | Dòng khách × SP DV có hạn, tạo khi lưu HĐ bán, hết hạn = ngày kết thúc HĐ, gia hạn = HĐ mới thay dòng | Module CKS riêng: khách, lô, chứng thư/serial, người giữ, gia hạn theo nhóm, văn bản đã ký, giá thị trường CKS (`MG/0004`, `H/cks/**`, `W/features/cks*`) | **Thay bằng bảng chung `service_users`** (khách × SP × HĐ bán × hết hạn × thay bởi). Màn CKS rời khỏi nav (nav-v2), route giữ chỉ đọc; không phát triển tiếp. Serial/người giữ không mang sang (BA không có). Dữ liệu CKS demo ⇒ C8 |
| C7 | **Xoá HĐ** | Xoá hẳn, không hoàn tác; hộp xác nhận liệt kê tác động; kho/BQ trả lại; SP + khách đang dùng sinh từ HĐ bị gỡ; đối tác giữ; điểm đã chốt giữ | D-08 không xoá (`REVOKE DELETE` HĐ/dòng/sổ; sổ đối tác chỉ thêm) | **Làm theo BA**, làn đầy đủ: hàm `contracts.delete_contract(id)` SECURITY DEFINER trong một tx: preview (GET tác động) → xoá; kho = ghi `stock_moves` đảo + tính lại BQ từ lô còn lại; `partner_events` của HĐ ⇒ thêm `partner_event_voids` (giữ chỉ thêm), chỉ điểm hiện tại đổi; `score_locks` không đụng. Chỉ vai `contracts-owner`. Một dòng audit (id, tên, số, người, lúc) giữ lại |
| C8 | **Dữ liệu cũ của tenant demo** | — | `demo` có dữ liệu mẫu mgmt import (`deploy/tenants/demo.yaml`, commit ca470588); nitigroup **bắt đầu trống** (D-NITI-09) | **Không chuyển tại chỗ.** Migration schema chỉ cộng thêm + backfill rẻ (deal từ direction; obligations cũ ⇒ kind thu/thanh toán, owner theo direction). Tenant demo **nạp lại** bộ mẫu v2 (dữ liệu theo mockup: CKS, hoá đơn ĐT, băng keo, thùng phi, bảo hiểm xe) bằng script lặp lại được; bộ mẫu mgmt cũ xoá khỏi demo. Không đụng tenant khác |
| C9 | **Trang cũ ngoài 4 trang BA** | 4 trang + Cài đặt | Thanh toán (ledger), Mua hàng (sourcing), Việc của tôi, CKS, Phụ lục, Giá hàng, Cấu hình điểm | nav-v2 bỏ khỏi menu; chức năng gộp: Thanh toán ⇒ mốc trong chi tiết HĐ + TQ; Việc của tôi ⇒ Cần xử lý; Giá hàng ⇒ tab NCC & giá; Phụ lục ⇒ tài liệu đính kèm trong chi tiết HĐ. Route cũ giữ tới lát dọn (O) |
| C10 | **BA ↔ mockup lệch nhau** | BA §6: không màn cách lấy hàng, không "ai được đánh giá", không điểm theo HĐ, không sửa SP/dòng | Mockup có: cấu hình "Cách lấy hàng theo loại", "Ai được đánh giá", "Điểm theo từng HĐ", điều chỉnh tay ±20 + "Cảnh báo bất thường", "Thêm sản phẩm"/"Nhập lô" tay, dời hạn "ai đề nghị", "Uy tín của mình", đổi thứ tự mốc | **BA thắng khi BA nói rõ không làm** (cách lấy hàng UI, ai được đánh giá, điểm theo HĐ, sửa SP/dòng, thêm SP/lô tay). **Mockup bổ sung khi BA im lặng và không trái công thức**: dời hạn có "ai đề nghị" (mình xin dời ⇒ không trừ điểm; đã có `postpone`), "Uy tín của mình" (mốc việc của mình), đổi thứ tự hiển thị mốc, gợi ý tạo loại việc. **Không làm** điều chỉnh tay ±20 / cảnh báo bất thường (trái công thức §5.1). Giao diện theo mockup |
| C11 | **Danh tính đối tác** | Khớp tên không phân biệt hoa thường | `party_key` = MST hoặc fold(tên) | Giữ `party_key` (đúng hơn, khớp BA trong mọi ca BA nêu); `companies` = hồ sơ đối tác + bảng mới `partner_roles` (party_key, vai, nhóm, created_from, first_at) + `partner_notes` |
| C12 | **Sửa dòng hàng** | Không sửa dòng SP sau lưu | patch-fields sửa được dòng (`contract_items.edited`) | Theo BA: sau lưu khoá dòng SP + gắn SP; trường thông tin khác sửa được (HD-09) |

## 3. Kế hoạch lát theo đợt
Luật 0b: một agent làm trọn mỗi lát, worktree riêng, merge tuần tự vào `platform/gd0`. Mỗi đợt ≤ 3 lát song song; đợt sau bắt đầu
ngay khi các lát nó phụ thuộc đã merge (phụ thuộc ghi rõ — không chờ cả đợt nếu phụ thuộc đã xong). Làn theo Luật 1b: dữ liệu/
migration/RLS/tiền = **đầy đủ** (Opus, test RLS/tiền viết trước phần đó); màn hình = **nhanh** (Sonnet). Đợt 0 = nav-v2 (đang chạy).

| Đợt | Lát | Làn | Phạm vi (ý BA) | Phụ thuộc | Effort |
|---|---|---|---|---|---|
| 1 | **V2-A Mô hình HĐ + mốc** | đầy đủ (migration, tiền) | KN-01..07, HD-01/09/11 (API), 5.4a, C2, C3 (cờ tắt duyệt), C12; migration cộng thêm + backfill; giai đoạn suy từ mốc; mốc mặc định theo loại khi lưu | — | L |
| 1 | **V2-B Danh mục SP + kho lô + BQ** | đầy đủ (tiền, bảng mới RLS) | KN-09..13, 5.3a-c, 5.5a/c/d/f (API), 5.7f; hàm `applyDelivery(tx, moves)` cho V2-D; perf: xác nhận 1 mốc nhiều dòng ≤ số câu SQL cố định | — | L |
| 1 | **V2-C Đối tác nhiều vai + ghi chú** | đầy đủ (bảng mới RLS) | KN-08, HD-10, 5.6b/c/d, DT-05, C11; `partner_roles`, `partner_notes` | — | M |
| 2 | **V2-D Xác nhận mốc ⇒ kho** | đầy đủ (tiền) | HD-05 (kho), 5.7a-d, 5.3b, 5.8a (tạo dòng khách đang dùng khi lưu HĐ bán), 5.8b | A, B | M |
| 2 | **V2-E Uy tín v2 (engine + Loại việc + chốt tháng)** | đầy đủ (đường nóng perf, thay test khoá HD8) | KN-03/05/14, HD-06, 5.1a-j, 6b, DT-02/03/04 (API), CD-02..05 (API cấu hình), C1 | A, C | L |
| 2 | **V2-F Hợp đồng UI v2** | nhanh | HD-01/03/04/09/10/11 UI, 5.5a/5.7e (form), dời hạn + đổi thứ tự mốc (C10), sticky Lưu/Huỷ, nhãn Nhập/Xuất kho | A, B, C (API) | L |
| 3 | **V2-G AI đọc HĐ v2** | nhanh (AI qua subscription, `ai-sub`) | HD-02, HD-08, 5.5b/f (gợi ý), tóm tắt 5 mục, mốc AI tìm thấy, trường chưa chắc tô vàng | F, B | M |
| 3 | **V2-H Khách đang dùng + gia hạn** | đầy đủ (bảng mới RLS, chuyển ý CKS) | SP-03, 5.8c/d, 5.9c, C6; Nhắc gia hạn ⇒ Cần xử lý; mặc định 60 ngày | D | M |
| 3 | **V2-I Đối tác UI v2** | nhanh | DT-01..07 UI (bảng tính điểm bấm tiêu chí, biểu đồ 3/6/12 th + đường ngưỡng, tab HĐ lọc giai đoạn, sao + lý do, ghi chú, Tìm trên internet), "Uy tín của mình" (C10) | E | M |
| 4 | **V2-J1 Điểm kinh doanh + SP danh sách/tóm tắt/lịch sử** | nhanh (công thức thuần + đọc) | KN-15, 5.2a-e, SP-01, SP-02, SP-07, CD-06 (API) | D, E | M |
| 4 | **V2-J2 NCC & giá** | nhanh | SP-04, SP-05 (AI dò giá chung, thay `/cks/scans`), SP-06 | J1 không cần; B, E | M |
| 4 | **V2-K Doanh thu/HH theo mốc + Cần xử lý 8 nguồn** | đầy đủ (tiền, đường nóng) | 5.4b/c, TQ-01 (API), TQ-02 (API: 4 số + 12 cột/nhóm, so kỳ trước), 5.9b-f, hàng đang giữ (5.3c) | D, H | M |
| 5 | **V2-L Hộp thoại Cài đặt** | nhanh | CD-01 (tên, tên app, logo ≤ 1 MB, 6 màu, giao diện), CD-02..06 UI (5 ô × 3 tab, thử tính, chấm cam, Khôi phục/Bỏ/Lưu) | E, J1 | M |
| 5 | **V2-M Xoá hợp đồng** | đầy đủ (mất dữ liệu, tiền) | HD-07, 5.5e, 6a, C7 (preview tác động + xoá một tx) | D, E, H | M |
| 5 | **V2-N Tổng quan nối dữ liệu** | nhanh | TQ-01..04 nối vào Tổng quan của nav-v2 (Cần xử lý 6 + Xem thêm, Bỏ qua/Đã xong; 4 số; theo nhóm; SP nên làm gì; đối tác cần xem lại; top 3 NCC/khách) | K, J1, E, nav-v2 | S |
| 6 | **V2-O Dữ liệu demo v2 + dọn trang cũ** | đầy đủ (dữ liệu tenant) | C8 (nạp lại demo theo mockup), C9 (gỡ route/nav cũ, HD8 engine cũ chỉ đọc), cập nhật CODEMAP/STATE, UAT trình duyệt cả luồng HĐ → kho → điểm → Tổng quan | tất cả | M |

**6 đợt (1–6) · 16 lát** (+ nav-v2 đang chạy). Review + security một lượt trên diff gộp cuối mỗi đợt (Luật 0b). Đường găng:
A → D → H → K → N/M → O. Lát V2-E và V2-K có ngưỡng perf (Luật 4c): `GET /partners` 1.000 đối tác × 3 vai p95 ≤ 100 ms; tổng hợp
Tổng quan 10.000 mốc p95 ≤ 100 ms; xác nhận mốc giao 20 dòng p95 ≤ 50 ms, số câu SQL cố định.

## Ảnh hưởng
| Phần | Spec | Đã qua Gate? | Test khoá | Artboard | Code | Mốc |
|---|---|---|---|---|---|---|
| HĐ + mốc | HD1, HD4, HD7 | done | `tests/acceptance/HD1` (17), `HD4` (6), `HD7` (6) — qc cập nhật phần mốc/trigger mặc định | mockup thay artboard | `H/application/create-manual`, `patch-fields`, `ledger*`; `MG` mới 0022+ | CR-096 đợt 1–2 |
| Duyệt | HD3 | done | `HD3` (8) giữ, chạy với cờ bật | — | cờ theo tenant | đợt 1 |
| Uy tín | HD8 | done | `HD8` (7) parity mgmt ⇒ **gỡ khoá, thay** | mockup | `H/domain/scoring*` thay | đợt 2 |
| CKS | HD9 | done | `HD9` (8) giữ (route chỉ đọc) | — | `H/cks/**` đóng băng | đợt 3, 6 |
| Việc của tôi / Mua hàng | W1, W1B | done | `W1` (5), `W1B` (2) — mywork mở rộng nguồn | — | `H/domain/mywork*` | đợt 4 |
| Xoá HĐ | HD1 D-08 | done | HD1 test "không xoá được" ⇒ qc sửa | — | hàm DB mới | đợt 5 |
| e2e | contracts-web | — | `e2e/contracts-web` — mỗi lát UI thêm/sửa e2e | — | `W/features/*` | mọi đợt |
Luật 0b: không Gate lại; tasks.md mỗi lát ghi quyết định. Mốc CR-095 (deploy song song sohoptac) không đổi; tenant nitigroup dùng v2 khi đợt 6 xong.

## CR đề xuất
| CR | R | Tóm tắt thay đổi | Tài liệu cần sửa |
|---|---|---|---|
| CR-096 | toàn bộ | App contracts tái cấu trúc theo BA v2 "Sổ Hợp Tác" + mockup NITI: HĐ 3 loại + mốc 7 loại, danh mục SP + kho lô + giá vốn BQ, uy tín §5.1 thay HD8, điểm KD, khách đang dùng thay CKS, xoá HĐ hẳn, 4 trang | `docs/CHANGE-REQUESTS.md`, `docs/ROADMAP.md`, `docs/STATE.md`, `docs/platform/modules.md` (CKS/HD8 engine đóng băng), `docs/specs/V2-*/tasks.md` |
| CR-096a | C3 | Tắt duyệt HĐ theo tenant | HD3 tasks.md (ghi chú) |
| CR-096b | C7 | Bỏ D-08 cho lệnh xoá có kiểm soát | HD1 spec (quyết định D-08) |

## 4. Câu hỏi (một lượt) — mặc định đã áp dụng, người dùng chỉ cần trả lời khi muốn khác
1. **Uy tín:** thay hẳn engine HD8 (kiểu mgmt, ngưỡng 80/60, tiêu chí Gắn bó/Lịch hẹn) bằng §5.1 của BA? — mặc định: **thay hẳn**; cấu hình/điểm cũ chỉ đọc, không chuyển.
2. **Duyệt HĐ (HD3):** BA không có bước duyệt. — mặc định: **tắt duyệt cho nitigroup + demo** (cờ theo tenant), HĐ lưu là có hiệu lực.
3. **Xoá HĐ + quyền:** xoá hẳn theo BA (bỏ luật "không xoá" D-08). Ai được xoá và chỉnh Cài đặt? — mặc định: **chỉ vai `contracts-owner`**; giữ một dòng nhật ký (số, tên, người, lúc).
4. **Module CKS** (serial, người giữ chứng thư, văn bản đã ký, gia hạn theo nhóm): — mặc định: **thay bằng "khách đang dùng" chung**, màn CKS rời menu, serial/người giữ không mang sang.
5. **Dữ liệu tenant demo:** — mặc định: **nạp lại bộ mẫu v2 theo mockup**, bỏ dữ liệu mgmt import cũ; nitigroup bắt đầu trống (như D-NITI-09).
6. **BA ↔ mockup lệch:** — mặc định: **BA thắng ở mục BA nói không làm** (cách lấy hàng, ai được đánh giá, điểm theo HĐ, thêm/sửa SP và lô tay); lấy từ mockup: dời hạn "ai đề nghị", "Uy tín của mình", đổi thứ tự mốc; **không làm** điều chỉnh tay ±20 và cảnh báo bất thường.
7. **VAT:** BA không nói. — mặc định: **giá vốn, giá bán, lãi gộp, hàng đang giữ tính chưa VAT**; doanh thu/hoa hồng dự kiến–thực nhận theo số tiền của mốc (đúng số tiền thu).
8. **Tìm trên internet (DT-07, SP-05):** gửi tên + MST đối tác / tên SP ra ngoài qua AI có tìm web. — mặc định: **cho phép, chỉ khi người dùng bấm**, chỉ gửi tên + MST; AI qua subscription (`ai-sub`).
9. **Trang cũ** (Thanh toán, Mua hàng, Việc của tôi, Phụ lục, Giá hàng): — mặc định: **gộp vào 4 trang và gỡ ở đợt 6**; phụ lục thành tài liệu đính kèm trong chi tiết HĐ.
