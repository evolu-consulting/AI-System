# Community — nghiệp vụ

Nguồn: PDF 28/10/2026 (`docs/intake/community/source-pdf.txt`), Intake (`.../2026-10-28-intake.md`), CR-102/102a/102b. Trạng thái: đã chạy trên `platform/gd0` (c2d8eebf, đợt Community C1–C12, gộp 2026-10-28); **chưa deploy production**. Dòng "Gộp" ở từng mục = hành vi thực tế từ Delta các lát.

## 1. Nguyên tắc (kim chỉ nam)
1. Mọi thông tin chảy về chủ quản; NCC và người mua không thấy nhau, không liên hệ trực tiếp (R1).
2. Lưu giá phải nhanh hơn chép Zalo: bấm "Lưu báo giá" trên bài Cần bán của NCC là giá vào SP & Giá của Sổ Hợp Tác (SHT).
3. Hỏi là có câu trả lời (chatbot tra giá từ SP & Giá, luôn kèm nguồn + ngày).
Đo thành công: số báo giá lưu/tuần, tỉ lệ bài Cần bán của NCC được lưu giá, số câu hỏi giá chatbot trả lời được.

## 2. Vai và quyền (R2, R3, R5, R6; lát C1/C3)
Mỗi tài khoản thuộc một công ty; quyền gắn với công ty (nhân viên nghỉ không mang theo khách).
| Vai | Là ai | Được | Không được |
|---|---|---|---|
| Admin chủ quản | `role=tenant_admin` của tenant chủ quản (seed: demo-owner) | Mọi thứ: tạo công ty + user đối tác, gắn nhãn, Lưu báo giá, dùng SHT, cài đặt | — |
| Thành viên chủ quản | `role=member` (seed: demo-editor) | Đăng bài, bình luận, Lưu báo giá, hỏi chatbot, SHT theo quyền | Xoá đối tác; xuất DS đối tác / SP & Giá (R4: hiện không có route xuất, giữ nguyên) |
| Nhà cung cấp (NCC) | user `kind=external` của công ty đối tác nhãn NCC | Đăng bài Cần bán, bình luận trên bài chủ quản, xem bài chủ quản được chia sẻ | Thấy NCC/người mua khác; kết bạn; thấy giá đã lưu / điểm uy tín / SHT |
| Người mua | user `kind=external`, nhãn người mua | Đăng bài Cần mua, bình luận, xem bài chủ quản được chia sẻ | như NCC |
- Một công ty có thể mang nhãn `supplier | buyer | both`; **vai tính theo từng bài**, không cố định theo công ty (R5).
- Nhiều nhân viên của một công ty đối tác cùng thấy **một** luồng trao đổi (R6, D3). GĐ1 chỉ Admin chủ quản thêm/khoá user đối tác; công ty đối tác tự quản lý thành viên = GĐ2 (Câu 3).
- Gộp C1: bảng `admin.external_orgs`; cột `admin.users.kind` (`internal`|`external`), `external_org_id`, `deactivated_at`; `/auth/me` trả `kind`, `ext_org_id`; route `/admin/external-orgs*` + menu admin-web "Đối tác". `POST /admin/groups/:id/members` với user ngoài ⇒ 422; `PATCH /admin/users/:id` đặt role ≠ member cho user ngoài ⇒ 422; `unlock` user đã vô hiệu ⇒ 409; `PUT /admin/org/managers|departments/:id` với user ngoài ⇒ 422; tạo công ty đối tác ở tenant platform ⇒ 422. Vô hiệu công ty ghi audit từng user; `POST /admin/external-orgs/:id/reactivate` + nút "Mở lại" (C2).
- D1: đối tác = user trong tenant chủ quản với `admin.users.kind='external'` + `external_org_id` (CR-102a); mọi tra "user thuộc công ty đối tác nào" qua MỘT port `ExternalOrgResolver`.

