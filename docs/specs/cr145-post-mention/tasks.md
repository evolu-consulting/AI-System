---
id: cr145-post-mention
lát: cr145-post-mention
cr: CR-145
làn: nhanh
migration: 0019 (pack-community)
phụ thuộc:
---
## Plan (ngắn)
Chủ quản mặc định loại bài «Thông báo»; nhắc NGƯỜI trong bài đăng (≤ 10, chỉ người thấy được bài) kèm chuông «X nhắc bạn trong một bài».

## Làm
- [x] Composer: `defaultPostType` (chủ quản ⇒ `note`, đối tác ⇒ loại đầu được phép) — `domain/mention.ts`, `Composer.tsx`.
- [x] Migration 0019: `community.post_mentions` + RLS (tenant, bài thấy được, đối tác chỉ thấy chủ quản/công ty mình).
- [x] Contract: `mentionUserIds` (tạo/sửa, ≤ 10, uuid), `PostView.mentionedUsers`, `GET /mentionable-people`.
- [x] Server: `post-mention.service.ts` (kiểm theo tập: danh bạ một câu + `orgsSeeingPost`), 422 `MENTION_USER_NOT_ALLOWED`; chuông `emitPostMentions` sau commit / khi duyệt (`onApproved`).
- [x] UI: ô «Nhắc tên» (`MentionPeople.tsx`) + chip; bài hiện «Nhắc: A, B».
- [x] Test: unit (web + chữ chuông), int `post-mention.int.test.ts`, e2e `e2e/community-web/cr145-post-mention.cs.ts` (viết, chưa chạy).

## Không làm / Chạm
Không đổi mention bình luận (công ty), không sửa test khoá. Sửa bài trên UI chưa có ô «Nhắc tên» (API `PATCH` đã hỗ trợ).

## Test tối thiểu
`apps/workspace-web/src/modules/community/domain/post-mention.test.ts`, `apps/hub-api/src/modules/packs/community/domain/post-mention.rules.test.ts`, `apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts`.

## Quyết định trong lúc làm
- Tên trường contract theo khuôn camelCase hiện có: `mentionUserIds` (không `mention_user_ids`).
- Chuông dùng loại tuỳ chọn `mention` («Được nhắc») có sẵn, chữ riêng «X nhắc bạn trong một bài»; khoá trùng `pm:<bài>` (gọi lại khi duyệt vô hại).
- Đối tác chỉ nhắc đồng nghiệp công ty mình (không lộ tên người chủ quản/công ty khác). Chủ quản nhắc: người chủ quản có quyền đọc gói + người công ty đối tác thấy bài.
- `post_mentions` chụp `user_name`/`user_org` lúc nhắc (feed không đọc `admin.users`); RLS chặn đối tác đọc người công ty khác.
- Sửa bài có thêm người mới khi khe duyệt bật ⇒ mở lại lượt duyệt, chuông gửi lúc duyệt; không bật ⇒ báo ngay người mới.
- Đổi phạm vi người xem SAU khi đã nhắc không tự gỡ người nhắc cũ (chỉ kiểm lúc ghi danh sách).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md

#### Yêu cầu: Chủ quản mặc định đăng loại «Thông báo»
- Kịch bản: khi chủ quản mở ô soạn bài thì loại bài mặc định là «Thông báo», còn đối tác thì là loại đầu tiên công ty được phép đăng [test: apps/workspace-web/src/modules/community/domain/post-mention.test.ts » chủ quản (được đăng «Thông báo») ⇒ note]

#### Yêu cầu: Nhắc tên người trong bài đăng, chỉ người xem được bài
- Kịch bản: khi chủ quản đăng bài và nhắc người thuộc nhóm xem bài thì bài đăng được và người được nhắc nhận chuông, người đăng không nhận [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » chủ quản nhắc người thấy được bài ⇒ 201]
- Kịch bản: khi nhắc người của công ty không thuộc nhóm xem bài thì bị từ chối 422 và bài không được tạo [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » nhắc người của công ty KHÔNG thuộc nhóm người xem bài ⇒ 422 MENTION_USER_NOT_ALLOWED]
- Kịch bản: khi đối tác nhắc người thì chỉ nhắc được đồng nghiệp công ty mình [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » đối tác chỉ nhắc đồng nghiệp công ty mình: nhắc chủ quản]
- Kịch bản: khi người công ty khác hoặc tenant khác đọc danh sách người được nhắc thì không thấy [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » RLS post_mentions: người công ty khác]
- Kịch bản: khi người dùng tìm người để nhắc thì chỉ thấy người trong phạm vi được phép [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » gợi ý người: chủ quản thấy chủ quản]

#### Yêu cầu: Chuông «X nhắc bạn trong một bài»
- Kịch bản: khi sửa bài thêm người mới thì chỉ người mới nhận chuông [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » sửa bài thêm người mới ⇒ chỉ người MỚI nhận chuông]
- Kịch bản: khi bài chờ duyệt thì chưa báo, được duyệt mới báo và người đăng không nhận [test: apps/hub-api/src/modules/packs/community/adapters/post-mention.int.test.ts » bài chờ duyệt: chưa báo]
- Kịch bản: khi chuông được gửi thì chữ là «X nhắc bạn trong một bài» và bấm mở đúng bài [test: apps/hub-api/src/modules/packs/community/domain/post-mention.rules.test.ts » không tiêu đề ⇒ «X nhắc bạn trong một bài»]
