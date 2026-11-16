---
id: fix-e2e-1116b
lát: fix-e2e-1116b
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 2 ca e2e đỏ sau CR-179 (lỗi ở test, không ở code) + thêm ca «A gửi ảnh, B thấy ảnh hiện ra».

## Làm
- [x] cr147-feed.cm.ts «avatar header và sidebar»: sidebar là `nav[data-testid=shell-sidebar]` (không có `aside`/`sidebar`) ⇒ đổi selector.
- [x] cr150-two-companies.spec.ts: A chờ vòng đối tác bằng tải lại tới khi đủ điều kiện (`expectRound`). Trace: B Trả lại 200 lúc 09:38:07.4; A tải `partner/sends` lúc 09:38:09.4 ⇒ vòng còn `open` (mailbox đã `replied`, tin báo về A do job nền `mailbox-mover` phát sau) và trang A không tự làm mới. Không đổi code CR-179 nào chạm luồng này.
- [x] e2e/cr179/tin-nhan-anh.spec.ts (mới, gắn vào testMatch của việc cr127): A gửi PNG, B (người nhận) thấy khung ảnh ≥ 100×75, ảnh đã tải.

## Không làm / Chạm
Chạm: e2e/community-web/cr147-feed.cm.ts · e2e/journey-approval/cr150-two-companies.spec.ts · e2e/cr127/playwright.cr127.config.ts · e2e/cr179/tin-nhan-anh.spec.ts. Không đổi code sản phẩm.

## Test tối thiểu
evotest: `run-tests.ps1 -Step e2e -Filter "community-web,cr127" -Wave -Dirty`.

## Quyết định trong lúc làm
- Gắn `e2e/cr179/*.spec.ts` vào việc cr127 làm lộ ca `khung-tep-co-dinh` (chưa từng chạy): nó tìm tệp bằng ô tìm người (không có «hit» theo tên tệp) ⇒ đổi sang mở dòng hội thoại của A. Sau tải lại trang chi tiết có thể đã mở sẵn ⇒ `expectRound` chỉ bấm dòng khi nó hiện.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa/thêm e2e; sai ở selector và ở chờ đúng điều kiện, code sản phẩm giữ nguyên)

## Việc còn lại