## 3. Mạng hình sao và kết bạn (R7, R9–R13; lát C1/C3)
- Chỉ chủ quản kết bạn; không có nút kết bạn phía đối tác. Không có kết nối trực tiếp đối tác–đối tác (GĐ3 ghi ý tưởng).
- Admin tạo công ty đối tác ở trang quản trị ai-admin (ADM-FR-75): tên công ty, người dùng, tên đăng nhập, mật khẩu tạm. **ai-admin chỉ tạo công ty + user** (Câu 2); nhãn NCC/mua/cả hai, nhóm hàng quan tâm, liên kết đối tác SHT đặt ở **Community › Đối tác** (chỉ Admin chủ quản).
- Tạo xong là bạn bè ngay (R11), không mời/chấp nhận. Admin tự gửi thông tin đăng nhập ngoài app; lần đầu đăng nhập đổi mật khẩu (`must_change_password`, R12).
- Quên mật khẩu: Admin đặt lại mật khẩu tạm. Khoá tạm: dùng khoá user có sẵn.
- **Xoá/rời (Câu 9, R13):** không xoá cứng; vô hiệu user + huỷ kết bạn; đối tác mất quyền xem bài; bài/bình luận của họ giữ, hiện "đối tác đã rời"; giá đã lưu giữ nguyên.
- Mời qua SĐT/email/link = GĐ2 (R14).

## 4. Loại bài và thao tác (R31–R35; lát C5)
| Loại | Ai đăng | Trường bắt buộc | Ai thấy |
|---|---|---|---|
| Cần bán | chủ quản, NCC | sản phẩm, số lượng, giá hoặc "liên hệ" | bài chủ quản: bạn bè được chọn; bài NCC: chỉ chủ quản |
| Cần mua | chủ quản, người mua | sản phẩm, số lượng, khu vực, ngày cần | bài chủ quản: bạn bè được chọn; bài người mua: chỉ chủ quản |
| Thông báo | chỉ chủ quản | nội dung | bạn bè được chọn |
Không có loại "Cần giá" (Q3). Tạo bài: form ngắn + nội dung tự do + tối đa 10 ảnh, 2 video (Filebox). "Dán mô tả, AI điền form" = COULD cuối đợt (Câu 7).
- Gộp C5: app `apps/community-web` (dev cổng 3400, prod `:18435` → host community) + contract `@ai/contracts/community`; đối tác vào bằng SSO app `community` (cookie `ai_rt_community`), không dùng phiên Sổ Hợp Tác (C3). Bản build production không chứa dữ liệu mẫu (`__COMMUNITY_MOCK__`, `check:bundle` báo lỗi).
- **Đăng nhập (fix-community-login):** community-web có màn Đăng nhập riêng (Mã công ty / Tên đăng nhập / Mật khẩu; đổi mật khẩu lần đầu). `/sso` chưa có phiên ⇒ `/login?next=/sso?…` (chỉ đường dẫn cùng origin, không open redirect) ⇒ xin mã ⇒ đích = `target_url` catalog admin-api. Chủ quản phải thuộc Group `community-owner`, thiếu ⇒ 403 `PACK_FORBIDDEN`.
- **Bảng tin** là trang đầu: chủ quản thấy cung cầu tổng hợp từ mọi bạn bè; đối tác thấy bài chủ quản được chia sẻ + bài của mình.
- Sửa: người đăng sửa mọi trường; hiện nhãn "đã sửa"; nếu chủ quản đã lưu báo giá từ bài ⇒ báo chủ quản (R27, mục 7).
- Lưu trữ / bỏ lưu trữ: ẩn khỏi bảng tin người khác, giữ bình luận. Đánh dấu đã xong: Cần mua có hàng / Cần bán hết; tự lưu trữ.
- Xoá: vĩnh viễn bài + bình luận, có bước xác nhận; giá đã lưu giữ, link ghi "bài đã xoá".
- Tự hết hạn: mặc định 30 ngày; trước 3 ngày hỏi người đăng gia hạn hay lưu trữ.
- Chủ quản ẩn được bài/bình luận của đối tác (spam, sai), không sửa nội dung họ (R36).
- Lọc: Cần bán / Cần mua / Lưu trữ, nhóm hàng, khu vực, khoảng giá, người đăng. Tìm chữ thường; "tên gọi khác" (AI ghép) = GĐ2 (R40, Câu 7).
- Đăng trùng một hàng nhiều lần ⇒ gợi ý cập nhật bài cũ: COULD (Câu 8).
- Trang công ty (icon user, R41): chủ quản = SHT (5 trang, chỉ chủ quản, mở sang contracts-web, D5/Câu 6) + Bài của tôi; đối tác = hồ sơ công ty + bài + bình luận của họ, không có SHT.

