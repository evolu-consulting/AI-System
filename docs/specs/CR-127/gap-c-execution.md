# CR-127 · Gap vùng C — Thực hiện hợp đồng (đối chiếu business.md §3, §9, §10, §12 với code)

Phát hiện bằng đọc code (chỉ đọc, ~35 lần gọi). "Chưa kiểm" = không mở tới. Ngày 2026-11-10.

## 0. Phát hiện lớn nhất (đổi cách hiểu business.md)
- business.md §3 / §10.2 / §12.3 nói "Giao dịch đã có từ CR-097, nháp → ghi sổ" — **đã lỗi thời**. CR-101 (DOC-deals) đã **gộp giao dịch vào chứng từ**: giao dịch = một hàng `contracts.contracts` có `doc_type = 'deal'` (`packages/db/migrations-pack-contracts/0056_doc_deals.sql:1-7`). Bảng G1 `contracts.transactions*` **chỉ đọc** (`0056:135-136`), `POST/PATCH/DELETE /transactions*` ⇒ 410 `USE_CONTRACTS` (`packages/contracts/src/pack-contracts/deals.ts:1-4,17`; `apps/hub-api/.../adapters/deals.routes.ts:44-50`). `transactions.ts` (zod G1) chỉ còn là lớp tương thích đọc.
- **Giao dịch hôm nay KHÔNG có trạng thái nháp/ghi sổ/huỷ/điều chỉnh**: "Lưu là có hiệu lực, không khoá, sửa trực tiếp, máy ghi `contract_edit_log`" (`0056:3-5,56-70`). Vì vậy C127-BR-72 ("thêm trạng thái Chờ duyệt giữa nháp và đã ghi sổ") không có "nháp/ghi sổ" để chèn vào — phải thiết kế lại (xem §3.5).
- **Không có màn "tạo giao dịch từ Sản phẩm & Giá"**. Trang Sản phẩm (`apps/workspace-web/src/features/products/*`) chỉ có danh mục, kho, lô, quy tắc, tab HĐ; `POST` duy nhất trên `products.routes.ts` là `/products`, `/products/match`, `/products/:id/rules` (dòng 49-57). Giao dịch tạo ở `/contracts/new?type=deal` (`features/contract-new/pages/DealNewPage.tsx:1-6`) ⇒ `POST /contracts/deals` (`deals.routes.ts:78`). C127-BR-49 (ô "Thuộc hợp đồng nào" khi bán/nhập từ Sản phẩm & Giá) là màn **mới hoàn toàn** (hoặc phải gắn vào DealNewPage — cần chốt, câu Q-C1).
- Không có khái niệm **tạm khoá thực hiện**: `locked_at` hiện là khoá K1 (khoá nội dung sau xác nhận), có "Mở lại" `POST /contracts/:id/reopen` (`adapters/manage.routes.ts:143-154`) — BR-74 cũng gỡ cái này. Hai loại khoá khác nghĩa, đừng dùng chung cột.

## 1. Sơ đồ dữ liệu thật

```
contracts.contracts (id, tenant_id, doc_type: contract|framework|deal, deal: buy|sell|referral, status 9 giá trị,
        locked_at (K1), frame_root_id -> HĐ nguyên tắc, source (cho deal), fields jsonb {key:{value,quote}}, ...)
   |  1                                        0055_doc_model.sql:2-6 ; 0056:8-15
   |--< contracts.obligations   (= MỐC. Một bảng, hai tên)   0008_hd7_ledger.sql:18-51 ; 0022_v2a_milestones.sql:76-78 (kind)
   |       id, contract_id, party_key, direction pay|receive, kind payment|delivery|commission|serial|renewal|other,
   |       seq, due_date, amount, qty, delivery_pct, title, owner ours|partner, status open|done|cancelled|replaced,
   |       done_at, fault, postponed_to, postpones, reminders, overdue_for, source manual|ai|default|cks,
   |       transaction_id (G1 cũ, chỉ để đối chiếu; CHECK 0056:128-131)
   |          |--< contracts.milestone_items (tenant, milestone_id, contract_item_id, qty kế hoạch, delivered)   0026:8-19
   |          |--< contracts.stock_moves (milestone_id, contract_id, contract_item_id, component_id, lot_id, direction, qty,
   |          |        unit_cost, reverses)   0023:99-121 — ghi khi mốc GIAO được xác nhận
   |          |--< contracts.partner_events (obligation_id, type delivered|received|paid|postponed|overdue|…, data.impact=rep_delta)
   |                   + partner_event_voids (sổ chỉ thêm)  — uy tín đối tác; milestones.repo.ts:16-24 đọc rep_delta từ đây
   |--< contracts.contract_events   (lịch sử HĐ, type+data jsonb ≤64KB)  0001_init.sql:189-202 ; mỗi lệnh mốc ghi 1 dòng (milestone_added/edited/deleted, obligation_settled)
   |--< contracts.contract_edit_log (chỉ deal; trigger ghi từng trường cũ→mới)  0056:56-124
   +--< contracts.milestone_items.contract_item_id -> dòng sản phẩm của HĐ (contract_items)
```

