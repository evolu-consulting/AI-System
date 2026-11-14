# fix-e2e-community — 3 lỗi sản phẩm do e2e cuối đợt (CR-147)

## Plan
QC phân loại «b» (lỗi sản phẩm) ở `docs/specs/qc-e2e-community-journey/tasks.md`. Mỗi lỗi có test ở tầng rẻ nhất; không sửa e2e đã khoá.

## Làm
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Ô đăng: nút thu gọn nằm tuyệt đối ở góc phải hàng 1 của `.ctop` (mọi vai); «Điền từ» của chủ quản cao 34px, tự xuống dòng bên trái nút (`feed.css`, `extras.css`) | xong (CSS; chứng minh bằng e2e `cr147-feed.cm.ts`) |
| 2 | Bảng tin: đổi người xem/vai/bộ lọc ⇒ bỏ danh sách cũ, trang đầu thay hẳn (`domain/feed-merge.ts` + `useFeed.ts`) | xong (unit `feed-merge.test.ts`) |
| 3 | Hồ sơ cá nhân: avatar xuất WebP→JPEG ≤ 150 KB, không gửi tệp gốc (`domain/image.ts`, `image-file.ts`) | xong (unit; lỗi e2e P1 thật là nhãn test, QC đã sửa e2e) |

## Không làm / Chạm
Không đổi contract, hub, e2e. Chạm: `modules/community` (application, domain, ui/profile, ui/styles).

## Test tối thiểu
- unit: `feed-merge.test.ts`, `image.test.ts`.
- e2e (evotest, theo tên việc): `community-web community-web-stack`.

## Quyết định trong lúc làm
- (3) Nguyên nhân e2e P1 KHÔNG phải trần 150 KB mà là selector `me-avatar-initials/-img` (QC đã đổi sang `span/img[data-testid="me-avatar"]`, khớp `PersonAvatar` hiện có; tôi hoàn lại thay đổi testid). Thêm rào phòng thủ: avatar xuất tới ≤ 150 KB (`pickAvatarBlob`), không được ⇒ báo «Chưa lưu được ảnh»; trước đây rơi về tệp gốc ≤ 2 MB bị server từ chối.
- (2) Khoá phạm vi gồm `userId/orgId/role` của người xem + bộ lọc; đổi ⇒ `setData(null)` ngay (không giữ bài cũ trong lúc chờ). Cùng phạm vi (đăng/thích) vẫn gộp để giữ phần đã tải dần.
- (1) Dùng `position:absolute` thay vì chỉnh thứ tự flex: nút luôn ở hàng 1 bất kể số control (chủ quản có «Điền từ» + nút 👤+).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Bảng tin tải lại từ đầu khi đổi người xem
Đổi người xem, vai hoặc bộ lọc thì danh sách bị bỏ và nạp lại từ trang đầu; chỉ khi cùng phạm vi (đăng, thích…) mới gộp để giữ phần đã tải dần.
- Kịch bản: khi người xem đổi sang vai không được thấy bài «chỉ dành cho người mua» thì danh sách không còn bài đó [test: apps/workspace-web/src/modules/community/domain/feed-merge.test.ts » đổi người xem/bộ lọc]; [test: e2e/community-web/feed.cm.ts]

#### Yêu cầu: Ảnh đại diện nén tới ≤ 150 KB
Ảnh đại diện cắt vuông ≤ 256 px, xuất WebP rồi JPEG nhẹ dần tới ≤ 150 KB; không đạt thì báo «Chưa lưu được ảnh», không gửi tệp gốc.
- Kịch bản: khi trình duyệt chỉ trả PNG to thì chọn bản JPEG ≤ 150 KB, không có thì không lưu [test: apps/workspace-web/src/modules/community/domain/image.test.ts » pickAvatarBlob]

#### Yêu cầu: Nút thu gọn ô đăng luôn ở hàng đầu
Nút thu gọn đứng ở góc phải hàng đầu của ô đăng, cùng cao với nút loại bài, với mọi vai.
- Kịch bản: khi chủ quản mở ô đăng thì nút thu gọn cùng hàng với nút loại bài [test: e2e/community-web/cr147-feed.cm.ts » ô đăng mở: nút thu gọn cùng hàng]
