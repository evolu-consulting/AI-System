## Tóm tắt lỗi
Trên chat-web, vùng cuộn của sidebar (gồm các mục Nhóm / Users / Hỏi AI) hiện thanh cuộn **ngang**. Mong muốn là mọi hàng co lại trong 260px và cắt chữ bằng dấu "…". Nguyên nhân là có một phần tử con vượt quá chiều rộng vùng cuộn. Vùng cuộn này chỉ khai báo `overflow-y-auto` nên trình duyệt hiện luôn thanh cuộn ngang khi có phần tử tràn.

## Vị trí nghi ngờ
1. `apps/chat-web/src/features/rooms/components/RoomListItem.tsx:57-60`
```tsx
<span id={`${uid}-d`} className="truncate text-xs text-muted-foreground">
  {preview}
  <span className="sr-only">{unreadText}</span>
</span>
```
Thẻ `sr-only` (định vị tuyệt đối) nằm **sau** đoạn xem trước, bên trong một span có `truncate`. Ở dòng 27, `<li className="group relative">` mới là khối chứa của nó, không phải span `truncate`.
2. `apps/chat-web/src/features/shell/components/Sidebar.tsx:68`: `className="relative -mx-1 min-h-0 flex-1 overflow-y-auto px-1"`. Chỉ có `overflow-y-auto`, theo CSS thì trục x sẽ tự thành `auto`, nên bất kỳ phần tử tràn nào cũng sinh thanh cuộn ngang. Không có `overflow-x-hidden`.
3. Các nguồn tràn phụ, chỉ xảy ra khi có điều kiện:
   `RoomSections.tsx:46,89,112`: `<p>` "không khớp" chèn nguyên từ khoá tìm `q`, không có `break-words`. Một chuỗi dài không có dấu cách sẽ tràn ngang.
   `ConversationList.tsx:72-76`: tương tự với `sidebar.noMatch`.
   `button.tsx:7`: Button có `whitespace-nowrap`, được dùng cho nút "Tải thêm" ở `RoomSections.tsx:214-222` và `ConversationList.tsx:100-108`.

## Nguyên nhân gốc
1. `RoomListItem` cắt chữ đoạn xem trước bằng `truncate` (overflow:hidden + nowrap) ở `RoomListItem.tsx:57`.
2. Bên trong span đó, ngay sau chữ, có một `<span className="sr-only">`. Lớp này dùng `position:absolute`, rộng 1px.
3. Phần tử tuyệt đối không có `top/left` sẽ nằm ở "vị trí tĩnh", tức là **cuối toàn bộ đoạn xem trước chưa cắt**. Với tin nhắn dài, vị trí này nằm xa hơn 260px.
4. Khối chứa của nó là `li.relative` (`:27`), là tổ tiên của span `truncate`. Theo quy tắc CSS, `overflow:hidden` của span **không cắt** được nó.
5. Vì vậy hộp 1px này tính vào vùng tràn có thể cuộn của div cuộn ở `Sidebar.tsx:68`. Div này có overflow-x = auto (do chỉ đặt `overflow-y-auto`), nên hiện thanh cuộn ngang.
6. Thẻ `sr-only` luôn được render, kể cả khi `unreadText` rỗng. Vì vậy chỉ cần **một phòng có tin cuối dài** là lỗi xuất hiện ngay khi mở app, khớp với mô tả.

Các phần khác trong sidebar đã co gọn đúng nên tôi đã loại trừ: `ConversationItem.tsx:44` (block truncate), `SidebarGroup.tsx:33,39` (`min-w-0`, truncate), `PersonItem` ở `RoomSections.tsx:74-76`, `ProcessDmRow.tsx:21`, `TodoGroup.tsx:26-33`, `UserMenu.tsx:19-21`.

## Đề xuất sửa (tối thiểu, dễ đảo)
```diff
// apps/chat-web/src/features/rooms/components/RoomListItem.tsx:57
- <span id={`${uid}-d`} className="truncate text-xs text-muted-foreground">
+ <span id={`${uid}-d`} className="relative truncate text-xs text-muted-foreground">
```
Thêm `relative` biến span `truncate` thành khối chứa, nên thẻ `sr-only` bị cắt theo. Ngữ nghĩa a11y (`aria-describedby`) không đổi. Cách tương đương: đặt `<span className="sr-only">` **trước** `{preview}`.

Phòng thủ thêm (tuỳ chọn):
```diff
// apps/chat-web/src/features/shell/components/Sidebar.tsx:68
- className="relative -mx-1 min-h-0 flex-1 overflow-y-auto px-1"
+ className="relative -mx-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1"
```
```diff
// RoomSections.tsx:46 (Empty) và ConversationList.tsx:73
- className="px-2.5 py-2 text-sm text-muted-foreground"
+ className="px-2.5 py-2 text-sm break-words text-muted-foreground"
```
Lưu ý: `overflow-x-hidden` chỉ che triệu chứng, còn sửa ở RoomListItem mới là sửa gốc. Viền focus (`ring`) dùng box-shadow nên không bị ảnh hưởng về bố cục. Nếu thấy viền bị cắt ở mép thì `-mx-1 px-1` hiện có vẫn chừa đủ 4px. Cả hai patch đều không đụng tới dữ liệu hay tenant.

## Cách tái hiện
1. Mở chat-web ở desktop (≥1024px, sidebar 260px, `AppShell.tsx:89`) hoặc mở Sheet trên mobile (`AppShell.tsx:115-129`).
2. Cần ít nhất một phòng (nhóm hoặc DM) có tin nhắn cuối dài, ví dụ hơn 40 ký tự, để `previewOf` trả về đoạn xem trước dài.
3. Vùng danh sách xuất hiện thanh cuộn ngang. Kéo sang phải sẽ thấy khoảng trống, độ rộng tỉ lệ với độ dài tin nhắn.
4. Lỗi phụ: gõ vào ô tìm một chuỗi dài không có dấu cách, khi không có kết quả thì dòng "không khớp" cũng gây tràn.

## Câu hỏi còn mở
- Tôi chưa xác định được phiên bản Tailwind (v3 dùng `clip`, v4 dùng `clip-path`) vì chưa đọc package.json/CSS. Cả hai thuộc tính đều không loại hộp khỏi vùng tràn cuộn, nên kết luận không đổi, nhưng nên kiểm tra lại bằng DevTools.
- Cần xác nhận tài khoản bị lỗi có phòng với tin cuối dài. Nếu lỗi xảy ra cả khi danh sách phòng rỗng, nguồn tràn nằm ở chỗ khác (ví dụ `BrandLogo`, chưa đọc) và cần ảnh chụp hoặc kích thước khung nhìn.
- Chưa có test layout (jsdom không đo được bố cục). Nên thêm một kiểm tra e2e Playwright: `scrollWidth <= clientWidth` cho vùng cuộn của sidebar.

## Nguồn tham chiếu
ai-system-local:apps/chat-web/src/features/shell/components/Sidebar.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/SidebarGroup.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/RoomSections.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/ConversationItem.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/ConversationList.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/AppShell.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/UserMenu.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/processes/inbox/components/ProcessDmRow.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/processes/inbox/components/TodoGroup.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/rooms/components/RoomListItem.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/rooms/components/RoomRowMenu.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/components/ui/collapsible.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/components/ui/button.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
