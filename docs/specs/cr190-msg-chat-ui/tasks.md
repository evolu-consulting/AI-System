---
id: cr190-msg-chat-ui
lát: cr190-msg-chat-ui
cr: CR-190
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Khung chat phải của trang Tin nhắn toàn màn (BR-190-1, 7, 8): đầu khung có avatar + «Ảnh & tệp» (điện thoại chỉ icon); nhãn ngày dính khi cuộn; màn «chưa chọn» có hình SVG; người chưa từng nhắn có màn «Gửi lời chào đầu tiên» + 3 câu chào bấm là gửi. Ô nhập dính đáy, nút «↓ n tin mới», điện thoại danh sách ⇄ chat đã có từ trước, giữ nguyên.

## Làm
- [x] `FirstHello.tsx` (mới) + `lib/first-hello.ts` (`isFirstHello`, `HELLO_KEYS`, `dayBarText`); `ChatView` hiện FirstHello thay câu trống cũ, bấm câu chào ⇒ `box.send`.
- [x] `ChatPick.tsx` (mới): hình minh hoạ SVG + «Chọn một người để bắt đầu trò chuyện»; `MessagesPage` dùng thay `EmptyState` (giữ `data-testid="chat-pick"`).
- [x] `ChatParts.ChatHeader`: avatar (người tròn, đối tác vuông bo), nút «Ảnh & tệp» có chữ từ md trở lên.
- [x] `MessageList.DayBar`: nhãn ngày dính đầu khung (`position: sticky`).
- [x] i18n vi + en: `firstHello`, `pickPerson(Hint)`, `hello.g1..g3`.
- [x] Mở cuộc ⇒ `POST …/read` (đã có sẵn `useMarkRead`, chạy mỗi lần mở cuộc có tin) xoá cờ ở máy chủ.

## Không làm / Chạm
Không làm: danh sách trái (`ConversationPane/List/Row/ListSection`, lát `cr190-msg-list-ui`); xoá cờ `marked_unread` trong cache danh sách (thuộc lát danh sách, chưa có trường này ở web); nút «thông tin» riêng cho cuộc 1-1 (chưa có nội dung — cuộc nhóm đã có «n thành viên»).
Chạm: `packages/messages-web/src/components/{ChatView,ChatParts,MessageList,FirstHello,ChatPick}.tsx`, `lib/first-hello.ts`, `apps/workspace-web/src/features/messages/pages/MessagesPage.tsx`, i18n `contracts/messages.{vi,en}.json`.

## Test tối thiểu
unit `packages/messages-web/src/lib/first-hello.test.ts`; e2e `e2e/cr190/khung-chat.spec.ts` (viết, chưa chạy — điều phối chạy cuối đợt); `tsc` messages-web.

## Quyết định trong lúc làm
- «↓ n tin mới», ô soạn dính đáy, vạch chưa đọc, điện thoại danh sách → chat toàn màn + nút quay lại đã có từ CR-178/CR-187: giữ, chỉ thêm e2e.
- `j18-*`, `j20-*` không vỡ vì lát này (testid `chat-pick`, `chat-title`, `chat-attach`, tên nút «Ảnh & tệp», ô «Nhập tin nhắn» giữ nguyên) ⇒ không sửa; chỗ vỡ nếu có đến từ lát danh sách.
- Cuộc đối tác chỉ đọc / ô khoá ⇒ FirstHello không hiện câu chào bấm (tránh bấm mà không gửi được).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan-giao-dien.md
#### Yêu cầu: Khung chat trống và nhãn ngày
Chưa chọn cuộc thì giữa khung chat có hình minh hoạ và câu mời chọn người; mở người chưa từng nhắn thì thấy avatar to, tên, chức vụ, công ty và 3 câu chào gợi ý bấm là gửi; nhãn ngày dính đầu khung khi cuộn.
- Kịch bản: khi cuộc chưa có tin và đã tải xong thì hiện màn «Gửi lời chào đầu tiên», có tin đang gửi thì không [test: packages/messages-web/src/lib/first-hello.test.ts » chỉ hiện khi đã tải xong và chưa có tin nào, kể cả tin đang gửi]
- Kịch bản: khi cuộn thì nhãn ngày là Hôm nay / Hôm qua / ngày đầy đủ [test: packages/messages-web/src/lib/first-hello.test.ts » hôm nay / hôm qua / ngày đầy đủ]
- Kịch bản: khi đang đọc tin cũ mà có tin mới thì nút «↓ n tin mới» đếm đúng tin người khác [test: packages/messages-web/src/lib/first-hello.test.ts » đếm tin người khác sau mốc đã thấy và bỏ tin mình và tin thu hồi]
- Kịch bản: khi người nhận (khác người tạo) mở cuộc mới thì thấy câu chào, bấm là gửi, ô nhập dính đáy, trang không cuộn [test: e2e/cr190/khung-chat.spec.ts » chưa chọn cuộc có hình và câu mời, mở người chưa nhắn thì câu chào bấm là gửi, ô nhập dính đáy và trang không cuộn]
- Kịch bản: khi người nhận đang đọc tin cũ và người gửi thêm tin thì thấy «↓ 1 tin mới» [test: e2e/cr190/khung-chat.spec.ts » B đang đọc tin cũ, A gửi thêm ⇒ B thấy «↓ 1 tin mới», bấm thì về cuối]

## Việc còn lại
- e2e chưa chạy (điều phối chạy cuối đợt). Xoá cờ `marked_unread` trong cache danh sách khi mở cuộc: lát `cr190-msg-list-ui`.
