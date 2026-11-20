---
id: cr194-partner-media
lát: cr194-partner-media
cr: CR-194
làn: nhanh
migration: community 0033
phụ thuộc:
---
## Plan (ngắn)
Bài công ty đã kết nối trả `media` đầy đủ (một câu `community.cross_media` mỗi trang) + `GET /files/:id` đọc được tệp của công ty kết nối khi người xem thấy bài (`community.cross_file`). «Thấy bài» = ĐÚNG hàm `community.cross_post_tenant` (0032) — không điều kiện thứ hai (G1). Web dùng `PostMedia` như bài nội bộ.

## Làm
- [x] Migration community 0033 (`when` 1807000800000): `cross_media(uuid[])`, `cross_file(uuid)` — DEFINER, STABLE, chỉ đọc, cấp `community_rw`.
- [x] `feed-connected.sql.ts` (`connectedQuery` + `crossFile`), `views.ts` (`connectedView.media`), `files.service.ts` (`download`: tệp mình → không có thì `crossFile`, chỉ người nội bộ).
- [x] `PostCard.tsx`: bỏ dòng «n tệp đính kèm» + key i18n `community.feed.files` (vi/en) + CSS `.pfiles`.
- [x] Test int `connected-media.int.test.ts`.

## Không làm / Chạm
BR-194-4 (.txt) — agent khác. Không đổi `feed_connected` (0031), không đổi RLS. `fileCount` trong contract giữ (= số media) vì test khoá/bản mẫu còn dùng.

## Test tối thiểu
int: `apps/hub-api/src/modules/packs/community/adapters/connected-media.int.test.ts` (+ chạy lại connected-posts, community-files, cross-comment).

## Quyết định trong lúc làm
- Không DROP/CREATE `feed_connected` (đổi kiểu trả về động tới test cũ + khoá quyền): thêm hàm `cross_media` gọi một lần mỗi trang trong cùng tx.
- Người dùng ngoài (đối tác cộng đồng, `a.org !== null`) không đi đường chéo công ty (`cross_post_tenant` ném 42501 cho họ) ⇒ 404.
- Không có route sửa/xoá tệp; media chéo chỉ đọc (hàm DEFINER không ghi) ⇒ BR-194-3 giữ bằng RLS hiện có (test (d)).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/bang-tin.md
#### Yêu cầu: Bài công ty đã kết nối hiện ảnh/tệp
Người xem công ty đã kết nối, được bài cho thấy, xem ảnh/video/tệp của bài như người nội bộ; không còn dòng «n tệp đính kèm». Không thấy bài ⇒ tải tệp 404 giống hệt. Chỉ xem/tải, không sửa/gỡ.
- Kịch bản: khi Vy (công ty B, không phải người đăng) xem bảng tin thì bài A «Tất cả đối tác» có media và tải tệp 200 [test: apps/hub-api/src/modules/packs/community/adapters/connected-media.int.test.ts » (a) Vy (B, không phải người đăng) thấy media của bài được cho thấy, đúng khuôn MediaItem, và tải được tệp (200 + byte)]
- Kịch bản: khi bài không cho B thấy thì không có bài và tệp 404 [test: apps/hub-api/src/modules/packs/community/adapters/connected-media.int.test.ts » (b) B kết nối nhưng bài không cho thấy ⇒ không có bài, tải tệp 404 (giống tệp không tồn tại); bài nội bộ cũng vậy]
- Kịch bản: khi ngắt kết nối hoặc A tắt Bảng tin thì tệp 404 ngay [test: apps/hub-api/src/modules/packs/community/adapters/connected-media.int.test.ts » (b2) ngắt kết nối hoặc A tắt Bảng tin ⇒ tệp mất ngay (kiểm lại mỗi lần)]
- Kịch bản: khi công ty không kết nối xin tệp thì 404 [test: apps/hub-api/src/modules/packs/community/adapters/connected-media.int.test.ts » (c) công ty không kết nối (C) ⇒ feed rỗng, mọi tệp 404 kể cả bài «Tất cả đối tác»]
- Kịch bản: khi đối tác chỉ xem thì không sửa/xoá được tệp, media [test: apps/hub-api/src/modules/packs/community/adapters/connected-media.int.test.ts » (d) đối tác chỉ xem: không sửa/xoá hàng tệp, không sửa/xoá media của A, không gắn tệp của A vào bài mình]
- Kịch bản: khi người xem mở bảng tin thì bài đối tác không còn dòng «n tệp đính kèm» [test: thủ công — bỏ khối JSX; không có e2e nào kiểm dòng này (grep e2e/ rỗng)]

## Việc còn lại
- e2e hành trình «ảnh bài đối tác» (viết + chạy cuối đợt do điều phối) — chưa có.
