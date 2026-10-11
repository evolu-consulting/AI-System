## Hướng sửa
Hai lần trả lời trước của tôi đều đã có mục `## Nguồn tham chiếu` ở cuối, nhưng lần nào cũng bị báo thiếu, và tôi chưa rõ vì sao. Lần này tôi bỏ các khối mã ``` và viết gọn lại, phòng khi trình kiểm tra đọc sai vì khối mã. Nội dung phương án không đổi.

Phương án là sửa đúng nguyên nhân gốc bằng một class Tailwind duy nhất, cộng thêm hai lớp phòng thủ tuỳ chọn. Không đổi logic.

1. **Sửa gốc** ở `apps/chat-web/src/features/rooms/components/RoomListItem.tsx:57`: thêm `relative` vào span xem trước đang có `truncate`.
   - Trong span này có `<span className="sr-only">` (`:59`). Thẻ này định vị tuyệt đối, và khối chứa hiện tại của nó là `<li className="group relative">` (`:27`).
   - Vì vậy nó nằm ở cuối đoạn xem trước **chưa bị cắt**, và không bị `overflow:hidden` của `truncate` cắt theo.
   - Hộp 1px này nằm ngoài bề ngang 260px. Vùng cuộn ở `Sidebar.tsx:68` chỉ đặt `overflow-y-auto`, nên trục x tự thành `auto` và hiện thanh cuộn ngang.
   - Khi span ở `:57` có `relative`, nó trở thành khối chứa và cắt luôn thẻ `sr-only`, nên hết tràn.
   - Repo dùng Tailwind v4 (`src/styles/globals.css:2`). Lớp `sr-only` của v4 ẩn bằng `clip-path`, mà `clip-path` không làm giảm vùng tràn cuộn, khớp với chẩn đoán.
   - `aria-describedby` (`:33`) và nội dung trình đọc màn hình đọc không đổi.
2. **Phòng thủ 1** ở `Sidebar.tsx:68`: thêm `overflow-x-hidden` để vùng danh sách không bao giờ cuộn ngang. Đây chỉ là lưới an toàn, không thay cho bước 1.
3. **Phòng thủ 2**: thêm `break-words` vào các dòng "rỗng / không khớp" có chèn từ khoá `q` do người dùng gõ, ở `RoomSections.tsx:46` và `ConversationList.tsx:73`. Một chuỗi dài không có dấu cách sẽ xuống dòng thay vì tràn ngang.

## Thay đổi dự kiến
`RoomListItem.tsx:57`: `className="truncate text-xs text-muted-foreground"` → `className="relative truncate text-xs text-muted-foreground"`

`Sidebar.tsx:68`: `className="relative -mx-1 min-h-0 flex-1 overflow-y-auto px-1"` → `className="relative -mx-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1"`

`RoomSections.tsx:46`: `className="px-2.5 py-2 text-sm text-muted-foreground"` → `className="px-2.5 py-2 text-sm break-words text-muted-foreground"`

`ConversationList.tsx:73`: `className="px-2.5 py-3 text-sm text-muted-foreground"` → `className="px-2.5 py-3 text-sm break-words text-muted-foreground"`

- **Quy mô:** khoảng 4 dòng, không thêm file, không đổi số dòng hay chữ ký hàm, nằm trong giới hạn của `docs/CONVENTIONS.md:104-109`.
- **Kiểm thử:** tôi chưa chạy test nào, mọi điều dưới đây chỉ là dự kiến.
  - Theo lần đọc trước, các test tĩnh trong `RoomListItem.test.tsx` không kiểm tra chuỗi class đầy đủ, nên dự kiến vẫn qua.
  - Có thể thêm `expect(html).toContain('class="relative truncate')` để khoá hồi quy.
  - Nên thêm một bài e2e: seed một phòng có tin cuối dài, rồi khẳng định `scrollWidth <= clientWidth` cho vùng cuộn của sidebar.

## Rủi ro & ảnh hưởng
- **Phạm vi:** chỉ phần trình bày của chat-web, gồm `features/rooms` (RoomListItem) và `features/shell` (Sidebar, RoomSections, ConversationList). Không đổi API, hook, state, i18n hay contracts.
- **Bảo mật, cách ly tenant, dữ liệu: KHÔNG chạm.** Không đụng RLS, fetch hay phiên đăng nhập. Nội dung hiển thị giữ nguyên.
- **Hồi quy có thể gặp:**
  - `relative` chỉ đổi khối chứa của thẻ `sr-only`. Nút menu `⋯` là con trực tiếp của `li`, nên vẫn định vị theo `li.relative` như cũ.
  - `overflow-x-hidden` có thể cắt viền focus ở sát mép. Lớp `-mx-1 px-1` hiện có (`Sidebar.tsx:68`) chừa 4px, đủ cho `ring-2` hoặc `ring-[3px]`. Nên kiểm tra lại bằng mắt.
  - Nội dung quá dài sẽ không còn cuộn ngang để xem được nữa. Đây đúng là hành vi mong muốn (ellipsis).
- Sidebar dùng chung cho cả desktop và Sheet trên mobile, nên một lần sửa áp dụng cho cả hai.

## Phương án thay thế
- **Đưa `sr-only` lên trước `{preview}`:** cũng hết tràn, nhưng trình đọc màn hình sẽ đọc "n tin chưa đọc" trước đoạn xem trước, và người sửa sau dễ vô tình đảo lại. Không chọn.
- **Tách `sr-only` thành phần tử anh em, cho `aria-describedby` trỏ tới hai id:** diff lớn hơn và phải sửa test. Không cần thiết.
- **Chỉ thêm `overflow-x-hidden`:** chỉ che triệu chứng, nguyên nhân gốc vẫn nằm trong RoomListItem. Giữ lại làm lớp phòng thủ.
- **Bỏ `sr-only`, chuyển sang `aria-label`:** làm đổi đặc tả a11y ghi ở đầu file `RoomListItem.tsx`. Không chọn.

## Nguồn tham chiếu
ai-system-local:apps/chat-web/src/features/rooms/components/RoomListItem.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/Sidebar.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/RoomSections.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/ConversationList.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/styles/globals.css@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:docs/CONVENTIONS.md@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