- **Milestone = Obligation = một hàng `contracts.obligations`.** `MilestoneSchema.id` là id nghĩa vụ; `msJson` dựng mốc từ cột `contracts.obligations` (`apps/hub-api/.../adapters/milestones.repo.ts:13-24`); xoá mốc = `status='replaced'` (`:92-100`). Bảng thanh toán (`GET /payments`, `ledger-read.repo.ts:43`) và "Việc cần làm" đọc cùng bảng này. Không có bảng `milestones` riêng.
- **Xác nhận mốc có hai tên gọi nhưng một lệnh**: `POST /pack/contracts/obligations/:id/settle` (`ledger.routes.ts:134-137`) ⇒ `settleOne` (`application/ledger.usecase.ts:73-100`): khoá HĐ → khoá mốc → nếu `kind='delivery'` gọi `confirmDelivery` (ghi `milestone_items.delivered` + `stock_moves`, `delivery.usecase.ts:77-106`) → tính `rep_delta` (`obligation-impact`, xem trước ở `GET /obligations/:id/impact`) → MỘT câu CTE ghi mốc + `partner_events` + `contract_events` (`adapters/ledger-write.repo.ts:88-102`). Số tiền thật: `amount: b.amount ?? ob.amount` (`ledger.usecase.ts:91`) — mốc tiền **đóng luôn** dù thu thiếu, **không sinh mốc còn lại**.
- **Giao dịch tạo mốc, không "là" mốc**: `POST /contracts/deals` tạo một HĐ `deal` kèm mốc mặc định của chính nó, rồi `settled_now` gọi `settle` tuần tự ≤3 mốc (`deals.routes.ts:56-68,78-90`, `transactions.mount.ts:38-46`). Giao dịch trỏ HĐ cha duy nhất bằng `frame_root_id` (HĐ **nguyên tắc**, `doc_type='framework'`), chứ **không** trỏ tới mốc của HĐ kinh tế (`doc-frame.repo.ts:1-14`, `0055:3-6`).
- Kho: `stock_moves` có `contract_id` + `milestone_id` (giữ `reverses`). Tiền: không có bảng sổ tiền riêng; "công nợ" = tổng `obligations.amount` đang `open` theo hướng (`ledger-read.repo.ts:43-52`, `obligation-impact.ts:52-59`). Uy tín: `partner_events` (`reputation.ts` — `penalty: Int(1,100)` dòng 43 là **điểm uy tín**, KHÔNG phải tiền phạt hợp đồng).
- Bằng chứng/chữ ký: **không có bảng/tệp bằng chứng**. `contract_events.data` (jsonb) lưu id mốc; ký số chỉ có luồng esign (`adapters/esign*.ts`; `esign.selfsign.ts:1-4` là ký thử, không ảnh chữ ký). Chưa có lưu ảnh chữ ký tay hay tệp đính kèm cho quyết định/xác nhận (chưa kiểm hạ tầng lưu tệp ngoài `file_id` của HĐ — `upload.routes.ts:322`).
- AI: summary 5 mục (`main, deadlines, penalties, bonuses, clauses` — mảng chuỗi ≤600 ký tự) và `milestones[{kind,title,due_date,amount,quote}]` (`packages/contracts/src/pack-contracts/extract.ts:103-119`); prompt ở `apps/hub-api/.../domain/extract-prompt.rules.ts:30-37`. Điều khoản: `clauses[{number,topic}]` có sẵn nhưng mốc chỉ có `quote`, **không có số điều/trang**. `fields.penalty`/`warranty` là text (`fields.ts:28-29`).

## 2. Bảng theo mã BR

