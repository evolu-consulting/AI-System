# cr147c-mention-comments — CR-147 (hộp Nhắc tên, 2 bình luận mới nhất từ API, bảng tin tải dần)

## Plan
Hộp chọn «Nhắc tên» theo bản mẫu `docs/specs/cr147-mention-picker/prototype.json`; `PostView` trả kèm 2 bình luận mới nhất + tổng số (một subquery tương quan trong CÙNG câu feed, số câu SQL không đổi); bảng tin tải dần khi cuộn.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Hộp «Nhắc tên» (icon 👤+, tìm máy chủ debounce, 20 người/lần, tối đa 10, «Xong (N người)»); bỏ MentionPeople | `ui/MentionPicker.tsx`, `application/usePeople.ts`, `ui/Composer.tsx` | [x] |
| 2 | `cursor` cho `GET /mentionable-people` | contracts `post.ts`, `people.reader.ts`, `post-mention.service.ts` | [x] |
| 3 | `PostView.recentComments`; `GET …/comments?dir=desc&before=` | contracts `post.ts` `comment.ts`, `post.sql.ts`, `views.ts`, `comment-list.repo.ts` | [x] |
| 4 | Thread dùng `recentComments`, «Xem thêm N bình luận» tải trang cũ hơn | `ui/Thread.tsx` | [x] |
| 5 | Bảng tin tải dần (IntersectionObserver + nút dự phòng) | `application/useFeed.ts`, `ui/Feed.tsx` | [x] |
| 6 | Int + e2e (hộp Nhắc tên, Xem thêm bình luận; cuộn bảng tin CHƯA có e2e — mock không có cursor, stack cần seed > 20 bài) | `comments.routes.int.test.ts`, `post-mention.int.test.ts`, `e2e/community-web/cr147-feed.cm.ts` | [x] int sửa lỗi nháy SQL, chờ chạy lại |

## Quyết định trong lúc làm
- Ảnh đại diện: chưa có `PersonAvatar` trên nhánh ⇒ chữ cái đầu. Phòng ban · chức vụ: API chưa trả ⇒ chỉ tên công ty.
- `mentionable-people` giữ kiểu mảng; `cursor` = số đã nhận (offset); trang đầy 20 ⇒ coi là còn.
- Bảng tin làm mới (rev) chỉ thay trang đầu, giữ phần đã tải dần.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md

#### Yêu cầu: Bảng tin trả kèm 2 bình luận mới nhất và tổng số
- Kịch bản: khi lấy bảng tin thì mỗi bài có 2 bình luận mới nhất người xem được và tổng số, không lộ bình luận riêng tư [test: apps/hub-api/src/modules/packs/community/adapters/comments.routes.int.test.ts » recentComments = 2 cuối của danh sách người xem được]
- Kịch bản: khi bấm Xem thêm thì tải bình luận cũ hơn theo trang [test: apps/hub-api/src/modules/packs/community/adapters/comments.routes.int.test.ts » GET /comments?dir=desc&before=<id>]

#### Yêu cầu: Gợi ý người Nhắc tên tải dần
- Kịch bản: khi tải theo cursor thì ghép lại đủ danh sách, không lọt người ngoài phạm vi [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » CR-147c · tải dần theo cursor]

## Việc còn lại
- Chạy int trên evotest (script chạy từ Git Bash lỗi tar `/tmp/...tgz`, báo «XANH 0 test» sai); chạy lại bằng PowerShell thật.
- Viết e2e (hộp Nhắc tên, Xem thêm bình luận, cuộn bảng tin); e2e cũ `cr145-post-mention.cs.ts` dùng ô gõ tên cũ ⇒ cần QC cập nhật.
- Đo số câu SQL trước/sau (thiết kế: không đổi, 1 câu/trang).
