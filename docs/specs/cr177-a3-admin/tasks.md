---
id: cr177-a3-admin
lát: cr177-a3-admin
cr: CR-177
làn: nhanh
migration: không
phụ thuộc: cr177 U2-U4 (web-kit/ui/kit)
---
## Plan (ngắn)
Admin-web dùng bộ component chung `@ai/web-kit/ui/kit/*`, xoá `apps/admin-web/src/components/ui` và `lib/utils.ts` (cn lấy từ kit).

## Làm
- [x] Đổi ~330 import sang kit (codemod tạm, đã xoá). Button/Badge ánh xạ biến thể.
- [x] Chuyển label, alert, skeleton, table, card, accordion, collapsible vào kit. Xoá breadcrumb, separator (không ai dùng).
- [x] Kit thêm (tương thích): Button `link`; Dropdown `Group/Sub/SubTrigger/SubContent`; Sheet `side="left"` + `showCloseButton`; icons `info`, `neutral`; exports `ui/kit/cn`, `ui/kit/icons` trong package.json.
- [x] StatusBadge (admin) dựng trên Badge kit: tone → status + icon. Mọi `<Badge variant>` trực tiếp đổi sang StatusBadge.
- [x] Gỡ deps cva/clsx/tailwind-merge khỏi admin-web; xoá `components.json`, `lib/utils.test.ts` (cn đã có test trong kit).
- [x] `check:ui-kit --update`: uiFiles 25 → 0.

## Không làm / Chạm
Không đổi chữ, luồng, testid. Không chạm workspace-web, messages-web.

## Test tối thiểu
`bun test apps/admin-web`, `bun test packages/web-kit`, tsc admin-web + web-kit, `check:ui-kit`.

## Bảng ánh xạ
| shadcn | kit |
|---|---|
| Button default / destructive / outline / secondary / ghost / link | primary / danger / outline / outline / quiet / link |
| Button size default, lg / sm, xs / icon, icon-sm, icon-xs, icon-lg | md / sm / icon |
| Badge ok / off / warn / info / err | ok / idle / warn / info / bad (+ icon success / neutral / warning / info / reject) |
| Badge default, secondary, outline | idle (tone `off`) |
| INPUT_CLASS | `fieldBase` + `h-[var(--control-md)]` |
| TooltipProvider | bỏ (Tooltip kit tự bọc Provider) |

## Quyết định trong lúc làm
- Sheet kit thêm phía `left` và `showCloseButton` (Topbar mobile + 4 drawer admin tự vẽ nút đóng) — cộng thêm, tương thích; test overlay cập nhật 3 phía.
- Badge bắt buộc có icon: giữ `StatusBadge` làm cửa duy nhất trong admin, không tạo component chung mới.
- `ConfirmDialog` đã dựng trên AlertDialog kit nên giữ nguyên.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi nguồn component sang bộ chung; chữ, luồng, testid giữ nguyên, lệch nhỏ do token).

## Việc còn lại
- `PageHeader`/`PageHead`, `ConnectionBanner`, `IconButton` của admin chưa thay bằng kit (chưa có component tương đương).
- Cỡ nút `xs`/`icon-sm`/`lg` đã gộp về `sm`/`icon`/`md`: cần soát mắt ở màn nhiều nút (bảng, thanh công cụ).
- `<button>`/`<input>` trần còn lại theo mốc check:ui-kit (input 9, arbitrary 6).
- Chưa soát UI bằng trình duyệt, chưa chạy e2e admin; `check:bundle` cần build (không build trên máy này).
