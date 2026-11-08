---
id: cr123-u13-elk-layout
lát: cr123-u13-elk-layout
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u12 (đã gộp); u12b (chưa gộp — chung arrow-rules.ts, use-canvas-edit.ts, free-nodes.ts, cr123-arrow-drag.spec.ts: sẽ có xung đột nhỏ khi gộp)
---
## Plan (ngắn)
Người dùng chốt dùng thư viện mạnh cho bố cục sơ đồ (ADR-0040): ELK `layered` thay bố cục cột tự viết. Flow demo 8–9 bước phải vừa khung 1440×900 / 1280×800 ở chữ đọc được.

## Làm
0. Ô "Gộp tới" ở ngăn chi tiết dùng cùng luật mũi tên (`linkableSteps` ở `arrow-rules.ts`): mọi bước không tạo vòng lặp; chọn bước trước ⇒ nối + sắp lại bước qua `ops.connect` (`onLink`). Ô "Theo kết quả chờ" của Ký số cũng dùng luật này (nguồn = cả cụm, nối từ đầu ra của cụm).
1. ADR-0040 `docs/adr/0040-elkjs-canvas-layout.md`.
2. `elkjs` 0.12.0 (ghim; phát hành 2026-07-17). Tải lười chỉ ở chunk `canvas`: `elk-api` (4 KB) trong chunk `q`; worker `elk-worker.min.js` (1,47 MB) phát NGUYÊN VĂN như tệp tĩnh `/static/elk/elk-worker.min.js` (`output.copy` trong `rsbuild.config.ts`, không vào chunk nào) và chạy trong web worker. `check:bundle` OK: js ban đầu 173,0 KB, chunk lớn nhất 49,3 KB; chunk trình soạn: canvas 26,1 KB + canvas-vendor 122,6 KB + elk-api 4,1 KB (gzip theo script riêng; ELK không vào ngân sách trang nào).
3. Bố cục: `packages/flow-canvas/src/layout/elk.ts` (đồ thị → đầu vào ELK → toạ độ; cổng ra mép phải theo thứ tự cố định cho Nếu / Ký số; cạnh `ORTHOGONAL` vẽ bằng smoothstep; gập hàng `MULTI_EDGE` + `aspectRatio` 2.4; toạ độ dự phòng khi worker lỗi), `layout/graph.ts` (cạnh: tiến, Đúng/Sai, rẽ nhánh, quay lại; Kết thúc không đi tiếp), hook `useFlowLayout`. XOÁ bố cục cột (`layout/columns.ts` + test, tiêu đề cột `StepHeaderNode`, nút gộp `JoinNode`, `stepFromDropX`, `clampY`, `MoreRight`, `collapseLoneJoins`, `stepHeaderLabels`); `columns-fit` ⇒ `view-fit` (không còn chia theo cột).
4. Vị trí: ELK tính khi mở lần đầu và mỗi khi cấu trúc đổi (thêm/xoá/nối); node người dùng kéo tay giữ `ui.x` + `ui.y` (contracts: `x` tuỳ chọn, tương thích ngược); "Sắp xếp" xoá vị trí tay (một bước hoàn tác, đã kiểm: kéo → Sắp xếp về chỗ cũ → Hoàn tác trả lại). Thả node từ menu: thành bước mới ở cuối, đứng đúng chỗ thả. Kéo ngang không còn đổi bước (đổi thứ tự = kéo mũi tên, u12).
5. Test: unit `layout/elk.test.ts` + `layout/graph.test.ts` (ELK thật qua worker của bun); e2e `cr123-arrow-drag.spec.ts` + `cr123-palette-drop.spec.ts` xanh trên evotest (4 pass). Ảnh: `docs/specs/CR-123/shots/u13/` (evolu, julian.bui, vi, 1440 và 1280): flow "Duyệt 2 cấp" 8 bước nằm trọn trong khung ở zoom ≈ 1, cổng/cạnh vuông góc.

## Không làm / Chạm
- Không engine / hub-api / migration; không CR-124; không tooling depcruise.
- Chạm contracts `process-ui.ts` (`x` tuỳ chọn) — chỉ UI, engine bỏ qua.

## Test tối thiểu
Unit flow-canvas 33 + admin-web processes 476 + contracts process-ui; tsc admin-web + flow-canvas sạch; e2e xanh (xem 5); `check:bundle` OK.

## Quyết định trong lúc làm
- Cạnh vẽ bằng smoothstep của xyflow (ELK chỉ quyết thứ tự/cổng/khoảng cách), không dùng bend point của ELK: node kéo tay vẫn có cạnh đúng.
- e2e: thả Duyệt vào điểm trống tính theo khung (`emptySpot`) vì bố cục ELK phủ khắp khung (không còn "dưới đáy"); palette-drop đợi số node ổn định (ELK bất đồng bộ); U12 kiểm cạnh theo id node thay vì vị trí x.
- Minimap mặc định TẮT, bật bằng nút ở thanh điều khiển (bố cục ELK phủ khắp khung nên minimap luôn che node).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Sơ đồ flow xếp bằng ELK, gập hàng, cổng ra cố định thứ tự, cạnh vuông góc (nguồn: CR-123 u13, ADR-0040)
Sơ đồ flow do ELK `layered` xếp khi mở lần đầu và khi cấu trúc đổi: đi trái → phải, gập thành nhiều hàng cho vừa khung, đầu ra nhiều nhánh (Ký số, Nếu) là cổng ở mép phải theo thứ tự cố định, cạnh vuông góc. Node người dùng kéo tay giữ vị trí; "Sắp xếp" xoá vị trí tay và hoàn tác được.
- Kịch bản: khi xếp flow demo 8 bước thì các bước gập hàng và vừa khung 1100×458 ở chữ đọc được [test: packages/flow-canvas/src/layout/elk.test.ts]
- Kịch bản: khi node có nhiều đầu ra thì cổng đi từ trên xuống theo thứ tự Ký xong, Từ chối, Hết hạn [test: packages/flow-canvas/src/layout/elk.test.ts » thứ tự cổng từ trên xuống: Ký xong → Từ chối → Hết hạn]
- Kịch bản: khi dựng cạnh thì bước Kết thúc không có cạnh đi tiếp và node Nếu có đúng hai cạnh Đúng/Sai [test: packages/flow-canvas/src/layout/graph.test.ts » bước Kết thúc không có cạnh đi tiếp]
- Kịch bản: khi thả node từ menu thì node thêm đúng một, đứng riêng ở chỗ thả [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]

## Việc còn lại
- Không còn việc dở của u13. Sau rebase lên gd0 (u12b đã gộp): cả hai ô chọn bước ('Gộp tới', 'Theo kết quả chờ' của Ký số) dùng luật mũi tên chung; minimap mặc định tắt (nút ở thanh điều khiển) nên không che node.
