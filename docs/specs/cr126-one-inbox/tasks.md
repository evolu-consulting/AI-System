---
id: cr126-one-inbox
lát: cr126-one-inbox
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Một hộp việc: «Chờ tôi duyệt» → «Việc của tôi» (/contracts/approvals) liệt kê MỌI việc mở tôi làm được: duyệt HĐ + ký (`/my-work`) và bước yêu cầu/quy trình/phiếu (`/me/review-tasks`, gồm run con). «Tạo yêu cầu» → «Yêu cầu» (chỉ danh sách tạo). Hook chung `useInbox` cho trang + số đỏ menu/thanh dưới. Không đổi backend.

## Làm
- `overview/hooks/use-inbox.ts`, `ApprovalsInboxPage`, `RequestsPage` (bỏ mục «Việc chờ tôi»), `nav.ts` (bỏ `cap`, thêm `inbox`), Sidebar/BottomNav, i18n vi+en, e2e.

## Không làm / Chạm
- «Yêu cầu của tôi» (đã gửi): chưa có endpoint liệt kê rẻ ⇒ để sau.

## Test tối thiểu
unit `waiting.test.ts`, `use-flow-caps.test.ts`; e2e viết lại, không chạy (baseline json menu cần chụp lại ở lượt e2e cuối).

## Quyết định trong lúc làm
- Task trùng giữa `/my-work.approvals` và `/me/review-tasks` loại theo id.
- Mục «Việc của tôi» luôn hiện; thanh dưới điện thoại giữ mục «Việc của tôi» riêng ⇒ mục menu là `more`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Một hộp «Việc của tôi»
Mục «Việc của tôi» (trước là «Chờ tôi duyệt») luôn hiện cho mọi người; liệt kê mọi việc mở tôi làm được: duyệt/ký HĐ, bước yêu cầu và quy trình (kể cả run con), phiếu cần điền. Mỗi dòng: tên quy trình/HĐ, tên bước, mở. Dòng yêu cầu mở `/contracts/requests/<runId>`. Số đỏ = số dòng. Mục «Tạo yêu cầu» đổi thành «Yêu cầu» và chỉ còn danh sách loại yêu cầu bắt đầu được.
- Kịch bản: khi task đã có ở danh sách duyệt HĐ thì không đếm hai lần [test: apps/workspace-web/src/features/requests/lib/waiting.test.ts » CR-126 · task đã có ở danh sách duyệt HĐ (skip) không đếm hai lần trong hộp «Việc của tôi»]
- Kịch bản: khi người không có vai duyệt thì vẫn thấy «Việc của tôi» sau Hợp đồng và Yêu cầu [test: apps/workspace-web/src/shell/use-flow-caps.test.ts » CR-126 · «Việc của tôi» luôn hiện (không cần vai duyệt), đứng sau Hợp đồng + Yêu cầu]

## Việc còn lại
- Chụp lại baseline menu (e2e/contracts-web/baseline/linux/shell-*.json) ở lượt e2e cuối; e2e chưa chạy.
