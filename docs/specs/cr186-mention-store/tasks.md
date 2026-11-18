---
id: cr186-mention-store
lát: cr186-mention-store
cr: CR-186
làn: nhanh
migration: 0022 (pack-community)
phụ thuộc: cr186-comment-mention (đã gộp)
---
## Plan (ngắn)
Lưu người được nhắc theo từng bình luận để bình luận hiển thị như bài đăng («Nhắc: …», «@Tên»), che theo người xem.

## Làm
- [x] Migration `0022_cr186_comment_mention_people` (chỉ thêm; `SET LOCAL lock_timeout='5s'`; không backfill; journal `when` = 1807000620000 > mọi `when` cùng thư mục): cột `community.comments.mention_people jsonb NOT NULL DEFAULT '[]'` = `[{id,name,org}]` (tên chụp lúc nhắc, `org` null = chủ quản) + CHECK mảng ≤ 10 (NOT VALID rồi VALIDATE).
- [x] Ghi: `insertComment` lưu `people` đã qua `resolvePeople`/`assertSeen` (cùng câu INSERT). Sửa chữ (`PATCH`) không đụng cột ⇒ giữ lời nhắc, không phát chuông.
- [x] Đọc: `commentJson` (một nguồn cho list / feed `recentComments` / insert / update) trả `mention_people` ĐÃ che ngay trong SQL (đối tác chỉ nhận chủ quản hoặc công ty mình — cùng luật `post_mentions_visible`); không thêm câu truy vấn ⇒ không N+1. `CommentView.mentionedUsers` (tuỳ chọn, như `PostView.mentionedUsers`).
- [x] UI: `MentionedLine` dùng chung bài đăng + bình luận; `@Tên` của người được nhắc tô đậm (`splitMentions` gộp công ty cũ + người). Bình luận cũ ⇒ không trường ⇒ như hiện nay.

## Không làm / Chạm
- KHÔNG đổi RLS/policy (cột trên bảng đã có policy `comments_*`); che theo người xem ở câu SELECT. Chạm quyền xem: có (lọc phần tử người được nhắc, mirror `post_mentions_visible`).
- Không bấm được «@Tên»: bài đăng cũng chỉ hiển thị chữ (chưa có trang hồ sơ người); giữ giống bài đăng.
- Bình luận cũ nhắc công ty giữ nguyên (`mentions`).

## Test tối thiểu
- int `post-mention.int.test.ts » lưu + đọc: người được nhắc theo bình luận, che theo người xem …` (chủ quản không phải người tạo bài; đối tác chỉ thấy chủ quản + công ty mình; feed `recentComments` cùng luật; sửa chữ giữ lời nhắc không chuông); `migrate-guard.int.test.ts`.
- unit `mock.test.ts`.

## Quyết định trong lúc làm
- Dùng cột jsonb có tên (không `uuid[]` thuần) vì feed/đọc không join `admin.users`; cùng cách chụp tên của `post_mentions`, nhưng không tạo bảng mới (ít RLS, một nguồn trong hàng bình luận).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bình luận thường, không còn bước «Nhắn riêng» (CR-129)
Bình luận lưu danh sách NGƯỜI được nhắc (`mention_people`, chụp tên lúc nhắc) và trả `mentionedUsers` như bài đăng; đối tác chỉ nhận người chủ quản hoặc công ty mình. Bình luận hiển thị «Nhắc: …» và «@Tên» tô đậm. Sửa chữ bình luận giữ lời nhắc và không gửi lại chuông. Bình luận cũ (không có danh sách) hiện như cũ.
- Kịch bản: khi chủ quản nhắc người thì chủ quản thấy đủ, đối tác chỉ thấy chủ quản và công ty mình, sửa chữ giữ lời nhắc và không chuông mới [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » lưu + đọc: người được nhắc theo bình luận, che theo người xem (đối tác chỉ thấy chủ quản + công ty mình), sửa chữ giữ lời nhắc, không chuông mới, bình luận cũ không có trường]
- Kịch bản: khi bình luận có người được nhắc thì hiện «Nhắc: …» và «@Tên» tô đậm [test: e2e/community-web/cr186-mention-store.cm.ts » bình luận có người được nhắc hiện dòng «Nhắc: …» và «@Tên» tô đậm, bình luận cũ không có dòng này]

## Việc còn lại
- QC chạy e2e `cr186-mention-store.cm.ts`; soát hình dòng «Nhắc» trong bình luận. Khi deploy: migration 0022 chạy tự động (chỉ thêm cột).
