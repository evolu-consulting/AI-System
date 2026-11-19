---
id: cr191-cross-comment
lát: cr191-cross-comment
cr: CR-191
làn: đầy đủ
migration: pack-community 0032 (when 1807000780000)
phụ thuộc: cr191-feed-merge-rls, cr191-composer-audience, cr191-feed-ui
---
## Plan (ngắn)
BR-191-12: người công ty đã kết nối bình luận bài đối tác họ thấy. Hàng bình luận nằm ở tenant BÀI (+ `author_tenant`, `author_company`); đọc/ghi/sửa/xoá chéo CHỈ qua DEFINER 0032 (hàng rào = luật `feed_connected`, kiểm lại mỗi lần, tenant/người từ GUC).

## Làm
- [x] Migration community 0032: cột `author_tenant`/`author_company`; `comments_visible` CHẶT hơn (đối tác cộng đồng không thấy bình luận chéo); trigger bất biến thêm `author_tenant`/`tenant_id`; DEFINER `cross_post_tenant` (nội bộ), `cross_comment_json` (nội bộ), `cross_comments`, `cross_comment_digest`, `cross_comment_add`, `cross_comment_edit`, `cross_comment_delete` (GRANT community_rw).
- [x] hub-api: `cross-comment.repo.ts`; `comment-list.service` (list/add rơi sang chéo khi bài không ở tenant mình; «@» bình luận cho phép người công ty kết nối qua `assertSeen`/`mention_tenants_ok`); `comment.service` (sửa/xoá chéo; người đăng + quản trị ẩn/xoá); `notify.events` (`foreignMentions` ⇒ chuông ở tenant người nhận sau `mention_tenants_live`); `feed-connected.sql` (digest trong CÙNG câu); `views` (`fromConnected`, `moderate`).
- [x] Contract `CommentView.fromConnected`, `moderate`.
- [x] Gợi ý «@» trên bài công ty kết nối (`mentionable-people?postId`): người có quyền gói ở công ty mình + công ty đăng (`suggestCross`, DEFINER `cross_post_tenant` cấp cho community_rw).
- [x] Web: bài «Đối tác» có nút/ô bình luận + 3 mới nhất (bỏ nhãn «chỉ xem»); `commentActions` theo `mine`/`moderate`; nút lưu báo giá bỏ qua `fromConnected`; tác giả hiện «công ty · tên» (avatar chữ cái — ảnh thật để lát thẻ người).
- [x] e2e viết (chưa chạy): `e2e/cr169/binh-luan-cheo-cr191.spec.ts` (Hà bình luận, Tiên ẩn, ngắt kết nối).
- [x] G1: `cross-comment-truth.int.test.ts` chạy bảng chân trị + trạng thái bài qua `feed_connected` VÀ `cross_comments`.

## Không làm / Chạm
- Không làm: ảnh thật tác giả bình luận chéo (thẻ người chéo — lát `cr191-cross-person-card`).

## Test tối thiểu
- int (evotest): `apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts` + không hồi quy `connected-posts`, `comments.routes`, `post-mention-connected`, `visibility.rls` (xanh).