## 5. Người xem bài chủ quản (D2, R32; lát C3/C5)
Khi chủ quản đăng, chọn người xem: tất cả bạn bè / chỉ NCC / chỉ người mua / theo nhóm hàng / từng công ty. Mặc định: Cần bán ⇒ người mua quan tâm nhóm hàng đó; Cần mua ⇒ NCC nhóm hàng đó; Thông báo ⇒ tất cả bạn bè. **Trần = bạn bè của chủ quản** (không bao giờ vượt). Bài lưu trữ/ẩn: xem `hien-thi.md`. Gộp C3: RLS thực thi ở DB (`visibility.rls.int.test.ts`, HT-01…50, HT-70…73).

## 6. Bình luận riêng theo đối tác (D3, R37, R38; lát C6)
- Trên bài chủ quản, mỗi cặp (bài × công ty đối tác) là **một luồng riêng** như nhắn tin gắn bài; RLS theo `external_org_id`. Đối tác chỉ thấy bình luận của công ty mình và câu trả lời gửi cho mình; chủ quản thấy tất cả.
- Chủ quản hỏi thêm giá/số lượng ngay trong bình luận; giá NCC trả lời trong bình luận lưu được bằng nút Lưu báo giá trên bình luận (Q3, thay "qua chatbot").
- Người viết sửa/xoá bình luận của mình; chủ quản ẩn mọi bình luận trên bài của mình.
- Bài của NCC/người mua (do đối tác đăng): luồng gồm chủ quản + chính công ty đó.

## 7. Che liên hệ và chống đi tắt (D4, R39, R46; lát C4, C11)
- Bài và bình luận do đối tác viết được dò **lúc ghi**: SĐT, email, link Zalo/Facebook, website, MST, **tên công ty khác** (khác với đối tác đó). Lưu **raw + masked**; đường đọc của user ngoài chỉ lấy masked; chủ quản thấy raw. Nhắc người đăng khi dò thấy (không chặn đăng).
- Che áp dụng cho mọi người trừ chủ quản. Nội dung do chủ quản viết gửi đối tác không bị che (chủ quản tự chịu trách nhiệm).
- Ảnh NCC: AI kiểm logo/tên/SĐT in trên ảnh; chủ quản được cảnh báo trước khi dùng lại ảnh (C11, cảnh báo, không chặn).
- Chủ quản không chia sẻ/chuyển tiếp nguyên bài đối tác; chỉ có "Đăng lại dưới tên mình": nội dung chuẩn hoá, không tên người đăng gốc, giá do chủ quản đặt (C11).
- Nút Lưu báo giá, dòng "Đã lưu báo giá", gợi ý dưới bài (giá vốn, uy tín, hàng đang có) **chỉ chủ quản**; API user ngoài **không trả cờ** nào (R16, R29). Xuất dữ liệu: chưa có route; thêm sau thì ghi nhật ký mọi lần xuất.
- Gộp C3/C4: cả trường form (giá, SL…) của đối tác cũng được che. Audience tính **động lúc đọc** (đổi nhãn ⇒ đổi người xem ngay).
- Gỡ thành viên chủ quản ⇒ mất quyền ngay; bạn bè, bài, giá thuộc công ty (R47, đã có).

