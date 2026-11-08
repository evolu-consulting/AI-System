---
id: cr125-g4-tokens
lát: cr125-g4-tokens
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Một gói token CSS `packages/web-kit/src/styles/tokens.css` (sáng + tối + ánh xạ `@theme inline`, lấy từ bộ của workspace-web/mgmt-app). 4 app `globals.css` chỉ `@import` gói + khai font; không còn token riêng. Màu chính mọi app = Indigo #4f46e5 (người dùng chốt 2026-11-08).

## Làm
- Tạo `tokens.css`; bốn `globals.css` import nó, giữ font, `@source`, base layer, hljs, run-part.
- `theme-parity.test.ts` (workspace-web) viết lại: gói + 4 app (không chép token, không khai `--primary`/`--color-*`) + mgmt-app tối.
- Sửa 3 test đọc `globals.css` cũ: `no-literal-colors`, admin `theme-tokens`, `tests/acceptance/C1/contrast` (khoá ⇒ cần relock).

## Không làm / Chạm
DLC, locale, hub, code component. Hệ quả: bản tối admin/chat/studio đổi sang bộ xám-tím của mgmt-app (cùng gói), không còn "Midnight".

## Test tối thiểu
`bun test apps/workspace-web/src/styles apps/admin-web/src/features/shell/lib/theme-tokens.test.ts tests/acceptance/C1/contrast.test.ts`; build 4 app; admin `check:bundle` (JS 136.7 KB, chunk lớn nhất 49.8 KB, css 19.5 KB).

## Quyết định trong lúc làm
- Nhập gói bằng đường dẫn tương đối (như `@source`), không qua `exports` của web-kit.
- Không có ghi đè riêng nào ở app (APP_OVERRIDES rỗng).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### ADDED platform/token-mau.md
#### Yêu cầu: Một gói token màu cho mọi app
Admin, workspace, chat và studio dùng chung một gói token màu (sáng + tối); màu chính là Indigo #4f46e5, app không tự khai lại token.
- Kịch bản: khi mở bất kỳ app nào ở bản sáng thì `--primary` là #4f46e5 [test: apps/workspace-web/src/styles/theme-parity.test.ts » gói token chung (CR-125 G4)]
- Kịch bản: khi một app chép token vào globals.css của mình thì kiểm tra parity báo đỏ [test: apps/workspace-web/src/styles/theme-parity.test.ts » 4 app dùng chung gói token]

## Việc còn lại
Chụp lại baseline (scenes.cw/admin snapshot, mọi e2e có ảnh màu) khi chạy e2e cuối đợt.
