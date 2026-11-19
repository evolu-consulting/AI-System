---
id: cr191-composer-audience
lát: cr191-composer-audience
cr: CR-191
làn: đầy đủ
migration: pack-community 0027, 0029
phụ thuộc: cr191-audience-schema, cr191-feed-merge-rls, cr191-feed-ui
---
## Plan (ngắn)
BR-191-5/6/7/8: đầu bảng tin chỉ dòng «Viết bài…» ⇒ hộp thoại; hàng hoá gõ được + gợi ý; ô «Ai thấy bài» (thay «Nhắc tên» + chọn khách); «@» trong THÂN bài nhắc người, kể cả người công ty ĐÃ KẾT NỐI nằm trong «Ai thấy bài» (ghi chéo tenant qua DEFINER); nhắc người ngoài «Ai thấy bài» ⇒ hỏi Thêm công ty / Bỏ nhắc.

## Làm
- [x] Migration community `0027_cr191_mention_connected`: `post_mentions.user_tenant`; chính sách đọc `post_mentions_visible` chặt hơn (đối tác ngoài không thấy dòng có `user_tenant`); DEFINER `community.connected_audience(mode, tenants)` (công ty kết nối + cờ thấy) và `community.mention_tenants_ok(post, tenants)`.
- [x] Hub: `post-mention.service` (resolve người công ty khác, `assertSeen` gọi DEFINER trong tx ghi bài ⇒ 422 + rollback cả bài; gợi ý kèm chức vụ/công ty/`outside`), `post-mention.repo` (`user_tenant`, `mentionTargets`, `connectedAudience`…), `notify.events` (chuông tới người nhận ở tenant CỦA HỌ), `people-reader` (người tenant khác + chức vụ), routes `GET /audience-connected`, `GET /goods-suggest`; bình luận chưa nhắc chéo công ty (`allowForeign=false`, lát `cr191-cross-comment`).
- [x] Contract: `qty` không bắt buộc (Cần bán/mua), `MentionablePerson` {title, connected, tenantId, outside}, query {tenants, connected, outside, mode internal}, `ConnectedAudience*`, `GoodsSuggest*`.
- [x] Web: `Composer` (dòng «Viết bài…» ⇒ Dialog, toàn màn điện thoại), `GoodsCombo`, `AudienceField` (n/N), `MentionPicker` (hideButton, chức vụ + công ty, chip có chuông), `DraftFields` (Hàng hoá/Số lượng/Đơn vị/Đơn giá), domain `mentionsInBody`/`stripMention`/`audienceCounts`/`addCompany`, mock + http adapter; bỏ «Gợi ý mẫu» (`demo-products.ts`).
- [x] e2e viết: `e2e/community-web/cr191-composer-audience.cm.ts`; sửa `composer.cm.ts`.

## Không làm / Chạm
- Không làm: bình luận chéo công ty, ảnh thật người công ty khác (avatar tạm chữ cái đầu), trang tìm đối tác.
- Chạm: xem «Làm».

## Test tối thiểu
- int (evotest): `post-mention-connected.int.test.ts` + `post-mention.int.test.ts`, `comments.routes.int.test.ts`, `community.routes.int.test.ts`, `visibility.rls.int.test.ts` (không hồi quy).
- unit: `goods-suggest.service.test.ts`, `composer-audience.test.ts`, `post-mention.test.ts` (sửa).

