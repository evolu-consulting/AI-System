---
id: cr177-w1-overlays
lát: cr177-w1-overlays
cr: CR-177
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chuyển 5 chỗ tự dựng sang bộ component chung (`@ai/web-kit/ui/kit/*`) để bàn phím đúng chuẩn; giữ giao diện, câu chữ, `data-testid`, hành vi chuột.

## Làm
- [x] DockSheet → kit `Sheet` (Esc đóng, aria-modal, con trỏ nằm trong ngăn); khoang vẫn nhớ tab/hội thoại như cũ (state nằm ở `useDock`/DockBody, không đổi).
- [x] PopMenu → kit `DropdownMenu`, giữ API `PopMenu`/`PopItem`; bỏ `menuPosition` (Radix tự đặt vị trí, portal nên không bị khung thẻ che — CR-166).
- [x] UserMenu (qua `Popover` cục bộ) → kit `Popover`; NotificationBell → kit `Popover`; AppSwitcher → kit `DropdownMenu`.
- [x] SegButton/PillRadio: mũi tên ←→↑↓ Home/End chuyển và chọn nút kế (hàm `radioStep`).
- [x] Test: unit `radioStep`, `menuStep`; e2e `e2e/contracts-web/cr177-w1-overlays.cw.ts` (viết, chưa chạy).

## Không làm / Chạm
Không `<select>`/`<input>`/`title=` hàng loạt (W2/W3), không nút robot nổi/emoji 🔒 (W4). Chạm: `apps/workspace-web/src/{components/shared,features/shell/components}`, `packages/web-kit/src/ui/{AppSwitcher,NotificationBell}.tsx`.

## Test tối thiểu
`bun test` workspace-web (shared, shell, notifications) + web-kit; `tsc --noEmit` hai gói; biome file sửa.

## Quyết định trong lúc làm
- Kit chưa có mục radio đứng riêng (RadioGroupItem cần Root; Stars còn cho bỏ chọn) ⇒ SegButton giữ nút cũ, thêm mũi tên ở app. Đề nghị kit thêm `SegGroup`.
- Kit `SheetContent` luôn có nút X riêng ⇒ ẩn bằng CSS vì DockBody đã có nút đóng; lớp mờ của kit không có `lg:hidden` (ngăn chỉ mở ở màn hẹp).
- Menu tài khoản chứa PrefsPanel (ô chọn) nên dùng Popover (không phải DropdownMenu) + ↑/↓ giữa các `menuitem`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/ban-phim-lop-noi.md
#### Yêu cầu: Menu, ngăn và nhóm chọn dùng được bằng bàn phím
Menu nhỏ («Xuất ▾», «⋯»), menu tài khoản, chuông thông báo và nút «Ứng dụng» mở bằng Enter/↓, con trỏ vào trong, Esc đóng và trả con trỏ về nút. Ngăn khoang trợ lý ở màn hẹp đóng bằng Esc và con trỏ không lọt ra ngoài; khoang vẫn nhớ tab/hội thoại như cũ. Nhóm nút chọn một đổi bằng mũi tên.
- Kịch bản: mở menu «Xuất» bằng Enter, ↓ sang mục kế, Esc trả con trỏ về nút [test: e2e/contracts-web/cr177-w1-overlays.cw.ts » CR177-W1 · menu «Xuất»]
- Kịch bản: ngăn khoang ở màn hẹp, Esc đóng, Tab không lọt ra ngoài [test: e2e/contracts-web/cr177-w1-overlays.cw.ts » CR177-W1 · khoang trợ lý ở màn hẹp]
- Kịch bản: mũi tên chuyển nút chọn một [test: e2e/contracts-web/cr177-w1-overlays.cw.ts » CR177-W1 · nhóm nút chọn một]
- Kịch bản: bước mũi tên trong nhóm nút (đi vòng, Home/End) [test: apps/workspace-web/src/components/shared/seg-button.test.ts » radioStep]
- Kịch bản: bước mũi tên trong menu tài khoản [test: apps/workspace-web/src/features/shell/components/Popover.test.ts » menuStep]

## Việc còn lại
- Chạy e2e `cr177-w1-overlays.cw.ts` cuối đợt (chưa chạy; nút mở ngăn khoang ở màn hẹp có thể không phải `topbar-feedback` — chỉnh theo kết quả chạy).
- Chưa e2e riêng cho chuông/«Ứng dụng»/menu tài khoản (đã có `bell.cw.ts` kiểm DOM mới khi chạy).