| Mã | Đã có (file:dòng) | Thiếu | Mâu thuẫn / rủi ro |
|---|---|---|---|
| 41 (chặn) | — (không có cột/cờ tạm khoá; `locked_at` là K1, `manage.routes.ts:143`) | Cờ `exec_hold` + người/lý do/bằng chứng; chặn `settle`, `confirmDelivery`, tạo giao dịch gắn HĐ; vẫn cho `kind=payment direction=receive` | Chặn phải ở **trong tx khoá HĐ** của `settleOne` (`ledger.usecase.ts:75-77`) để chống đua; thêm chỗ đọc ở Sản phẩm & Giá. Quyền (Opus soát) |
| 43 | AI trích mốc `AiMilestoneSchema` (`extract.ts:113-120`), `source='ai'` (`obligations_source_ck`); sửa mốc `PATCH /milestones/:id` (`milestones.routes.ts:56`) | "Lập mốc khi DONE" (hiện lập khi xác nhận HĐ — chưa kiểm điểm gọi); điều khoản gốc **Điều x, trang y** (chỉ có `quote`; thiếu `clause_ref`/`page`); "ai làm" có (`owner`) | Prompt không hỏi số điều/trang ⇒ đổi prompt + schema (strict ⇒ phải sửa `AiMilestoneSchema`, `extraction.rules`) |
| 44 | `ContractProgress` + `Timeline.tsx`, `MilestoneSchema` đủ trạng thái open/done, `done_at`, `fault` (`milestones.ts:81-105`) | 4 ô số (đã giao/đã thu/mốc kế/phạt phát sinh), nhãn "sắp tới / xong đúng hạn / xong trễ" (suy từ `done_at`↔`due_date`), người xác nhận (`done_by` có ở bảng nhưng không lên `MilestoneSchema`), bằng chứng | `done_by` đã có `0008:30` — chỉ cần đưa ra contract |
| 45 | Hỏi ngày thật + lỗi do ai khi trễ (`ConfirmBox.tsx:1-4,45-60`; `SettleRequestSchema` `ledger.ts:75-80`); lỗi đối tác ⇒ trừ điểm (`ledger.usecase.ts:81-83`, `obligation-impact.usecase.ts`) | Số lượng/số tiền thật cho **giao** đã có qua bảng "Giao lần này" (`delivery.ts:26-31`); **bằng chứng** (ý kiến + chữ ký/tệp) không có | Bằng chứng là hạ tầng dùng chung vùng duyệt (BR-23…26) — vùng C phải chờ hợp đồng (contract) bằng chứng từ vùng B/A |
| 46 | Giao thiếu: phần còn lại tự là "Còn được giao" (`DeliveryViewRow.remaining`, `delivery.ts:44`); `milestone_items` giữ `delivered` | **Tách mốc**: mốc tiền đóng ngay với số thật (`ledger.usecase.ts:91`), không sinh mốc còn lại; mốc giao đóng nhưng phần còn lại không có mốc mới có hạn | Hai kiểu "làm thiếu" khác bản chất (giao: theo dòng; tiền: số) |
| 47 | `remind` đếm `reminders` + ghi sổ (`ledger.usecase.ts:124-130`); vòng nhắc `reminders.mount.ts`; mốc quá hạn ghi `partner_events.overdue` (`overdue-sweep.ts`) | Nhắc **3 ngày trước hạn** cho mốc (vòng hiện nhắc theo `remind_at` của HĐ — chưa kiểm); email nhắc đối tác từ mốc (CR-126 có email báo đối tác nhưng chưa kiểm có gọi từ mốc); mốc đỏ ở "Việc của tôi" | Chưa kiểm email đối tác |
| 48 | Giao dịch = `doc_type='deal'` (`0056:1-7`); mốc giao dịch tính từ mốc của **chính** nó | **Gắn giao dịch với mốc của HĐ DONE** (không có cột); "tiến độ mốc tính từ giao dịch" | **Mâu thuẫn mô hình**: hai nơi ghi "đã giao": mốc của HĐ (`milestone_items.delivered`) và mốc của hàng `deal` (cũng `milestone_items`/`stock_moves`). Phải chọn một (§3.1) |
| 49 | `DealNewPage` có "Thuộc HĐ nguyên tắc" (`frame_root_id`) | Màn tạo từ Sản phẩm & Giá; ô "Thuộc hợp đồng nào" (bắt buộc khi đối tác có HĐ DONE chứa SP); gợi ý HĐ+mốc đang mở; "Không theo hợp đồng"+lý do; ẩn HĐ tạm khoá | API cần truy vấn "HĐ DONE còn hiệu lực của đối tác chứa SP X" — chưa có (chưa kiểm `product-links`) |
| 50 | `confirmDelivery` ghi kho + mốc (`delivery.usecase.ts:77-106`), công nợ suy từ mốc open | Ghi vào mốc của HĐ khi lưu giao dịch gắn HĐ; làm thiếu ⇒ BR-46 | Đường nóng kho/tiền, khoá HĐ→mốc theo thứ tự D7-15 (`milestones.repo.ts:1-3`) |
| 51 | Đường giao dịch → nghĩa vụ ↔ mốc đã là MỘT bảng (`obligations`) | — | Chính BR-51 thoả nếu chọn §3.1 (A). Lưu ý `contract_id`/`transaction_id` G1 còn tồn (`0056:128`) — nợ cần gỡ theo D6 |
| 52 | Nhật ký chung `contract_events` (ai, khi nào, loại) cho thêm/sửa/xoá/xác nhận mốc; `contract_edit_log` cho deal | Ý kiến + chữ ký/tệp; "dời hạn" có `postpone` nhưng không bằng chứng (`ledger.routes.ts:138`); miễn phạt; huỷ giao dịch (không còn — deal xoá bằng `DELETE /contracts/:id`, chỉ owner, đảo kho) | "Huỷ giao dịch có lý do" của G1 (`transactions.ts:93-95`) không còn đường tương đương |
| 53 | Đổi giá trị/bên/điều khoản đã đi qua K1 + phiên bản K2 (`0049_k2_contract_versions.sql`) | Chặn sửa `amount` mốc vượt phạm vi (BR-53 chỉ nói không sửa **giá trị HĐ**) | `PATCH /milestones/:id` đang sửa được `qty/amount/due_date` khi mốc `open` (`milestones.repo.ts:122-133`) ⇒ BR-52 cần bằng chứng cho đổi SL/số tiền/hạn |
| 54 | `contract_events` có `data` jsonb (id mốc, kind, due_date mới) nhưng **không lưu trước → sau** (`milestones.repo.ts:131`); `postpone` lưu `was`/`to` ở `partner_events` | Lịch sử đủ "trước → sau + bằng chứng" cho mốc | Nên chuẩn hoá `data:{before,after,evidence_id}` |
| 55 | Summary 5 mục (`extract.ts:103-109`); `penalties`/`clauses` | Thẻ "Điều cần lưu ý" theo 6 nhóm (phạt hai chiều, thanh toán, giao & nghiệm thu, bảo hành, gia hạn/chấm dứt, tranh chấp), mỗi ý **điều khoản + trang** (hiện chỉ chuỗi tự do); thẻ "Cần chú ý" (rủi ro AI) | Đổi `AiSummarySchema` từ `string[]` sang `{text, clause, page}[]` ⇒ **đổi contract + dữ liệu cũ** (bản trích cũ phải vẫn hợp lệ — `extraction-v2.test.ts` có test hồi quy) |
| 56 | Có chuỗi phạt trong summary; `fields.penalty` text | AI trích **số**: tỷ lệ, cơ sở, trần, chiều; hàm tính phạt ước tính theo ngày trễ; "Ghi vào công nợ" (sinh mốc/nghĩa vụ loại phạt) và "Miễn phạt" (bằng chứng); ô "phạt phát sinh" | Không có loại mốc `penalty` ⇒ thêm vào `obligations_kind_ck` (đã từng nới ở `0022:76-78`). **Tiền** ⇒ Sonnet high + Opus soát; không tự trừ tiền (đúng BR-56) |
| 70 | `overdue-sweep.ts` quét theo tập, ghi `partner_events.overdue` và `overdue_for` | Phát sự kiện "Mốc quá hạn N ngày" vào Hub (có `flow-events.repo.ts` bên community — chưa kiểm); lọc mốc của mình/đối tác, loại mốc; `overdue_for` chỉ ghi 1 lần ⇒ không có "N ngày" | Cần đếm ngày trễ theo mốc + chống phát trùng (idempotency) |
| 71 | `remind` + ghi sổ | Mẫu quy trình báo người phụ trách → chờ 3 ngày → trưởng phòng; email đối tác | Phụ thuộc vùng engine/flow (ngoài C) |
| 72 | — | Trạng thái giao dịch "Chờ duyệt"; sự kiện "Giao dịch được lưu" | Xem §0 & §3.5 |
| 73 | — | Nếu (giá trị > ngưỡng hoặc không theo HĐ) ⇒ Duyệt ⇒ ghi sổ/từ chối | "Ngưỡng 100 tr" ở bước Nếu cần giá trị giao dịch: `total_value` của deal (đã có `fields.total_value`) |
| 75 | `postpone` (hạn mới > hạn cũ, `ledger.usecase.ts:107-122`) là thay đổi **áp ngay** | Yêu cầu thay đổi thực hiện (loại: dời hạn, tách mốc, miễn phạt, tạm khoá, mở khoá) + bằng chứng, **chờ duyệt** | Hiện `postpone`/`PATCH milestone` áp ngay — phải bọc để đi qua yêu cầu khi vượt ngưỡng |
| 76 | — | "Chờ duyệt thay đổi" trên mốc: nhãn + khoá sửa mốc khi có yêu cầu mở | Hai yêu cầu cùng mốc đua nhau ⇒ một yêu cầu mở mỗi mốc |
| 70…73 (phần dữ liệu §12.2) | xem trên | | |

