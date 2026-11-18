---
id: cr185-avatar
lát: cr185-avatar
cr: CR-185
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`PersonAvatar` + `TouchTip` + `PersonAvatarGroup` trong web-kit (`ui/kit/person-avatar.tsx`, `touch-tip.tsx`); thay mọi avatar người ở workspace-web; xoá `AvatarTip` (gom về một bản).

## Làm
- [x] Component chung + luật `RULES.md` + test
- [x] Thay ở Phụ trách (OwnerRow/OwnerPopover), SignersStrip, PersonPick, uỷ quyền (form + lịch sử), FlowAssignMembers
- [x] Bỏ `personTip`; trạng thái «Bên A · Đã ký» thành chữ cạnh avatar

## Không làm / Chạm
Sơ đồ `packages/flow-canvas` không vẽ avatar/chữ cái đầu ⇒ không đổi. `MyProfileHeader`, `UserMenu`, `MentionPicker` (hồ sơ/cộng đồng, dùng `ui/PersonAvatar` cũ) giữ nguyên.

## Test tối thiểu
unit `person-avatar.test.tsx`, `touch-tip.test.ts`, `OwnerRow.test.tsx`, `SignersStrip.test.tsx`; `check:ui-kit`, `i18n:check`, `tsc`.

## Quyết định trong lúc làm
- Avatar nằm trong nút/mục menu đã có tên bên cạnh ⇒ `interactive={false}` (tránh focus lồng nhau, tên đã hiện).
- Nút `owner-select` giữ `aria-label` «Phụ trách: tên» (nhãn đọc màn hình, không phải tooltip).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/person-avatar.md
#### Yêu cầu: Avatar người dùng chung
Mọi avatar người dùng `PersonAvatar`: rê chuột, focus bàn phím hoặc chạm (điện thoại) chỉ hiện HỌ TÊN; thiếu ảnh ⇒ chữ cái đầu; `aria-label` là họ tên; trạng thái thể hiện bằng viền, dấu hoặc chữ cạnh avatar.
- Kịch bản: khi vẽ avatar người không có ảnh thì hiện chữ cái đầu và nhãn là họ tên [test: apps/workspace-web/src/shared/ui/person-avatar.test.tsx » aria-label = họ tên, thiếu ảnh ⇒ chữ cái đầu, focus được]
- Kịch bản: khi avatar có viền và dấu thì trong DOM không có chữ trạng thái [test: apps/workspace-web/src/shared/ui/person-avatar.test.tsx » viền và dấu nhỏ hiện ra, không có chữ trạng thái nào trong DOM của avatar]
- Kịch bản: khi chạm xong rồi nhận click đi kèm thì tooltip không đóng ngay [test: packages/web-kit/src/ui/kit/touch-tip.test.ts » đóng ngay sau chạm bị bỏ qua, đóng muộn hơn thì cho phép]

### ADDED web/person-avatar-phu-trach.md
#### Yêu cầu: Ô Phụ trách
Chỉ hiện avatar; tooltip và popover điện thoại chỉ có họ tên (không chữ «Phụ trách»); người có quyền thấy thêm «Đổi người phụ trách».
- Kịch bản: khi chỉ đọc thì tooltip không có chữ «Phụ trách» [test: apps/workspace-web/src/features/contract-review/components/OwnerRow.test.tsx » chỉ đọc: avatar + tooltip, không có nút chọn]

### ADDED web/person-avatar-nguoi-ky.md
#### Yêu cầu: Dải người ký
Mỗi người một avatar, viền tím Bên A / cam Bên B, dấu ✓ khi đã ký; «Bên A · Đã ký» là chữ cạnh avatar, tooltip chỉ họ tên.
- Kịch bản: khi nhóm có hai thành viên thì mỗi avatar mang tên người đó [test: apps/workspace-web/src/features/doc-sign/components/contract/SignersStrip.test.tsx » nhóm: một avatar mỗi thành viên, tooltip chỉ là tên người đó]

## Việc còn lại
e2e khoá cần qc sửa: `e2e/contracts-web/gapa1-manage.cw.ts` (dòng 66-70: aria-label/tooltip «Phụ trách: »), `e2e/cr181/journey-dot2.spec.ts` + `partner-sign-link.spec.ts` (`signers-strip` chứa «Đã ký»: vẫn đúng nhờ chữ cạnh avatar, chỉ kiểm lại).
