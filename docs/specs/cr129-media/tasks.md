# cr129-media — ảnh trong bài đăng + soát composer/hồ sơ (CR-129 f/d/e)

Làn nhanh, một agent. Không đổi hub/migration/contract. (a)(b)(c) đã có từ trước, không làm lại.

## Quyết định
- Ảnh có `fileId` ⇒ lưới ≤ 3 ô (`imageGrid`), ô cuối «+N»; tải qua `api.fileObjectUrl` (Bearer ⇒ blob ⇒ object URL), lazy bằng IntersectionObserver, thu hồi URL khi gỡ ô (`useImageUrl`).
- Bấm ảnh ⇒ `ImageViewer` (Dialog shadcn: Esc, tiêu điểm, ‹ ›, ←/→, Tải về). Tệp khác giữ `file-card`. Nhánh video bỏ (kind `video` mẫu không còn dạng phát, vẽ như ô nhãn).
- 415 ⇒ «Chỉ nhận: PDF, PNG, JPG, …» từ `ATTACH_ALLOWED` (không có video ⇒ không đổi contract).
- (d) Composer: đã đạt (nút đính kèm chỉ icon có `aria-label`, `.icononly` `flex:none`, `.cbar` wrap, textarea `min-height` 76) ⇒ không sửa.
- (e) MyProfile: đã đạt (tab «Bài đăng của tôi» trước + «Bài đăng của tổ chức», khối «Công ty» là phần phụ) ⇒ không sửa.

## Việc
- [x] `domain/media.ts` (+ unit) · `PostMedia.tsx` · `ImageViewer.tsx` · `useImageUrl.ts` · port `fileObjectUrl` (http + mock) · CSS · i18n VI/EN
- [x] e2e viết, CHƯA chạy: `e2e/community-web/cr129-media.cm.ts`
- [ ] Chạy e2e cuối đợt; e2e có thể vỡ: không thấy spec nào chọn `.mbox`/icon ảnh cũ (`composer.cm.ts` dùng `file-card` ⇒ giữ nguyên).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)

### MODIFIED community/hien-thi.md
#### Yêu cầu: Ảnh trong bài đăng hiện dạng lưới thu nhỏ và xem phóng to
Bài có ảnh hiện tối đa 3 ô thu nhỏ (1 ảnh rộng, 2 đôi, ≥ 4 thì ô cuối phủ «+N»); bấm ảnh mở hộp xem phóng to, qua lại giữa ảnh, Esc đóng, có nút Tải về. Tệp không phải ảnh giữ thẻ Tải về. Ảnh chỉ tải khi cuộn tới.
- Kịch bản: khi bài có 4 ảnh thì lưới có 3 ô và ô cuối phủ «+1» [test: apps/workspace-web/src/modules/community/domain/media.test.ts » CR-129 lưới ảnh]
- Kịch bản: khi bấm ảnh rồi bấm Ảnh sau thì sang ảnh kế và đi vòng tròn [test: apps/workspace-web/src/modules/community/domain/media.test.ts » stepImage đi vòng tròn]
- Kịch bản: khi đăng bài 4 ảnh rồi bấm ảnh thì mở hộp phóng to, Esc đóng [test: e2e/community-web/cr129-media.cm.ts » bài 4 ảnh]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Đính kèm chỉ nhận ảnh và tài liệu, lỗi 415 nói rõ định dạng
Bài đăng không nhận video (đã bỏ khỏi §4); tệp sai định dạng báo «Chỉ nhận: PDF, PNG, JPG, …» theo danh sách hệ thống.
- Kịch bản: khi tải tệp sai định dạng thì thông báo liệt kê định dạng nhận được và không có video [test: apps/workspace-web/src/modules/community/domain/media.test.ts » 415 nêu định dạng]

#### Yêu cầu: Bình luận trên bài là bình luận thường, không còn bước «Nhắn riêng»
Mục 6 viết lại theo hệ thống hiện có: chủ bài và đối tác bình luận trực tiếp; @ chọn đối tác; ai thấy bình luận theo bạn bè + RLS (chủ bài, người viết, người được tag, bạn bè của người viết); không còn bước ẩn «Nhắn riêng».
- Kịch bản: khi chủ bài viết bình luận thì không cần bước ẩn nào trước khi viết [test: e2e/community-web/cr129-mention.cs.ts » M1]
