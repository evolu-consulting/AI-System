---
id: cr177-u1-tokens
lát: cr177-u1-tokens
cr: CR-177
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Một bộ tên màu (tên shadcn là nguồn), thang chữ 6 bậc + bo góc 3 mức dùng chung qua `@theme` của web-kit, token điều khiển/chuyển động/toast. Chưa viết component, chưa sửa class trong app.

## Làm
- [x] 11 tên màu trùng nghĩa chuyển thành bí danh `var(--<tên shadcn>)` ở cả sáng và tối (`packages/web-kit/src/styles/tokens.css`).
- [x] `@theme inline`: `--text-xs/sm/md/lg/xl/2xl` (12/16 · 13/18 · 14/20 · 16/24 · 20/28 · 24/32), `--radius-sm/md/lg` = 6/10/16; bỏ `--radius-xl`.
- [x] `--duration-fast` 150ms (giảm chuyển động = 0ms), `--control-md/sm` 40/32 (điện thoại ≤ 640px: 44/40).
- [x] Toast: `TOAST_MS` 3000, `TOAST_UNDO_MS` 6000 (hằng số TS trong `ui/toast.tsx`, một nguồn; không khai lại ở CSS).
- [x] Test tĩnh `packages/web-kit/src/styles/tokens.test.ts`; `theme-parity.test.ts` giải bí danh trước khi so với mgmt-app.

## Không làm / Chạm
Không component, không sửa hàng loạt `text-[13px]` trong app, không đổi màu thương hiệu. App không tự khai `@theme` chữ/bo góc (đã kiểm admin/studio/chat/workspace: chỉ khai font) nên không phải gỡ gì ở app. Giữ nguyên tên ngữ nghĩa cũ (`text-body`, `text-caption`…) và `--spacing-control: 36px` tới lát chuyển app.

## Test tối thiểu
`bun test packages/web-kit` (xanh) · `bun test apps/workspace-web/src/styles` · `tsc --noEmit -p packages/web-kit` · `check:size`, `check:toast`.

## Bảng ánh xạ màu (tên cũ → tên mới; giá trị cũ → mới; sáng / tối)
| Tên cũ | Thành bí danh của | Sáng cũ → mới | Tối cũ → mới |
|---|---|---|---|
| `--subtle-foreground` | `--muted-foreground` | giữ #6b6b6b | giữ #a1a3b8 |
| `--code-fg` | `--foreground` | giữ #0a0a0a | giữ #ececf4 |
| `--code-comment` | `--muted-foreground` | giữ #6b6b6b | giữ #a1a3b8 |
| `--sunk` | `--muted` | #f6f6fa → #f5f5f5 | giữ #1d1f33 |
| `--rule` | `--border` | #e5e5ec → #e5e5e5 | giữ #2a2c44 |
| `--rule-soft` | `--row-divider` | #efeff4 → #f5f5f5 | giữ #23253b |
| `--field` | `--input` | #d4d4dc → #d4d4d8 | **#3a3c58 → #686c99** (viền ô nhập sáng hơn hẳn, theo `--input` đã chốt CR-125 tương phản) |
| `--ink` | `--foreground` | #0f1020 → #0a0a0a | giữ #ececf4 |
| `--ink-2` | `--muted-strong-foreground` | #45465a → #525252 | giữ #c3c5d6 |
| `--dim` | `--muted-foreground` | #6b6c80 → #6b6b6b | giữ #a1a3b8 |
| `--soon` | `--warning` | #8a4306 → #7f3c04 | giữ #fbbf24 |

Giữ nguyên (không có cặp shadcn): `--bubble --act-line --soon-line --late-line --idle-bg --new-bg --scroll* --grad-to --type-* --brand-* --mention-* --code-*(trừ fg/comment) --chart-*`, các `--sidebar-*` (là tên shadcn chuẩn, test cũ so giá trị chữ). Tên `--color-ground/panel/act…` trong `@theme` vốn đã là bí danh, giữ.

## Quyết định trong lúc làm
- `--soon` → `--warning` (cùng vai chữ cam trên nền sáng); `--ink-2` → `--muted-strong-foreground` thay vì `--secondary-foreground` (giá trị tối trùng hơn).
- `--rule-soft` → `--row-divider` (không có tên shadcn cho vạch nhạt; `--row-divider` là token gốc có sẵn).
- Bí danh khai lại ở khối tối (không chỉ ở `:root`) để `.dark` đặt trên phần tử con vẫn đúng.
- Toast: hằng số TS, không thêm `--toast-ms` CSS (một nguồn, G1). `ERROR_TOAST_MS`/`SUCCESS_TOAST_MS` giữ cho tới lát toast (U2).
- Bỏ `--radius-xl`: chưa lát nào cần; `rounded-xl` rơi về mặc định Tailwind 12px cho tới khi chuyển màn.
- `text-sm` nay 13px (trước 14px), `text-lg` 16px (trước 18px): component shadcn đổi nhẹ cỡ chữ, theo CR-177.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

### ADDED web/giao-dien-chung.md
#### Yêu cầu: Token màu, chữ, bo góc dùng chung
Mọi app lấy màu, 6 cỡ chữ (xs 12 · sm 13 · md 14 · lg 16 · xl 20 · 2xl 24), 3 mức bo góc (6 · 10 · 16), chiều cao nút (40/32, điện thoại 44/40) và thời lượng toast (3 giây, có «Hoàn tác» 6 giây) từ một gói chung; mỗi màu chỉ có một tên gốc, tên cũ là bí danh trỏ về tên gốc.
- Kịch bản: khi tra gói token thì mỗi màu sáng đều có bản tối và mọi bí danh trỏ tới token có thật [test: packages/web-kit/src/styles/tokens.test.ts » mỗi token khai ở :root có mặt ở khối tối; packages/web-kit/src/styles/tokens.test.ts » bí danh trỏ tới token có thật]
- Kịch bản: khi tra thang chữ và bo góc thì có đúng 6 cỡ chữ và 3 mức bo góc [test: packages/web-kit/src/styles/tokens.test.ts » đúng 6 cỡ chữ; packages/web-kit/src/styles/tokens.test.ts » đúng 3 mức bo góc]
- Kịch bản: khi hiện thông báo thì thường tự ẩn sau 3 giây, có «Hoàn tác» sau 6 giây [test: packages/web-kit/src/styles/tokens.test.ts » toast thường 3 giây]

## Việc còn lại
- Gỡ bí danh tạm + tên ngữ nghĩa cũ (`text-body`…) ở lát chuyển app; nối `ERROR_TOAST_MS`/`SUCCESS_TOAST_MS` vào `TOAST_MS`/`TOAST_UNDO_MS` ở lát toast.
- `docs/current/web/giao-dien-chung.md` tạo khi gộp cuối đợt.