## Quyết định trong lúc làm
- «Quản trị công ty» = quyền `admin` gói contracts (`Access.joinAdmin`); người đăng/quản trị nay ẩn + xoá MỌI bình luận trên bài chủ quản của mình (trước: chỉ người đăng ẩn).
- Người công ty B thấy trên bài A: bình luận người nội bộ A + công ty B; không thấy công ty kết nối khác, đối tác cộng đồng A, bình luận bị ẩn. Chữ của A trả bản đã che.
- «@» trong bình luận chéo chỉ người nội bộ của công ty đăng hoặc công ty mình (không lộ công ty kết nối khác); sai ⇒ 422.
- Ngắt kết nối ⇒ không xem/viết/sửa/xoá nữa (hàng rào cả khi sửa/xoá).
- Migration đổi giao số 0030 ⇒ 0032 theo điều phối.
- G1: luật «Ai thấy bài» cho công ty kết nối nằm ở 2 hàm (`feed_connected` 0026, `cross_post_tenant` 0032). Không gộp: `feed_connected` lọc NGAY trong LATERAL mỗi công ty trên `posts_feed_idx` (perf p95 ≤ 120 ms, soát #3 lát feed-merge); hàm theo một bài không dùng lại được dạng đó. Khoá lệch bằng test đối chiếu bảng chân trị qua cả hai đường.
- Sửa test khoá do spec đổi nghĩa (BR-191-12): `e2e/community-web/cr191-feed-ui.cm.ts` — bài đối tác KHÔNG còn «chỉ xem», có `.pact` (ô bình luận).
- Soát Opus: nút Ẩn chỉ theo `moderate` (G3); nhắc người công ty đăng phải ∈ người có quyền gói ở công ty đó (kiểm ở service — quyền gói nằm ở cấu hình app, DEFINER không thấy); `comments_insert` thêm `author_tenant IS NULL`; `cross_comment_edit` không sửa bình luận đã ẩn; tách hàm theo `check:fn`.
- Lỗi đỏ đợt trước: `cross_comments` dùng biến `record` chưa gán khi không có `before` (55000) ⇒ đổi sang 2 biến vô hướng (lỗi code). Test đọc `feed.json.posts` ⇒ đúng là `items` (lỗi test).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bình luận bài của công ty đã kết nối
Người của công ty đã kết nối bình luận được bài đối tác họ thấy trên bảng tin (số bình luận, 3 mới nhất, danh sách), sửa/xoá bình luận của mình; người đăng bài và quản trị công ty đăng ẩn/xoá được mọi bình luận trên bài mình. Bài không dành cho công ty họ, công ty không kết nối, hoặc đã ngắt kết nối ⇒ không xem, không viết. «@» trong bình luận nhắc được người thấy bài, chuông đúng người. Đối tác cộng đồng không thấy bình luận của người công ty khác.
- Kịch bản: khi B bình luận bài A «Tất cả đối tác» thì ghi được, đọc được và bảng tin có số + bình luận mới nhất [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » B bình luận bài A «Tất cả đối tác»: ghi, đọc danh sách, bảng tin có số + bình luận mới nhất — A thấy kèm tên công ty B]
- Kịch bản: khi bài A chỉ nội bộ hoặc chọn công ty không có B thì B không đọc, không ghi [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » bài A «Chỉ nội bộ» / «Chọn công ty» không có B ⇒ B không đọc, không ghi (404)]
- Kịch bản: khi công ty không kết nối thì không đọc, không ghi [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » công ty C không kết nối ⇒ không đọc, không ghi]
- Kịch bản: khi B sửa/xoá thì chỉ bình luận của B [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » B sửa/xoá bình luận của B — đồng nghiệp B và người A không sửa/xoá được bình luận của B]
- Kịch bản: khi người đăng hoặc quản trị A ẩn/xoá bình luận của B thì B không còn thấy [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » N2 · người đăng bài (hM) ẩn, quản trị A (hA, không phải người đăng) ẩn/xoá bình luận của B — bị ẩn ⇒ B không thấy]
- Kịch bản: khi nhắc tên trong bình luận chéo thì chuông đúng người [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » nhắc + chuông: B nhắc người đăng A (hM) ⇒ chuông ở A — A (hA) nhắc hB ⇒ chuông ở B — nhắc người công ty khác ⇒ 422]
- Kịch bản: khi đối tác cộng đồng xem bình luận thì không thấy bình luận người công ty khác [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » người ngoài cộng đồng (đối tác A) theo luật cũ: không thấy bình luận người công ty B, không thấy tên người B được nhắc]
- Kịch bản: khi tải danh sách bình luận chéo thì số câu SQL cố định [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » số câu SQL cố định khi tải danh sách bình luận chéo (2 câu, 3 hay 30 bình luận)]
- Kịch bản: khi gõ «@» trong bình luận bài công ty kết nối thì gợi ý người hai công ty, không người công ty khác [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » gợi ý «@» trên bài công ty kết nối: người có quyền ở A (kèm tên công ty) + đồng nghiệp B, không người công ty khác — bài không thấy ⇒ 404]
- Kịch bản: khi so bảng chân trị «Ai thấy bài» thì bảng tin và quyền bình luận chéo khớp nhau [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment-truth.int.test.ts » bảng chân trị + trạng thái bài: feed_connected và cross_comments cho cùng tập bài, đúng bảng chân trị]
- Kịch bản: khi người đăng/quản trị xem bình luận thì có Ẩn + Xoá với bình luận người khác [test: apps/workspace-web/src/modules/community/domain/thread.test.ts » CR-191 · moderate (người đăng/quản trị) ⇒ ẩn + xoá bình luận người khác — bài đối tác không moderate ⇒ chỉ của mình]
- Kịch bản: khi người công ty kết nối bình luận bài đối tác thì quản trị bên đăng ẩn được và họ không còn thấy [test: e2e/cr169/binh-luan-cheo-cr191.spec.ts » CR191-C2 · Tiên (quản trị NitiGroup, không phải người đăng) thấy bình luận của Preschool kèm tên công ty, bấm Ẩn ⇒ Hà không còn thấy]
- Kịch bản: khi ngắt kết nối thì hết xem, hết viết [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » ngắt kết nối ⇒ B không xem/không viết nữa, bài + bình luận cũ biến khỏi bảng tin — nối lại ⇒ hiện lại]

### MODIFIED community/hien-thi.md
#### Yêu cầu: Ẩn và xoá bình luận trên bài công ty mình
Trên bài của công ty mình, người đăng bài và quản trị Sổ Hợp Tác ẩn/hiện và xoá được mọi bình luận (của đồng nghiệp hoặc người công ty đã kết nối); nút Ẩn chỉ hiện với họ. Người khác chỉ sửa/xoá bình luận của chính mình.
- Kịch bản: khi người đăng hoặc quản trị (không phải người viết) ẩn/xoá bình luận trên bài nội bộ thì được [test: apps/hub-api/src/modules/packs/community/adapters/cross-comment.int.test.ts » bài nội bộ: người đăng (hM) ẩn + xoá bình luận của người khác, quản trị (hA, không phải người đăng) ẩn + xoá bình luận của nhân viên]
- Kịch bản: khi người xem không phải người đăng/quản trị thì không có nút Ẩn [test: apps/workspace-web/src/modules/community/domain/thread.test.ts » người viết sửa/xoá — chỉ chủ quản ẩn và chỉ trên bài chủ quản]

## Việc còn lại
- e2e `e2e/cr169/binh-luan-cheo-cr191.spec.ts` + `cr191-feed-ui.cm.ts` (đã sửa) chưa chạy (điều phối chạy cuối đợt). Mock web (`mock-connected.ts`) chưa có bình luận chéo.
- Ảnh thật tác giả bình luận chéo: chờ thẻ người chéo.
