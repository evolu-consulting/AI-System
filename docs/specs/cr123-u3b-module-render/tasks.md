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
- Cụm lấy từ `moduleClusters` của `@ai/contracts/hub-admin` (u3a). Cổng ra của ô có id `exit:<khoá>[:<on,…>]`; `connectPatch` đổi nguồn sang stage chờ (nhánh `wait.branches`, "Ký xong" ⇒ `nextStep`), luật đích: chỉ bước sau stage chờ.
- Trần số bước tính theo số stage THẬT (`stageCount`), số cột/bước người dùng thấy đếm ô một lần.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Node module nhiều stage là một ô trên sơ đồ flow (nguồn: CR-123 FLOW3-FR-14)
Trên sơ đồ flow, các stage liền nhau của cùng một node module (Ký số = gửi ký + chờ ký) hiện thành MỘT ô cùng dáng bước thường: tên bước, loại node,
và các đầu ra theo kết quả nghiệp vụ do manifest khai (`exits`: Ký xong · Từ chối · Hết hạn). Ô chiếm một cột; chọn ô là chọn stage đầu của cụm;
cạnh vào ô tới stage đầu, cạnh "đi tiếp" ra khỏi ô tới bước kế, cạnh Từ chối/Hết hạn theo nhánh của stage chờ. Bản nháp và dữ liệu đã lưu không đổi.
- Kịch bản: khi mở mẫu "Duyệt theo giá trị" thì thấy đúng một ô Ký số với ba đầu ra Ký xong, Từ chối, Hết hạn [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » đúng MỘT ô Ký số với 3 đầu ra Ký xong · Từ chối · Hết hạn]
- Kịch bản: khi gộp thì ô chiếm một cột và số cột đếm ô một lần [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » ô chiếm một cột: cột sau dồn trái, số cột đếm ô một lần]
- Kịch bản: khi stage chờ có nhánh từ chối/hết hạn thì cạnh đi từ đúng đầu ra tới bước đích [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » nhánh Nếu và cạnh Từ chối/Hết hạn đổi theo cột đã gộp]
- Kịch bản: khi vẽ bố cục thì cạnh vào ô tới stage đầu và cạnh ra đi thẳng bước kế [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts]
- Kịch bản: khi kéo đầu ra Từ chối / Hết hạn / Ký xong sang bước sau thì đặt nhánh của stage chờ, đích không sau stage chờ thì báo lỗi [test: apps/admin-web/src/features/processes/lib/canvas-connect-exit.test.ts » Từ chối ⇒ declined + voided của stage chờ tới đích, giữ nhánh khác]
- Kịch bản: khi tính chỗ còn lại cho trần số bước thì ô Ký số tính 2 stage [test: apps/admin-web/src/features/processes/components/canvas/module-cluster.test.ts » số stage thật (trần số bước) khác số ô: ô Ký số = 2 stage]

## Việc còn lại
- Ảnh nghiệm thu: `docs/specs/CR-123/shots/u3b/` (1 mẫu một ô Ký số 3 đầu ra · 2-3 kéo "Từ chối" sang Trả lại rồi về Kết thúc · Từ chối · 4 menu "Thêm bước" không có "Chờ ký xong").
- Lỗi CŨ sửa kèm (không do u3a/u3b): mở flow trong trình soạn vỡ trang "Cannot read properties of undefined (reading 'kind')" — `waitFromDef` đọc `ex.from.kind` mà node lõi "Chờ tới" (core.nodes, CR-122 N1) đặt sẵn giờ nhưng KHÔNG có nguồn ngày; menu "Thêm bước" (p25 e2e6c8da1) dựng patch của mọi node nên vỡ cả trang. Sửa: `waitFromDef` chịu `from` vắng (nguồn trống); test `lib/palette-all-nodes.test.ts`.