## 8. Lưu báo giá (R15–R28; lát C7, CR-102b)
**Nút**: góc trên phải bài, cạnh nhãn "Cần bán"; chỉ trên bài Cần bán của NCC (và trên bình luận của NCC, Q3); chỉ chủ quản thấy (Admin và thành viên). Không có trên bài Cần mua, bài của chính chủ quản, hoặc phía đối tác.
**Luồng** (R17): bấm Lưu báo giá ⇒ form mở dưới nội dung bài, điền sẵn từ bài: sản phẩm (gợi ý SP khớp = tìm chữ, GĐ1), NCC, giá, đơn vị, VAT, loại (Mua mới / Gia hạn), ngày. Sửa nếu cần; đổi SP hoặc "Tạo sản phẩm mới". Form so với giá đã ghi nhận của SP: bằng / rẻ hơn / đắt hơn bao nhiêu, hoặc "giá đầu tiên". Bấm Lưu ⇒ giá vào "Các giá đã ghi nhận" (nguồn **Báo giá**, `product_supplier_prices.source='quote'`) kèm link về bài. Bài hiện "Đã lưu báo giá vào SP & Giá" + nút Xem (chỉ chủ quản).
| R | Quy tắc |
|---|---|
| R15 | Một cách thu giá duy nhất, dùng cổng `SupplierQuoteWriter` (ADR-0031) vào `suppliersUsecase.save`; community không import contracts |
| R18 | So giá cùng đơn vị; cảnh báo khi lệch > 30% so với giá đang có; cảnh báo khi khác VAT |
| R19 | Cột `vat_included` trên từng giá (CR-102b). Đơn vị khác (thùng/lốc/kg): chủ quản sửa trong form, **chưa tự quy đổi** |
| R20 | Giá không hạn mặc định; tự đặt `expires_on`; quá hạn ⇒ nhãn "Đã hết hạn", chatbot/so sánh bỏ qua |
| R21 | Gỡ giá bất cứ lúc nào = gỡ **mềm** (`removed_at`), vẫn trong lịch sử, chatbot bỏ qua |
| R22 | Cùng NCC + cùng SP đã có giá nguồn Báo giá ⇒ giá mới thay (`replaced_at` ở giá cũ), cũ vào lịch sử; màn SHT chỉ thêm nhãn "Đã thay" |
| R23 | `origin_ref` = id bài + mặt hàng; bài xoá ⇒ link ghi "bài đã xoá", giá giữ nguyên |
| R24 | NCC chưa có trong Đối tác ⇒ tạo đối tác vai NCC, điểm MỚI (qua cùng cổng ghi) |
| R25 | Lưu báo giá **không** đổi kho, giá vốn, điểm uy tín (bảng giá NCC tách khỏi `stock_moves`); chỉ HĐ và mốc trong SHT làm việc đó |
| R26 | Bài nhiều mặt hàng: lưu từng mặt hàng một giá; nút đổi thành "Lưu thêm báo giá" |
| R27 | NCC sửa giá bài đã lưu ⇒ báo chủ quản (chuông); giá cũ giữ tới khi chủ quản lưu lại |
| R28 | Hai thành viên cùng lưu một bài: người sau thấy "đã lưu bởi … lúc …", vẫn lưu đè được |
| R29 | NCC **không biết** bài đã được lưu: không thông báo, không dấu hiệu, API không trả |
- Bài Cần bán thiếu giá ("liên hệ"): vẫn đăng; nút vẫn có; chủ quản hỏi trong bình luận rồi tự nhập giá.
- Tên hàng khác danh mục: gợi ý SP khớp nhất; chủ quản chọn hoặc tạo SP mới.
- Gộp C7b (migration community `0004_quote_saves`): route `POST /posts/:id/quote/preview`, `POST /posts/:id/quote`, `GET /quote/match`; gợi ý `hostHint` + `quotes` ở feed chỉ cho chủ quản (một `HostBookReader.read` mỗi trang; không quyền đọc contracts ⇒ bỏ gợi ý, không lỗi). Ghi qua `packs/community-wire.mount.ts` (`communityPorts`, ADR-0031).
  - D10 dấu "đã lưu" = bảng `community.quote_saves` (RLS RESTRICTIVE chỉ chủ quản), JSON đối tác y hệt trước/sau lưu. D11 `posts.edited_at`, `posts.price_edited_at`; chuông R27 khi `price_edited_at` đổi và `quote_saves.notify_price_edit`. D12 NCC do server suy (công ty đăng bài / công ty luồng + `party_key`); nguồn hợp lệ: Cần bán của đối tác, hoặc bình luận đối tác trên Cần mua của chủ quản (khác ⇒ 422). D13 khoá lưu đè `(post, item_idx, comment)`; preview trả `existing {by, at}`; cổng ghi và dấu lưu là hai tx. D14 VAT mặc định form = "đã gồm VAT"; `item_idx` mặc định 0.
  - R18 so với giá đã lưu rẻ nhất cùng loại + đơn vị (D4); R22 thay theo NCC + loại (D2); R24 vai NCC `manual` (D5). SHT SP & Giá: xem `sht/sp-va-gia.md`.
