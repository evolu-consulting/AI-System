# cr178-api — lát API của CR-178 (Tin nhắn: lọc chưa đọc · ảnh & tệp · tìm tin)

Nguồn: `docs/CHANGE-REQUESTS.md` CR-178 mục (4)(5)(6); hành vi hiện hành `docs/current/pack-contracts/tin-nhan.md`; tin đối tác `docs/specs/CR-169/spec.md` §3–4.
Web/UI do lát khác làm (sau U4 của CR-177). Migration CHỈ THÊM (hàm mới, chỉ mục): hub 0153 (+0154 grants), pack-contracts 0120.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Thêm vào `docs/current/pack-contracts/tin-nhan.md` (mục «API đọc — CR-178»):

#### Yêu cầu: Lọc chưa đọc ở máy chủ (M5)
`GET /messages/conversations?unread=true` chỉ trả cuộc có tin chưa đọc của người gọi (cùng luật đếm với badge: sau mốc đọc, không do mình gửi, chưa thu hồi), trộn nội bộ + `partner`, mới nhất trước, keyset `next_cursor`; trang luôn đầy (lọc trước LIMIT). `unread=false`/vắng = tất cả; giá trị khác ⇒ 400.
- Kịch bản: người được giao (không phải người tạo) chỉ thấy cuộc còn chưa đọc; tin của mình + tin đã thu hồi không tính; người ngoài cuộc không thấy [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » người được giao]
- Kịch bản: đọc xong thì rời danh sách; `unread=abc` ⇒ 400 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » đọc xong thì rời]
- Kịch bản: trộn nội bộ + partner, keyset, lọc `company`, người gửi/người thứ ba không thấy cuộc partner [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » trộn partner]

## Quyết định trong lúc làm
- Migration pack/hub chạy trong MỘT tx (drizzle migrator) ⇒ không dùng `CREATE INDEX CONCURRENTLY` (không chạy được trong tx); `SET LOCAL lock_timeout = '5s'` như 0070/0084. Cái giá: khoá ghi bảng trong lúc dựng chỉ mục (bảng tin nhắn còn nhỏ trên prod).
- M5 partner: hàm MỚI `hub.pmsg_inbox_unread` (không thêm tham số vào `pmsg_inbox` — đổi chữ ký sẽ sinh overload mơ hồ và đụng grants cũ). Lọc «còn chưa đọc» nằm TRONG từng nhánh trước LIMIT (không lọc sau LIMIT ⇒ phân trang không hụt).

## Việc
- [x] M5 · `unread=true` (contract `MsgConversationsQuerySchema.unread`, `messages.repo.ts` `UNREAD_ONLY`, hub 0153 `pmsg_inbox_unread`)
