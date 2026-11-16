# Tin nhắn: giao diện hiện hành (CR-178/179)

Thắng các mục §5 của [tin-nhan.md](tin-nhan.md) khi mâu thuẫn. Nguồn: cr178-m1-ui, m2-composer, m3-find, cr179-msg-text, cr179-files, fix-e2e-msg-1116. Code: `packages/messages-web/src/` (`lib/*.ts` thuần có test, `components/`). API: [tin-nhan-tim-kiem.md](tin-nhan-tim-kiem.md). Khung chung điện thoại: [../web/mobile.md](../web/mobile.md).

## Danh sách
#### Yêu cầu: Màn «Tin nhắn» toàn màn, menu có số chưa đọc
«Tin nhắn» (sau «Yêu cầu») có số đỏ tổng chưa đọc. Danh sách MỘT kiểu: cuộc gần đây, mới nhất trước, tải dần. Mỗi dòng có 3 dòng chữ (CR-179): (1) tên người/nhóm + giờ; (2) «công ty · chức vụ» (công ty chỉ cuộc `partner`, chức vụ của người kia ở 1-1; thiếu cả hai ⇒ không vẽ dòng) chữ phụ không nền; (3) xem trước tin cuối (có icon tệp nếu là tệp). Avatar luôn theo tên người/nhóm (không theo tên công ty), cuộc partner avatar vuông; chưa đọc in đậm kèm số (đến 99, «99+»). Mỗi phần tự cắt «…» có tooltip đủ chữ ([../web/chu-cat-tooltip.md](../web/chu-cat-tooltip.md)). Thanh lọc 3 tab «Tất cả · Chưa đọc (n) · Đối tác ▾»: «Chưa đọc» gọi `unread=true`; «Đối tác» mở menu công ty đã kết nối, chọn xong chỉ hiện cuộc với công ty đó. Ô tìm lọc người/nhóm theo tên không dấu. Danh bạ theo phòng ban và «Bảng tin» không còn ở danh sách.
- Kịch bản: tab Tất cả/Chưa đọc/Đối tác ⇒ bộ lọc gửi lên API đúng [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · tab danh sách]
- Kịch bản: `?company=` đối tác ⇒ tab Đối tác; own/rỗng ⇒ Tất cả [test: packages/messages-web/src/lib/cr178.test.ts » ?company= đối tác ⇒ tab Đối tác]
- Kịch bản: dòng 2 là «công ty · chức vụ»; avatar theo tên người [test: packages/messages-web/src/lib/row-view.test.ts]
- Kịch bản: người được giao (không phải người tạo) thấy cuộc ở «Chưa đọc», mở thì hết [test: e2e/cr127/j18-tin-nhan.spec.ts » A nhắn B: B thấy chưa đọc, mở thì hết, A thấy «Đã xem»]
- Kịch bản: cuộc đối tác ⇒ nhãn công ty ở hàng riêng, KHÔNG có nút «Bảng tin <Công ty>» [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J1]
- Kịch bản: công ty (+ chức vụ) hiện ở dòng danh sách và đầu khung chat [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J2]
- Kịch bản: lọc đối tác + tìm theo tên không dấu [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J3]

#### Yêu cầu: «Nhắn tin mới» tạo 1-1 hoặc nhóm
Hộp 2 tab. «Công ty mình»: danh bạ theo phòng ban («Chưa có phòng» cuối), 1 người ⇒ nhắn riêng, từ 2 ⇒ «Tên nhóm» bắt buộc + «Tạo nhóm», tối đa 50 người (quá ⇒ báo nhóm đầy). «Đối tác»: chọn công ty đã kết nối rồi 1 người ⇒ nhắn riêng; nhóm chỉ nội bộ. Người chọn hiện chip ở ô «Tới:» (× để bỏ); đổi tab ⇒ bỏ chọn. Lỗi API hiện câu theo mã.
- Kịch bản: chọn nhiều/bấm lại bỏ/tối đa 49; đối tác chỉ một người [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · hộp «Nhắn tin mới»]
- Kịch bản: kế hoạch tạo direct/group/partner/none; gom phòng ban A→Z [test: packages/messages-web/src/lib/cr178.test.ts » kế hoạch tạo: 1 người ⇒ direct, ≥ 2 ⇒ group, đối tác ⇒ partner, chưa chọn ⇒ none]
- Kịch bản: nhân viên chọn theo phòng ban, chip «Tới:», chọn 2 ⇒ «Tên nhóm»; tab Đối tác không có nhóm [test: e2e/cr127/j20-tin-nhan-danh-ba.spec.ts » «Nhắn tin mới»: chọn ≥ 2 người ⇒ «Tên nhóm» bắt buộc]

