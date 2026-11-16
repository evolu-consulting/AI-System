# cr178-api — lát API của CR-178 (Tin nhắn: lọc chưa đọc · ảnh & tệp · tìm tin)

Nguồn: `docs/CHANGE-REQUESTS.md` CR-178 mục (4)(5)(6); hành vi hiện hành `docs/current/pack-contracts/tin-nhan.md`; tin đối tác `docs/specs/CR-169/spec.md` §3–4.
Web/UI do lát khác làm (sau U4 của CR-177). Migration CHỈ THÊM (hàm mới, chỉ mục): hub 0153 (+0154 grants), pack-contracts 0120.
Viết tắt: `H` = `apps/hub-api/src/modules/packs/contracts/messages`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

### MODIFIED pack-contracts/tin-nhan.md

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

#### Yêu cầu: Tìm tin nhắn (M3)
`GET /messages/search?q=&conversation_id=&cursor=&limit=`: `q` 2–100 ký tự; khớp chứa chuỗi, không phân biệt hoa/dấu (`hub.fold` hai phía; `%` `_` `\` là chữ thường); chỉ tin người gọi xem được (nội bộ: thành viên qua RLS; partner: một trong hai đầu qua hàm DEFINER, kể cả sau ngắt kết nối); bỏ tin đã thu hồi; mới nhất trước, keyset `next_cursor`, ≤ 20/trang. Mỗi kết quả: `conversation_id`, `kind`, `title` (tên nhóm / tên người kia), `company` (partner), `seq`, `sender_id`, `sender_name`, `at`, `snippet` (≤ 160 ký tự, một dòng, «…» khi cắt, không cắt đôi emoji), `match` (chỉ số UTF-16 để tô sáng). Có `conversation_id` ⇒ chỉ cuộc đó; cuộc không thấy ⇒ rỗng (không lộ). `q` ngắn/dài quá, `limit` > 20, `cursor`/`conversation_id` sai ⇒ 400.
- Kịch bản: «bao gia» ra «báo giá»; người được giao thấy nội bộ + partner mới nhất trước; tin thu hồi + cuộc không là thành viên không ra [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » «bao gia» ra «báo giá»]
- Kịch bản: mỗi người chỉ thấy phần của mình; người thứ ba / công ty thứ ba rỗng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » mỗi người chỉ thấy phần của mình]
- Kịch bản: phân trang keyset nối lại đúng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » phân trang keyset limit=2]
- Kịch bản: `conversation_id` chỉ trong cuộc đó; cuộc không thấy ⇒ rỗng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » conversation_id: chỉ tìm trong cuộc đó]
- Kịch bản: khớp chứa chuỗi, đ→d, `%` `_` là chữ thường, tin thu hồi không ra [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » khớp chứa chuỗi]
- Kịch bản: query sai ⇒ 400 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » query sai ⇒ 400]
- Kịch bản: tin partner thu hồi không ra; sau ngắt kết nối vẫn tìm được; người thứ ba không [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » sau khi ngắt kết nối A–B]
- Kịch bản: đoạn trích ≤ 160, không cắt đôi emoji, match đúng; con trỏ; thứ tự [test: apps/hub-api/src/modules/packs/contracts/messages/application/messages.search.test.ts » snippetOf]
- Kịch bản: số câu SQL cố định (2) + p95 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-search.perf.int.test.ts » perf tìm tin]

#### Yêu cầu: Trang tin quanh một tin (`around_seq`)
`GET .../messages?around_seq=N&limit=L` (nội bộ và `partner`) trả tin N + tin cũ hơn + ~⌊L/2⌋ tin mới hơn; `has_more` = còn tin cũ hơn, `has_newer` (chỉ khi có `around_seq`) = còn tin mới hơn. Có `around_seq` thì bỏ qua `before_seq`. Không có `around_seq` ⇒ hành vi cũ, không có `has_newer`.
- Kịch bản: giữa / đầu / cuối cuộc, partner, người ngoài cuộc 404, tương thích cũ [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » around_seq]

## Quyết định trong lúc làm
- Migration pack/hub chạy trong MỘT tx (drizzle migrator) ⇒ không dùng `CREATE INDEX CONCURRENTLY` (không chạy được trong tx); `SET LOCAL lock_timeout = '5s'` như 0070/0084. Cái giá: ghi bảng chờ trong lúc dựng chỉ mục (bảng tin nhắn còn nhỏ trên prod).
- M5 partner: hàm MỚI `hub.pmsg_inbox_unread` (không thêm tham số vào `pmsg_inbox` — đổi chữ ký sinh overload mơ hồ và đụng grants cũ). Lọc «còn chưa đọc» nằm TRONG từng nhánh trước LIMIT (không lọc sau LIMIT ⇒ phân trang không hụt).
- M4 đường riêng `/attachments` (GET), không dùng `GET .../files`: tránh nhập nhằng với `POST .../files` (tải lên) và `GET .../files/:fileId` (tải xuống). Partner: hàm MỚI `hub.pmsg_files_list` (DEFINER, kiểm «là một trong hai đầu» ⇒ CC404, không kiểm còn kết nối).
- M4 «đường tải tệp»: tải/xem tệp tin nhắn là 302 / JSON `{url}` sang FileBox (`/d/…`) ⇒ `Content-Disposition`/`nosniff` do FileBox đặt, hub-api KHÔNG kiểm soát được. Phía hub-api: upload chỉ nhận đuôi trong `ATTACH_ALLOWED` (không svg/html). Ghi vào «Việc còn lại».
- M3 so khớp: `hub.fold(body) LIKE '%'||hub.fold(q)||'%'` (q thoát `\ % _` bằng `escapeLike` ở TS) — cùng biểu thức + điều kiện `deleted_at IS NULL` với chỉ mục trigram từng phần ⇒ planner dùng được chỉ mục. `q` 2 ký tự không đủ trigram ⇒ quét (vẫn đúng, chậm hơn). pg_trgm thiếu ⇒ migration bỏ qua chỉ mục (khuôn 0152).
- M3 hai nguồn: nội bộ (1 câu) + `hub.pmsg_search` (1 câu) trong CÙNG tx, trộn + cắt ở TS theo keyset `(created_at, conversation_id, seq)`; người không có quyền Sổ Hợp Tác (42501) ⇒ chạy lại chỉ nội bộ (`internalOnPartnerDenied`, chuyển sang `H/application/messages.ops.ts` để dùng chung).
- M3 cuộc không thấy khi có `conversation_id` ⇒ 200 rỗng (không 404): không lộ cuộc có tồn tại ở nguồn nào, và không phải đoán cuộc là nội bộ hay partner.
- M3 snippet: đơn vị = cụm ký tự (`Intl.Segmenter`) nên không cắt đôi cặp thay thế/emoji ghép; so khớp trong TS dùng `foldText` (NFD bỏ dấu + lower + đ→d) — lệch DB ở ký tự lạ thì `match` = null (đoạn trích từ đầu), kết quả tìm vẫn đúng vì lọc ở DB.
- `around_seq`: tái dùng `page`/`pmsg_page` với `before = around + ⌊limit/2⌋ + 1` (không thêm hàm DB); `has_newer` lấy từ tin cuối của cuộc (`facts` nội bộ / `pmsg_detail.last`) — thêm 1 câu cố định.
- `hub.fold` cấp thêm cho `contracts_rw` (pack 0120) vì chỉ mục biểu thức trên `contracts.msg_messages` gọi hàm này khi chèn/sửa tin.
- Số lượt int > 3 (N3): lượt 1–2 mỗi lượt một phần xanh; lượt 3–4 là sửa lỗi của chính test M3 (thiếu `export`, dữ liệu trùng cặp partner của M5).

## Số đo (dữ liệu mẫu 100 nhóm × 500 + 20 cuộc partner × 500 = 60.000 tin, ~1% khớp; evotest)
- Tìm mọi cuộc, trang 1: p95 131 ms · trang 2 (con trỏ): p95 117 ms · một cuộc: p95 8 ms — đều 2 câu SQL repo / thao tác (cố định). Chưa đo trên dữ liệu prod.

## Việc còn lại / cần quyết
- Ép «inline chỉ ảnh raster + pdf, `nosniff`, còn lại `attachment`» cho tải/xem tệp tin nhắn: header do FileBox quyết (chưa kiểm được ở hub-api). Cần quyết: (a) proxy byte qua hub-api như `evidence-disposition.ts`, hoặc (b) kiểm/đặt ở FileBox (ngoài phạm vi lát này).
- Sau khi nhảy bằng `around_seq` UI cần tải tiếp tin MỚI hơn: hiện dùng lại `around_seq` = seq cuối đã có; nếu gượng thì thêm `after_seq` (tương thích, một tham số).
- Lỗi tsc có sẵn ngoài phạm vi: `H/pmsg-db.int.test.ts:412` (TS2769 `toEqual([])`).
- Gộp Delta vào `docs/current/pack-contracts/tin-nhan.md` + `openspec:archive` ở giai đoạn Đóng (sau khi UI xong).

## Việc
- [x] M5 · `unread=true` (contract `MsgConversationsQuerySchema.unread`, `messages.repo.ts` `UNREAD_ONLY`, hub 0153 `pmsg_inbox_unread`)
- [x] M4 · `/attachments` nội bộ + partner (contract `messages-find.ts`, `messages-find.repo.ts`, `messages-find.usecase.ts`, hub 0153 `pmsg_files_list`)
- [x] M3 · `/messages/search` + `around_seq` (contract `messages-find.ts`/`messages.ts`, `messages.search.ts`, `messages-find.{repo,usecase,routes}.ts`, hub 0153 `pmsg_search` + trigram, pack 0120 trigram + grant `hub.fold`)
- [ ] Kiểm đường tải tệp (inline/nosniff) — chờ quyết (xem «Việc còn lại»)
