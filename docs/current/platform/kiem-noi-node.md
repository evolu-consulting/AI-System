# kiem noi node

Cập nhật: 2026-11-08 · Nguồn: cr122-u2-editor-list. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Kiểm nối hai bước và gợi ý cầu nối (FLOW2-FR-25, FLOW2-FR-26)
Node chèn từ bảng ghi khoá node; bước sau thiếu đầu vào bắt buộc so với bước trước ⇒ cạnh vàng kèm câu nói rõ; gợi ý cầu nối cho xem trước, Nhận chèn node Ghi giá trị, Bỏ thì thôi.
- Kịch bản: khi bước sau cần `date` mà bước trước không có thì báo thiếu [test: apps/admin-web/src/features/processes/lib/palette-node.test.ts » cạnh vàng: Chờ tới ngày cần `date` mà bước trước không có]
- Kịch bản: khi nhận gợi ý thì thành node Ghi giá trị [test: apps/admin-web/src/features/processes/lib/palette-node.test.ts » nhận gợi ý cầu nối ⇒ node Ghi giá trị]
