## Patch
Ghi chú định dạng: các lần trả lời trước đều có mục "Nguồn tham chiếu" nhưng vẫn bị báo thiếu. Tôi đoán (chưa kiểm chứng) nguyên nhân là ký tự backtick: dòng 57 của RoomListItem.tsx có template literal, có thể làm bộ kiểm tra hiểu sai phần còn lại của văn bản.
- Bản này bỏ hẳn mọi ký tự backtick. Riêng dòng 57, tôi chỉ trích phần className (khớp đúng từng ký tự với repo); thuộc tính id ở đầu dòng giữ nguyên, không đổi.
- Mọi thay đổi chỉ là class Tailwind. Tôi không sửa repo và không chạy lệnh nào.
- Dòng bắt đầu bằng "CŨ" là mã trích đúng như trong repo, dòng bắt đầu bằng "MỚI" là mã thay thế.

1) apps/chat-web/src/features/rooms/components/RoomListItem.tsx, dòng 57 (sửa gốc). Đây là span xem trước có id kết thúc bằng "-d"; dòng 58 {preview} và dòng 59 thẻ sr-only giữ nguyên.
CŨ: className="truncate text-xs text-muted-foreground">
MỚI: className="relative truncate text-xs text-muted-foreground">

2) apps/chat-web/src/features/shell/components/Sidebar.tsx, dòng 68 (phòng thủ)
CŨ: <div className="relative -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
MỚI: <div className="relative -mx-1 min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-1">

3) apps/chat-web/src/features/shell/components/RoomSections.tsx, dòng 46 (phòng thủ)
CŨ: return <p className="px-2.5 py-2 text-sm text-muted-foreground">{children}</p>;
MỚI: return <p className="px-2.5 py-2 text-sm break-words text-muted-foreground">{children}</p>;

4) apps/chat-web/src/features/shell/components/ConversationList.tsx, dòng 73 (phòng thủ)
CŨ: <p className="px-2.5 py-3 text-sm text-muted-foreground">
MỚI: <p className="px-2.5 py-3 text-sm break-words text-muted-foreground">

5) apps/chat-web/src/features/rooms/components/RoomListItem.test.tsx, chèn sau dòng 53 (khoá hồi quy, tuỳ chọn)
CŨ (dòng 53–54):
expect(html).toContain("3 tin chưa đọc");
expect(html).not.toContain("aria-current");
MỚI:
expect(html).toContain("3 tin chưa đọc");
expect(html).toContain('class="relative truncate text-xs');
expect(html).not.toContain("aria-current");

## Giải thích
1) RoomListItem.tsx:57 sửa đúng nguyên nhân gốc.
- Thẻ span sr-only ở dòng 59 có position:absolute. Hiện khối chứa của nó là li.group.relative ở dòng 27, nên nó đứng ở cuối đoạn xem trước chưa bị cắt.
- overflow:hidden của truncate không cắt được nó, vì khối chứa nằm ngoài span. Hộp 1px này vượt bề ngang 260px.
- Vùng cuộn ở Sidebar.tsx:68 chỉ khai báo overflow-y-auto, nên trục x tự thành auto và sinh thanh cuộn ngang.
- Thêm relative làm span truncate trở thành khối chứa, nên thẻ sr-only bị cắt theo và hết tràn.
- aria-describedby và chuỗi "n tin chưa đọc" mà trình đọc màn hình đọc không đổi.
- Repo dùng Tailwind v4 (globals.css:2). Lớp sr-only của v4 ẩn bằng clip-path, mà clip-path không làm giảm vùng tràn cuộn. Vì vậy phải đổi khối chứa chứ không thể trông vào clip.

2) Sidebar.tsx:68 là lưới an toàn: nếu sau này có phần tử khác tràn, vùng danh sách cũng không cuộn ngang. Lớp -mx-1 px-1 sẵn có chừa 4px, đủ cho viền focus ring-2 và ring-[3px] không bị cắt.

3) RoomSections.tsx:46 và ConversationList.tsx:73 là hai dòng "không khớp" chèn nguyên từ khoá q người dùng gõ. Một chuỗi dài không có dấu cách sẽ tràn ngang; thêm break-words thì chuỗi được ngắt dòng.

4) Test: render tĩnh không đo được bố cục, nên assert mới chỉ khoá việc class relative còn trên span. Các assert cũ ở dòng 49–54 không phụ thuộc class, nên dự kiến vẫn qua; tôi chưa chạy test để xác nhận.

Về quy mô: khoảng 5 dòng, không thêm file, không đổi chữ ký hàm, nằm trong giới hạn ở docs/CONVENTIONS.md:104-109.

Về bảo mật, cách ly tenant và dữ liệu: không chạm. Patch chỉ đổi phần trình bày, không đụng API, RLS, fetch hay state.

## Việc thủ công còn lại
- Không có migration hay cấu hình nào.
- Chạy Biome (bun run check) trong apps/chat-web.
  - Nếu quy tắc sắp xếp class Tailwind tự đổi thứ tự, cứ chấp nhận: thứ tự class không ảnh hưởng CSS.
  - Khi đó cần sửa chuỗi trong assert mới ở mục 5 cho khớp thứ tự mới.
- Chạy bun test cho RoomListItem.test.tsx và các test trong features/shell.
- Kiểm tra bằng tay:
  1. Chọn một phòng có tin cuối dài hơn 60 ký tự.
  2. Mở chat-web ở desktop (từ 1024px trở lên) và trong Sheet trên mobile.
  3. Xác nhận sidebar không còn thanh cuộn ngang, đoạn xem trước hiện dấu "…", và trong DevTools vùng cuộn có scrollWidth bằng clientWidth.
  4. Tab qua các hàng để chắc viền focus không bị cắt.
- Tuỳ chọn: thêm một bài e2e Playwright khẳng định scrollWidth <= clientWidth cho vùng cuộn của sidebar.

## Nguồn tham chiếu
ai-system-local:apps/chat-web/src/features/rooms/components/RoomListItem.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/rooms/components/RoomListItem.test.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/Sidebar.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/RoomSections.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/features/shell/components/ConversationList.tsx@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:apps/chat-web/src/styles/globals.css@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
ai-system-local:docs/CONVENTIONS.md@0bfc9fca-0c9d-45ce-a4ef-d425499e2da2
