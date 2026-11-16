# Tin nhắn: API lọc chưa đọc, tìm, Ảnh & tệp, nhảy tới tin, xem trước (CR-178)

Bổ sung cho [tin-nhan.md](tin-nhan.md) §2/§4. Nguồn: cr178-api, fix-e2e-msg-1116. Code: `apps/hub-api/src/modules/packs/contracts/messages/` (`messages-find.{repo,usecase,routes}.ts`, `application/messages.search.ts`, `messages.repo.ts` `UNREAD_ONLY`); contract `packages/contracts/src/pack-contracts/messages-find.ts`; hub migration 0153 (`pmsg_inbox_unread`, `pmsg_files_list`, `pmsg_search`, trigram), pack 0120 (trigram + grant `hub.fold` cho `contracts_rw`). UI: [tin-nhan-giao-dien.md](tin-nhan-giao-dien.md).

#### Yêu cầu: Lọc chưa đọc ở máy chủ
`GET /messages/conversations?unread=true` chỉ trả cuộc có tin chưa đọc của người gọi (cùng luật đếm với badge: sau mốc đọc, không do mình gửi, chưa thu hồi), trộn nội bộ + `partner`, mới nhất trước, keyset `next_cursor`; lọc trước LIMIT nên trang luôn đầy. `unread=false`/vắng = tất cả; giá trị khác ⇒ 400.
- Kịch bản: người được giao (không phải người tạo) chỉ thấy cuộc còn chưa đọc; tin của mình + tin thu hồi không tính; người ngoài cuộc không thấy [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » người được giao]
- Kịch bản: đọc xong thì rời danh sách; `unread=abc` ⇒ 400 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » đọc xong thì rời]
- Kịch bản: trộn nội bộ + partner, keyset, lọc `company`, người thứ ba không thấy cuộc partner [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » trộn partner]

#### Yêu cầu: Ảnh & tệp của một cuộc
`GET /messages/conversations/:id/attachments` (nội bộ) và `GET /messages/partner/:id/attachments` (partner) liệt kê tệp ĐÃ GỬI (gắn tin, tin chưa thu hồi, tệp chưa xoá), mới nhất trước, `kind=image|file` (image = mime `image/*`), keyset `next_cursor`, ≤ 30/trang. Mỗi dòng: `file` (FileRef), `kind`, `sender_id`, `sender_name`, `seq` (cho «Đến tin nhắn»), `at`. Nội bộ: chỉ thành viên; partner: chỉ hai đầu, đọc được cả sau ngắt kết nối. Người ngoài cuộc / công ty thứ ba / id lạ ⇒ 404 `MSG_NOT_FOUND`; `kind`/`cursor`/`limit` sai ⇒ 400.
- Kịch bản: người được giao liệt kê, lọc kind, phân trang; tệp chưa gửi + tệp tin thu hồi không ra [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » người được giao (VY, không phải người tạo) liệt kê tệp]
- Kịch bản: ngoài cuộc cùng công ty / công ty khác / id lạ ⇒ 404; query sai ⇒ 400 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » người ngoài cuộc cùng công ty (LAN)]
- Kịch bản: partner: hai đầu thấy tệp cả hai phía, công ty thứ ba 404 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » hai đầu (VY, CUONG]
- Kịch bản: sau ngắt kết nối vẫn liệt kê được [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » sau khi ngắt kết nối A–C]
- Kịch bản: con trỏ hỏng ⇒ null; dựng DTO (kind, ISO) [test: apps/hub-api/src/modules/packs/contracts/messages/application/messages.find.test.ts » con trỏ Ảnh & tệp]

