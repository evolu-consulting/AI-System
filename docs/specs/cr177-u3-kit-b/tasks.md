---
id: cr177-u3-kit-b
lát: cr177-u3-kit-b
cr: CR-177
làn: nhanh
migration: không
phụ thuộc: cr177-u1
---
## Plan (ngắn)
Bộ component chung nhóm B (lớp nổi + xác nhận) trong `packages/web-kit/src/ui/kit/`, gốc là copy shadcn + khuôn CR-175. Chưa app nào dùng.

## Làm
- [x] dialog, alert-dialog (danger), sheet, dropdown-menu, popover, tabs, toggle-group, radio-group, combobox, inline-confirm
- [x] `toastUndo` trong `ui/toast.tsx`
- [x] `kit/README-overlay.md` (4 mức xác nhận)

## Không làm / Chạm
Không chuyển app, không sửa dialog/menu cũ. Chạm: `ui/kit/*`, `ui/toast.tsx`, `ui/toast.test.ts`.

## Test tối thiểu
`bun test packages/web-kit/src/ui` · `tsc --noEmit -p packages/web-kit` · biome file mới.

## Quyết định trong lúc làm
- web-kit không có react-i18next: nhãn (Đóng, Huỷ, Hoàn tác) là prop, mặc định tiếng Việt; app truyền chữ dịch.
- `foldText` không có trong web-kit (chỉ ở messages-web): viết lại trong `combobox.tsx`.
- Không có `react-dom/server` trong web-kit: test kiểm tĩnh qua cây element và hàm thuần.
- Rê chuột dừng đếm: sonner làm sẵn, không viết thêm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/giao-dien-chung-lop-noi.md
#### Yêu cầu: Hộp thoại chung cuộn riêng
Hộp thoại cao tối đa 90% màn hình, tiêu đề và hàng nút đứng yên, chỉ phần thân cuộn; Esc đóng, giữ focus, trả focus về nút mở.
- Kịch bản: khi dựng hộp thoại thì có aria-modal và vùng thân cuộn riêng [test: packages/web-kit/src/ui/kit/overlay.test.tsx » dialog có aria-modal và vùng body cuộn riêng, header/footer cố định]

#### Yêu cầu: Xác nhận xoá nguy hiểm giữ lại là mặc định
Hộp xác nhận mất dữ liệu đưa con trỏ vào nút «Giữ lại», không vào nút xoá.
- Kịch bản: khi mở hộp danger thì focus vào nút huỷ [test: packages/web-kit/src/ui/kit/overlay.test.tsx » danger đưa focus vào nút huỷ và chặn focus mặc định]

#### Yêu cầu: Ô chọn có tìm
Gõ không dấu, không phân biệt hoa thường vẫn tìm ra mục có dấu.
- Kịch bản: khi gõ «bao gia» thì ra «Báo giá» [test: packages/web-kit/src/ui/kit/overlay.test.tsx » gõ «bao gia» ra «Báo giá» (không phân biệt hoa/dấu)]

#### Yêu cầu: Xác nhận tại chỗ cần lý do
Khung xác nhận tại chỗ có ô nhập bắt buộc thì nút xác nhận khoá cho tới khi có chữ.
- Kịch bản: khi ô trống thì nút khoá [test: packages/web-kit/src/ui/kit/overlay.test.tsx » nút xác nhận khoá khi ô bắt buộc còn trống, bật khi có chữ hoặc không bắt buộc]

#### Yêu cầu: Thông báo Hoàn tác
Việc đổi lại được hiện thông báo có nút «Hoàn tác» trong 6 giây.
- Kịch bản: khi bấm Hoàn tác thì gọi hàm hoàn tác, thông báo ở lại 6000 ms [test: packages/web-kit/src/ui/toast.test.ts » toastUndo gọi onUndo khi bấm nút và dùng 6000 ms]

## Việc còn lại
Không. Lát U2 (nhóm A) và việc chuyển app làm riêng.
