---
id: cr125-x9-layout-direction
lát: cr125-x9-layout-direction
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: x4 (đã gộp), m6b (đã gộp)
---
## Plan (ngắn)
Người dùng: (1) chọn hướng sơ đồ Ngang / Dọc; (2) "Gửi đối tác xác nhận" là bước nghiệp vụ nhưng nằm ở "Nâng cao"; (3) lỗi shot c1: cạnh "Ký xong" rời từ mép TRÊN node rồi đi vòng, Từ chối / Hết hạn không có cạnh, nhiều cạnh chạy dưới node.

## Làm
1. Hướng bố cục: `StageUiSchema.dir` (`RIGHT` Ngang | `DOWN` Dọc) — lưu cùng chỗ vị trí tay (`ui`), ghi trên mọi giai đoạn, đọc từ giai đoạn đầu có giá trị (`lib/layout-dir.ts`); chưa lưu ⇒ Ngang, Dọc khi màn < 1100 px. Đổi hướng = một bước hoàn tác (ghi `uiDir` + bỏ vị trí tay) và fit lại. Nút "Ngang | Dọc" cạnh "Sắp xếp" (`LayoutDirControl`).
2. ELK: `direction` RIGHT/DOWN; cổng ra ở mép EAST (Ngang) / SOUTH (Dọc, đảo chỉ số cho cổng đầu nằm bên trái); node nhiều cổng chừa thêm bên phải (Ngang) / bên dưới (Dọc); Dọc gập theo khung (tỉ lệ như Ngang 2.4, màn hẹp 0.8). Node (`StageNode`, `IfNode`, `ModuleNode`, cổng ra) đặt chấm vào/ra đúng mép theo hướng (`DirCtx`, `sidesOf`). Chống chồng nhau + khung nhìn theo node chọn dùng chung cho cả hai hướng (hộp có phần chừa theo hướng).
3. Sửa cạnh Ký số: cạnh tiến rời ô module gán `sourceHandle` = chấm "Ký xong" (`withMainExit`) — trước đó xyflow lấy handle nguồn đầu tiên trong DOM (cổng ẩn "back" mép trên) nên đi vòng; đầu ra của ô module đọc từ `MODULES` (không phụ thuộc palette theo công ty) nên luôn có đủ Ký xong / Từ chối / Hết hạn và cạnh tới Kết thúc · Từ chối.
4. Cạnh vẽ theo đường định tuyến NÉ node (`routing/orthogonal`, lưới Hanan + Dijkstra, phạt khúc rẽ): bắt đầu đúng ở chấm xyflow đưa (toạ độ + mép), không cắt hộp node nào kể cả node đã kéo tay; "+" và nhãn đặt trên chính đường (nút "+" ở giữa). Dùng cho cạnh tiến / quay lại / rẽ nhánh / cạnh thường (`routed`). Canvas có "Bắt đầu khi" cao thêm (460 → 520 px) để flow demo vừa khung ở mức chữ đọc được.
5. `contracts.partner-send` khai `menu: { section: "business", order: 35 }` ⇒ nằm ở nhóm nghiệp vụ của menu "+" (sau Ký số); chỉ hiện khi công ty có tính năng `contracts-partner-confirm` (palette lọc theo `feature`).

## Không làm / Chạm
- Không dùng `sections` của ELK để vẽ: chấm đầu ra thật của xyflow lệch với cổng mô hình ELK vài px, và vị trí tay / ngăn chi tiết làm đường ELK cũ đi; đường định tuyến tại chỗ luôn khớp chấm và né node (có test). ELK vẫn xếp node.
- Không hub-api / migration (`ui` đã là trường chỉ-UI của giai đoạn, engine bỏ qua).