- CR-102b: migration contracts 0066 cộng cột (`vat_included`, `expires_on`, `replaced_at`, `removed_at`, `origin_ref`); không thêm màn mới.

## 9. Đọc từ SHT (R45, D5; lát C8)
Gộp C8: lô ≤ 50 gợi ý (id/tên) ⇒ SP khớp (đúng → tiền tố) + tồn + BQ + giá ghi nhận + band uy tín; chỉ `kind=internal` có quyền đọc gói. `stockHolders(tenant, product)` = 1 tx sổ (2 câu) + 1 câu quyền đọc theo tập, không vòng từng chủ quản; hạn giá theo ngày tenant (`timeZoneOf`), không `current_date`; tab NCC & giá trần 200 dòng ưu tiên dòng còn hiệu lực.
Community **đọc** (qua cổng `HostBookReader`): hàng đang giữ, giá vốn bình quân, giá đã ghi nhận, điểm uy tín — để gợi ý dưới bài và cho chatbot; **chỉ chủ quản**. Community **ghi** vào SHT chỉ một chỗ: Lưu báo giá. SHT giữ nguyên nghiệp vụ.

## 10. Thông báo (R44; lát C9)
Chỉ trong app (chuông kit `notify.enqueue`), không Zalo/SMS/email. Bấm thông báo mở đúng chỗ (bài với bình luận đã mở, hoặc form Lưu báo giá). Mỗi người bật/tắt từng loại ở Cài đặt (bảng tuỳ chọn trong community).
| Sự kiện | Ai nhận | Mặc định |
|---|---|---|
| Có bình luận trên bài của mình | người đăng | Bật |
| Có người trả lời bình luận của mình | người bình luận | Bật |
| NCC đăng bài Cần bán mới | chủ quản | Bật |
| Người mua đăng bài Cần mua mới | chủ quản | Bật |
| Bài Cần mua khớp sản phẩm đang có | chủ quản | Bật |
| NCC sửa giá trên bài đã lưu báo giá | chủ quản | Bật |
| Bài sắp tự hết hạn (3 ngày) | người đăng | Bật |
| Tổng hợp hằng ngày 8:00 (bài mới, Cần bán chưa lưu) | chủ quản | Tắt, bật được (COULD) |
Gộp C9/fix-review: chuông phát **sau commit** (`communityEvents.emit*` mở tx hệ thống riêng; lỗi phát chỉ log `community-notify-failed`). Chuông bình luận: chủ quản còn quyền gói, đối tác thuộc công ty còn hiệu lực; vòng nhắc hết hạn lọc tương tự. Migration community `0003` (notify).
Nhắc "đối tác chưa đăng nhập 7 ngày" cho Admin: COULD (Câu 8).

## 11. Chatbot (R42, R43; lát C10)
- **Chủ quản**: tool community trên cùng trợ lý `assistant` (một trợ lý chung), surface `community` + dock; nút nổi mọi trang, biết ngữ cảnh trang (bài/SP đang xem). Việc: tra giá ("Giá chữ ký số USB Token?": liệt kê NCC, giá, nguồn Đã mua/Báo giá/Giá thị trường, ngày, uy tín); so sánh (cùng đơn vị, ghi rõ VAT); lưu báo giá (GĐ1 chỉ **dán văn bản Zalo** ⇒ bóc tách ⇒ mở form điền sẵn; ảnh/PDF = GĐ2, Câu 4); tóm tắt ("Hôm nay có gì mới?"); tìm đối tác theo nhóm hàng/khu vực/uy tín.
- Quy tắc chung: mọi con số có nguồn + ngày; không có dữ liệu ⇒ "chưa có giá", không đoán; bỏ giá hết hạn/gỡ; chỉ soạn, lưu giá/đăng bài luôn cần người bấm xác nhận; câu hỏi ngoài phạm vi chuyển cho chủ quản; bóc tách không chắc ⇒ đánh dấu trường chưa chắc trong form.
- **Đối tác: không có chatbot ở GĐ1** (Câu 5; C2 chặn). Thiết kế GĐ2: đăng bài bằng lời, hỏi "bài của tôi có ai hỏi chưa?", không bao giờ nói về đối tác khác / giá vốn / giá đã lưu / SP & Giá.

