---
id: cr191-feed-merge-rls
lát: cr191-feed-merge-rls
cr: CR-191
làn: đầy đủ
migration: hub 0163, pack-community 0026
phụ thuộc: cr191-audience-schema
---
## Plan (ngắn)
Bảng tin GỘP (BR-191-1/2/3): `GET /pack/community/feed` trả một dòng = bài công ty mình (RLS cũ, không đổi) + bài công ty ĐÃ KẾT NỐI (hàm DEFINER mới `community.feed_connected` dựa trên `hub.cc_connected_ids()`), trộn mới nhất trước, 20 bài/trang, con trỏ `(created_at,id)` chung, 2 câu SQL cố định mỗi trang. Gỡ đường cũ «Bảng tin công ty» CR-161 (route `/pack/contracts/connect/posts/:tenant_id`, `community.cc_posts`) theo G1.

## Làm
- [x] Hub `0163_cr191_cc_connected_ids` (DEFINER, một câu, hai chiều accepted + không chặn, chặn người dùng ngoài) + GRANT `hub_rw`/`contracts_rw`/`community_rw` + journal.
- [x] Community `0026_cr191_feed_connected`: `community.feed_connected` (luật «Ai thấy bài» cho công ty kết nối: all / suppliers-buyers theo `partner_roles` khoá `tax:<MST>` / companies ∈ `aud_tenants` / internal-cats không), `community.author_titles` (chức vụ, chỉ tenant người xem), cấp lại `hub.cc_connected_ids`, DROP `community.cc_posts` + journal.
- [x] hub-api: `feed-connected.sql.ts`, `domain/feed-merge.rules.ts` (trộn + so micro giây), `post.service.feed` (2 câu một tx), `posts.routes.feedJson`, `views.connectedView`, `post.sql` (`author_title`, `aud.tenants`), `post-write.repo` ghi `aud_tenants`, kiểm `tenants` ∈ công ty đã kết nối (400).
- [x] Contract `PostView`: `source` (`own`|`connected`), `authorTitle`, `fileCount`; gỡ `CcPost*`.
- [x] Gỡ `connect/adapters/posts.*`, cổng `PostsRepo`, use case `posts` (UI tab cũ đã gỡ ở CR-169).

## Không làm / Chạm
- Không làm: UI bảng tin mới (lát `cr191-feed-ui`), bình luận chéo, thẻ người chéo (ảnh), đếm theo nguồn.
- Không đổi `posts_visible`/`posts_tenant`/`audience_ok`.
- Chạm: migrations trên, `apps/hub-api/src/modules/packs/community/{adapters,domain}/…`, `contracts/connect/*`, `packages/contracts/src/pack-community/post.ts`, `pack-contracts/company-connect.ts`.

## Test tối thiểu
- unit `domain/feed-merge.rules.test.ts`; `connect.usecase.test.ts`.
- int `adapters/connected-posts.int.test.ts` (viết lại cho `feed_connected`), `connect.routes.int.test.ts` (đường cũ 404 + quyền hàm).
- perf `adapters/feed-merge.perf.int.test.ts` (2 câu/trang, p95).

