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

#### Yêu cầu: Ảnh & tệp của một cuộc (M4)
`GET /messages/conversations/:id/attachments` (nội bộ) và `GET /messages/partner/:id/attachments` (partner) liệt kê tệp ĐÃ GỬI (gắn tin, tin chưa thu hồi, tệp chưa xoá), mới nhất trước, `kind=image|file` (image = mime `image/*`), keyset `next_cursor`, ≤ 30/trang. Mỗi dòng: `file` (FileRef), `kind`, `sender_id`, `sender_name`, `seq` (để «Đến tin nhắn»), `at`. Tệp chưa gửi không ra. Nội bộ: chỉ thành viên; partner: chỉ hai đầu, đọc được cả sau ngắt kết nối (P3). Người ngoài cuộc / công ty thứ ba / id lạ ⇒ 404 `MSG_NOT_FOUND`; `kind`/`cursor`/`limit` sai ⇒ 400.
- Kịch bản: người được giao liệt kê, lọc kind, phân trang; tệp chưa gửi + tệp tin thu hồi không ra [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » người được giao (VY, không phải người tạo) liệt kê tệp]
- Kịch bản: ngoài cuộc cùng công ty / công ty khác / id lạ ⇒ 404; query sai ⇒ 400 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » người ngoài cuộc cùng công ty (LAN)]
- Kịch bản: partner: hai đầu thấy tệp cả hai phía, công ty thứ ba/ngoài cuộc 404 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » hai đầu (VY, CUONG]
- Kịch bản: sau ngắt kết nối vẫn liệt kê được [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » sau khi ngắt kết nối A–C]
- Kịch bản: con trỏ hỏng ⇒ null; dựng DTO (kind, ISO) [test: apps/hub-api/src/modules/packs/contracts/messages/application/messages.find.test.ts » con trỏ Ảnh & tệp]

## Quyết định trong lúc làm
- Migration pack/hub chạy trong MỘT tx (drizzle migrator) ⇒ không dùng `CREATE INDEX CONCURRENTLY` (không chạy được trong tx); `SET LOCAL lock_timeout = '5s'` như 0070/0084. Cái giá: khoá ghi bảng trong lúc dựng chỉ mục (bảng tin nhắn còn nhỏ trên prod).
- M5 partner: hàm MỚI `hub.pmsg_inbox_unread` (không thêm tham số vào `pmsg_inbox` — đổi chữ ký sẽ sinh overload mơ hồ và đụng grants cũ). Lọc «còn chưa đọc» nằm TRONG từng nhánh trước LIMIT (không lọc sau LIMIT ⇒ phân trang không hụt).
- M4 đường riêng `/attachments` (GET), không dùng `GET .../files`: tránh nhập nhằng với `POST .../files` (tải lên) và `GET .../files/:fileId` (tải xuống).
- M4 partner: hàm MỚI `hub.pmsg_files_list` (DEFINER, kiểm «là một trong hai đầu» ⇒ CC404, không kiểm còn kết nối).
- M4 «đường tải tệp»: tải/xem tệp tin nhắn là `302`/JSON `{url}` sang FileBox (`/d/…`) ⇒ `Content-Disposition`/`nosniff` do FileBox đặt, hub-api KHÔNG kiểm soát được. Phía hub-api: upload chỉ nhận đuôi trong `ATTACH_ALLOWED` (không svg/html). Ép «inline chỉ ảnh raster + pdf» cần proxy byte qua hub-api (kiểu `evidence-disposition.ts`) hoặc tham số của FileBox ⇒ ghi «Việc còn lại», chờ quyết.

## Việc
- [x] M5 · `unread=true` (contract `MsgConversationsQuerySchema.unread`, `messages.repo.ts` `UNREAD_ONLY`, hub 0153 `pmsg_inbox_unread`)
- [x] M4 · `/attachments` nội bộ + partner (contract `messages-find.ts`, `messages-find.repo.ts`, `messages-find.usecase.ts`, hub 0153 `pmsg_files_list`)