## 3. Đề xuất một nguồn sự thật (mức contract/bảng/endpoint)

### 3.1 Giao dịch gắn mốc = MỘT bản ghi (không thêm nguồn thứ ba)
**Lựa chọn khuyến nghị (A): "giao dịch thực hiện" là một dòng sổ thực hiện của chính mốc — chỉ MỘT bảng mới, thay vì hai nơi ghi.**
- Hiện tại hai nơi có thể ghi "đã giao/đã thu": mốc của HĐ (xác nhận) và mốc của hàng `deal`. Nếu thêm "giao dịch gắn mốc" bằng cách sinh thêm `deal` rồi đồng bộ về mốc ⇒ **vi phạm Luật GỐC 1**.
- (A) Thêm bảng `contracts.fulfillments` (id, tenant_id, obligation_id → mốc, contract_id, qty/amount thực, `occurred_on`, `by_user`, `source: milestone_confirm | product_sale | product_purchase`, `deal_id` NULL, `evidence_id`, `status: posted|pending_approval|rejected|voided`, `void_reason`). Mốc **không** giữ `done_at/status` làm nguồn riêng cho tiến độ: `delivered`/`collected` = tổng `fulfillments posted`; `status='done'` đặt khi Σ ≥ kế hoạch (hoặc bấm "đóng mốc"). `milestone_items.delivered` và `stock_moves.milestone_id` trở thành **hệ quả cùng tx** của một `fulfillment` giao.
- "Xác nhận mốc" (`POST /obligations/:id/settle`) và "Lưu từ Sản phẩm & Giá" **cùng gọi một use case** `recordFulfillment` (mở rộng `settleOne`, `ledger.usecase.ts:73`): xác nhận mốc = tạo 1 fulfillment đủ phần còn lại. Đường cũ `settle` giữ làm vỏ (tương thích e2e) nhưng gọi use case mới ⇒ không còn hai đường.
- Ít xáo trộn hơn (B): **không thêm bảng**, dùng chính `obligations`: "giao dịch gắn mốc" = hàng `obligations` con của mốc (cột mới `parent_obligation_id`, `kind` giữ nguyên) — mỗi lần giao/thu là một hàng con đã `done`; mốc cha `open` cho tới khi Σ con = kế hoạch. Ưu: không bảng mới, `GET /payments`, `partner_events`, `stock_moves.milestone_id` trỏ hàng con. Nhược: mốc "cha" vừa là kế hoạch vừa là tổng — phải tránh đếm đôi `receive_open` (`ledger-read.repo.ts:43`) và `ObligationImpact.debt` (`obligation-impact.ts:52`); `seq`/`due_date`/`overdue` của hàng con cần miễn. **Đề xuất (B) cho vùng tách mốc (§3.2)** vì tách mốc vốn đã là "sinh mốc mới" cùng bảng.
- **Khuyến nghị tổng hợp: dùng (B) cho cả tách mốc lẫn giao dịch từng phần** (một khái niệm = hàng `obligations`; "giao dịch" trên màn hình = hàng `obligations` đã làm xong, có `fulfilled_by_deal_id` tuỳ chọn trỏ hàng `deal` khi nguồn là Sản phẩm & Giá). Không dùng `deal` để ghi kho cho HĐ kinh tế: khi người dùng chọn "Thuộc hợp đồng X", **không tạo `deal`** mà ghi thẳng vào mốc của X; khi chọn "Không theo hợp đồng" mới tạo `deal` (đúng hiện tại, kèm lý do).
- Endpoint: `POST /pack/contracts/obligations/:id/fulfill` (body: `at, qty_items[] | amount, evidence`) — thay `settle` làm lõi; `settle` = fulfill phần còn lại. `GET /pack/contracts/open-milestones?party_key=&product_id=&deal=` cho ô "Thuộc hợp đồng nào" (BR-49).