## Quyết định trong lúc làm
- Kèm bài công ty kết nối chỉ khi: người nội bộ, tab ≠ «Lưu trữ», không lọc «của tôi»/người đăng/nhóm hàng/khu vực/từ khoá, không lọc «chỉ chủ quản». `authorOrgId` = id tenant kết nối ⇒ chỉ bài công ty đó.
- Bài công ty kết nối: chỉ xem — `actions: []`, `media: []` + `fileCount` (tệp chưa tải chéo được), `commentCount: 0` (bình luận chéo = lát `cr191-cross-comment`), `authorSide: "partner"`, `source: "connected"`.
- Đếm/facets trong phản hồi vẫn chỉ của công ty mình.
- `feed_connected` thêm điều kiện `moderation IN ('none','approved')` (cc_posts cũ thiếu).
- Chức vụ người đăng bài công ty mình qua DEFINER `community.author_titles` (CTE trong cùng câu bảng tin, không thêm câu); người dùng ngoài nhận rỗng.
- `cc_connected_ids` chặn người dùng ngoài (42501).
- journal `when`: hub 0163 = 1806903700000 (giữa 0161 và 0166), community 0026 = 1807000660000 (> 0025).
- Viết lại `connected-posts.int.test.ts` (test của CR-161 cho `cc_posts`): spec CR-191 đổi nghĩa (bỏ bảng tin riêng từng công ty, G1).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bảng tin gộp công ty mình và công ty đã kết nối
Bảng tin là MỘT dòng: bài công ty mình (luật người xem cũ) và bài của công ty đã kết nối có công ty mình trong «Ai thấy bài» (Tất cả đối tác; Nhà cung cấp/Khách hàng theo vai của công ty mình trong sổ đối tác bên đăng, khớp MST; chọn đích danh). Mới nhất trước, 20 bài/lần. Mỗi bài có tên công ty, nhãn nguồn «Công ty mình»/«Đối tác», tên và chức vụ người đăng. Bài đối tác chỉ xem, đã che liên hệ. Ngắt kết nối ⇒ bài họ biến mất ngay. Không còn «Bảng tin công ty» riêng từng công ty.
- Kịch bản: khi công ty A kết nối B thì nhân viên B (không phải người đăng) thấy bài A «Tất cả đối tác» và bài chọn đích danh B, không thấy «Chỉ nội bộ», nhóm hàng, bài chọn công ty khác [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts » B (Vy, không phải người đăng) thấy bài A «Tất cả đối tác» + bài chọn đích danh B, không thấy Chỉ nội bộ / nhóm hàng / công ty khác]
- Kịch bản: khi bài dành cho Nhà cung cấp hoặc Khách hàng thì công ty kết nối chỉ thấy khi có đúng vai trong sổ đối tác bên đăng [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts » Nhà cung cấp / Khách hàng theo nhãn vai của B trong sổ đối tác của A (khoá MST)]
- Kịch bản: khi so với bảng chân trị «Ai thấy bài» thì mọi hàng người xem công ty kết nối khớp [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts » khớp bảng chân trị (mọi hàng người xem công ty kết nối)]
- Kịch bản: khi công ty chưa kết nối, mới mời một chiều hoặc bị chặn thì không thấy bài nào [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts » công ty thứ ba / một chiều / bị chặn ⇒ không thấy gì, bài chính mình không lẫn vào]
- Kịch bản: khi ngắt kết nối thì bài đối tác biến mất ở lần tải kế [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts » ngắt kết nối ⇒ biến mất ở lần gọi kế, nối lại ⇒ hiện lại (không cache)]
- Kịch bản: khi người dùng ngoài (đối tác cộng đồng) gọi thì bị từ chối [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts » người dùng ngoài ⇒ 42501, chưa đặt người xem ⇒ 42501, A tắt Bảng tin ⇒ rỗng]
- Kịch bản: khi xem bảng tin thì một dòng gộp mới nhất trước kèm nhãn nguồn, công ty, chức vụ [test: apps/hub-api/src/modules/packs/community/adapters/connected-posts.int.test.ts » API bảng tin (service): một dòng gộp bài công ty mình + đối tác, mới nhất trước, nhãn nguồn + công ty + chức vụ]
- Kịch bản: khi trộn hai nguồn thì đúng thứ tự tới micro giây và báo còn trang sau [test: apps/hub-api/src/modules/packs/community/domain/feed-merge.rules.test.ts » trộn hai nguồn mới nhất trước, lấy đúng limit, báo còn trang sau]
- Kịch bản: khi tải trang 20 bài thì số câu SQL cố định [test: apps/hub-api/src/modules/packs/community/adapters/feed-merge.perf.int.test.ts » trang 20 bài (2.000 bài mình + 10.000 bài của 200 công ty kết nối): 2 câu SQL cố định, p95 ≤ 200 ms]
- Kịch bản: khi gọi đường cũ «Bảng tin công ty» thì không còn [test: apps/hub-api/src/modules/packs/contracts/connect/connect.routes.int.test.ts » đường cũ /connect/posts/:tenant_id không còn — bài công ty đã kết nối nằm ở bảng tin gộp /pack/community/feed]

## Việc còn lại
- Đếm theo nguồn/loại cho bộ lọc (lát `cr191-feed-ui` cần — thêm cột đếm vào `feed_connected` hoặc hàm đếm một câu).
- Ảnh/tệp bài đối tác (chỉ `fileCount`), bình luận chéo, ảnh người chéo: lát sau.
