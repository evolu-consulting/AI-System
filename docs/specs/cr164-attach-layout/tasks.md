---
id: cr164-attach-layout
lát: cr164-attach-layout
cr: CR-164
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
MỘT bộ hiển thị ảnh + tệp đính kèm ở `packages/web-kit` (logic thuần `attach-layout.ts`; `ui/AttachGallery.tsx`, `ui/AttachDraft.tsx`), Community và chat-web dùng lại. Nguồn ảnh qua `getUrl(id)` (mỗi app lấy blob URL có xác thực; bộ chung thu hồi). Style nội tuyến + `currentColor`, chữ qua `labels` (i18n ở app).

## Làm
- Lưới ảnh 1 lớn / 2 ngang / 3 (1 lớn + 2 nhỏ) / ≥4 lưới 2×2, ô cuối «+N» khi ≥5 ảnh; bấm ⇒ phóng to, qua lại (nút, ←/→), Esc đóng, «Tải về».
- Thẻ tệp xếp dọc: icon theo loại, tên cắt giữa, dung lượng, nút tải; PDF thêm «Xem» trong trang (khung trong hộp phóng to); tệp đã xoá ⇒ thẻ xám.
- Lúc soạn: ảnh thu nhỏ / thẻ tệp, nút ✕ bỏ, thanh tải lên (chạy vô định, fetch không có tiến trình thật).
- Community: `PostMedia`, `DraftAttachments` (Composer + AttachEditor) dùng bộ chung; gỡ `ImageViewer`, `useImageUrl`, `imageGrid/splitMedia/stepImage` và CSS cũ. chat-web: `AttachmentList`, `AttachBar` dùng bộ chung.
- Nút cùng hàng `gap` 8px (CR-163).

## Không làm / Chạm
Không đổi API/backend, giới hạn số/cỡ tệp, trò chuyện công ty (CR-161), không thêm thư viện.

## Test tối thiểu
`packages/web-kit/src/attach-layout.test.ts`, `apps/chat-web/src/features/attachments/components/AttachGallery.test.tsx`; e2e (viết, chưa chạy): `e2e/community-web/cr129-media.cm.ts`, `composer.cm.ts`, `cr147-feed.cm.ts`, `e2e/chat/x1-attachments.chat.ts`, `e2e/stg/uat-cr118.stg.ts`; chạy lại thêm `e2e/chat/x2b2-attach.x2b2.ts`.

## Quyết định trong lúc làm
- Test component đặt ở chat-web vì web-kit chưa có `react-dom` (không thêm thư viện).
- Thanh tải lên chạy vô định: upload bằng fetch, không có tiến trình thật; `DraftItem.progress` sẵn cho khi có.
- Nút tải trên thẻ tệp là icon + aria-label «Tải về {tên}» (giữ nhãn cũ chat «Tải {filename}»).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Ảnh trong bài dạng lưới thu nhỏ, bấm xem phóng to
Lưới theo số ảnh (1 lớn giữ tỉ lệ · 2 ngang · 3 = 1 lớn + 2 nhỏ · ≥ 4 lưới 2×2, ô cuối «+N» khi ≥ 5); bấm mở hộp phóng to, qua lại, Esc đóng, «Tải về». Tệp là thẻ xếp dọc (icon theo loại, tên dài cắt giữa, dung lượng, nút tải; PDF thêm «Xem»). Lúc soạn: ảnh thu nhỏ / thẻ tệp, nút ✕ bỏ, thanh tải lên. Cùng bộ hiển thị với Chat (`@ai/web-kit`).
- Kịch bản: khi bài có 1, 2, 3, 4 hoặc 7 ảnh thì bố cục lần lượt một, hai, ba, bốn và 7 ảnh chỉ hiện 4 ô, ô cuối «+3» [test: apps/chat-web/src/features/attachments/components/AttachGallery.test.tsx » 7 ảnh]
- Kịch bản: khi bài có ảnh lẫn tệp thì ảnh vào lưới, tệp thành thẻ, PDF có Xem [test: apps/chat-web/src/features/attachments/components/AttachGallery.test.tsx » ảnh + tệp lẫn]
- Kịch bản: khi tên tệp dài thì cắt giữa và giữ đuôi [test: packages/web-kit/src/attach-layout.test.ts » tên dài cắt giữa]
- Kịch bản: khi đang soạn thì mỗi tệp có nút bỏ và thanh tải lên [test: apps/chat-web/src/features/attachments/components/AttachGallery.test.tsx » mỗi mục có nút bỏ]
- Kịch bản: khi đăng 5 ảnh thì thấy 4 ô và «+1», bấm mở hộp phóng to, qua lại, Esc đóng [test: e2e/community-web/cr129-media.cm.ts » bài 5 ảnh]
- Kịch bản: khi mở tin chat có 3 ảnh thì lưới 1 lớn + 2 nhỏ, ảnh tải bằng fetch có Authorization [test: e2e/chat/x1-attachments.chat.ts » CR-164 · lịch sử]

## Việc còn lại
Chạy e2e cuối đợt; gộp Delta vào `docs/current/community/hien-thi.md`; thêm mục chat-web vào docs/current khi có file phù hợp.
