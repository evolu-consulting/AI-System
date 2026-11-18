---
id: cr186-composer
lát: cr186-composer
cr: CR-186
làn: nhanh
migration: không
phụ thuộc: cr185-avatar (đã gộp)
---
## Plan (ngắn)
4 ý CR-186 trên màn Bảng tin trong Sổ Hợp Tác (workspace-web `modules/community`; `apps/community-web` không còn): loại bài 390px, ô đăng dính + thu «Viết bài…», hộp «Nhắc tên» làm lại (lọc nhóm, avatar, tải dần), 3 bình luận mới nhất.

## Làm
- [x] 3 bình luận mới nhất: `post.sql.ts` limit 3, mock `slice(-3)`, contract + int test `comments.routes.int.test.ts`.
- [x] Nhắc tên (BE): `group=internal|partner|customer` ở `GET /mentionable-people` (`orgsInGroup` một câu SQL theo vai SHT; chỉ thu hẹp). int test `post-mention.int.test.ts`.
- [x] Nhắc tên (FE): Select nhóm (chủ quản) + ô tìm, dòng `PersonAvatar` (kit) + tên + công ty/«Nội bộ», ≥ 44px, tải dần giữ nguyên.
- [x] Ô đăng: mobile hàng loại bài cuộn ngang ≥ 44px (CSS, fieldset `min-width:0`); mốc `useStuck` ⇒ bóng dưới khi dính; hẹp + đã cuộn ⇒ `CompactBar` «Viết bài…».
- [x] e2e viết, CHƯA chạy: `e2e/community-web/cr186-composer.cm.ts`.

## Không làm / Chạm
- Không đổi migration. Chức vụ của người trong Nhắc tên: API chưa trả ⇒ chưa hiện.
- `MyProfileHeader` còn dùng `ui/PersonAvatar` cũ (cỡ 72px, ngoài cỡ 24/32/40 của kit) và `UserMenu`/`Header`/messages-web chưa đổi ⇒ việc dở cho một lát dọn avatar (G2): thêm cỡ lớn cho kit hoặc bỏ cỡ 72.

## Test tối thiểu
- unit `useStuck.test.ts`; int `post-mention.int.test.ts` (nhóm), `comments.routes.int.test.ts` (3 bình luận).
- e2e khoá bị ảnh hưởng (cho qc): `e2e/community-web/cr147-feed.cm.ts` ca «bài có 3 bình luận: mặc định 2 mới nhất, «Xem thêm 1 bình luận» mở phần cũ» (giờ p1 hiện đủ 3, không còn «Xem thêm»; ca mới ở cr186-composer.cm.ts thay thế).

## Quyết định trong lúc làm
- «Khách hàng» = công ty đối tác có vai `customer` (SHT `contracts.partner_roles` qua `community_partners`); «Đối tác» = vai `supplier` hoặc chưa có vai; công ty vừa NCC vừa mua nằm ở cả hai; «Nội bộ» = chủ quản. Đối tác (user ngoài) không thấy ô lọc nhóm.
- Ô đăng chỉ thu «Viết bài…» khi chưa có nháp (body/ảnh/người nhắc) để không mất chỗ đang gõ.
- Giữ markup `fieldset.seg` + nút (không đổi sang ToggleGroup role=radio) để e2e cũ `getByRole("button")` vẫn đúng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Thanh tab bảng tin không che bài đầu (nguồn: cr120-handson-fixes)
Ô đăng bài + thanh tab dính đầu vùng cuộn khi ô thu gọn, nền đặc, có bóng nhẹ dưới khi đang dính (bài cuộn bên dưới không lộ phía trên). Trên điện thoại (≤ 640px) loại bài trong ô đăng mở là MỘT hàng nút cuộn ngang, cao ≥ 44px, không tràn; khi cuộn xuống (và chưa có nháp) ô thu thành một dòng «Viết bài…», bấm ⇒ cuộn về đầu và mở đầy đủ.
- Kịch bản: khi mở ô đăng ở 390px thì ba nút loại bài cùng một hàng, cao ≥ 44px, trang không cuộn ngang [test: e2e/community-web/cr186-composer.cm.ts » ô đăng mở: loại bài là một hàng nút ≥ 44px, không tràn ngang]
- Kịch bản: khi cuộn xuống ở 390px thì ô đăng thành «Viết bài…» dính dưới thanh trên; bấm thì mở đầy đủ [test: e2e/community-web/cr186-composer.cm.ts » cuộn xuống: ô đăng dính dưới thanh trên, thu thành «Viết bài…», bấm ⇒ mở đầy đủ]
- Kịch bản: khi mở Nhắc tên ở 390px thì dòng người cao ≥ 44px và ô lọc không tràn [test: e2e/community-web/cr186-composer.cm.ts » hộp Nhắc tên: dòng cao ≥ 44px, bộ lọc nhóm không tràn]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Hộp «Nhắc tên» lọc theo nhóm, tải dần (CR-186)
Ngoài ô tìm tên, chủ quản có ô lọc nhóm «Tất cả · Nội bộ · Đối tác · Khách hàng» (`group` ở `GET /pack/community/mentionable-people`). Nội bộ = chủ quản; Đối tác = công ty có vai nhà cung cấp (hoặc chưa có vai); Khách hàng = công ty có vai mua. Lọc chỉ thu hẹp tập người xem được bài. Mỗi dòng: avatar, họ tên, công ty (nội bộ: «Nội bộ»), cao ≥ 44px; danh sách tải dần.
- Kịch bản: khi lọc nhóm thì chỉ người đúng nhóm, vẫn trong phạm vi người xem bài; group sai thì 400 [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » CR-186 · lọc nhóm: Nội bộ = chủ quản, Đối tác = công ty NCC, Khách hàng = công ty có vai mua, chỉ thu hẹp (không mở thêm quyền), group sai ⇒ 400]
- Kịch bản: khi chọn «Khách hàng» ở hộp Nhắc tên thì chỉ hiện người công ty khách hàng [test: e2e/community-web/cr186-composer.cm.ts » Nhắc tên: lọc nhóm Tất cả · Nội bộ · Đối tác · Khách hàng + tìm tên]

#### Yêu cầu: Bảng tin trả kèm 3 bình luận mới nhất (CR-186, thay 2 của CR-147)
`recentComments` = 3 bình luận mới nhất người xem được (cũ → mới); «Xem thêm» tải phần cũ hơn như CR-147.
- Kịch bản: khi lấy bảng tin thì mỗi bài có đúng 3 bình luận mới nhất người xem được, bình luận riêng tư không lộ [test: apps/hub-api/src/modules/packs/community/adapters/comments.routes.int.test.ts » CR-147c · bảng tin trả kèm 3 bình luận mới nhất + tổng số, tải dần phần cũ hơn]
- Kịch bản: khi bài có 4 bình luận thì hiện 3 + «Xem thêm 1 bình luận» [test: e2e/community-web/cr186-composer.cm.ts » 3 bình luận mới nhất: bài 4 bình luận hiện 3 + «Xem thêm 1 bình luận»]

## Việc còn lại
- QC chạy e2e `cr186-composer.cm.ts` + sửa ca cr147-feed (khoá); soát hình 390px thật (chưa xem bằng mắt).
