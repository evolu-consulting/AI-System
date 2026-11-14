# cr147a-feed-ux — CR-147 ý 1, 2, 5, 6 (Bảng tin)

## Plan
UI Bảng tin: bỏ tiêu đề lặp ở 2 màn quản trị, nút thu gọn ô đăng thẳng hàng, bình luận chỉ hiện 2 mới nhất, sửa bài đổi tệp đính kèm. Không đổi API/contract (PATCH `media` đã có: thay toàn bộ danh sách).

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Bỏ h1 «Báo cáo vi phạm» / «Yêu cầu tham gia» (màn quản trị) | `ui/flows/parts.tsx` | [x] |
| 2 | Nút thu gọn vào hàng `.ctop`, cao 34px, căn giữa | `ui/Composer.tsx`, `styles/extras.css`, `feed.css` | [x] |
| 3 | 2 bình luận mới nhất + «Xem thêm N bình luận» | `ui/Thread.tsx`, `domain/thread.ts`, i18n `thread.more` | [x] |
| 4 | Sửa bài: thêm/bớt tệp | `ui/AttachEditor.tsx`, `ui/PostCard.tsx`, `adapters/mock.ts` | [x] |

## Không làm
Hộp chọn «Nhắc tên», avatar/bìa/hồ sơ (cr147b), xem trước PDF/Word (CR-149), Profile*/MyProfile/MentionBox/MentionPeople.

## Test tối thiểu
`domain/thread-recent.test.ts`, `adapters/mock.test.ts`, e2e `e2e/community-web/cr147-feed.cm.ts` (chưa chạy; điều phối chạy cuối đợt).

## Quyết định trong lúc làm
- Ý 3: không sửa contract (`PostView`) nên chưa trả kèm 2 bình luận trong trang bảng tin; bình luận vẫn nạp khi mở bài, nạp đủ các trang (≤ 20) rồi cắt đuôi 2. Số câu SQL bảng tin không đổi.
- Ý 4: backend `update` đã thay media + `replaceChildren` ⇒ tệp bị bỏ không còn trên bài nào ⇒ vòng dọn tệp mồ côi (24 h) tự xoá; quyền tải theo quyền xem bài giữ nguyên. Chỉ gửi `media` khi người dùng đổi (không mở lại lượt duyệt vô cớ).
- Ý 1: giữ đoạn dẫn của đối tác (`intro`); chỉ bỏ tiêu đề ở chế độ `bare`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md

#### Yêu cầu: Màn quản trị «Yêu cầu tham gia» và «Báo cáo vi phạm» không lặp tên tab bằng tiêu đề
- Kịch bản: khi quản trị mở hai màn này thì không có dòng tiêu đề lặp tên tab [test: thủ công — soát UI; chưa có e2e, xem Việc còn lại]

#### Yêu cầu: Nút thu gọn ô đăng thẳng hàng với nút loại bài
- Kịch bản: khi ô đăng mở thì nút thu gọn cùng hàng, cùng cao, căn giữa dọc [test: e2e/community-web/cr147-feed.cm.ts » ô đăng mở: nút thu gọn cùng hàng, cùng chiều cao và căn giữa dọc với nút loại bài]

#### Yêu cầu: Bình luận mặc định hiện 2 mới nhất
- Kịch bản: khi bài có > 2 bình luận thì hiện 2 mới nhất và nút «Xem thêm N bình luận» mở phần còn lại [test: e2e/community-web/cr147-feed.cm.ts » bài có 3 bình luận: mặc định 2 mới nhất, «Xem thêm 1 bình luận» mở phần cũ]
- Kịch bản: khi cắt danh sách thì giữ 2 cuối, ≤ 2 hiện hết [test: apps/workspace-web/src/modules/community/domain/thread-recent.test.ts » visibleComments (CR-147)]

### MODIFIED community/nghiep-vu.md

#### Yêu cầu: Sửa bài thêm / bớt / thay tệp đính kèm (CR-147; mở rộng «Đính kèm tệp vào bài»)
Người đăng sửa bài được thêm tệp (cùng luật tải lên) và bỏ tệp; lưu thay toàn bộ danh sách. Tệp bị bỏ vào cơ chế dọn tệp không dùng.
- Kịch bản: khi sửa bài, bỏ một tệp, thêm một tệp, lưu thì thẻ tệp đổi theo [test: e2e/community-web/cr147-feed.cm.ts » sửa bài: bớt một tệp, thêm một tệp, lưu ⇒ thẻ tệp đổi theo]
- Kịch bản: khi PATCH có `media` thì thay toàn bộ, vắng `media` thì giữ nguyên [test: apps/workspace-web/src/modules/community/adapters/mock.test.ts » PATCH media thay toàn bộ]

## Việc còn lại
- Trả kèm 2 bình luận mới nhất + tổng số trong `PostView` (cần backend-lead đổi contract; SQL: lateral/`row_number()` một câu theo trang) để thẻ bài hiện bình luận không cần bấm mở.
- Kịch bản ý 1 chưa có test tự động (đề nghị QC thêm assert không có heading ở e2e admin).
