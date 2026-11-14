# fix-e2e-community — 3 lỗi sản phẩm do e2e cuối đợt (CR-147)

## Plan
QC phân loại «b» (lỗi sản phẩm) ở `docs/specs/qc-e2e-community-journey/tasks.md`. Mỗi lỗi có test ở tầng rẻ nhất; không sửa e2e đã khoá.

## Làm
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Ô đăng: nút thu gọn nằm tuyệt đối ở góc phải hàng 1 của `.ctop` (mọi vai); «Điền từ» của chủ quản cao 34px, tự xuống dòng bên trái nút (`feed.css`, `extras.css`) | xong (CSS; chứng minh bằng e2e `cr147-feed.cm.ts`) |
| 2 | Bảng tin: đổi người xem/vai/bộ lọc ⇒ bỏ danh sách cũ, trang đầu thay hẳn (`domain/feed-merge.ts` + `useFeed.ts`) | xong (unit `feed-merge.test.ts`) |
| 3 | Hồ sơ cá nhân: chọn ảnh đại diện báo «Chưa lưu được ảnh» (e2e P1). Trace: KHÔNG có request PUT ⇒ client lỗi trước khi gọi API (không phải trần 150 KB, ảnh test 1×1). Sửa phòng thủ: `encodeAvatar` (WebP→JPEG, `toBlob` null/ném lỗi ⇒ `toDataURL`), giải mã dự phòng `<img>` khi `createImageBitmap` không có/lỗi, lỗi thật hiện trong thông báo + `console.error` (`domain/avatar-encode.ts`, `ui/profile/image-file.ts`, `ImagePick.tsx`) | xong: unit + e2e `community-web-stack` 25/25 xanh (evotest, cf5bf20ff) |

## Không làm / Chạm
Không đổi contract, hub, e2e. Chạm: `modules/community` (application, domain, ui/profile, ui/styles).

## Test tối thiểu
- unit: `feed-merge.test.ts`, `image.test.ts`.
- e2e (evotest, theo tên việc): `community-web community-web-stack`.

## Quyết định trong lúc làm
- (3) Selector `me-avatar` của e2e P1 đã được QC sửa khớp `PersonAvatar` (tôi hoàn lại thay đổi testid). Nguyên nhân thật của «Chưa lưu được ảnh» CHƯA xác định chắc chắn (không tái hiện local); sau khi thêm `toDataURL`/`<img>` dự phòng e2e P1 xanh nên nghi `canvas.toBlob`/`createImageBitmap` của Chromium headless; unit chỉ giả lập `toBlob` null/ném lỗi/PNG to. Thông báo lỗi nay kèm message thật + `console.error` ⇒ lần chạy e2e kế đọc `error-context.md` để biết nguyên nhân. Tạm thời hậu tố message trong UI là bằng chứng gỡ lỗi; bỏ sau khi P1 xanh.
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
- Kịch bản: khi trình duyệt chỉ trả PNG to thì chọn bản JPEG ≤ 150 KB, không có thì không lưu [test: apps/workspace-web/src/modules/community/domain/avatar-encode.test.ts » encodeAvatar]; [test: apps/workspace-web/src/modules/community/domain/image.test.ts » pickAvatarBlob]

#### Yêu cầu: Nút thu gọn ô đăng luôn ở hàng đầu
Nút thu gọn đứng ở góc phải hàng đầu của ô đăng, cùng cao với nút loại bài, với mọi vai.
- Kịch bản: khi chủ quản mở ô đăng thì nút thu gọn cùng hàng với nút loại bài [test: e2e/community-web/cr147-feed.cm.ts » ô đăng mở: nút thu gọn cùng hàng]
