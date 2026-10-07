# Canvas Chat X2 (nguồn design cho mốc X2a/X2b)

Bản sao nguồn của canvas **Chat nhóm X2 — mockup** (https://claude.ai/artifact/GS6GeKK6ycaY6seR77iKs3), người dùng duyệt 2026-10-07, 4 artboard.

- `*.dc.html` — mỗi file một artboard (runtime riêng của canvas). **Đọc để lấy bố cục, số đo, câu chữ; không chạy trực tiếp.**
- `canvas.json` — vị trí và tiêu đề artboard.
- **Token màu/font dùng chung**: `docs/design/canvas/tokens-map.md` (không tạo bảng token riêng).
- **Quyết định hiệu lực** (người dùng 2026-10-07, lần 2): **không** panel agent bên phải, **không** hàng chip agent — agent dùng được hiện qua **menu `@` trong composer**; giữ mô hình thread/flow C1 ("Trả lời tiếp" mở khung flow bên phải). Chi tiết: `docs/specs/X2a-rooms/spec.md` §5.2. Artboard Main/DM/Mobile đã vẽ lại theo quyết định này (2026-10-07).

| Artboard | Nội dung | UC (`../usecases-chat.md`) | Mốc |
|---|---|---|---|
| Main | Nhóm chat: sidebar "Tin nhắn & Nhóm" + "Hỏi AI", header phòng (thành viên, Thêm người), tin phẳng user↔user, khối flow agent ("Trả lời tiếp"), composer placeholder "gõ @ để hỏi agent, / để chạy lệnh" + menu `@` "Agent bạn dùng được" | UC-10, UC-11 | X2a (khung) + X2b (agent) |
| DM | Tin nhắn 1-1: header không đổi tên/thêm người, "Ẩn hội thoại"; khối flow đang trả lời ("Dừng" chỉ người hỏi); menu `@` như nhóm | UC-09, UC-11 | X2a + X2b |
| NewGroup | Tạo nhóm: tên (bắt buộc), chọn thành viên từ danh bạ, đếm "n / 50 · gồm bạn" | UC-10 | X2a |
| Mobile | Điện thoại: phòng toàn màn; agent qua menu `@` (không hàng chip) | UC-10, UC-11 | X2a + X2b |
