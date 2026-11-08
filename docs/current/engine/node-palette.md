# node palette

Cập nhật: 2026-11-08 · Nguồn: cr122-n1-module-nodes. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Bảng node gồm node lõi và node của tính năng đang bật (FLOW2-FR-25/26)
Trình sửa lấy bảng node qua `GET /process-palette`: node lõi + node của app có tính năng đang bật cho công ty. Bước dùng node của tính năng đã tắt bị chặn khi lưu (422 `FLOW_NODE_FEATURE_OFF`, nêu tính năng) và không mở lượt. Nối hai node kiểm bằng `edgeIssues` (thiếu đầu vào bắt buộc / lệch kiểu).
- Kịch bản: khi công ty chưa có tính năng thì bảng node không hiện node đó [test: apps/hub-api/src/modules/processes/library/palette.routes.test.ts » tenant_admin: lõi + Ký số (contracts-write bật), không Hiện bài (community-write chưa cấp)]
- Kịch bản: khi lưu bước của tính năng đã tắt thì 422 nêu tính năng [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » N1 · bước là node của tính năng đã tắt ⇒ 422 FLOW_NODE_FEATURE_OFF nêu tính năng, node bật ⇒ lưu được]
- Kịch bản: khi nối hai node lệch giao diện thì báo thiếu/lệch kiểu [test: packages/contracts/src/app-manifest/nodes.rules.test.ts » đủ và khớp kiểu ⇒ rỗng, thiếu đầu vào bắt buộc ⇒ missing, khác kiểu ⇒ type, không bắt buộc thiếu ⇒ bỏ qua]
- Kịch bản: khi khai node sai thì check:app-events đỏ [test: packages/contracts/src/app-manifest/nodes.rules.test.ts » khai sai ⇒ mã luật, khoá trùng / khác tiền tố app]