### 3.2 Tách mốc (BR-46)
- Contract: `FulfillRequest.remainder: "keep" | { split: { due_date, title? } }`. `keep` = mốc **giữ mở** với phần còn lại (giao: tự nhiên nhờ `remaining`; tiền: mốc ghi `amount` còn lại). `split` = đóng mốc cũ, sinh mốc mới `seq+1` (`insert … seq = max+1`, như `milestones.repo.ts:106-120`), `amount/qty` còn lại, hạn mới, `source='manual'`, `split_from` = id mốc cũ (cột mới). Trong **một** CTE (Luật 4c).
- Ràng buộc: `sum(children) ≤ kế hoạch`; không tách khi mốc `done`.

### 3.3 Bằng chứng (ý kiến + chữ ký/tệp)
- Hiện **không có nơi lưu**. Đề xuất một bảng dùng chung toàn CR (vùng duyệt định nghĩa trước): `contracts.evidence (id, tenant_id, subject_type, subject_id, note, signature_file_id NULL, attachment_file_ids uuid[], by_user, at)` — chỉ thêm (REVOKE UPDATE/DELETE như `contract_edit_log` `0056:74`). Vùng C chỉ **tham chiếu** `evidence_id` trong: `fulfillments`/hàng mốc, `exec_hold`, `penalty_decision`, `milestone_change_request`. Ràng buộc "ý kiến bắt buộc + ≥ 1 trong chữ ký/tệp" kiểm ở zod + CHECK.
- Tệp/ảnh chữ ký cần kho tệp: chưa kiểm cơ chế lưu tệp ngoài `contracts.file_id` (upload HĐ). **Câu hỏi Q-C3**.

