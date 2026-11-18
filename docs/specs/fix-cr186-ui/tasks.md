---
id: fix-cr186-ui
lát: fix-cr186-ui
cr: CR-186
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Soát UI lượt 6 báo 2 lỗi Trung ở CR-186: (1) «@» trong ô bình luận không có lọc/tìm; (2) bài có bình luận không hiện sẵn 3 bình luận.

## Làm
- [x] (2) `PostCard` mở sẵn khối bình luận khi bài có ≥ 1 bình luận (`opensThreadByDefault`, domain `search-hint.ts`); bài chưa có bình luận vẫn gập. Nguyên nhân: khối bình luận gập mặc định (`useState(fromBell)`), feed vẫn trả `recentComments`.
- [x] e2e viết, CHƯA chạy: `e2e/community-web/fix-cr186-ui.cm.ts`.

## Không làm / Chạm
- (1) KHÔNG đổi: «@» trong bình luận là nhắc CÔNG TY theo thiết kế CR-129 (`mentions` = id công ty ở `CreateCommentInput`, gợi ý `GET /posts/:id/mentionables`, chuông gửi cho thành viên công ty đó), khác hộp «Nhắc tên» của ô đăng bài (nhắc NGƯỜI, `GET /mentionable-people`). Gộp thành một hộp (nhắc người trong bình luận) phải đổi contract bình luận + chuông ⇒ cần người dùng chốt (điểm dừng cứng). Đề xuất: bình luận chuyển sang nhắc người bằng `mentionUserIds` + dùng lại hộp `MentionPicker` (nút 👤+ cạnh ô bình luận), giữ «@» chỉ để mở hộp.
- Không đổi backend.

## Test tối thiểu
- unit `domain/search-hint.test.ts` (đỏ trước: chưa có hàm; xanh sau).
- e2e khoá bị ảnh hưởng (cho qc, vì khối bình luận nay mở sẵn nên bấm «Bình luận» sẽ GẬP): `e2e/community-web/cr147-feed.cm.ts` (ca 3 bình luận, dòng bấm nút), `e2e/community-web/feed.cm.ts:80` (bài p1), `e2e/community-web/roles.cs.ts` (3 chỗ bấm «Bình luận» ở bài có bình luận sẵn), `e2e/community-web/cr186-composer.cm.ts` (ca 4 bình luận, bấm nút ở p1), `e2e/community-web/cr129-mention.cs.ts` (openComments, nếu bài đã có bình luận).

## Quyết định trong lúc làm
- Mở sẵn bằng khối bình luận thật (không làm bản xem trước riêng) để «Xem thêm», sửa/xoá, ô viết dùng đúng một component.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bảng tin trả kèm 3 bình luận mới nhất (CR-186, thay 2 của CR-147)
Thẻ bài có ≥ 1 bình luận hiển thị sẵn khối bình luận (3 bình luận mới nhất + «Xem thêm» nếu còn); bài chưa có bình luận gập, bấm «Bình luận» để mở ô viết. Bấm nút «Bình luận» ở bài đã mở sẵn thì gập lại.
- Kịch bản: khi mở Bảng tin thì bài p1 hiện sẵn 3 bình luận, bấm «Bình luận» thì gập [test: e2e/community-web/fix-cr186-ui.cm.ts » bài p1 (3 bình luận) hiện sẵn cả 3, nút «Bình luận» đang mở, bấm thì gập]
- Kịch bản: khi bài chưa có bình luận thì gập, bấm «Bình luận» mới hiện ô viết [test: e2e/community-web/fix-cr186-ui.cm.ts » bài chưa có bình luận vẫn gập, bấm «Bình luận» mới mở ô viết]

## Việc còn lại
- Chốt với người dùng: bình luận nhắc NGƯỜI (đổi contract, như đề xuất ở «Không làm») hay giữ nhắc công ty.
- QC sửa các e2e khoá liệt kê ở «Test tối thiểu», chạy e2e fix-cr186-ui.
