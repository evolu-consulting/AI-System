---
id: cr178-m3-find
lát: cr178-m3-find
cr: CR-178
làn: nhanh
migration: không
phụ thuộc: cr178-api, cr178-m1-ui
---
# cr178-m3-find — M3 «Tin nhắn»: tìm tin, «Ảnh & tệp», xem trước tệp (giao diện)

Nguồn: `docs/CHANGE-REQUESTS.md` CR-178; API: `docs/specs/cr178-api/tasks.md`. Chỉ đổi `packages/messages-web` (+ i18n, e2e); không đổi API/migration. Không làm: trả lời trích dẫn, cảm xúc, gắn hợp đồng.

## Plan (ngắn)
Ô tìm đầu danh sách ≥ 2 ký tự ⇒ chế độ tìm (tab «Tin nhắn» / «Người») · nhảy tới tin bằng `around_seq` (kho yêu cầu nhảy `jump-request` + `useJump`) · FindBar trong cuộc · Sheet «Ảnh & tệp» · hộp xem trước qua blob.

## Làm
- [x] `lib/find.ts` (+ test): tô sáng theo `match`, gộp trang, chia ảnh theo tháng, lọc tên, kiểu xem trước theo mime, ‹ ›, ↑↓, ghép trang `around`.
- [x] `api.ts`: `fetchSearch`, `fetchAttachments`, `fetchFileBlob`, `fetchMessages(…, aroundSeq)`; `hooks/use-find.ts`, `use-jump.ts`, `jump-request.ts`.
- [x] `SearchHits`, `FindBar`, `AttachSheet`, `FilePreview`; nối vào `ConversationList/Pane`, `ChatView`, `MessageList` (cuộn + nháy viền, tải tin mới hơn); i18n vi + en (`contracts.messages.find.*`).
- [x] e2e `e2e/cr127/j18-tim-tin-nhan.spec.ts` (chưa chạy).

## Không làm / Chạm
Không sửa web-kit, API. Ô tìm giữ nhãn cũ «Tìm người theo tên, chức vụ» (e2e CR-169/smoke dùng tên này).

## Test tối thiểu
`bun test packages/messages-web` · tsc messages-web/workspace-web/chat-web · `check:ui-kit`.

## Quyết định trong lúc làm
- Xem trước: tải byte bằng link FileBox ngắn hạn (`fetch`, không cookie), `new Blob([...], {type: mime đã lưu})` — không tin `Content-Type` của máy chủ tệp; ảnh `<img>`, PDF `<iframe sandbox="">`; svg/html/Word/Excel/ZIP ⇒ chỉ «Tải về»; thu hồi blob khi đổi tệp/đóng.
- Danh sách tin có `pageParam {around}` ⇒ làm mới (refetch) vẫn ra đúng trang đã nhảy, không bật về tin mới nhất.
- Nhảy tới tin chưa tải: thay hẳn danh sách tin bằng trang `around_seq`; cuộn gần đáy khi `has_newer` ⇒ nạp thêm tin mới hơn (thêm lên đầu).
- ↑ = kết quả cũ hơn, ↓ = mới hơn; Enter = cũ hơn, Shift+Enter = mới hơn; «n/m+» khi còn trang.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

### MODIFIED pack-contracts/tin-nhan.md