### 3.4 Phạt dạng số (BR-55/56)
- AI: thêm `penalty_terms: [{ party: "ours"|"partner", trigger: "late_delivery"|"late_payment"|"other", rate_pct, basis: "per_day_of_value"|"per_day_of_milestone"|"fixed", cap_pct|cap_amount|null, clause, page, quote }]` vào `ExtractionOutputSchema` (tuỳ chọn ⇒ bản cũ vẫn hợp lệ). Lưu ở bảng riêng `contracts.penalty_terms` (hoặc trong `fields` jsonb — **ưu tiên bảng** để tính theo tập), người phụ trách sửa được trước khi bắt đầu.
- Tính ước tính: hàm thuần `penaltyEstimate(term, milestone, today)` ở `domain/` (số nguyên đồng, làm tròn xuống, trần). Không lưu; hiển thị ở mốc trễ.
- Quyết định: `POST /obligations/:id/penalty` body `{ decision: "book"|"waive", amount, evidence }`. `book` ⇒ hàng `obligations` mới `kind='penalty'` (thêm vào CHECK `0022:76-78` — vẫn **cùng bảng nghĩa vụ**, nên "công nợ" thấy ngay; hướng theo bên vi phạm); `waive` ⇒ `penalty_decisions` hoặc `contract_events` + bằng chứng. Miễn phạt > ngưỡng đi §12.5.

### 3.5 Giao dịch "Chờ duyệt" (BR-72/73) — thiết kế lại theo mô hình hiện tại
- Không có nháp/ghi sổ ⇒ dùng **trạng thái 4 giá trị của CR-127** (BR-01) cho deal: giao dịch cần duyệt = `PROCESSING` (chờ duyệt), duyệt xong = `DONE` (có hiệu lực), từ chối = `REJECT`. Kho/công nợ chỉ đổi khi `settle`/`fulfill` chạy, mà `fulfill` chỉ cho phép khi deal/giao dịch `DONE`; `settled_now` phải **hoãn** sau duyệt (`deals.routes.ts:82` hiện chạy ngay ⇒ đổi thành "chạy sau khi DONE").
- **Rủi ro công nợ**: mốc `open` của giao dịch PROCESSING hiện vẫn tính vào `receive_open/pay_open` (`ledger-read.repo.ts:43`) ⇒ lọc theo trạng thái cha (cần JOIN `contracts` hoặc cột phản chiếu trên mốc — chọn cột cha-state-aware để giữ chỉ mục `obligations_open_idx`, `0008:56`, mà không phá đường nóng).
- Sự kiện "Giao dịch được lưu" phát ở use case tạo deal (`create-manual`, `transactions.mount.ts:31`), chưa kiểm cơ chế phát vào Hub.

### 3.6 Yêu cầu thay đổi thực hiện chờ duyệt (BR-75/76)
- Bảng `contracts.change_requests (id, tenant_id, contract_id, obligation_id, kind: postpone|split|waive_penalty|hold|release, payload jsonb, evidence_id, status: pending|approved|rejected|applied, requested_by, flow_run_id)`; partial unique `(obligation_id) WHERE status='pending'`.
- Áp thật qua **cùng use case** `fulfill/postpone/hold/waive` (không đường thứ hai): mẫu quy trình "Nếu vượt ngưỡng ⇒ Duyệt ⇒ áp; ngược lại áp ngay" ⇒ use case nhận cờ `viaApproval`. Mốc đọc `change_pending` để hiện "Chờ duyệt thay đổi" (join một chiều, partial index).
- Tạm khoá (BR-41) là `kind=hold|release` của chính bảng này khi vượt ngưỡng, ngoài ngưỡng áp ngay: cột trên HĐ `exec_hold_at, exec_hold_by, exec_hold_reason, exec_hold_evidence_id` (nullable) — **một** nguồn.

## 4. Bản đồ file

