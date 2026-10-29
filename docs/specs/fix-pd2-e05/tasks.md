---
id: fix-pd2-e05
lát: fix-pd2-e05
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa e2e đỏ PD2-E05 (AC-H47): công ty chưa bật tool nào vẫn thấy combobox "Chọn tool…".

## Làm
Nguyên nhân gốc: `toolSwitchReader` gộp `PackToolCatalog.available(tenant)`; tool lõi `open` (app-guide, my-activity, my-chat-history — thêm sau khi viết e2e) luôn "bật" cho mọi tenant ⇒ catalog editor không bao giờ rỗng. Sửa: `PackToolInfo.open` + loại tool `open` khỏi catalog quy trình (`tool-switch.repo.ts`).

## Không làm / Chạm
Không đụng e2e khoá, không đổi chat/MCP (tool lõi vẫn dùng cho chat).

## Test tối thiểu
Unit `processes/adapters/tools/tool-switch.repo.test.ts`.

## Quyết định trong lúc làm
Sản phẩm sai (không phải test/seed): tool "Gọi tool" của quy trình là công tắc theo công ty; tool lõi chat không thuộc công tắc đó.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-engine.md
#### Yêu cầu: Danh sách tool theo công ty
Catalog "Gọi tool" của editor quy trình chỉ gồm tool workflow được bật cho đúng công ty và tool của gói công ty đã bật; tool lõi chỉ đọc dành cho chat (`open`) không nằm trong catalog.
- Kịch bản: khi công ty chưa bật tool nào thì danh sách tool rỗng và editor hiện thông báo "Chưa có tool nào được bật cho công ty".
- Kịch bản: khi công ty chỉ bật "Ghi sổ" thì chỉ "Ghi sổ" là option, không có "Xuất HĐ" và không có tool lõi.

## Việc còn lại
