# cr148-messages — CR-148 Tin nhắn: tải dần, danh bạ theo phòng ban, thẻ người

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md

#### Yêu cầu: Mọi danh sách tải dần 30 dòng mỗi lần
Danh bạ (`GET /messages/people`: `cursor`, `q`, `limit` ≤ 50, mặc định 30), danh sách hội thoại và tin trong hội thoại đều tải 30 dòng/lần; cuộn tới cuối (hoặc bấm «Xem thêm») tải trang kế, cuộn lên gần đầu hội thoại tải tin cũ hơn và giữ nguyên vị trí đang đọc. Mỗi trang đúng MỘT câu SQL (danh bạ: lấy limit+1 dòng để biết còn trang sau). Con trỏ hỏng ⇒ 400; đối tác (external) ⇒ rỗng; không thấy người công ty khác.
- Kịch bản: khi danh bạ có nhiều người thì mỗi trang trả đúng số dòng xin, con trỏ nối tiếp không trùng không sót, trang cuối hết con trỏ [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » tải dần: trang 1 người, con trỏ nối tiếp không trùng không sót, trang cuối hết con trỏ]
- Kịch bản: khi con trỏ hỏng thì bị từ chối, ô tìm lọc tên không dấu [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » con trỏ hỏng ⇒ BAD_CURSOR, q lọc tên không dấu]
- Kịch bản: khi người dùng công ty khác hoặc đối tác xin danh bạ thì không thấy người công ty này [test: apps/hub-api/src/modules/packs/contracts/messages/messages.int.test.ts » chặn chéo công ty và đối tác: không lộ người công ty khác, external ⇒ rỗng]
- Kịch bản: khi thẻ người cần đọc cho cả trang thì chia lô tối đa 50 id, bỏ trùng và người đã có [test: apps/workspace-web/src/features/messages/lib/directory.test.ts » chia lô ≤ 50, bỏ trùng và id đã có]

#### Yêu cầu: Danh bạ chia nhóm theo phòng ban, thu gọn hoặc mở
«Thành viên» chia nhóm theo phòng ban (sắp theo tên), người không thuộc phòng nào vào nhóm «Chưa có phòng» ở cuối. Bấm tiêu đề nhóm để thu gọn/mở; trạng thái nhớ trong phiên (đóng tab thì quên). Đang tìm thì mọi nhóm mở.
- Kịch bản: khi có nhiều phòng thì nhóm theo tên phòng, «Chưa có phòng» cuối [test: apps/workspace-web/src/features/messages/lib/directory.test.ts » nhóm theo phòng (tên phòng), «Chưa có phòng» cuối, trong phòng theo tên]
- Kịch bản: khi lọc tên thì nhóm rỗng biến mất [test: apps/workspace-web/src/features/messages/lib/directory.test.ts » lọc tên làm nhóm rỗng biến mất]
- Kịch bản: khi thu gọn nhóm thì nhớ trong phiên [test: apps/workspace-web/src/features/messages/lib/directory.test.ts » bật/tắt rồi đọc lại, dữ liệu hỏng ⇒ rỗng]
- Kịch bản: khi nhân viên mở Tin nhắn thì thấy danh bạ chia nhóm, thu gọn được, rê chuột lên tên hiện thẻ phòng ban + chức vụ [test: e2e/cr127/j20-tin-nhan-danh-ba.spec.ts » Danh bạ theo phòng ban: thu gọn, thẻ người]

#### Yêu cầu: Thẻ người khi rê chuột hoặc focus
Rê chuột (hoặc focus bàn phím) lên ảnh đại diện hoặc tên ⇒ thẻ nhỏ gồm ảnh đại diện, tên, phòng ban, chức vụ; Esc đóng. Dữ liệu đọc theo lô cho cả trang (hub `GET /people?ids=`, ≤ 50 id mỗi lời gọi), không gọi từng người. Mọi avatar trong Tin nhắn dùng `PersonAvatar`.
- Kịch bản: khi người của 1-1 chưa tải ở trang danh bạ thì phòng lấy từ thẻ, thiếu thẻ ⇒ «Chưa có phòng» [test: apps/workspace-web/src/features/messages/lib/directory.test.ts » 1-1 với người chưa tải trang danh bạ: lấy phòng từ thẻ, thiếu thẻ ⇒ Chưa có phòng]

## Quyết định trong lúc làm
- Đổi hợp đồng `/messages/people`: mảng đầy đủ ⇒ trang `{items,next_cursor}` kèm `department` (thay hẳn, G1; client duy nhất là Tin nhắn). `MSG_PAGE_DEFAULT` 50 ⇒ 30.
- Sắp danh bạ ở SERVER theo (có phòng, tên phòng, tên, id) để phân trang ổn định; nhóm phòng ghép ở client (một phòng có thể trải qua nhiều trang).
- Lọc tên: server `unaccent` (ô tìm danh bạ) + client (hội thoại/nhóm đã tải).

## Perf
Danh bạ: 1 câu SQL/trang (limit+1). Hội thoại, tin: giữ 1 câu/trang như cũ. Thẻ người: 1 câu/lô ≤ 50 (hub `/people`).

## Việc còn lại
- e2e j20 viết, chưa chạy. Tách phòng ban không-đầu-tiên (người nhiều phòng chỉ hiện ở phòng đầu theo khoá).