## Khung chat
#### Yêu cầu: Khung chat — theo ngày, gửi, thu hồi, «Đã xem», quyền theo vai
Tin theo ngày, tải thêm theo trang; tin đang gửi mờ, lỗi bấm gửi lại. Tin liên tiếp cùng người (cách ≤ 5 phút) gộp nhóm: avatar + tên một lần (nhóm chat), giờ dưới tin cuối nhóm. Vạch «Tin chưa đọc» ở tin đầu của người khác sau mốc đọc lúc mở; mở cuộc có tin chưa đọc ⇒ cuộn tới vạch. Đang cuộn lên mà có tin mới của người khác ⇒ không kéo xuống, hiện «↓ n tin mới». «Đã xem» = avatar nhỏ người đã đọc tới tin cuối của mình (nhóm tối đa 3 + «+N»). Nút «⋯» trên tin: «Sao chép» (toast «Đã sao chép») cho tin còn chữ; «Thu hồi» chỉ tin của mình, vẫn hỏi lại. Cuộc `partner`: đầu khung chat dòng 1 tên người, dòng 2 công ty + chức vụ (cắt «…», tooltip); KHÔNG có nút «Bảng tin <Công ty>» (thay CR-169 P11 phía UI; API bài công khai giữ nguyên); cuộc chỉ đọc thay ô soạn bằng câu giải thích. Chỉ chủ nhóm đổi tên/thêm/bớt, mọi thành viên rời. Ô soạn: chữ ở trên, hàng nút cố định ở đáy (đính kèm + emoji trái, Gửi phải), cao tối đa ~6 dòng rồi cuộn.
- Kịch bản: gộp tin liên tiếp cùng người [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · gộp tin liên tiếp cùng người]
- Kịch bản: vạch «Tin chưa đọc» đúng mốc [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · vạch «Tin chưa đọc» và «n tin mới»]
- Kịch bản: đếm «n tin mới» chỉ tin người khác chưa thu hồi [test: packages/messages-web/src/lib/cr178.test.ts » đếm tin mới của người khác sau mốc đã thấy (bỏ tin mình, tin thu hồi)]
- Kịch bản: «Đã xem» chỉ người khác đã đọc tới tin cuối của mình [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · «Đã xem» bằng avatar]
- Kịch bản: người nhận chỉ có «Sao chép», người gửi thêm «Thu hồi» [test: packages/messages-web/src/lib/cr178.test.ts » CR-178 · «⋯» trên tin: quyền hiện Sao chép / Thu hồi]
- Kịch bản: Hà (người nhận) chỉ «Sao chép», Vy thu hồi ⇒ hai bên chỉ còn «Tin nhắn đã được thu hồi» [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J4]
- Kịch bản: nút Gửi và Đính kèm cùng một hàng ở đáy ô soạn [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR172-J1]

#### Yêu cầu: Ô soạn: emoji, dán ảnh, kéo thả
Nút emoji (Frimousse) cạnh «Đính kèm»: bảng chọn (tìm, nhóm, «Dùng gần đây», màu da), chọn ⇒ chèn tại con trỏ, đóng bảng, focus về ô soạn; Esc đóng. Dán ảnh/tệp (không kèm chữ) vào ô soạn hoặc thả tệp vào khung chat ⇒ vào danh sách đính kèm như chọn tệp (cùng kiểm loại/dung lượng, cùng câu lỗi); kéo tệp ⇒ lớp phủ «Thả tệp để gửi kèm». Ô khoá không nhận tệp.
- Kịch bản: chèn emoji thay vùng chọn/tại con trỏ, quá giới hạn thì không chèn [test: packages/messages-web/src/lib/composer.test.ts » insertAtCursor]
- Kịch bản: dán ảnh không chữ ⇒ lấy tệp; dán chữ thường ⇒ không đổi [test: packages/messages-web/src/lib/composer.test.ts » tệp từ dán / kéo thả]
- Kịch bản: «Dùng gần đây» lên đầu, bỏ trùng, tối đa N [test: packages/messages-web/src/lib/composer.test.ts » dùng gần đây]
- Kịch bản: A chèn emoji + dán ảnh rồi gửi; B (người nhận) thấy tin [test: e2e/cr127/j18-tin-nhan.spec.ts » A chèn emoji và dán ảnh rồi gửi, B thấy]

## Tìm và Ảnh & tệp
#### Yêu cầu: Tìm tin nhắn
Ô tìm đầu danh sách gõ ≥ 2 ký tự ⇒ chế độ tìm với tab «Tin nhắn» (tin khớp ở mọi cuộc người dùng thấy: tên cuộc, người gửi, thời gian, đoạn trích tô sáng; mới nhất trước, tải dần) và «Người». Bấm kết quả ⇒ mở cuộc, cuộn tới tin, tin nháy viền ~2 giây (giảm chuyển động: chỉ viền); cuộn xuống tải tiếp tin mới hơn. ‹ hoặc Esc thoát. Không khớp ⇒ «Không có tin nào khớp «…»»; lỗi ⇒ «Thử lại».
- Kịch bản: tô sáng cắt đúng 3 phần theo `match` [test: packages/messages-web/src/lib/find.test.ts » tô sáng theo match]
- Kịch bản: gộp trang kết quả bỏ trùng [test: packages/messages-web/src/lib/find.test.ts » gộp trang]
- Kịch bản: ghép trang quanh `around_seq` [test: packages/messages-web/src/lib/find.test.ts » trang tin quanh around_seq]
- Kịch bản: B (người nhận) tìm «bao gia» thấy tin «báo giá» của A, bấm ⇒ mở đúng tin; người ngoài cuộc không ra [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A]