#### Yêu cầu: Tìm tin nhắn
`GET /messages/search?q=&conversation_id=&cursor=&limit=`: `q` 2–100 ký tự; khớp chứa chuỗi, không phân biệt hoa/dấu (`hub.fold` hai phía; `%` `_` `\` là chữ thường; đ→d); chỉ tin người gọi xem được (nội bộ: thành viên qua RLS; partner: một trong hai đầu qua hàm DEFINER, kể cả sau ngắt kết nối); bỏ tin đã thu hồi; mới nhất trước, keyset `next_cursor`, ≤ 20/trang. Kết quả: `conversation_id`, `kind`, `title`, `company` (partner), `seq`, `sender_id`, `sender_name`, `at`, `snippet` (≤ 160 ký tự, một dòng, «…» khi cắt, không cắt đôi emoji), `match` (chỉ số UTF-16 để tô sáng). Có `conversation_id` ⇒ chỉ cuộc đó; cuộc không thấy ⇒ 200 rỗng (không lộ). `q` ngắn/dài quá, `limit` > 20, `cursor`/`conversation_id` sai ⇒ 400. Người không có quyền Sổ Hợp Tác (42501) ⇒ chỉ tìm nội bộ. Hai nguồn (nội bộ 1 câu + `hub.pmsg_search` 1 câu) trong cùng tx, trộn theo keyset `(created_at, conversation_id, seq)` ở TS; số câu SQL cố định (2).
- Kịch bản: «bao gia» ra «báo giá»; người được giao thấy nội bộ + partner mới nhất trước; tin thu hồi + cuộc không là thành viên không ra [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » «bao gia» ra «báo giá»]
- Kịch bản: mỗi người chỉ thấy phần của mình; người thứ ba rỗng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » mỗi người chỉ thấy phần của mình]
- Kịch bản: phân trang keyset nối lại đúng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » phân trang keyset limit=2]
- Kịch bản: `conversation_id` chỉ trong cuộc đó; cuộc không thấy ⇒ rỗng [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » conversation_id: chỉ tìm trong cuộc đó]
- Kịch bản: khớp chứa chuỗi, đ→d, `%` `_` là chữ thường [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » khớp chứa chuỗi]
- Kịch bản: query sai ⇒ 400 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » query sai ⇒ 400]
- Kịch bản: partner thu hồi không ra; sau ngắt kết nối vẫn tìm được; người thứ ba không [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » sau khi ngắt kết nối A–B]
- Kịch bản: đoạn trích ≤ 160, không cắt đôi emoji, match đúng [test: apps/hub-api/src/modules/packs/contracts/messages/application/messages.search.test.ts » snippetOf]
- Kịch bản: số câu SQL cố định (2) + p95 (60.000 tin: trang 1 p95 131 ms, một cuộc 8 ms; chưa đo trên prod) [test: apps/hub-api/src/modules/packs/contracts/messages/messages-search.perf.int.test.ts » perf tìm tin]

#### Yêu cầu: Trang tin quanh một tin (`around_seq`)
`GET .../messages?around_seq=N&limit=L` (nội bộ và `partner`) trả tin N + tin cũ hơn + ~⌊L/2⌋ tin mới hơn; `has_more` = còn tin cũ hơn, `has_newer` (chỉ khi có `around_seq`) = còn tin mới hơn. Có `around_seq` thì bỏ qua `before_seq`. Không có `around_seq` ⇒ hành vi cũ, không có `has_newer`.
- Kịch bản: giữa / đầu / cuối cuộc, partner, người ngoài cuộc 404, tương thích cũ [test: apps/hub-api/src/modules/packs/contracts/messages/messages-read-cr178.int.test.ts » around_seq]

#### Yêu cầu: Xem trước tệp tải byte qua hub-api
Xem trước ảnh/PDF của «Ảnh & tệp» tải byte qua hub-api (`GET …/files/:fileId/content`, Bearer, cùng origin; cả nội bộ và `partner`), không `fetch` xuyên origin tới FileBox. Quyền như link tải: chỉ thành viên (ngoài cuộc/chưa được thấy ⇒ 404 `MSG_NOT_FOUND`). Server luôn trả `application/octet-stream` + `nosniff`; web gắn loại đã lưu; SVG/HTML/loại khác không hiển thị. Upload chỉ nhận đuôi trong `ATTACH_ALLOWED` (không svg/html). (Việc «inline chỉ raster + pdf» từng chờ quyết ở cr178-api: đã giải bằng đường byte này.)
- Kịch bản: người nhận (khác người tải) lấy được byte; người ngoài cuộc 404 [test: apps/hub-api/src/modules/packs/contracts/messages/pmsg-partner-api.int.test.ts » CR-178 · xem trước]
- Kịch bản: cuộc nội bộ — thành viên đọc được byte, người ngoài cuộc MSG_NOT_FOUND [test: apps/hub-api/src/modules/packs/contracts/messages/messages-files.int.test.ts » thành viên tải lên]
- Kịch bản: B mở «Ảnh & tệp» ⇒ «Xem trước» PDF hiển thị trong hộp [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A, mở đúng tin]

Nợ: `after_seq` (tải tin mới hơn sau khi nhảy) chưa có — UI dùng lại `around_seq` = seq cuối đã có; lỗi tsc sẵn có `H/pmsg-db.int.test.ts:412`.