## Quyết định trong lúc làm
- Nhắc người ngoài «Ai thấy bài»/công ty không kết nối ở API ghi ⇒ 422 `MENTION_USER_NOT_ALLOWED` (giữ mã cũ của CR-145), không 400; hỏi Thêm/Bỏ làm ở client dựa trên `outside` của gợi ý (`outside=1`).
- Người công ty khác đọc bằng hub scope hệ thống (`peopleReader`) theo id đã qua DEFINER; tên công ty lấy từ DEFINER (người dùng hub không đọc `admin.tenants`).
- «Thêm công ty vào» chuyển «Ai thấy bài» sang «Chọn công ty» có công ty đó (giữ công ty đã chọn); từ «Nhà cung cấp/Khách hàng/Chỉ nội bộ» chỉ còn công ty đó (+ đối tác đã chọn).
- Số lượng + đơn vị gộp «100 cuộn» vào `fields.qty` (không thêm trường); `qty` giờ không bắt buộc ở contract (BR-191-6).
- Mặc định «Ai thấy bài» = Tất cả đối tác với mọi loại bài (trước: Cần bán/mua theo nhóm hàng).
- Gợi ý hàng: «Sản phẩm & Giá» (`goods-catalog.mount.ts`: `contracts.products` (tên + đơn vị, không giá), cần quyền đọc gói contracts, một câu) gộp với «hàng công ty đã đăng» (một câu, tenant tường minh, chỉ bài còn hiệu lực), bỏ trùng tên, ≤ 8, tổng 2 câu cố định. Đơn giá gợi ý KHÔNG lấy từ giá nhập (`product_supplier_prices`: bài đăng hiện cho đối tác ⇒ lộ giá vốn, điều phối chốt 20/11); Sản phẩm & Giá hiện chưa có bảng giá BÁN ⇒ chỉ điền đơn vị, đơn giá để trống (chỉ «hàng đã đăng» kiểu Cần bán có giá đã công khai thì gợi ý giá). Cần mua: không điền đơn giá/ngân sách.
- Soát Opus #1: sửa bài có `audience` mà không gửi `mentionUserIds` ⇒ `pruneForeignMentions` (một câu trong tx sửa bài) xoá người công ty kết nối không còn đạt `mention_tenants_ok`.
- Soát Opus #2: chuông kiểm lại ngay lúc gửi bằng DEFINER biến thể hệ thống `community.mention_tenants_live` (migration 0029, `when` 1807000720000; không đòi `app.user_id`).
- Soát Opus #7: `emitPostMentions` chạy MỘT vòng `uow.system(tenant người nhận)` cho mỗi công ty (≤ 10 người nhắc ⇒ vài công ty), vì `notify.enqueue` chỉ nhận người cùng tenant của tx; tenant người nhận đọc từ `post_mentions.user_tenant` (đã qua DEFINER lúc ghi), không từ lời gọi, và chỉ gửi nếu `mention_tenants_live` còn đạt.
- Soát Opus #3/#4: `escapeLike` thoát đúng (backslash, %, _); `tenants` ở contract phải là danh sách UUID (sai ⇒ 400).
- `composer-pref.ts` (nhớ mở/thu gọn) không còn dùng, để nguyên (nợ nhỏ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Hộp «Viết bài…», hàng hoá và «Ai thấy bài»
Đầu bảng tin chỉ có dòng «Viết bài…» (avatar + ô giả); bấm mở hộp thoại (điện thoại toàn màn) với loại bài Thông báo / Cần bán / Cần mua. Thông báo không có phần hàng hoá. Cần bán/Cần mua: ô Hàng hoá gõ được có gợi ý thả xuống (Sản phẩm & Giá của công ty + hàng công ty đã đăng), chọn gợi ý điền sẵn đơn vị và đơn giá; số lượng, đơn vị, đơn giá không bắt buộc; không còn nhãn «Gợi ý mẫu». Ô «Ai thấy bài»: Tất cả đối tác (mặc định) · Chỉ nội bộ · Nhà cung cấp · Khách hàng · Chọn công ty…; dưới ô «n/N công ty đối tác thấy bài». Không còn nút «Nhắc tên» riêng và ô chọn khách.
- Kịch bản: khi xem đầu bảng tin thì chỉ có dòng «Viết bài…», bấm mở hộp có 3 loại bài và Thông báo không có hàng hoá [test: e2e/community-web/cr191-composer-audience.cm.ts » đầu bảng tin chỉ dòng «Viết bài…», bấm ⇒ hộp thoại có 3 loại bài, Thông báo không có hàng hoá]
- Kịch bản: khi gõ hàng hoá thì có gợi ý và chọn gợi ý điền sẵn đơn vị + đơn giá [test: e2e/community-web/cr191-composer-audience.cm.ts » Cần bán: gõ hàng hoá có gợi ý thả xuống, chọn gợi ý ⇒ điền sẵn đơn vị + đơn giá, số lượng/đơn vị/đơn giá không bắt buộc]
- Kịch bản: khi mở «Ai thấy bài» thì mặc định Tất cả đối tác và có «n/N công ty đối tác thấy bài» [test: e2e/community-web/cr191-composer-audience.cm.ts » «Ai thấy bài»: mặc định Tất cả đối tác, dưới ô có «n/N công ty đối tác thấy bài», Chỉ nội bộ ⇒ 0]
- Kịch bản: khi xem ở điện thoại thì hộp soạn bài toàn màn [test: e2e/community-web/cr191-composer-audience.cm.ts » điện thoại: hộp soạn bài toàn màn]
- Kịch bản: khi bài chỉ có tên hàng thì đăng được (số lượng, đơn vị, đơn giá gộp, không bắt buộc) [test: apps/workspace-web/src/modules/community/domain/composer-audience.test.ts » hàng hoá: chỉ bắt buộc tên hàng, số lượng + đơn vị gộp «100 cuộn», Thông báo không gửi hàng]
- Kịch bản: khi đếm công ty thấy bài thì tính đối tác chưa rời + công ty kết nối [test: apps/workspace-web/src/modules/community/domain/composer-audience.test.ts » n/N: đối tác chưa rời + công ty kết nối, chỉ nội bộ ⇒ 0/N]
- Kịch bản: khi chọn gợi ý hàng thì đơn vị lấy từ số lượng đã đăng, Sản phẩm & Giá trước, khử trùng, tối đa 8 [test: apps/hub-api/src/modules/packs/community/adapters/goods-suggest.service.test.ts » Sản phẩm & Giá trước, hàng đã đăng sau, khử trùng theo tên không phân biệt hoa/thường, ≤ 8]
- Kịch bản: khi cổng Sản phẩm & Giá lỗi thì vẫn gợi ý hàng đã đăng, đối tác ngoài không có gợi ý [test: apps/hub-api/src/modules/packs/community/adapters/goods-suggest.service.test.ts » cổng Sản phẩm & Giá lỗi ⇒ vẫn trả hàng đã đăng, đối tác ngoài ⇒ rỗng]
- Kịch bản: khi gợi ý hàng đã đăng thì kèm đơn vị và đơn giá, một dòng mỗi tên, gõ để lọc [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » gợi ý hàng hoá: hàng công ty đã đăng kèm đơn vị + đơn giá, khử trùng, gõ để lọc, đối tác ngoài ⇒ rỗng]
- Kịch bản: khi xem n/N thì máy chủ trả công ty kết nối và cờ thấy bài theo chế độ [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » «n/N công ty đối tác»: audience-connected trả công ty kết nối + cờ thấy theo chế độ, đối tác ngoài ⇒ rỗng]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: «@» trong thân bài, kể cả người công ty đã kết nối
«@» trong thân bài mở danh sách người (avatar, họ tên, chức vụ, công ty); người được nhắc tô sáng + chuông. Người của công ty đã kết nối được nhắc khi công ty họ nằm trong «Ai thấy bài»; nhắc người ngoài «Ai thấy bài» thì hỏi «Thêm <công ty> vào» hoặc «Bỏ nhắc», chưa chọn thì chưa đăng được. Máy chủ chỉ nhận người công ty kết nối còn kết nối và thuộc «Ai thấy bài» (ngoài ⇒ 422, cả bài không tạo); chuông tới đúng người ở công ty của họ, không tới người đăng hay người không được nhắc; đối tác trong cộng đồng không thấy tên người công ty khác. Bình luận chưa nhắc được người công ty khác.
- Kịch bản: khi nhắc người công ty kết nối trong «Tất cả đối tác» thì ghi và chuông tới đúng người [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » người công ty kết nối ∈ «Tất cả đối tác» ⇒ 201, lưu user_tenant, chuông tới ĐÚNG người (không tới người đăng, đồng nghiệp không được nhắc)]
- Kịch bản: khi nhân viên không phải người tạo nhắc người công ty có trong «Chọn công ty» thì được, không có trong danh sách thì 422 [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » N2 · nhân viên (hM, không phải người tạo/quản trị) nhắc người công ty kết nối khi B ∈ «Chọn công ty» ⇒ 201 + chuông, B không có trong danh sách ⇒ 422, bài không tạo]
- Kịch bản: khi bài «Chỉ nội bộ» thì không nhắc được người công ty kết nối [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » «Chỉ nội bộ» ⇒ không nhắc được người công ty kết nối (422)]
- Kịch bản: khi người thuộc công ty không kết nối thì không nhắc được [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » người công ty KHÔNG kết nối ⇒ 422 dù «Tất cả đối tác»]
- Kịch bản: khi đối tác ngoài nhắc người công ty kết nối thì bị từ chối [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » đối tác ngoài không nhắc được người công ty kết nối (422)]
- Kịch bản: khi gợi ý «@» thì người công ty kết nối kèm chức vụ và công ty chỉ khi trong «Ai thấy bài» [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » gợi ý «@»: người công ty kết nối kèm chức vụ + tên công ty khi trong «Ai thấy bài», «Chỉ nội bộ», connected=0, đối tác ngoài ⇒ không có]
- Kịch bản: khi ngắt kết nối thì lần nhắc kế bị từ chối ngay [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » ngắt kết nối (B chặn A) ⇒ nhắc người B ⇒ 422 ngay lần kế]
- Kịch bản: khi gõ «@» trong thân bài thì chọn người, nhắc ngoài «Ai thấy bài» hỏi Thêm công ty, chưa chọn thì chưa đăng được [test: e2e/community-web/cr191-composer-audience.cm.ts » «@» trong thân bài: nhắc người công ty kết nối ngoài «Ai thấy bài» ⇒ hỏi, chưa chọn thì chưa đăng được, Thêm công ty vào ⇒ đăng được]
- Kịch bản: khi chọn Bỏ nhắc thì gỡ «@Tên» khỏi thân bài [test: e2e/community-web/cr191-composer-audience.cm.ts » «@» ngoài «Ai thấy bài»: Bỏ nhắc ⇒ gỡ «@Tên» khỏi thân bài và bỏ người đó]
- Kịch bản: khi nhắc trong thân bài thì chỉ người còn «@Tên» trong chữ được gửi [test: apps/workspace-web/src/modules/community/domain/composer-audience.test.ts » «@» trong thân bài: chỉ người còn «@Tên» trong chữ mới được nhắc, Bỏ nhắc xoá «@Tên»]
- Kịch bản: khi bấm Thêm công ty vào thì chuyển «Chọn công ty» và giữ công ty đã chọn [test: apps/workspace-web/src/modules/community/domain/composer-audience.test.ts » Thêm công ty vào: sang «Chọn công ty» có công ty đó, giữ công ty đã chọn, «Chọn công ty» rỗng ⇒ lỗi]
- Kịch bản: khi sửa bài thu hẹp «Ai thấy bài» mà không gửi lại danh sách nhắc thì bỏ người công ty kết nối không còn thấy bài [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » soát #1 · sửa bài thu hẹp «Ai thấy bài» mà không gửi lại danh sách nhắc ⇒ bỏ người công ty kết nối không còn thấy bài]
- Kịch bản: khi gửi chuông (kể cả sau duyệt) mà công ty đã ngắt kết nối hoặc không còn trong «Ai thấy bài» thì không chuông [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » soát #2 · chuông kiểm lại kết nối + «Ai thấy bài» NGAY lúc gửi (kể cả sau duyệt): thu hẹp hoặc ngắt trước khi gửi ⇒ không chuông]
- Kịch bản: khi tenants không phải UUID thì 400 [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » soát #4 · tenants không phải UUID ⇒ 400 (không chạm SQL)]
- Kịch bản: khi gợi ý hàng thì Sản phẩm & Giá đứng trước kèm đơn vị (không kèm giá nhập), bỏ trùng tên, người không có quyền đọc gói chỉ thấy hàng đã đăng [test: apps/hub-api/src/modules/packs/community/adapters/post-mention-connected.int.test.ts » gợi ý hàng hoá nối «Sản phẩm & Giá»: Sản phẩm & Giá trước kèm đơn vị, KHÔNG kèm giá nhập, bỏ trùng tên với hàng đã đăng, người không có quyền đọc gói ⇒ chỉ hàng đã đăng]
- Kịch bản: khi tìm hàng có ký tự đặc biệt thì được thoát đúng [test: apps/hub-api/src/modules/packs/kit/adapters/people-reader.test.ts » thoát ký tự đặc biệt của LIKE (gạch chéo ngược, phần trăm, gạch dưới)]
- Sửa test khoá do spec đổi nghĩa (BR-191-5/8): `apps/workspace-web/.../domain/post-mention.test.ts` (`mentionScope` thêm `tenants`, `outside`); e2e `composer.cm.ts` (ô đăng luôn một dòng «Viết bài…»; hộp thoại; Số lượng + Đơn vị).

## Việc còn lại
- e2e khoá còn dựa vào ô đăng cũ (nút «Cần bán»/«Nhắc tên» trong `composer`, `composer-collapse`): `cr145-post-mention.cs.ts`, `cr186-composer.cm.ts`, `cr186-mention-store.cm.ts`, `fix-cr186-ui.cm.ts`, `cr147-feed.cm.ts`, `feed.cm.ts`, `cr129-media.cm.ts`, `cr129-mention.cs.ts`, `flows.cs.ts`, `roles.cs.ts` — QC sửa theo hộp thoại mới (`composer-dialog`, nút «Viết bài…»). e2e cr191-composer-audience chưa chạy.
- e2e khoá SẼ VỠ vì ô đăng mới (QC sửa cuối đợt, danh sách ở trên): nút «Cần bán»/«Nhắc tên»/`composer-collapse` trong `composer`, nhớ mở/thu gọn, «Gợi ý mẫu»; nhãn «Tất cả bạn bè»→«Tất cả đối tác», «Từng công ty»→«Chọn công ty…».
- Bình luận chéo công ty, ảnh thật người công ty khác: lát `cr191-cross-comment`, `cr191-cross-person-card`.
- Hộp «@» của ô soạn dùng hộp chọn nhiều người (checkbox) chung với bình luận, chưa là danh sách thả ngay con trỏ.
- Nợ: `application/composer-pref.ts` không còn dùng.