## Test tối thiểu
Unit: `flow-canvas/layout/direction.test.ts`, `routing/orthogonal.test.ts`, `canvas/x9-exit-edges.test.ts`, `lib/x9-layout-dir.test.ts`, `contracts process-ui.test.ts`, `node-menu.test.ts`; e2e `cr123-arrow-drag.spec.ts` (U12b: cạnh bắt đầu ở chấm ≤ 4px, không cạnh nào đi dưới node, Ngang → Dọc, lưu và mở lại giữ Dọc) chạy MỘT lần trên evotest; tsc flow-canvas + contracts + admin-web.

## Quyết định trong lúc làm
- `StageUiSchema.y` thành tuỳ chọn (cần `y` hoặc `dir`) để giai đoạn chỉ mang hướng không cần vị trí tay; hướng ghi trên MỌI giai đoạn (xoá giai đoạn đầu không mất hướng), đọc từ giai đoạn đầu có giá trị.
- Đổi hướng bỏ vị trí tay (toạ độ của hướng cũ không dùng được ở hướng mới).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Sơ đồ có hướng Ngang / Dọc, cạnh bắt đầu ở chấm đầu ra và không đi dưới node (nguồn: CR-125 x9)
Người dùng chọn hướng sơ đồ Ngang (ELK RIGHT, cổng ra mép phải) hoặc Dọc (ELK DOWN, cổng ra mép dưới); lựa chọn lưu theo flow trong `ui`, mặc định Ngang (Dọc khi màn dưới 1100 px), đổi hướng hoàn tác được. Mọi cạnh rời ô Ký số bắt đầu đúng ở chấm của đầu ra (Ký xong / Từ chối / Hết hạn), không cạnh nào cắt node khác, nút "+" nằm giữa đường đã định tuyến. "Gửi đối tác xác nhận" nằm ở nhóm nghiệp vụ của menu "+".
- Kịch bản: khi chọn Dọc thì ELK dùng hướng DOWN và cổng ra ở mép dưới [test: packages/flow-canvas/src/layout/direction.test.ts » cổng ra: Ngang ở mép phải (EAST), Dọc ở mép dưới (SOUTH)]
- Kịch bản: khi chưa lưu hướng thì mặc định Ngang, màn hẹp thì Dọc, đã lưu thì theo lưu [test: apps/admin-web/src/features/processes/lib/x9-layout-dir.test.ts » đã lưu thắng mặc định (kể cả màn hẹp), đọc từ giai đoạn đầu có giá trị]
- Kịch bản: khi đổi hướng thì mọi giai đoạn mang hướng mới và mất vị trí tay [test: apps/admin-web/src/features/processes/lib/x9-layout-dir.test.ts » mọi giai đoạn mang hướng mới, vị trí tay (x, y) mất]
- Kịch bản: khi Ký xong nối tới bước kế thì cạnh dùng chấm Ký xong chứ không phải cổng ẩn ở mép trên [test: apps/admin-web/src/features/processes/components/canvas/x9-exit-edges.test.ts » Ký xong → Kế toán dùng chấm 'Ký xong' (không phải cổng ẩn ở mép trên)]
- Kịch bản: khi Từ chối và Hết hạn có đích thì mỗi đầu ra có cạnh riêng tới Kết thúc · Từ chối [test: apps/admin-web/src/features/processes/components/canvas/x9-exit-edges.test.ts » Từ chối và Hết hạn đều có cạnh tới Kết thúc · Từ chối, mỗi cạnh ở chấm riêng]
- Kịch bản: khi vẽ flow demo cộng một bước thêm ở cả Ngang và Dọc thì không cạnh nào cắt hộp node [test: packages/flow-canvas/src/routing/orthogonal.test.ts » mọi cạnh bắt đầu ở chấm và không cắt hộp node nào]
- Kịch bản: khi mở flow thật, thêm Kế toán duyệt chi rồi đổi sang Dọc thì cạnh bắt đầu ở chấm, không đi dưới node, lưu và mở lại giữ hướng Dọc [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]
- Kịch bản: khi công ty mở menu "+" thì "Gửi đối tác xác nhận" ở nhóm nghiệp vụ sau Ký số [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng]

## Việc còn lại
- Không.
