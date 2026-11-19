---
id: cr191-feed-ui
lát: cr191-feed-ui
cr: CR-191
làn: nhanh
migration: không
phụ thuộc: cr191-feed-merge-rls
---
## Plan (ngắn)
Bảng tin MỘT cột kiểu Facebook (BR-191-2/3/4, BR-187-6/9): bỏ cột phải (`FeedRail`) và hàng chip loại bài; đầu bài có avatar, tên, chức vụ, công ty + nhãn «Công ty mình»/«Đối tác»; lọc (loại bài + nguồn + nhóm hàng/khu vực) trong sheet mở từ nút «Lọc»; icon Sửa/Xoá/Ẩn... ở thẻ bài thay menu ⋯; bài Đối tác chỉ xem.

## Làm
- [x] Contract `FeedQuery.source` (`own`|`connected`); hub-api: `source=own` ⇒ không kèm bài kết nối, `source=connected` ⇒ không trả bài công ty mình (vẫn đếm).
- [x] Web: `FeedPage` một cột, `FeedFilterSheet` (nút «Lọc» trên thanh dính ở máy tính; nút nổi đáy + sheet từ dưới ở điện thoại), `PostActions` (icon, thay `PostMenu`), `PostCard` (đầu bài mới, bài Đối tác chỉ xem), khung chờ khi tải thêm, gỡ `FeedRail` + CSS rail.
- [x] Domain `feed-source.ts` (nguồn → query, đếm, số lọc bật, nhãn nguồn); port `listConnected` (`/pack/contracts/connect/links?status=connected`, lỗi/403 ⇒ rỗng).
- [x] Mock: 2 công ty kết nối × 14 bài + phân trang `cursor` 20 bài/lần.
- [x] e2e: `cr191-feed-ui.cm.ts` mới; sửa e2e khoá vỡ do bỏ cột phải/tab/menu ⋯ (`feed.cm.ts`, `cr147-feed.cm.ts`, `cr187-ui.cm.ts`, `shell.cm.ts`, `flows.cs.ts`).

## Không làm / Chạm
- Không làm: hộp thoại đăng bài / «Ai thấy bài» / «@» (lát `cr191-composer-audience`), trang tìm đối tác, bình luận chéo, ảnh bài đối tác.
- Chạm: `apps/workspace-web/src/modules/community/{ui,application,domain,adapters}`, `packages/contracts/src/pack-community/feed.ts`, `apps/hub-api/.../community/adapters/{post.sql,post.service,posts.routes}.ts`, i18n `community`, e2e `community-web`.

## Test tối thiểu
- unit `domain/feed-source.test.ts`; `post.service.test.ts` (source own ⇒ không kèm kết nối).
- e2e (viết, điều phối chạy cuối đợt): `e2e/community-web/cr191-feed-ui.cm.ts`.

