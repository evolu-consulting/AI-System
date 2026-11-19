# Nghiệp vụ đợt CR-187..192 (phản hồi UAT 19/11) — ĐÃ CHỐT 2026-11-19

Nguồn trình bày: Claude Docs https://claude.ai/artifact/2SukMRCS6r9cv3Kkcn7uAP (bản này là nguồn cho agent; lệch thì bản này + quyết định người dùng sau đó thắng).
Bản mẫu đã duyệt: CR-187/188/192 `docs/specs/CR-187/prototype.html` · CR-189 `docs/specs/CR-189/prototype.html` · CR-190 `docs/specs/CR-190/prototype.html` · CR-191 `docs/specs/CR-191/prototype.html`. Bản mẫu là đồ bỏ đi — chỉ để xem bố cục/luồng; spec này thắng khi lệch.
Intake + góp ý từng vòng: `docs/specs/CR-187/intake-2026-11-19.md`.
6 câu mở: người dùng chốt THEO MẶC ĐỊNH («bạn đã có đủ thông tin… implement», 19/11).

## CR-187 · Sửa nhanh + luật giao diện
- BR-187-1 Đổi mật khẩu ngay trong Sổ Hợp Tác (hộp thoại: hiện tại / mới / nhập lại), không chuyển sang trang quản trị. Luật độ mạnh như nền tảng hiện tại, hiện khi gõ. Sai mật khẩu hiện tại ⇒ lỗi trong hộp. Đăng xuất thiết bị khác: giữ hành vi API hiện tại (không đổi).
- BR-187-2 Thành viên & phòng ban chỉ người nội bộ công ty (không đối tác) ở danh sách và mọi ô chọn; hết lỗi «not allowed for partner».
- BR-187-3 Màu avatar khi không có ảnh: bảng 10 màu (phương án 1 bản mẫu CR-189: đậm chữ trắng; tối: nền nhạt chữ tối), cố định theo id tài khoản (băm), đổi tên không đổi màu; ảnh thắng màu; tương phản ≥ 4,5:1 sáng và tối; áp mọi nơi có avatar (web-kit).
- BR-187-4 Tin nhắn: trang không có thanh cuộn chung; tên công ty dài cắt «…» + tooltip, không tràn sang khung phải.
- BR-187-5 Công tắc «Cho công ty khác tìm thấy công ty mình» chuyển sang Sổ Hợp Tác › Đối tác, gỡ khỏi Admin; chỉ quản trị công ty; điều kiện bật giữ (tên pháp lý + MST); dùng API cũ.
- BR-187-6 Sửa/Xoá/Ẩn ở bài + bình luận: chỉ icon + tooltip + aria-label. Máy tính nút 28px cách 2px; điện thoại vùng bấm 44px, sát nhau. Quyền giữ nguyên.
- BR-187-7 Chế độ Tối: mọi chữ Community + Sổ Hợp Tác ≥ 4,5:1 cả hai chế độ; có test tự động đo tương phản token.
- BR-187-8 Luật cuộn (ghi `packages/web-kit/src/ui/kit/RULES.md`): (1) mỗi chiều một vùng cuộn, không lồng dọc; (2) trang thường: trang cuộn; (3) trang toàn màn (Tin nhắn, sơ đồ, màn ký): trang đứng, khung con cuộn (cờ toàn màn của Shell, bỏ `calc(100dvh-…)` viết cứng); (4) khung con chỉ cuộn khi tải dần hoặc > 8 mục; (5) `scrollbar-gutter: stable`.
- BR-187-9 Luật chống nháy (ghi RULES.md): (1) đổi tab/lọc giữ dữ liệu cũ làm mờ tới khi có mới; (2) số đếm không về 0 khi tải; (3) trạng thái chọn chỉ đổi màu nền/chữ, không đổi độ đậm/padding/viền; (4) khung chờ đúng kích thước, ảnh có `aspect-ratio`; (5) e2e đo bounding box trước/sau khi bấm. Sửa ngay chỗ đã biết: `useFeed.ts` `setData(null)` khi đổi tab (Community «Tất cả/Cần bán»).
- BR-187-10 Phông giao diện đổi sang **Inter** cho mọi app web (workspace, admin, chat, studio): thay Be Vietnam Pro ở `--font-sans` (globals.css), giữ dự phòng `"Segoe UI", system-ui, sans-serif`; nạp đủ subset `latin` + `vietnamese`, độ đậm 400/500/600/700; số dùng `tabular-nums`. Người dùng chọn Inter + đồng ý thêm gói `@fontsource/inter` (19/11, trang so sánh https://claude.ai/artifact/LrQ4cH7hNd35G37Y6SFkAq). Ảnh mẫu so ảnh (baseline e2e) sẽ đổi ⇒ cập nhật baseline trong cùng lát.

## CR-188 · Chữ ký + Kiểm tra tệp
- BR-188-1 Dòng dưới chữ ký = Họ tên · Chức vụ · Phòng ban (lấy sẵn từ hồ sơ, sửa được khi tạo). Màn tạo chữ ký không còn ngày tháng.
- BR-188-2 Mọi dấu ký trên giấy tờ LUÔN in «Ký ngày dd/mm/yyyy hh:mm» (giờ VN, giờ máy chủ lúc ký). Bỏ tuỳ chọn tắt ngày theo công ty. Giấy tờ đã ký trước không đổi.
- BR-188-3 «Gõ họ tên» có 6 phông: Dancing Script, Pacifico, Great Vibes, Allura, Lobster, Charm — tự host, OFL. Phông nào sai dấu tiếng Việt ⇒ bỏ khi code, ghi «Quyết định trong lúc làm».
- BR-188-4 Lịch sử chữ ký (đã có, không đổi hành vi): tạo mới ⇒ bản cũ «thôi dùng», không xoá. Danh sách phiên bản: số bản, ngày tạo, đang dùng. Ai xem: chính người đó + quản trị công ty.
- BR-188-5 «Giấy tờ đã ký bằng chữ ký này» trong Chữ ký của tôi: chọn một phiên bản ⇒ danh sách HĐ / phụ lục / giấy tờ khác ký bằng nó (qua `sign_marks.user_signature_id`), lọc loại + khoảng ngày, bấm mở. Chỉ hiện giấy tờ người xem có quyền mở.
- BR-188-6 Kiểm tra tệp (GIỮ — người dùng chốt): không cần biết số HĐ; tải tệp ⇒ so sha256 với MỌI giấy tờ đã ký của công ty (HĐ chính, phụ lục, khác, mọi phiên bản đã ký); không lưu tệp; không bao giờ so với công ty khác. Kết quả: (a) khớp ⇒ số HĐ, loại, đối tác, ngày giờ ký, nút «Mở hợp đồng»; (b) mở từ một HĐ mà khớp HĐ khác ⇒ «Tệp này là bản đã ký của HĐ khác: …»; (c) không khớp ⇒ «Tệp không khớp giấy tờ đã ký nào của công ty — có thể đã bị sửa hoặc không phải của công ty bạn». Lối vào: nút «Kiểm tra tệp» trên danh sách HĐ + mục «⋯» của từng HĐ; bỏ khỏi thanh bên. Ai dùng: ai vào được Sổ Hợp Tác; khớp HĐ người dùng KHÔNG có quyền xem ⇒ chỉ «Khớp một giấy tờ đã ký của công ty», không chi tiết, không nút mở.

## CR-189 · Người và sơ đồ
- BR-189-1 «Thành viên & phòng ban» mở tab «Sơ đồ tổ chức» trước, «Thành viên» sau.
- BR-189-2 Thẻ phòng: tên, avatar + tên trưởng phòng, «N người» (trực tiếp, gồm trưởng phòng), có phòng con thêm «· tổng M», hàng avatar nhân viên.
- BR-189-3 Component dùng chung «Danh sách avatar» (web-kit): tối đa 5 chồng nhau + «+n»; bấm mở danh sách (avatar, họ tên, chức vụ), cuộn khi > 8. Sửa RULES.md «tối đa 3» ⇒ 5.
- BR-189-4 Tab Thành viên: cột tên = avatar + họ tên + chức vụ.
- BR-189-5 Cấp quản lý: ô chọn avatar + tên, CHỈ trưởng phòng, gợi ý trưởng phòng của chính người đó, được để trống. Dữ liệu cũ giữ: người có cấp quản lý không phải trưởng phòng giữ nguyên + cảnh báo vàng. Ai đổi: như hiện tại. (Cấp quản lý quyết định ai thấy HĐ — chế độ `org`.)
- BR-189-6 Admin › Cơ cấu sửa trực tiếp trên sơ đồ; bỏ form «Thêm phòng»: «+» thêm phòng con (gõ tên tại chỗ, không trùng cùng cấp) · bấm tên đổi tên tại chỗ · «⋯»: Đổi trưởng phòng / Thêm-bớt thành viên / Chuyển phòng cha / Xoá. Mỗi người một phòng; chọn người phòng khác ⇒ chuyển sang; bỏ ⇒ về phòng cha; trưởng phòng của phòng khác phải đổi trước. Xoá chặn khi còn người/phòng con; phòng gốc không xoá; không chuyển vào con của chính nó. Máy tính kéo thả; điện thoại chỉ «⋯». Mọi thay đổi có «Hoàn tác» 6 giây (thực hiện thao tác ngược).

## CR-190 · Tin nhắn (phương án A)
- BR-190-1 Trang toàn màn; chỉ danh sách + khung chat cuộn; ô nhập dính đáy.
- BR-190-2 Trái: ô tìm (người, nhóm, công ty) · «Tất cả» / «Chưa đọc» có số · nhóm mở/thu thứ tự cố định: từng công ty đối tác (A→Z), «Nhóm chat», «Nội bộ»; đầu nhóm có tổng người + số chưa đọc. Bỏ hàng tab cũ.
- BR-190-3 Nhóm có tin chưa đọc mở sẵn, còn lại thu; nhớ mở/thu trên máy (localStorage).
- BR-190-4 Mỗi nhóm liệt kê MỌI người/nhóm luật hiện tại cho phép nhắn, kể cả chưa từng nhắn («Chưa có tin nhắn», không giờ). Không mở rộng ai được nhắn ai.
- BR-190-5 Nhóm mở hiện 15 dòng, «Xem thêm (n)» +15.
- BR-190-6 Sắp xếp: ghim trước → tin mới nhất → chưa từng nhắn theo tên A→Z. Gửi/nhận ⇒ dòng lên đầu nhóm, chỉ dòng đó chuyển động.
- BR-190-7 Trống, căn giữa: chưa chọn ⇒ hình + «Chọn một người để bắt đầu trò chuyện»; người chưa nhắn ⇒ avatar to, tên, chức vụ, công ty, «Chưa có tin nhắn. Gửi lời chào đầu tiên» + 3 câu chào gợi ý (bấm là gửi).
- BR-190-8 Mới: Ghim · Đánh dấu chưa đọc («⋯» trên dòng; điện thoại giữ lâu) · «↓ n tin mới» · nhãn ngày dính. Ghim + chưa đọc lưu theo người trên máy chủ (migration chỉ thêm).
- Không làm: tắt thông báo cuộc; nhớ mở/thu giữa các máy. «Nhắn tin mới», «Tìm trong cuộc» giữ.

## CR-191 · Bảng tin gộp (RLS/quyền ⇒ soát Opus)
- BR-191-1 Một bảng tin: bài công ty mình (luật người xem hiện có) + bài của công ty ĐÃ KẾT NỐI có công ty mình trong «Ai thấy bài» (tất cả đối tác / nhóm NCC-KH chứa mình / đích danh). Bỏ tab «Bảng tin công ty» riêng (CR-161). Ngắt kết nối ⇒ bài họ biến khỏi bảng tin. Bài «Tất cả đối tác» cũ trên prod hiện ngay khi lên (chấp nhận).
- BR-191-2 Mới nhất trước, không ưu tiên, không ghim; 20 bài/lần, tự tải khi cuộn; ảnh tải lười.
- BR-191-3 Đầu bài: avatar, tên, chức vụ, công ty + nhãn «Công ty mình»/«Đối tác», thời gian, ai thấy.
- BR-191-4 Bỏ cột phải (thẻ Đối tác, thẻ Bộ lọc, hàng chip loại). Máy tính: nút «Lọc» trên thanh dính; điện thoại: nút nổi đáy mở sheet. Lọc loại + nguồn (tất cả / công ty mình / đối tác / từng công ty), có số, «Xoá lọc».
- BR-191-5 Đầu bảng tin chỉ dòng «Viết bài…» ⇒ hộp thoại (điện thoại toàn màn); loại: Thông báo / Cần bán / Cần mua.
- BR-191-6 Thông báo không có hàng hoá/gợi ý. Cần bán/mua: ô Hàng hoá gõ được + gợi ý thả xuống (nguồn: Sản phẩm & Giá của công ty + hàng công ty đã đăng), chọn gợi ý điền sẵn đơn vị + đơn giá; số lượng, đơn vị, đơn giá (không bắt buộc). Bỏ nhãn «Gợi ý mẫu».
- BR-191-7 «Ai thấy bài» thay «Nhắc tên» + «chọn khách hàng xem»: Tất cả đối tác (mặc định) · Chỉ nội bộ · Nhà cung cấp · Khách hàng · Chọn công ty…; dưới ô «n/N công ty đối tác thấy bài». Không có «Công khai».
- BR-191-8 «@» trong thân bài và bình luận: danh sách avatar, họ tên, chức vụ, công ty; người được nhắc tô sáng + chuông. Nhắc người ngoài «Ai thấy bài» ⇒ hỏi: thêm công ty họ / bỏ nhắc; chưa chọn ⇒ chưa đăng được. Bỏ nút «Nhắc tên».
- BR-191-9 Tìm đối tác: người có quyền (BR-191-11) tìm cả công ty chưa kết nối đã bật «cho tìm thấy», vào trang công ty (ảnh bìa, giới thiệu, ngành, nơi; không có bài), «Mời kết nối» + lời nhắn. Người khác chỉ tìm đối tác đã kết nối.
- BR-191-10 Sổ Hợp Tác › Đối tác: Yêu cầu kết nối (Đồng ý / Từ chối + lý do) · Lời mời đã gửi (Thu hồi) · công tắc tìm thấy (BR-187-5) · cài đặt «Ai được tìm và mời đối tác mới». «Yêu cầu tham gia» của Community chuyển về đây. Đồng ý ⇒ bài họ vào bảng tin ngay.
- BR-191-11 Chỉ quản trị công ty đồng ý/từ chối/thu hồi/đổi cài đặt; vai khác xem khoá + lý do. Cài đặt 2 mức: Chỉ quản trị công ty (mặc định) · Mọi nhân viên.
- Không làm: ẩn bài đối tác khỏi bảng tin mình; quyền Sửa/Xoá/Ẩn giữ.

## CR-192 · Ảnh
- BR-192-1 Giao diện hồ sơ GIỮ NGUYÊN (nút bút, vị trí, kích thước). Chọn ảnh ⇒ hộp cắt (kéo chọn vùng, phóng 1–3×); đại diện khung tròn, bìa 3:1.
- BR-192-2 Thu nhỏ trên máy người dùng: đại diện 400×400 ≤ 150 KB; bìa 1200×400 ≤ 400 KB. Không từ chối ảnh lớn.
- BR-192-3 Chưa có ảnh bìa (cá nhân/công ty) ⇒ dải màu chuyển theo màu chính, không chữ, đẹp cả sáng/tối.
- BR-192-4 Không có «Dùng ảnh mẫu».
- BR-192-5 (HOÃN — người dùng 19/11: «không làm, để nghĩ thêm»; không chia lát) Ảnh nhanh (hiện ~3 s): tạo ảnh nhỏ (rộng ≤ 800px) khi tải ảnh bài; bảng tin hiện ảnh nhỏ, bấm mở gốc; tạo bù cho ảnh cũ (backfill); cache riêng tư 5 phút (bỏ `no-store`); mục tiêu < 1 s; đo trước/sau, báo số; kiểm cả Tin nhắn, hồ sơ, avatar.

## Ảnh hưởng chung
Migration chỉ thêm (backfill trong cùng thay đổi). Lên prod cùng đợt CR-181..186: backup, `verify:predeploy`, `verify:prod`, người dùng cho phép. Soát Opus: CR-187 (BR-2), CR-188, CR-189, CR-191.
