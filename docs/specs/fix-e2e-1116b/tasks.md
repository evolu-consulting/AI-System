---
id: fix-e2e-1116b
lát: fix-e2e-1116b
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa ca e2e đỏ sau CR-179: avatar sidebar (test), cr150 «B phản hồi ⇒ A thấy» (CODE: A không tự làm mới vòng gửi đối tác), khung-tep-co-dinh (test) + thêm ca «A gửi ảnh, B thấy ảnh hiện ra».

## Làm
- [x] cr147-feed.cm.ts «avatar header và sidebar»: sidebar là `nav[data-testid=shell-sidebar]` (không có `aside`/`sidebar`) ⇒ đổi selector.
- [x] cr150 (Trả lại ở lượt f1ca7b8d6, Từ chối ở lượt a033475c0 — cùng nguyên nhân): LỖI CODE. `useRounds` (partner-inbox) không có làm mới/đẩy; B phản hồi ⇒ hộp thư «replied» nhưng tin báo về A do job nền phát vài giây sau, vòng của A còn «open» khi A tải trang, rồi đứng yên (trace: B Trả lại 200 lúc 09:38:07.4; A tải `partner/sends` lúc 09:38:09.4 vẫn open, không tải lại). Người dùng thật cũng gặp. Sửa: còn vòng «open» ⇒ `refetchInterval` 5s (`roundsRefetchMs`), đóng hết thì dừng. Test cr150 giữ nguyên cách chờ 90s KHÔNG tải lại để bắt lại lỗi này.
- [x] e2e/cr179/tin-nhan-anh.spec.ts (mới, gắn vào testMatch của việc cr127): A gửi PNG, B (người nhận) thấy khung ảnh ≥ 100×75, ảnh đã tải.

## Không làm / Chạm
Chạm: apps/workspace-web/src/features/partner-inbox (hooks/use-partner-queries.ts, lib/partner-view.ts + test) · e2e/community-web/cr147-feed.cm.ts · e2e/journey-approval/cr150-two-companies.spec.ts · e2e/cr127/playwright.cr127.config.ts · e2e/cr179/tin-nhan-anh.spec.ts. 

## Test tối thiểu
evotest: `run-tests.ps1 -Step e2e -Filter "community-web,cr127" -Wave -Dirty`.

## Quyết định trong lúc làm
- Không chạy lặp (`--repeat-each`): run-tests.ps1 không có cờ chuyển đối số; ba ca cr150 (ok/tl/tc) là 3 quan sát độc lập cùng cơ chế.
- Gắn `e2e/cr179/*.spec.ts` vào việc cr127 làm lộ ca `khung-tep-co-dinh` (chưa từng chạy): nó tìm tệp bằng ô tìm người (không có «hit» theo tên tệp) ⇒ đổi sang mở dòng hội thoại của A; rồi lộ tiếp: đo hộp «đang tải» lúc hộp thoại còn hoạt ảnh mở (tỉ lệ 0.95) ⇒ lệch với lúc xong ⇒ đo lại khi đã ổn định (test sai, không phải lỗi khung).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-giao-dien.md
#### Yêu cầu: Bên gửi tự thấy phản hồi của bên nhận ở khối «Gửi đối tác»
Khi còn vòng gửi đang chờ, khối tự làm mới (5 giây/lần) để bên gửi thấy xác nhận / trả lại / từ chối kèm lý do mà không phải tải lại trang; hết vòng chờ thì dừng làm mới.
- Kịch bản: khi còn vòng «open» thì làm mới theo chu kỳ, đóng hết hoặc chưa có vòng thì dừng [test: apps/workspace-web/src/features/partner-inbox/lib/partner-view.test.ts » roundsRefetchMs]
- Kịch bản: khi B Trả lại có lý do thì A (nhân viên) thấy trả lại + lý do mà không tải lại [test: e2e/journey-approval/cr150-two-companies.spec.ts » B Trả lại có lý do ⇒ A (nhân viên) thấy trả lại + lý do]

## Việc còn lại

