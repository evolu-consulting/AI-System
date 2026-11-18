---
id: cr186-comment-mention
lát: cr186-comment-mention
cr: CR-186
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Người dùng chốt «Nhắc người ở cả hai»: «@» trong ô bình luận mở CHUNG hộp «Nhắc tên» (`MentionPicker`) như ô đăng bài và nhắc NGƯỜI; chuông tới người được nhắc.

## Làm
- [x] Contract `CreateCommentInput.mentionUserIds` (≤ 10, chỉ thêm); `mentions` (công ty) giữ `@deprecated` cho dữ liệu cũ + tương thích, UI không gửi. Bỏ `MentionablesQuery/MentionableSchema`.
- [x] `comment-list.service.add`: `resolvePeople` (ngoài tx) + `assertSeen` (trong tx, công ty người đó phải thấy bài) — dùng lại đúng luật nhắc người của bài đăng (CR-145); sai ⇒ 422 `MENTION_USER_NOT_ALLOWED`, không ghi bình luận.
- [x] Chuông: `emitComment` thêm `mentionUsers` ⇒ «X nhắc bạn trong một bình luận» (`commentMentionText`, link `?post=&comment=`, khoá `cm:<bình luận>`), cùng loại tuỳ chọn «Được nhắc»; không báo chính người viết, không trùng chuông «nhắc công ty».
- [x] Bỏ `GET /posts/:id/mentionables`, `MentionBox`, `listMentionables` (port/http/mock) — không còn chỗ dùng. `PeopleScope.postId` ⇒ `GET /mentionable-people?postId=` (đã có ở server).
- [x] Web: ô bình luận = `Input` (role combobox, tên «Viết bình luận») + `MentionPicker` điều khiển từ ngoài (gõ «@» đầu từ hoặc nút «Nhắc tên»); người chọn ⇒ chèn «@Tên»; gửi chỉ người còn «@Tên» trong chữ.

## Không làm / Chạm
- Không migration. KHÔNG chạm RLS/policy; chạm LOGIC quyền ở tầng service (ai nhắc được ai = luật CR-145 sẵn có, không mở rộng) + `comment-list.service`, `notify.events`.
- Không lưu danh sách người được nhắc theo bình luận (chưa có cột): người được nhắc chỉ nhận chuông + thấy «@Tên» trong chữ. Cần lưu (hiện «Nhắc: …», sửa bình luận giữ lời nhắc) ⇒ xin migration số kế tiếp ở lát sau.
- Server còn nhận `mentions` (công ty) cho dữ liệu/tương thích cũ (nhiều int test visibility dựa vào); UI không gửi nữa. Muốn cấm ghi hẳn: lát sau đổi test.
- Bình luận cũ nhắc công ty: giữ nguyên, chỉ đọc (`CommentView.mentions`), tô đậm như cũ.

## Test tối thiểu
- unit `notify.rules.test.ts` (commentMentionText), `thread.test.ts`, `mock.test.ts`, `http.test.ts`.
- int `post-mention.int.test.ts » CR-186 · nhắc NGƯỜI trong bình luận` (N2: chủ quản không phải người tạo bài; ngoài quyền bị loại; đối tác chỉ đồng nghiệp; bình luận cũ vẫn đọc), `comments.routes.int.test.ts`, `notify.int.test.ts` (bỏ ca gợi ý mentionables).
- e2e khoá bị ảnh hưởng (cho qc): `e2e/community-web/cr129-mention.cs.ts` (gõ «@» nhắc công ty, popover cũ `mention-popover`).

## Quyết định trong lúc làm
- Ô bình luận giữ `role="combobox"` + tên «Viết bình luận» để e2e cũ vẫn chọn được ô.
- Nhắc người chỉ chặn ở service (không đổi RLS): bình luận của chủ quản đối tác nào cũng thấy, của đối tác chỉ cùng công ty ⇒ người được nhắc luôn thấy bình luận.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Bình luận thường, không còn bước «Nhắn riêng» (CR-129)
«@» trong ô bình luận (hoặc nút «Nhắc tên») mở CHUNG hộp «Nhắc tên» của ô đăng bài và nhắc NGƯỜI: gửi `mentionUserIds` (≤ 10), chỉ người thấy được bài (đối tác: chỉ đồng nghiệp công ty mình), ngoài tập ⇒ 422 `MENTION_USER_NOT_ALLOWED`. Người được nhắc nhận chuông «X nhắc bạn trong một bình luận» trỏ đúng bình luận; người viết không nhận. Không còn gợi ý nhắc công ty (`GET /posts/:id/mentionables` bỏ); bình luận cũ nhắc công ty vẫn hiện như cũ (chỉ đọc).
- Kịch bản: khi chủ quản khác người tạo bài nhắc người thấy được bài thì 201 và người đó nhận chuông trỏ đúng bình luận [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » N2 · chủ quản KHÁC người tạo bài nhắc người thấy được bài ⇒ 201, người đó nhận chuông trỏ đúng bình luận, người viết không nhận]
- Kịch bản: khi nhắc người ngoài quyền xem bài thì 422 và không ghi bình luận, không chuông [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » người NGOÀI quyền xem bài (khách mua, bài chỉ cho NCC) ⇒ 422 MENTION_USER_NOT_ALLOWED, không ghi bình luận, không chuông, người tenant khác ⇒ 422]
- Kịch bản: khi gõ «@» ở ô bình luận thì mở hộp «Nhắc tên» có lọc nhóm + tìm, chọn người thì «@Tên» vào chữ [test: e2e/community-web/cr186-comment-mention.cm.ts » gõ «@» ở ô bình luận ⇒ hộp «Nhắc tên» có lọc nhóm + tìm, chọn người ⇒ «@Tên» vào chữ, gửi ⇒ bình luận hiện «@Tên»]

## Việc còn lại
- QC sửa `cr129-mention.cs.ts`, chạy `cr186-comment-mention.cm.ts`; soát hình hộp «Nhắc tên» trong bình luận.
- (tuỳ) migration lưu người được nhắc theo bình luận.