#### Yêu cầu: Tìm trong một cuộc
Kính lúp ở đầu khung chat ⇒ ô tìm thay đầu khung, «2/5», ↑ (cũ hơn) ↓ (mới hơn), Enter / Shift+Enter; mỗi lần nhảy tới tin khớp của cuộc đó.
- Kịch bản: ↑↓ vòng quanh các kết quả [test: packages/messages-web/src/lib/find.test.ts » chuyển ‹ › và ↑↓]
- Kịch bản: tìm trong cuộc ra «1/1» [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A]

#### Yêu cầu: Ảnh & tệp của cuộc
Nút «Ảnh & tệp» ở đầu khung chat ⇒ Sheet bên phải (điện thoại: toàn màn) có tab «Ảnh» (lưới 3 cột chia theo tháng, tải dần) và «Tệp» (tên cắt giữa, dung lượng, người gửi, ngày; ô lọc tên trên phần đã tải). Mỗi mục có «Đến tin nhắn»; tệp có «Xem trước» (ảnh, PDF) và «Tải về».
- Kịch bản: ảnh chia theo tháng [test: packages/messages-web/src/lib/find.test.ts » chia ảnh theo tháng]
- Kịch bản: lọc tên không phân biệt hoa/dấu; tên dài cắt giữa giữ đuôi [test: packages/messages-web/src/lib/find.test.ts » lọc tên tệp]
- Kịch bản: B mở «Ảnh & tệp» thấy PDF của A, «Đến tin nhắn» về đúng tin [test: e2e/cr127/j18-tim-tin-nhan.spec.ts » B tìm «bao gia» ra tin của A]

## Xem tệp
#### Yêu cầu: Xem trước tệp toàn màn, khung cố định
Hộp lớn nền đen kín, cách mép màn hình 5px (không lộ giao diện dưới): ảnh (png/jpg/gif/webp) và PDF xem trong trang; Word/Excel/ZIP… chỉ «Tải về». Byte lấy qua hub-api ([tin-nhan-tim-kiem.md](tin-nhan-tim-kiem.md)), xem qua `blob:` (PDF trong iframe sandbox), thu hồi khi đóng; svg/html không bao giờ hiển thị. Có ‹ ›, «Đến tin nhắn», «Tải về», Esc đóng. Ảnh, thẻ tệp, chip tải lên và hộp xem có kích thước cố định từ đầu: lúc tải nền tối + vòng xoay (hộp xem ghi «Đang tải…» giữa hộp), tải xong ảnh hiện dần, khung không đổi cỡ; ảnh lỗi hiện ô lỗi cùng cỡ kèm «Tải về». Ảnh trong khung chat bấm vào mở trình xem của web-kit (`AttachGallery`; cũng cách mép 5px, nền đen).
- Kịch bản: chỉ ảnh raster và PDF xem được; svg, html, Word, Excel, ZIP ⇒ chỉ tải về [test: packages/messages-web/src/lib/find.test.ts » kiểu xem trước theo mime]
- Kịch bản: ‹ › không vòng [test: packages/messages-web/src/lib/find.test.ts » chuyển ‹ › và ↑↓]
- Kịch bản: trạng thái «đang tải»/«lỗi»/«sẵn sàng» theo URL và onLoad [test: packages/web-kit/src/attach-layout.test.ts » loadPhase đổi theo URL, onLoad và lỗi]
- Kịch bản: một ảnh có khung tỉ lệ và rộng tối đa cố định [test: packages/web-kit/src/attach-layout.test.ts » thumbFrame ảnh đơn có tỉ lệ và rộng tối đa cố định]
- Kịch bản: B bấm «Xem trước» PDF ⇒ hộp nền đen giữ nguyên kích thước trước và sau khi tải xong [test: e2e/cr179/khung-tep-co-dinh.spec.ts » xem trước tệp: hộp nền đen giữ nguyên kích thước trước và sau khi tải xong]

Nợ: tin realtime tới khi đang xem vùng cũ (còn `has_newer`) hiện ngay sau khoảng trống, tải tiếp khi cuộn tới đáy; code chết `lib/directory.ts`, `lib/collapse.ts`, `lib/company-filter.ts`; kit thiếu ô chọn riêng (dùng `<select>` thường trong «Nhắn tin mới») và Sheet cho «⋯» trên cảm ứng.
