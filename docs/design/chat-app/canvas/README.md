# Canvas Chat App (nguồn design cho mốc C1)

Bản sao nguồn của canvas **Chat App** (https://claude.ai/artifact/Jf4ZGu6ZtDjVsugCaNHSQK), chép ngày 2026-10-03, 5 artboard.

- `*.dc.html` — mỗi file một artboard (HTML + style inline, runtime riêng của canvas: `<x-dc>`, `<sc-for>`, `{{…}}`). **Đọc để lấy bố cục, số đo, câu chữ; không chạy trực tiếp.**
- `canvas.json` — vị trí và tiêu đề artboard.
- **Token màu/font dùng chung với Admin**: `docs/design/canvas/tokens-map.md` (không tạo bảng token riêng).
- Ảnh logo EvoluConsulting trong artboard là `/_blob/...` của artifact (không có trong repo). File gốc: `D:\AI\logo`; khi build chép vào `apps/chat-web` (frontend-lead quyết vị trí).
- Đồng bộ: trước Gate C1, điều phối đọc lại canvas; khác bản ở đây → cập nhật + ghi `docs/CHANGE-REQUESTS.md`.

| Artboard | Nội dung | UC (`../usecases-chat.md`) |
|---|---|---|
| Main | Hội thoại: mỗi câu hỏi là một khối flow, sidebar nhóm theo thời gian | UC-02, 03, 07 |
| FlowOpen | Bấm "Trả lời tiếp": khung flow bên phải mở | UC-06 |
| Welcome | Hội thoại mới: lời chào + 4 thẻ gợi ý | UC-07 |
| States | Bước (đang chạy / thu gọn), hỏi lại, lỗi hết lượt, flow mở lại, đã dừng, mất kết nối | UC-03, 04, 05, 06, 08 |
| Mobile | Điện thoại: khung flow là sheet từ dưới | UC-06 (CHAT-AC-17) |