## 12. Ngoài phạm vi GĐ1 (R14, ghi để khỏi nhầm)
Mời qua SĐT/email/link; kết nối trực tiếp trả phí; nhiều chủ quản; thu phí thuê bao / gói AI theo lượng; hỏi giá nhiều NCC cùng lúc; gửi báo giá cho khách; tự quản lý thành viên của công ty đối tác; lưu giá từ ảnh/PDF; chatbot đối tác; tự ghép tên SP; giao hàng/hoá đơn (quy trình của chủ quản). Ngành GĐ1: chữ ký số + vật tư đóng gói (seed trên tenant `demo`).

## 13. Bề mặt phải chặn user ngoài (C2, mỗi dòng một int)
Gộp C2: tường lửa hub-api trả 403 `FORBIDDEN` ngoài `/pack/community*` và `/notifications`; admin-api cho đối tác chỉ: hồ sơ, đổi mật khẩu, đăng xuất, mã SSO, app/portal của mình; `/directory`, `GET /pack/<k>/members`, người được giao HĐ không liệt kê user ngoài; `GET /me/apps` + `/me/portal` của đối tác chỉ Community, `chat=false`; GUC `app.user_kind` trong `withPackScope`; contracts 0067 policy `ext_deny`; admin 0029 trigger. Bảng contracts mới sau 0067 phải có policy `ext_deny`. Danh sách:
pack guard (chỉ gói trong `EXTERNAL_PACKS={community}`, bỏ qua Group) · `chat-gate` (không Chat App) · agent grants `tenant` + agent mặc định/dự phòng · `/directory` · kit members/pickers · portal/app catalog + `default_app` · admin-web/admin-api (chỉ `/me`, đổi mật khẩu) · RLS `contracts` phòng thủ (`kind=external` ⇒ 0 hàng) · quota/usage tính vào tenant chủ quản (ghi nhận, không chặn).

## Chưa rõ
1. Nhãn "đã hết hạn" cho giá **thay** vs **hết hạn** cùng lúc: mặc định đề xuất "Đã thay" thắng.
2. Thông báo cho "chỉ NCC": mặc định hợp lệ (D2).
3. Đối tác thấy bài của mình khi chủ quản ẩn? Xem `hien-thi.md` Chưa rõ #1.
4. Tên công ty "khác" để che: chỉ `external_orgs` hay cả danh sách đối tác SHT? (C4 chưa chốt).
5. **SSO login-CSRF nonce:** luồng `/sso` chưa có nonce chống login-CSRF (review security cuối đợt; chưa làm).
6. **C11b vision:** kiểm logo/tên/SĐT trên ảnh NCC chờ `ai-client` hỗ trợ ảnh (vision); chưa làm.
7. **HD-NFR-01:** facets danh sách đo 52–54 ms so với ngưỡng 50 ms (ngoài ngân sách nhẹ).
8. **Host community:** tên miền/DNS/TLS chưa có; `APP_URL_COMMUNITY` đặt khi deploy.
9. **Hưng Thịnh:** ánh xạ `party_key` cho đối tác Hưng Thịnh chưa được xác nhận.
10. Mở lại công ty đã vô hiệu có (C2); tự quản lý thành viên đối tác = GĐ2. Điều hướng "mở SHT" từ community-web sang contracts-web (phiên) chưa chốt. Mockup Community của người dùng chưa có.