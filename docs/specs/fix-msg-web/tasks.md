---
id: fix-msg-web
lát: fix-msg-web (sửa lỗi review cuối đợt CR-132 · vùng web tin nhắn + quy ước đếm chưa đọc)
cr: CR-132
làn: nhanh
migration: không
phụ thuộc: cr132-w2, cr132-w3, cr132-m3
---
## Plan (ngắn)
| # | Mục review | Sửa |
|---|---|---|
| 2 | `me-stream` dừng do 4xx rồi mở lại không báo nối lại | cờ `needResync` đặt khi dừng do lỗi; lần mở kế (kể cả do người nghe mới) gọi `onReconnected` của mọi người nghe |
| 3 | `msg.deleted` không giảm chưa đọc trong danh sách | hội thoại có chưa đọc > 0 ⇒ tải lại danh sách (gộp), xem trước vẫn cập nhật ngay |
| 4 | server `limit 99` ↔ client «99+» | MỘT quy ước: server đếm `limit 100`, dây 0..100 (`MSG_UNREAD_CONV_CAP`), client hiện số đúng tới 99 và «99+» khi > 99 |
| 6 | `viewing` toàn cục bị dọn nhầm | `lib/viewing.ts`: `leave(id)` chỉ xoá khi vẫn là `id` |
| 7 | xem trước hai bản | `messagePreview` ở `packages/contracts` (gộp dòng, cắt theo ký tự Unicode) dùng chung `messages.view.ts` và client |
| 9 | tải lại danh sách cho mỗi tin | tên người gửi lấy từ dữ liệu có sẵn (1-1 ⇒ người kia, chi tiết thành viên, tin cuối); chỉ khi thiếu mới tải lại, GỘP 300 ms một lần |

## Quyết định trong lúc làm
- Mục 4 đổi contract: `ConversationSummary.unread` 0..99 ⇒ 0..100 (thêm `MSG_UNREAD_CONV_CAP`); spec CR-132 §4 sửa theo. Client cũ nhận 100 vẫn đúng (kẹp «99+»).
- Mục 3: client không biết mốc đọc nên không tự trừ chính xác; tải lại danh sách gộp là cách đúng nhất, một câu SQL.
- Gộp tải lại dùng bộ hẹn giờ 300 ms (không phải chờ trạng thái; chỉ giãn các lần tải lại liên tiếp).

## Test
unit: `platform/stream/me-stream.test.ts` (mục 2), `messages/lib/messages-fix.test.ts` (mục 3, 4, 6, 7, 9), `messages-lib.test.ts` (nhãn 99+/trần 100) · hub: `messages.rules.test.ts`, `messages.view.test.ts` (trần 100), `messages.perf.int.test.ts` (kỳ vọng 100, cần DB — không chạy). Đã chạy: web 121 xanh, contracts `pack-contracts` 57 xanh, hub domain+application 18 xanh; tsc workspace-web/contracts sạch; biome.

## Việc còn lại
Int `messages.perf.int.test.ts` chạy ở lượt int cuối đợt (cần DB).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
<!-- ADDED file riêng: tin-nhan-ui.md của các lát trước chưa gộp vào docs/current; gộp cuối đợt. -->
### ADDED pack-contracts/tin-nhan-sua-loi.md
#### Yêu cầu: Màn «Tin nhắn» toàn màn và mục menu có số chưa đọc (nguồn: CR-132)
Số chưa đọc mỗi hội thoại hiện đúng số tới 99 và «99+» khi nhiều hơn (server đếm tối đa 100); khi một tin chưa đọc bị thu hồi thì số chưa đọc của hội thoại được cập nhật; dựng xem trước một dòng, tối đa 120 ký tự Unicode, giống nhau ở server và khi nhận tin mới.
- Kịch bản: khi hội thoại có từ 100 tin chưa đọc thì nhãn là «99+», dưới 100 hiện đúng số, tin mới không vượt trần [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » thu hồi tin chưa đọc]
- Kịch bản: khi cắt xem trước thì không cắt đôi ký tự emoji và gộp xuống dòng [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » xem trước dùng chung]
- Kịch bản: khi mở hội thoại khác trước khi hội thoại cũ dọn thì tin tới hội thoại mới vẫn không cộng chưa đọc [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » đang xem theo id]
- Kịch bản: khi tên người gửi đã có trong danh sách hoặc thành viên thì không phải tải lại danh sách [test: apps/workspace-web/src/features/messages/lib/messages-fix.test.ts » tên người gửi từ dữ liệu sẵn có]
### ADDED shell/luong-thoi-gian-thuc.md
#### Yêu cầu: Một kết nối /me/stream mỗi tab tự nối lại và báo để tải lại phần đã lỡ (nguồn: CR-132)
Khi kết nối dừng do lỗi 4xx rồi được mở lại bởi người nghe mới, mọi người nghe cũ được báo «đã nối lại» để tải lại dữ liệu đã lỡ.
- Kịch bản: khi dừng do 403 rồi người nghe mới mở lại thì người nghe cũ nhận một lần báo nối lại [test: apps/workspace-web/src/platform/stream/me-stream.test.ts » dừng do 4xx rồi người nghe mới mở lại]
