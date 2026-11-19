---
id: cr189-avatar-list
lát: cr189-avatar-list
cr: CR-189
làn: nhanh
migration: không
phụ thuộc: cr187-avatar-rules
---
## Plan (ngắn)
Mở rộng `PersonAvatarGroup` thành «Danh sách avatar» (BR-189-3): tối đa 5 + «+n», bấm mở Popover danh sách.

## Làm
- [x] `person-avatar.tsx`: `splitAvatars`, `AvatarListBody`, `PersonAvatarGroup` (max 5, popover, 44px điện thoại, aria-label).
- [x] `avatar.tsx` `AvatarGroup` mặc định max 5 (một con số cho mọi nhóm).
- [x] `RULES.md:24` «tối đa 3» ⇒ 5.
- [x] unit + e2e (viết, chưa chạy).

## Không làm / Chạm
Không làm thẻ phòng sơ đồ. Chạm: `packages/web-kit/src/ui/kit/{person-avatar,avatar}.tsx`, RULES.md, `kit-a.test.tsx`, `apps/workspace-web/src/shared/ui/person-avatar.test.tsx`. Không có nơi nào gọi `PersonAvatarGroup` ngoài test; `AvatarGroup` ở `MessageList.tsx` (người đã đọc) đổi 3 ⇒ 5.

## Test tối thiểu
`bun test apps/workspace-web/src/shared/ui/person-avatar.test.tsx packages/web-kit/src/ui/kit/kit-a.test.tsx`

## Quyết định trong lúc làm
- Chuỗi nhãn không cứng: web-kit không có i18n ⇒ nút lấy `label` từ nơi gọi, mặc định các họ tên nối dấu phẩy.
- Không có DOM trong bun test ⇒ mở/đóng/Esc do Radix Popover (đã có test overlay) + e2e; unit test phần thuần và markup tĩnh.
- e2e để `fixme` tới khi lát thẻ phòng gắn component.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED web/giao-dien-chung.md
#### Yêu cầu: Nhãn trạng thái và avatar (nguồn: cr177-u2-kit-a)
Nhãn trạng thái 5 màu cố định, luôn có icon; avatar người tròn, công ty vuông bo (28%), cỡ 24/32/40; nhóm avatar tối đa 5 rồi «+N»; bấm nhóm người mở danh sách (avatar, họ tên, chức vụ), cuộn khi hơn 8 người.
- Kịch bản: khi nhóm có 7 người thì hiện 5 avatar và «+2» [test: packages/web-kit/src/ui/kit/kit-a.test.tsx » AvatarGroup 7 người ⇒ 5 avatar + «+2»]
- Kịch bản: khi danh sách có 9 người thì cuộn, 8 người thì không [test: apps/workspace-web/src/shared/ui/person-avatar.test.tsx » danh sách: họ tên + chức vụ, tới 8 không cuộn, trên 8 cuộn]

## Việc còn lại
- (đã gắn ở lát cr189-org-chart-cards; e2e bỏ fixme)
