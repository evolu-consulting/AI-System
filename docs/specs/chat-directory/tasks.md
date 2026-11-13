# chat-directory — CR-132b · «Tin nhắn» liệt kê Nhóm + Thành viên

## Delta (docs/current/pack-contracts/tin-nhan.md §5)
#### Yêu cầu: Cột trái liệt kê «Nhóm» và «Thành viên»
Cột trái có hai mục: «Nhóm» (nhóm mình là thành viên) và «Thành viên» (đồng nghiệp còn dùng được cùng công ty; ô tìm lọc cả hai). Bấm thành viên chưa có hội thoại ⇒ mở/tạo 1-1 và vào khung chat; đã có 1-1 thì dòng đó mang xem trước/chưa đọc (1-1 không hiện lần hai). Danh bạ do `GET /pack/contracts/messages/people` (guard read, đối tác 403, chỉ công ty mình, trừ mình và người bị khoá); «Nhắn tin mới»/«Thêm người» dùng chung nguồn này (thay `/assignees`, vốn cần quyền write).
- Kịch bản: nhóm riêng, thành viên có 1-1 lên trước, lọc không dấu [test: apps/workspace-web/src/features/messages/lib/directory.test.ts » buildDirectory]
- Kịch bản: danh bạ đúng công ty, không lộ công ty khác/đối tác [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » danh bạ «Thành viên»]
- Kịch bản: bấm thành viên ⇒ nhắn ngay [test: e2e/cr127/j20-tin-nhan-danh-ba.spec.ts » Bấm thành viên]

## Việc
- [x] internalDirectory + route /messages/people + int
- [x] directory.ts + ConversationList/Row/Pane + i18n
- [x] e2e j20 (chưa chạy)

## Quyết định trong lúc làm
- 1-1 là dòng của người đó (G2), không có mục «Hội thoại» riêng.
- Lỗi tải danh bạ ⇒ cả danh sách hiện lỗi + «Thử lại» (một trạng thái).