#### Yêu cầu: Tìm tin nhắn
Ô tìm đầu danh sách gõ ≥ 2 ký tự ⇒ chế độ tìm với tab «Tin nhắn» (tin khớp ở mọi cuộc người dùng thấy: tên cuộc, người gửi, thời gian, đoạn trích tô sáng chỗ khớp; mới nhất trước, tải dần) và «Người». Bấm kết quả ⇒ mở cuộc, cuộn tới tin, tin nháy viền ~2 giây (giảm chuyển động: chỉ viền); cuộn xuống tải tiếp tin mới hơn. ‹ hoặc Esc thoát chế độ tìm. Không khớp ⇒ «Không có tin nào khớp «…»»; lỗi ⇒ «Thử lại».
- Kịch bản: tô sáng cắt đúng 3 phần theo `match`; thiếu/ngoài đoạn thì không tô [test: packages/messages-web/src/lib/find.test.ts » tô sáng theo match]
- Kịch bản: gộp trang kết quả bỏ trùng, giữ thứ tự [test: packages/messages-web/src/lib/find.test.ts » gộp trang]
- Kịch bản: ghép trang quanh `around_seq`, tin mới hơn thêm lên đầu [test: packages/messages-web/src/lib/find.test.ts » trang tin quanh around_seq]
- Kịch bản: B (người nhận, khác người gửi) tìm «bao gia» thấy tin «báo giá» của A, bấm ⇒ cuộc mở đúng tin; người ngoài cuộc tìm không ra [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A]

#### Yêu cầu: Tìm trong một cuộc
Nút kính lúp ở đầu khung chat ⇒ ô tìm thay đầu khung, hiện «2/5», ↑ (cũ hơn) ↓ (mới hơn), Enter / Shift+Enter; mỗi lần nhảy tới tin khớp của cuộc đó.
- Kịch bản: ↑↓ vòng quanh các kết quả [test: packages/messages-web/src/lib/find.test.ts » chuyển ‹ › và ↑↓]
- Kịch bản: tìm trong cuộc ra «1/1» [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A]

#### Yêu cầu: Ảnh & tệp của cuộc
Nút «Ảnh & tệp» ở đầu khung chat ⇒ Sheet bên phải (điện thoại: toàn màn) có tab «Ảnh» (lưới 3 cột chia theo tháng, tải dần) và «Tệp» (tên cắt giữa, dung lượng, người gửi, ngày; ô lọc tên trên phần đã tải). Mỗi mục có «Đến tin nhắn»; tệp có «Xem trước» (ảnh, PDF) và «Tải về».
- Kịch bản: ảnh chia theo tháng, tháng liền nhau gộp một nhóm [test: packages/messages-web/src/lib/find.test.ts » chia ảnh theo tháng]
- Kịch bản: lọc tên không phân biệt hoa/dấu; tên dài cắt giữa giữ đuôi [test: packages/messages-web/src/lib/find.test.ts » lọc tên tệp]
- Kịch bản: B mở «Ảnh & tệp» thấy PDF của A, «Đến tin nhắn» về đúng tin [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A]

#### Yêu cầu: Xem trước tệp
Hộp lớn nền tối: ảnh (png/jpg/gif/webp) và PDF xem trong trang; Word/Excel/ZIP… chỉ «Tải về». Byte tải về bằng link ngắn hạn, gắn đúng loại đã lưu, xem qua `blob:` (PDF trong iframe sandbox), thu hồi khi đóng; svg/html không bao giờ hiển thị. Có ‹ ›, «Đến tin nhắn», «Tải về», Esc đóng.
- Kịch bản: chỉ ảnh raster và PDF xem được; svg, html, Word, Excel, ZIP ⇒ chỉ tải về [test: packages/messages-web/src/lib/find.test.ts » kiểu xem trước theo mime]
- Kịch bản: ‹ › không vòng, ngoài biên không chuyển [test: packages/messages-web/src/lib/find.test.ts » chuyển ‹ › và ↑↓]
- Kịch bản: B bấm «Xem trước» PDF ⇒ khung PDF trên blob, Esc đóng [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A]

## Việc còn lại
- Ảnh trong khung chat bấm vào vẫn mở trình xem cũ của `AttachGallery` (web-kit, không sửa được trong lát) — chưa chuyển sang hộp xem trước mới.
- Chạy e2e cuối đợt; soát UI trên trình duyệt thật (chưa dựng giao diện); kiểm fetch link FileBox có CORS cho xem trước (nếu không ⇒ hiện «Không tải được tệp», vẫn «Tải về» được).
- Tin realtime tới khi đang xem vùng cũ (còn `has_newer`) hiện ngay sau khoảng trống; tải tiếp khi cuộn xuống đáy.