| Nhóm việc | File · hàm (điểm chạm) |
|---|---|
| Lõi `fulfill`/settle | `apps/hub-api/src/modules/packs/contracts/application/ledger.usecase.ts` (`settleOne` :73, `openObligation` :40, `obligationCommands` :103); `adapters/ledger-write.repo.ts` (`settle` :88-102 — CTE), `adapters/ledger.routes.ts` (:134 settle, :138 postpone); `application/delivery.usecase.ts` (`confirmDelivery` :77, `plannedMoves` :109); `adapters/delivery.repo.ts`; `domain/ledger.rules.ts`, `domain/milestones.rules.ts` |
| Contract zod | `packages/contracts/src/pack-contracts/{ledger.ts (SettleRequestSchema :75), milestones.ts (MilestoneSchema :81), delivery.ts, obligation-impact.ts, deals.ts, extract.ts (:103-119), fields.ts}`; thêm `fulfill.ts`, `penalty.ts`, `change-requests.ts`, `evidence.ts` |
| Mốc CRUD / tách | `adapters/milestones.repo.ts` (`insertQ` :106, `updateQ` :122, `written` :38), `application/milestones.usecase.ts`, `adapters/milestones.routes.ts` (:51-64), `domain/milestones.rules.ts`, `adapters/milestones.mapper.ts` |
| Giao dịch / deal | `transactions.mount.ts` (:23-47), `adapters/deals.routes.ts` (`settleNow` :57, POST :78), `adapters/deals.repo.ts`, `domain/deal.rules.ts` (`settleNowOrder`), `application/create-manual.usecase.ts` |
| Khoá thực hiện | `adapters/manage.routes.ts` (reopen :143 — gỡ theo BR-74), `application/reopen-contract.usecase.ts`; migration cột `exec_hold_*` |
| Phạt | `domain/extract-prompt.rules.ts` (:30-37), `domain/extraction.rules.ts`, `application/extraction.ports.ts`, `adapters/extraction.repo.ts`; hàm mới `domain/penalty.rules.ts` |
| Mốc quá hạn | `application/overdue-sweep.ts`, `adapters/overdue*.repo.ts` (chưa mở), `reminders.mount.ts`; phát sự kiện flow: `apps/hub-api/src/modules/packs/community/adapters/flow-events.repo.ts` (chưa kiểm) |
| Uy tín | `application/obligation-impact.usecase.ts`, `adapters/obligation-impact.repo.ts`, `domain/obligation-impact.rules.ts` |
| Migration | `packages/db/migrations-pack-contracts/` số kế tiếp sau `0090_partner_inbox_pending_idx.sql`; sửa `obligations_kind_ck` (mẫu `0022:76-78`); cột `parent_obligation_id`, `fulfilled_deal_id`, `exec_hold_*`; bảng `evidence`, `penalty_terms`, `change_requests`; `packs.secure_table` + RLS (mẫu `0026:23`, `0056:72-85`) |
| Web | `apps/workspace-web/src/features/contract-milestones/{components/ConfirmBox.tsx, Timeline.tsx, TimelineNode.tsx, DeliveryLines.tsx, ImpactPreview.tsx, api.ts, hooks/use-milestone-writes}`; `features/contract-review/components/{AiMilestonesPanel,DetailGrid}.tsx`; `features/contract-new/pages/DealNewPage.tsx`; `features/products/*` (màn mới "ghi giao dịch"); `features/ledger/api.ts`; `features/contract-lock/*` (LockBanner — chip tạm khoá) |
| Đường nóng có ngưỡng perf bị chạm | `GET /payments` (`ledger-read.repo.ts:43` — thêm lọc trạng thái cha; giữ `obligations_open_idx`, `paymentsText`); `overdue-sweep` (lô theo tập, SKIP LOCKED); `settleOne` (1 CTE/lệnh, thứ tự khoá HĐ→mốc, D7-15). Cần `*.perf.int.test.ts` hiện có chạy lại (không đo trong báo cáo này) |

## 5. Câu hỏi nghiệp vụ (mặc định) · ước lượng lát · rủi ro

