---
id: cr125-g7-partner-count
lát: cr125-g7-partner-count
cr: CR-125
làn: đầy đủ (đường nóng /pack/nav)
migration: có (0090 pack contracts)
phụ thuộc:
---
## Plan (ngắn)
Mục menu `contracts.partner` (consistency-audit G7, dòng #34) hiện luôn `count: 0`. Đếm `contracts.partner_inbox` trạng thái `pending` của công ty người xem,
MỘT câu `count(*)` theo tập, qua cổng đếm trong kit nav (`PackNavCountPort` + `countedCap`) để gói khác dùng lại.

## Làm
- kit: `PackNavCountPort`, `countedCap` (cổng vắng/lỗi ⇒ 0, mục vẫn hiện) — `kit/application/pack-nav.ports.ts`, xuất qua `kit/public.ts`.
- `partnerInboxRepo.pendingCount()` (1 câu) + `partnerCountPort(db)` trong `contracts/nav.mount.ts`; `mountContractsNav(view, runs, db)` nối từ `packs.mount.ts`.
- Mục hộp thư và mục duyệt chạy song song (`Promise.all`) ⇒ không cộng thêm độ trễ nối tiếp.
- Migration `0090_partner_inbox_pending_idx` (pack contracts): index một phần `(tenant_id) WHERE status='pending'` ⇒ đếm index-only, không quét lịch sử đã trả lời.
  Số 0090: g8 (cr125-g8-flow-flag) chỉ lấy hub 0126, không đụng pack contracts.

## Không làm / Chạm
Không ops (G8), notify/link ký, toast, locale nhóm khác, DLC.

## Test tối thiểu
unit: `contracts/nav.mount.test.ts`, `adapters/partner-inbox.repo.test.ts` · int: `contracts/nav.mount.int.test.ts`, `adapters/partner-inbox.repo.int.test.ts` ·
perf int: `contracts/nav.mount.perf.int.test.ts` (p95 `/pack/nav` ≤ 50 ms, trước → sau cùng DB).

## Quyết định trong lúc làm
- Đếm lỗi ⇒ 0 (ẩn badge) thay vì làm mất cả gói nav — mục vẫn hiện, menu không hỏng.
- Số đếm theo công ty (hộp thư là của công ty, không theo người); không phân quyền theo người.
- Chưa có test perf `/pack/nav` từ trước ⇒ tạo mới, đặt ngưỡng p95 ≤ 50 ms (mẫu Luật 4c).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-giao-dien.md
#### Yêu cầu: Số chờ trên mục hộp thư đối tác của menu
Mục `contracts.partner` trên menu hiện số hợp đồng đối tác gửi tới đang chờ công ty nhận (trạng thái pending của công ty người xem), thay cho số 0 cố định; đếm bằng một câu theo tập, không phụ thuộc số thư.
- Kịch bản: khi công ty có 3 thư chờ và 2 thư đã trả lời thì menu hiện số 3, công ty khác không lẫn [test: apps/hub-api/src/modules/packs/contracts/nav.mount.int.test.ts » mỗi công ty thấy đúng số của mình]
- Kịch bản: khi một thư được trả lời thì số giảm theo trạng thái thật [test: apps/hub-api/src/modules/packs/contracts/nav.mount.int.test.ts » qua GET /pack/nav: trả lời một thư ⇒ số giảm theo trạng thái thật]
- Kịch bản: khi công ty chưa bật tính năng nhận hợp đồng đối tác thì không có mục và không đếm [test: apps/hub-api/src/modules/packs/contracts/nav.mount.test.ts » tính năng tắt ⇒ không mục và không gọi cổng đếm]
- Kịch bản: khi có 10.000 thư thì `/pack/nav` vẫn p95 ≤ 50 ms [test: apps/hub-api/src/modules/packs/contracts/nav.mount.perf.int.test.ts » p95 không vượt ngưỡng và số đúng (trước → sau)]

## Việc còn lại
Không (chưa chạy slice:merge theo yêu cầu).
