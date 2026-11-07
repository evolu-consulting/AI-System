---
id: cr123-u3b-module-render
lát: cr123-u3b-module-render
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u3a (panel gộp, `moduleClusters` của contracts) — chưa gộp thì dùng bản cục bộ cùng chữ ký
---
## Plan (ngắn)
FLOW3-FR-14, phần VẼ: node module nhiều stage (Ký số = gửi + chờ) là MỘT ô trên canvas flow, 3 đầu ra Ký xong · Từ chối · Hết hạn.

## Làm
- Manifest: `AppNodeDecl.exits` (đầu ra nghiệp vụ, nhãn vi/en; `on` = khoá sự kiện/`timeout` của stage chờ); `contracts.esign` khai 3 đầu ra.
- `canvas/module-cluster.ts` (thuần): `moduleClusters`, `collapseModules` (gộp cụm → một StageView mang `module`, đánh lại cột, đổi đích nhánh), `moduleEdges` (cạnh từ đầu ra có tên).
- `canvas/ModuleNode.tsx` (dáng StageNode + cổng ra có nhãn), `StageNode` chuyển sang `ModuleNode` khi `v.module`.
- `canvas/use-module-canvas.ts` + `CanvasView`: gộp trước khi vào `ProcessCanvas`; bọc `ops` (cột gộp ⇄ bước thật), chọn ô = chọn stage đầu, cạnh cảnh báo vàng trỏ về stage đầu.
- i18n `process.admin.canvas.module.*`.

## Không làm / Chạm
- Không sửa engine, hub-api, migration, `packages/flow-canvas`, handler tương tác của `ProcessCanvas` (chỉ import + một dòng ghép `moduleEdges` vào danh sách cạnh).
- Kéo cổng ra của ô để đổi đích: chưa (cổng chỉ để đọc sơ đồ); thuộc lát nối tay/p25.

## Test tối thiểu
Unit `canvas/module-cluster.test.ts` (mẫu "Duyệt theo giá trị": một ô, 3 đầu ra, cạnh, số cột).

## Quyết định trong lúc làm
- Gộp ở lớp bọc CanvasView (không đổi bản nháp/ops/uid) để `ProcessCanvas` không phải biết cụm; palette (`usePalette`) cấp nhãn đầu ra và số stage của node.
- `moduleClusters` cục bộ (TODO đổi sang bản của @ai/contracts khi u3a gộp).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Node module nhiều stage là một ô trên sơ đồ flow (nguồn: CR-123 FLOW3-FR-14)
Trên sơ đồ flow, các stage liền nhau của cùng một node module (Ký số = gửi ký + chờ ký) hiện thành MỘT ô cùng dáng bước thường: tên bước, loại node,
và các đầu ra theo kết quả nghiệp vụ do manifest khai (`exits`: Ký xong · Từ chối · Hết hạn). Ô chiếm một cột; chọn ô là chọn stage đầu của cụm;
cạnh vào ô tới stage đầu, cạnh "đi tiếp" ra khỏi ô tới bước kế, cạnh Từ chối/Hết hạn theo nhánh của stage chờ. Bản nháp và dữ liệu đã lưu không đổi.
- Kịch bản: khi mở mẫu "Duyệt theo giá trị" thì thấy đúng một ô Ký số với ba đầu ra Ký xong, Từ chối, Hết hạn [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » đúng MỘT ô Ký số với 3 đầu ra Ký xong · Từ chối · Hết hạn]
- Kịch bản: khi gộp thì ô chiếm một cột và số cột đếm ô một lần [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » ô chiếm một cột: cột sau dồn trái, số cột đếm ô một lần]
- Kịch bản: khi stage chờ có nhánh từ chối/hết hạn thì cạnh đi từ đúng đầu ra tới bước đích [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » nhánh Nếu và cạnh Từ chối/Hết hạn đổi theo cột đã gộp]
- Kịch bản: khi vẽ bố cục thì cạnh vào ô tới stage đầu và cạnh ra đi thẳng bước kế [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » bố cục: vào ô tới stage đầu, ra ô đi thẳng bước kế, số cột = 7]

## Việc còn lại
- Kéo cổng ra của ô (Từ chối → Kết thúc · Từ chối) để đổi nhánh của stage chờ: cần `connectPatch` xử lý `wait_event` (+ `ops.connect` đổi nguồn sang stage chờ).
- Đổi `moduleClusters` cục bộ sang bản của contracts khi u3a gộp; `room` của menu "+" đang đếm ô gộp một lần (lệch 1 so với số stage).
