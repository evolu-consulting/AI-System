---
id: cr187-avatar-rules
lát: cr187-avatar-rules
cr: CR-187
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Màu avatar người theo băm id (10 token sáng/tối), cờ toàn màn của Shell (chỉ dựng), hai mục luật trong RULES.md.

## Làm
- [x] `avatar-color.ts` (`avatarColorIndex`, `avatarColorStyle`) + 10 cặp token `--avatar-N-bg/-fg` sáng/tối.
- [x] `Avatar` (`colorId`), `PersonAvatar` kit + cũ (`id`) dùng màu theo id khi không có ảnh; `PersonPick` truyền id.
- [x] `FULLSCREEN_PATHS` + `isFullscreen` (nav.ts), Shell áp lớp; chưa trang nào dùng.
- [x] RULES.md: «Luật cuộn», «Luật chống nháy».

## Không làm / Chạm
Không đổi phông, không sửa Community/Tin nhắn, không dòng «tối đa 3» (CR-189). Chạm: web-kit (avatar, tokens, RULES), workspace-web Shell + PersonPick.

## Test tối thiểu
`avatar-color.test.ts`, `tokens.test.ts`, `person-avatar.test.tsx`, `shell-lib.test.ts`; tsc web-kit + workspace-web.

## Quyết định trong lúc làm
- Prop của kit `Avatar` tên `colorId` (không `id`, vì trùng thuộc tính HTML `id`).
- `UserAvatar` (thanh trên/chân thanh bên, tông accent theo CR-179), `MyProfileHeader` (Community), `messages-web` chưa truyền id: thuộc lát khác/giữ tông CR-179.
- Cờ toàn màn là danh sách đường dẫn `FULLSCREEN_PATHS` rỗng; lát áp trang thêm đường dẫn vào.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED web/bang-tin-giao-dien.md
#### Yêu cầu: Màu avatar người khi không có ảnh
Avatar người không ảnh có màu nền cố định theo mã người (10 màu, tương phản ≥ 4,5:1 sáng và tối); đổi tên không đổi màu; có ảnh thì dùng ảnh.
- Kịch bản: khi cùng mã người đổi tên thì màu giữ nguyên [test: apps/workspace-web/src/shared/ui/person-avatar.test.tsx » không ảnh + có id ⇒ nền/chữ là token avatar theo băm id]
- Kịch bản: khi có ảnh thì không dùng màu [test: apps/workspace-web/src/shared/ui/person-avatar.test.tsx » có ảnh ⇒ không dùng màu]
- Kịch bản: khi đo token thì mọi cặp ≥ 4,5:1 cả hai chế độ [test: packages/web-kit/src/ui/avatar-color.test.ts » đủ 10 cặp, tương phản ≥ 4,5:1]

## Việc còn lại
Áp `FULLSCREEN_PATHS` cho Tin nhắn/sơ đồ/màn ký (lát CR-187 #4, CR-190); truyền id ở `UserAvatar`, `MyProfileHeader`, `messages-web` (PeopleSearch, PersonTip, ConversationRow, MessageList) ở lát tương ứng.
