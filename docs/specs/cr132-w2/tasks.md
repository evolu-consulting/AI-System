---
id: cr132-w2
lát: cr132-w2 (W2 của CR-132 · màn «Tin nhắn» toàn màn + mục menu, workspace-web)
cr: CR-132
làn: nhanh
migration: không
phụ thuộc: cr132-m3 (API), cr132-w1 (bộ phát /me/stream chung)
---
## Plan (ngắn)
Feature `apps/workspace-web/src/features/messages/` (spec `docs/specs/CR-132/spec.md` §5, §7, §8): api → hooks react-query → luật thuần (`lib/`) → component. Route `/contracts/messages` (`?c=<id>`), mục menu «Tin nhắn» sau «Yêu cầu» kèm số chưa đọc.
Realtime: `hooks/msg-realtime.ts` (nạp lazy vì kéo zod; MỘT bộ nghe cho cả tab, đếm số bên dùng) áp `msg.new|read|deleted|conversation` vào cache bằng luật thuần; nối lại ⇒ tải lại mọi query `["messages"]`.

## Component dùng lại cho W3 (khoang hẹp)
| Component | Việc | Ghi chú |
|---|---|---|
| `ConversationPane` | danh sách ĐÃ nối dữ liệu + hộp «Nhắn tin mới» | props `myId`, `activeId`, `onSelect` |
| `ConversationList` | danh sách thuần trình bày (lọc, chưa đọc in đậm + số) | không gọi mạng |
| `ChatView` | khung chat một hội thoại | props `conversationId`, `myId`, `onBack` (hiện nút ‹), `compact`, `backClass`; **phải `key={conversationId}`** (hàng chờ gửi reset theo key) |
| `useUnreadTotal()` (`hooks/use-unread.ts`) | tổng chưa đọc (chấm đỏ nút khoang/tab) — một query, realtime cập nhật | |
| `NewConversationDialog`, `GroupMembersSheet`, `MessageList`, `MessageComposer`, `PeoplePicker` | phần con | |

## Nhãn cho e2e
`button "Nhắn tin mới"`, `searchbox "Tìm người hoặc nhóm"`/`"Tìm đồng nghiệp"`, `button "Nhắn tin"` (1-1) / `"Tạo nhóm"`, `textbox "Tên nhóm"`, `textbox "Nhập tin nhắn"`, `button "Gửi"`, `button "Thu hồi"` (icon, aria-label), `button "Về danh sách"`, `button "n thành viên"`, `button "Rời nhóm" | "Thêm người" | "Bỏ khỏi nhóm" | "Lưu tên"`; testid `nav-contracts-messages`, `nav-badge`, `conv-row` (`data-unread`), `conv-unread`, `msg-row`, `msg-seen`, `chat-gone`, `composer-locked`.

## Quyết định trong lúc làm
- Route theo spec/CR-119: `/contracts/messages` (brief ghi `/messages`; mọi route SHT nằm dưới `/contracts`). Hội thoại mở qua `?c=<id>`.
- W1 chỉ làm bộ phát `/me/stream`; `api.ts`/hooks/kho chưa đọc chưa có ⇒ làm ở lát này. Kho chưa đọc = query `GET /messages/unread` (`staleTime` 60 s) + cộng/trừ theo sự kiện; đọc/xoá/đổi thành viên ⇒ lấy lại (đúng hơn tự trừ).
- Chọn người nội bộ dùng `GET /pack/contracts/assignees` (thành viên còn dùng, có quyền xem gói; tra MỘT lần, lọc ở máy khách). Giới hạn 500 người của endpoint đó chấp nhận ở v1.
- Nhãn menu `contracts.nav.messages` đặt trong `partner.*.json` (phần đã gộp SÂU vào nhánh `nav`; thêm `nav` ở file khác sẽ ghi đè cả nhánh); phần còn lại ở `messages.*.json` chèn trước `esign-anchor` trong `contracts-locales.ts`.
- Nút đính kèm CHƯA hiện (chưa có API tải tệp — M5); tin có tệp hiện tên tệp (chưa tải xuống được).
- Mở hội thoại / tin tới khi đang xem và tab hiển thị ⇒ `POST …/read` tới seq cuối; đang xem ⇒ tin tới không cộng chưa đọc.
- Thu hồi / rời nhóm / bớt người hỏi lại bằng `confirmDialog`; lỗi API ⇒ toast câu i18n theo mã `MSG_ERRORS` (nói cách khắc phục).
- `BottomNav` (điện thoại): mục «Tin nhắn» ở menu trái/«Thêm» (`mobile: "more"`), chưa có số đỏ ở đó (việc W3/UI sau nếu cần).