### Câu hỏi
- **Q-C1 (chặn)**: "Giao dịch từ Sản phẩm & Giá" hiện **không tồn tại** — tạo giao dịch ở `/contracts/new?type=deal`. Làm màn mới trong trang Sản phẩm, hay thêm ô "Thuộc hợp đồng nào" vào `DealNewPage` + lối tắt từ Sản phẩm? *Mặc định*: thêm vào `DealNewPage` (bắt buộc khi đối tác có HĐ DONE chứa SP) + nút "Ghi bán/nhập" ở trang Sản phẩm mở trang đó điền sẵn SP.
- **Q-C2 (chặn)**: Khi chọn HĐ, có **tạo `deal` hay chỉ ghi thẳng vào mốc** (đề xuất §3.1)? *Mặc định*: ghi thẳng vào mốc, KHÔNG tạo `deal`; chỉ "Không theo hợp đồng" mới tạo `deal`.
- **Q-C3**: Lưu ảnh chữ ký tay + tệp bằng chứng ở đâu (kho tệp hiện chỉ có file HĐ)? *Mặc định*: dùng kho tệp HĐ hiện có, giới hạn 10 MB/tệp, ≤ 5 tệp; chữ ký = PNG ≤ 200 KB.
- **Q-C4**: BR-72 "nháp → Chờ duyệt → ghi sổ" nhưng giao dịch không còn nháp (CR-101). *Mặc định*: Chờ duyệt = PROCESSING của deal; ghi sổ = DONE.
- **Q-C5**: Mốc tiền thu thiếu: mặc định "giữ hạn cũ cho phần còn lại" = mốc giữ mở với số còn lại? *Mặc định*: có.
- **Q-C6**: Phạt "hai chiều": công nợ ghi về chiều nào (mình phải trả / thu đối tác)? *Mặc định*: theo bên vi phạm của mốc (`owner`): mốc `ours` trễ ⇒ mình phải trả; `partner` trễ ⇒ phải thu.
- **Q-C7**: Giao dịch `deal` cũ (không gắn HĐ) và các hàng G1 — giữ nguyên, chỉ thêm đường gắn mốc cho giao dịch **mới**? *Mặc định*: giữ nguyên, không backfill.

### Ước lượng lát (≤ ½ ngày/lát, Luật 0b; nối tiếp vì chung `ledger.usecase`/`obligations`)
| # | Lát | Model | Ghi chú |
|---|---|---|---|
| C1 | Bằng chứng (bảng + contract, tham chiếu) | Sonnet high + Opus soát RLS | phụ thuộc vùng duyệt |
| C2 | Cột/mốc: `parent_obligation_id`, `kind=penalty`, trạng thái suy diễn; `fulfill` lõi + int kho/tiền | **Opus medium** (khoá/đồng thời/kho) | đường nóng |
| C3 | Tách mốc + giao/thu thiếu (BR-46) | Sonnet high + Opus low soát | tiền/kho |
| C4 | Tạm khoá thực hiện (chặn trong tx) + chip + chặn ở Sản phẩm & Giá | Sonnet high + Opus low soát (quyền) | |
| C5 | Giao dịch gắn HĐ: `open-milestones`, ô "Thuộc hợp đồng nào", Không theo HĐ+lý do | Sonnet high + Opus soát | |
| C6 | AI trích số phạt + `penalty.rules` + thẻ phạt + ghi công nợ/miễn | Sonnet high + Opus soát (tiền) | đổi contract extract |
| C7 | Điều cần lưu ý (summary có điều khoản+trang) + 4 ô số + trạng thái mốc | Sonnet | UI một đợt |
| C8 | Giao dịch Chờ duyệt (§3.5) + chặn công nợ | Sonnet high + Opus low | phụ thuộc máy trạng thái 4 giá trị |
| C9 | Yêu cầu thay đổi thực hiện chờ duyệt + mốc "Chờ duyệt thay đổi" | Opus medium (trạng thái) + Sonnet UI | phụ thuộc engine |
| C10 | Mốc quá hạn: sự kiện flow + đếm N ngày + chống trùng | Opus (idempotency) | |
| C11 | e2e hành trình thật (Luật 0d.10): HĐ DONE → giao thiếu → tách → ghi từ Sản phẩm → phạt → miễn → tạm khoá | Sonnet, chạy MỘT lần cuối | |

### Rủi ro chính
1. **Hai nguồn "đã giao"** nếu làm "giao dịch gắn mốc" bằng `deal` + đồng bộ (vi phạm Luật GỐC 1) ⇒ phải chốt Q-C2 trước C2.
2. **Công nợ tính cả mốc của giao dịch Chờ duyệt / tạm khoá** nếu quên lọc (`ledger-read.repo.ts:43`).
3. Đổi `AiSummarySchema`/`AiMilestoneSchema` (strict) ⇒ bản trích cũ và `extraction-v2.test.ts` — cần giữ tương thích (trường tuỳ chọn).
4. `PATCH /milestones/:id` và `postpone` đang **áp ngay**, không bằng chứng — nếu không bọc, BR-52/75 bị lọt đường vòng.
5. Gỡ "Mở lại" (BR-74) và cột `transaction_id` G1 phải theo D6 (backfill + chuyển mọi chỗ đọc + gỡ); chưa liệt kê hết chỗ đọc.
6. Đường nóng: `settleOne` (một tx, một CTE) và `GET /payments` — thêm bảng/JOIN phải giữ số câu SQL cố định; chưa đo.

### Chưa xem
Frontend Timeline/Việc của tôi (chi tiết hiển thị), cơ chế phát sự kiện vào Hub (`flow-events.repo.ts`), email nhắc đối tác từ mốc, `product-links` (truy HĐ theo SP), `overdue.repo`, nơi gọi lập mốc khi xác nhận HĐ.