## Quyết định trong lúc làm
- Lọc nguồn cần máy chủ (phân trang): thêm `FeedQuery.source` (nhỏ, không migration). Một công ty đã kết nối = `authorOrgId` (có sẵn).
- Máy chủ chỉ đếm bài công ty mình ⇒ số cạnh loại bài và «Công ty mình» chỉ hiện khi nguồn = «Công ty mình»; nguồn khác ẩn số (không hiện số sai).
- Danh sách công ty đã kết nối lấy từ `/pack/contracts/connect/links` (chỉ người Toàn quyền gọi được; khác ⇒ 403 ⇒ chỉ có Tất cả / Công ty mình / Đối tác, không có từng công ty).
- Bỏ hẳn cột «Người đăng» (chủ quản/đối tác cộng đồng) khỏi bảng tin chính (nguồn thay thế); `FeedList` ở Hồ sơ giữ nguyên chip + ô lọc.
- Nút «Lọc» điện thoại đặt góc TRÁI đáy (nút trợ lý ở phải, luật R4 không đè).
- Ảnh trong bài đã `loading="lazy"` + khung có tỉ lệ cố định ở `attach-frame` (web-kit) ⇒ không đổi.
- Icon thao tác thẻ bài dùng `IconAction` có sẵn (28px cách 2px; điện thoại 44px sát nhau).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Bảng tin một cột có nút Lọc, tải dần và icon thao tác
Bảng tin là MỘT cột: ô đăng bài, thanh dính có nút «Lọc», rồi các bài gộp (không còn cột phải «Bộ lọc/Đối tác» và hàng chip loại bài). Đầu bài: avatar, tên, chức vụ, công ty + nhãn «Công ty mình»/«Đối tác», thời gian, ai thấy. Tải 20 bài mỗi lần khi cuộn. «Lọc» mở sheet (từ phải ở máy tính; từ dưới ở điện thoại, nút nổi đáy): loại bài, nguồn (Tất cả / Công ty mình / Đối tác / từng công ty đã kết nối), nhóm hàng, khu vực, «Xoá lọc»; nút «Lọc» hiện số lọc đang bật; số đếm chỉ hiện khi nguồn là «Công ty mình». Sửa/Xoá/Ẩn... là icon nhỏ sát nhau ở thẻ bài (28px cách 2px; điện thoại 44px). Bài «Đối tác» chỉ xem: không có ô bình luận, không có thao tác.
- Kịch bản: khi cuộn bảng tin thì tải 20 bài mỗi lần và dừng khi hết [test: e2e/community-web/cr191-feed-ui.cm.ts » cuộn tải 20 bài mỗi lần, hết bài thì dừng]
- Kịch bản: khi xem đầu bài thì có nhãn Công ty mình / Đối tác, chức vụ; bài Đối tác chỉ xem [test: e2e/community-web/cr191-feed-ui.cm.ts » đầu bài: tên, chức vụ, công ty, nhãn Công ty mình / Đối tác, bài Đối tác chỉ xem, không có ô bình luận]
- Kịch bản: khi lọc loại và nguồn thì danh sách đúng, nút Lọc hiện số, «Xoá lọc» trả về ban đầu [test: e2e/community-web/cr191-feed-ui.cm.ts » lọc loại + nguồn, số lọc đang bật, «Xoá lọc»]
- Kịch bản: khi lọc theo một công ty đã kết nối thì chỉ bài công ty đó [test: e2e/community-web/cr191-feed-ui.cm.ts » lọc theo một công ty đã kết nối]
- Kịch bản: khi đổi lọc thì cột bài và nút Lọc không nhảy [test: e2e/community-web/cr191-feed-ui.cm.ts » đổi lọc: cột bài và nút Lọc không nhảy (đo bounding box)]
- Kịch bản: khi xem thẻ bài ở máy tính thì icon thao tác 28px cách 2px, có tên đọc được [test: e2e/community-web/cr191-feed-ui.cm.ts » icon Sửa/Xoá/Ẩn ở thẻ bài: 28px cách 2px trên máy tính, có tên đọc được]
- Kịch bản: khi xem ở điện thoại thì icon 44px sát nhau và nút Lọc nổi đáy mở sheet từ dưới [test: e2e/community-web/cr191-feed-ui.cm.ts » điện thoại: icon thẻ bài 44px sát nhau, nút Lọc nổi đáy mở sheet từ dưới]
- Kịch bản: khi chọn nguồn thì gửi đúng tham số lọc, đếm và nhãn nguồn đúng [test: apps/workspace-web/src/modules/community/domain/feed-source.test.ts » nguồn ⇒ query: tất cả không gửi gì, mình/đối tác gửi source, một công ty gửi authorOrgId]
- Kịch bản: khi nguồn là Đối tác thì ẩn số đếm (máy chủ chỉ đếm bài công ty mình) [test: apps/workspace-web/src/modules/community/domain/feed-source.test.ts » đếm: chỉ «Công ty mình» có số theo tab, nguồn đối tác và «Tất cả» ẩn số]
- Kịch bản: khi đếm bộ lọc đang bật thì không tính «Tất cả» [test: apps/workspace-web/src/modules/community/domain/feed-source.test.ts » đếm số lọc đang bật: loại ≠ Tất cả, nhóm hàng, khu vực, nguồn]
- Kịch bản: khi bài thiếu nguồn thì coi là Công ty mình [test: apps/workspace-web/src/modules/community/domain/feed-source.test.ts » nhãn nguồn: bài kết nối = Đối tác, còn lại (kể cả vắng source) = Công ty mình]
- Kịch bản: khi lọc nguồn «Công ty mình» thì máy chủ không kèm bài công ty kết nối [test: apps/hub-api/src/modules/packs/community/adapters/post.service.test.ts » lọc nguồn «Công ty mình» không kèm bài công ty kết nối, «Đối tác» vẫn gọi]
- Sửa e2e khoá vỡ do bỏ cột phải / hàng tab / menu ⋯ (spec CR-191 đổi nghĩa): `feed.cm.ts` (menu ⋯ → icon; test «2 cột» → «một cột»), `cr147-feed.cm.ts` (menu ⋯ → icon; «thẻ Bộ lọc» → cùng cột), `cr187-ui.cm.ts` (đổi tab → đổi lọc), `shell.cm.ts` (màu số đếm tab bỏ), `flows.cs.ts` (Báo cáo là icon).

## Việc còn lại
- Số đếm theo nguồn (Đối tác / từng công ty) và số đếm loại bài gộp: API chưa trả ⇒ đang ẩn số (cần cột đếm trong `feed_connected` hoặc hàm đếm một câu).
- Danh sách «từng công ty đã kết nối» chỉ có với người Toàn quyền (API `connect/links` 403 với người khác): cần đường đọc cho mọi người nội bộ.
- Ảnh baseline `bang-tin-mobile.png` (scenes-mobile.cm.ts) cũ: điều phối chụp lại (`CM_MODE=capture`) sau khi gộp.
- Ảnh người chéo công ty (`PersonAvatar` hiện chữ cái đầu cho người công ty kết nối), bình luận chéo, ảnh bài đối tác: lát sau.