## Test
unit: `features/messages/lib/messages-lib.test.ts` (sắp xếp/in đậm/lọc, áp sự kiện realtime vào cache, gộp trang tin, «Đã xem», quyền hiện nút theo vai, chọn người) · `shell/nav.test.ts` + `use-flow-caps.test.ts` cập nhật mục menu · e2e hành trình viết sẵn `e2e/cr127/j18-tin-nhan.spec.ts` (KHÔNG chạy trong lát). Đã chạy: `bun test src` (workspace-web), `tsc --noEmit`, `check:bundle` (js 145.0 KB, chunk lớn nhất 55.7 KB), `i18n:check`, biome.

## Việc còn lại
W3 (tab trong khoang trợ lý + chấm đỏ nút khoang); M5 (đính kèm: nút + tải lên/xuống); M4 phát sự kiện thật (đến lúc đó realtime mới sống — trước đó UI refetch khi mở/gửi, stale 30–60 s); chạy e2e + soát UI cuối đợt. Lỗi có sẵn ngoài lát: `attach.test.ts` (community), `shell-ui.test.tsx` thiếu `./NotificationBell`, `placeholders`/`settings-paths` của `@ai/i18n`.

## Delta (so với docs/current)
<!-- ADDED file riêng `tin-nhan-ui.md`: `tin-nhan*.md` của cr132-m1/m3 chưa gộp vào docs/current; gộp cuối đợt nhập vào một file. -->
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)
### ADDED pack-contracts/tin-nhan-ui.md
#### Yêu cầu: Màn «Tin nhắn» toàn màn và mục menu có số chưa đọc (nguồn: CR-132)
Nhân viên mở «Tin nhắn» từ menu (có số đỏ tổng chưa đọc) để xem danh sách hội thoại — hội thoại có tin chưa đọc in đậm, kèm số, và đưa lên đầu khi có tin mới; tìm theo tên người hoặc nhóm không phân biệt dấu. Danh sách và khung chat nói rõ khi đang tải, lỗi (kèm «Thử lại») hoặc rỗng.
- Kịch bản: khi có tin mới từ người khác thì hội thoại lên đầu, tăng số chưa đọc (kẹp 99) và đổi xem trước; tin của mình hoặc đang mở xem thì không tăng [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » msg.new của người khác]
- Kịch bản: khi lọc theo tên thì khớp không phân biệt hoa thường và dấu [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » lọc theo tên]
- Kịch bản: khi mở menu thì «Tin nhắn» đứng sau «Yêu cầu» [test: apps/workspace-web/src/shell/nav.test.ts » đủ 7 + 2 mục]
- Kịch bản: khi A nhắn B thì B thấy số chưa đọc ở menu, mở hội thoại thì số hết và A thấy «Đã xem» [test: e2e/cr127/j18-tin-nhan.spec.ts » A nhắn B]
#### Yêu cầu: Tạo hội thoại 1-1 hoặc nhóm từ «Nhắn tin mới» (nguồn: CR-132)
Chọn 1 người ⇒ nhắn riêng; chọn từ 2 người ⇒ hiện «Tên nhóm» (bắt buộc) và «Tạo nhóm»; nhóm tối đa 50 người. Lỗi API hiện câu theo mã, nói cách khắc phục.
- Kịch bản: khi chọn 0/1/2+ người thì chế độ là chưa chọn/nhắn riêng/nhóm, vượt 49 người thì báo nhóm đầy [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » chọn người]
#### Yêu cầu: Khung chat — tin theo ngày, gửi, thu hồi, «Đã xem», quyền theo vai (nguồn: CR-132)
Tin hiện theo ngày (Hôm nay/Hôm qua/ngày), tin cũ tải thêm theo trang; tin đang gửi hiện mờ, gửi lỗi bấm để gửi lại; chỉ người gửi thu hồi tin của mình; chỉ chủ nhóm đổi tên, thêm, bớt người (người khác thấy lý do), mọi thành viên rời nhóm; 1-1 với người đã khoá thì khoá ô gửi kèm lý do; bị bỏ khỏi nhóm thì báo «Bạn không còn trong cuộc trò chuyện này.».
- Kịch bản: khi gộp các trang tin thì tăng dần theo seq, không trùng, tin mới tới sau khi gửi xong không nhân đôi [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » msg.new thêm vào trang mới nhất]
- Kịch bản: khi thu hồi thì tin rỗng và đánh dấu đã thu hồi [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » thu hồi ⇒ rỗng]
- Kịch bản: khi người khác đọc tới tin cuối của mình thì hiện «Đã xem» [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » «Đã xem»]
- Kịch bản: khi không phải chủ nhóm thì không có nút đổi tên/thêm/bớt; 1-1 người kia khoá thì ô gửi bị khoá [test: apps/workspace-web/src/features/messages/lib/messages-lib.test.ts » quyền hiện nút]
