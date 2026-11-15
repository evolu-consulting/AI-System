# cr172-ui-align — CR-172 (UI: căn chỉnh, avatar + tên, lọc Tin nhắn mặc định, trạng thái trống)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md

#### Yêu cầu: Bảng tin — ô đăng bài thẳng mép với cột (CR-172)
Ô đăng bài không có đệm ngang riêng của khối dính: mép trái/phải trùng thanh tab và thẻ bài cùng cột (thẳng hàng với khối «Bộ lọc» bên phải).
- Kịch bản: ô đăng bài và thanh tab có cùng mép trái/phải [test: e2e/community-web/composer.cm.ts » CR172 · ô đăng bài thẳng mép trái/phải với thanh tab của bảng tin]

### MODIFIED web/trang-thai-trong.md

#### Yêu cầu: Trạng thái trống/không tìm thấy căn giữa, phủ vùng nội dung (CR-172)
`EmptyState full` (trang lạ, không có quyền, chưa chọn gì) chiếm 100% rộng + cao vùng nội dung và căn giữa cả ngang lẫn dọc, không dồn lên đầu hay lệch trái. Khối trống trong bảng/danh sách giữ dạng khối trong trang.
- Kịch bản: full ⇒ 100% rộng/cao, căn giữa [test: packages/web-kit/src/ui/EmptyState.test.tsx » EmptyState]
- Kịch bản: trang lạ căn giữa vùng nội dung [test: e2e/community-web/composer.cm.ts » CR172 · trang lạ: khối «không tìm thấy» căn giữa ngang và dọc vùng nội dung]
- Kịch bản: Tin nhắn chưa chọn cuộc căn giữa [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR172-J3 · trạng thái «chưa chọn cuộc» căn giữa ngang + dọc, phủ 100% vùng nội dung]

### MODIFIED web/web-hop-nhat.md

#### Yêu cầu: Thanh trên hiện avatar + tên người đăng nhập (CR-172)
Workspace-web và Chat AI hiện ở thanh trên một chip chung (`UserChip`, web-kit): ảnh đại diện (CR-147/156) nếu có, không thì chữ cái đầu, kèm tên hiển thị.
- Kịch bản: thanh trên có avatar + tên người đăng nhập [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR172-J2 · thanh trên hiện avatar + tên người đăng nhập ở Sổ Hợp Tác]

### MODIFIED web/luong-thoi-gian-thuc.md

#### Yêu cầu: Tin nhắn — mặc định lọc theo công ty mình, ô soạn căn giữa (CR-172)
Vào «Tin nhắn» (Sổ Hợp Tác và Chat AI) chip lọc mặc định = công ty mình; «Tất cả» chọn tay hoặc `?company=all`. Nút Đính kèm và Gửi căn giữa theo chiều dọc với ô soạn.
- Kịch bản: rỗng/sai ⇒ công ty mình; `all` rõ ràng ⇒ tất cả [test: packages/messages-web/src/lib/partner-web.test.ts » CR-169 · bộ lọc công ty]
- Kịch bản: mặc định chip công ty mình, «Tất cả» hiện cuộc với đối tác [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR169-J3 · Vy: lọc chip công ty (Preschool / công ty mình) và tìm theo tên ngay trong danh sách cuộc]
- Kịch bản: Gửi và Đính kèm căn giữa với ô soạn [test: e2e/cr169/tin-nhan-cong-ty.spec.ts » CR172-J1 · Tin nhắn: nút Gửi và Đính kèm căn giữa theo chiều dọc với ô soạn, Sổ Hợp Tác và Chat AI cùng gói]

## Luật UI đề xuất
(Điều phối gộp vào `docs/CONVENTIONS.md` cuối đợt.)
1. **Nút cạnh ô nhập căn giữa theo chiều dọc**: hàng chứa ô nhập + nút (gửi, đính kèm, tìm…) dùng `items-center`, nút không có `margin` dọc riêng; chiều cao hàng do ô nhập quyết.
2. **Trạng thái trống / không tìm thấy căn giữa vùng nội dung**: dùng `EmptyState` web-kit (`full` cho cả trang/khung); không tự dựng khối trống lệch trái hoặc dồn lên đầu.
3. **Khối cùng cấp thẳng mép**: các khối cùng cột (ô đăng, thanh tab, thẻ) không có đệm ngang khác nhau ở lớp bọc; đệm nằm trong thẻ, không ở lớp bọc.
4. **Một chỗ nhận diện người đăng nhập**: avatar + tên ở thanh trên mọi app qua `UserChip` (web-kit).

## Quyết định trong lúc làm
- «Ô đăng bài padding ngang 0» hiểu là lớp bọc dính (`.stickytop`) và thẻ ô đăng không có đệm/lề ngang riêng; đệm trong thẻ giữ 16px.
- Tin nhắn: chưa biết công ty mình (`ownId` rỗng) ⇒ giữ `all` để không lọc theo id rỗng.
- `UserChip` tự lấy ảnh qua `/people/me` (một lần mỗi tab), lỗi ⇒ chữ cái đầu; thanh trên workspace-web chỉ hiện từ md (dưới md đã có menu tài khoản).
- Danh sách cuộc rỗng (`conv-empty`) giữ khối trong trang (không `full`) để không đổi tiêu đề thành h1.
