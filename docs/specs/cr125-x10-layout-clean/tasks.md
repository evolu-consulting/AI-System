---
id: cr125-x10-layout-clean
lát: cr125-x10-layout-clean
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: x9 (đã gộp)
---
## Plan (ngắn)
Giám đốc xem shot x9 `1-ngang.png`: (1) thứ tự flow vỡ — Ký số nằm TRÁI các bước duyệt trước nó, "Kế toán duyệt chi" (sau Ký số) lùi sang trái + xuống, cạnh Ký xong đi phải, xuống rồi quay trái thành chữ U (do ELK gập hàng `MULTI_EDGE`); (2) cạnh cắt nhau, nhãn "Từ chối" / "Hết hạn" đè nhau; (3) "Kết thúc · Trả lại" lạc một mình ở góc trên trái.

## Làm
1. ELK không gập hàng: `wrapping.strategy = OFF` ⇒ MỘT dải theo chiều flow (Ngang trái → phải, Dọc trên → dưới); `considerModelOrder = NODES_AND_EDGES` + `cycleBreaking = MODEL_ORDER` (thứ tự khai báo dẫn tầng và thứ tự trong tầng), `crossingMinimization = LAYER_SWEEP`, `favorStraightEdges`; khoảng giữa tầng Ngang 60 (Dọc 70).
2. Node Kết thúc xếp tầng CUỐI (`layerConstraint = LAST`, node đầu "Bắt đầu khi" = FIRST) và `separateConnectedComponents = false` để node không có cạnh nào (Kết thúc · Trả lại) cũng vào cột cuối, không còn lạc ở đầu sơ đồ. Host đặt `layer` theo `isTerminalView`.
3. Nhãn đầu ra: các đầu ra CÙNG đích (Từ chối + Hết hạn → Kết thúc · Từ chối) chung MỘT nhãn ghép "Từ chối · Hết hạn" ở cạnh đầu (`moduleEdges`), đặt ở đoạn cuối gần node đích, tránh đè node (`labelPoint`) — không còn hai nhãn đè nhau; chấm đầu ra vẫn mang tên riêng.
3b. Node vừa thả rồi được NỐI vào flow (`clearFree`) bỏ vị trí lúc thả (`ui.x/y`) để ELK xếp theo thứ tự flow, không nằm lạc ở chỗ thả (nguyên nhân "Kế toán duyệt chi" lùi trái / xuống dưới).
4. Mức zoom tối thiểu khi fit của canvas flow 0.75 → 0.6 để cả flow demo (một dải ~1800px) vừa khung 1100px; chữ vẫn đọc được, kéo / zoom tay như cũ.

## Không làm / Chạm
- Không đổi định tuyến cạnh của x9 (bộ định tuyến né node dùng nguyên) và không đổi dữ liệu / contract. Cạnh Từ chối và Hết hạn tới cùng một đích vẫn chung đoạn cuối (hai nhãn tách ở đoạn đầu).

## Test tối thiểu
Unit/acceptance `flow-canvas/layout/clean-layout.test.ts` (flow demo + Kế toán duyệt chi, Ngang và Dọc: thứ tự theo chiều flow, Kết thúc cùng tầng cuối, cạnh cắt nhau ≤ 1, nhãn không đè nhau / node, đường chính không quay đầu), `elk.test.ts`; e2e `cr123-arrow-drag.spec.ts` chạy MỘT lần trên evotest; tsc flow-canvas + admin-web.

## Quyết định trong lúc làm
- Không gập hàng ⇒ flow dài hơn khung phải kéo / thu nhỏ (thay vì đọc ngược): chọn đọc đúng thứ tự thay vì vừa khung bằng mọi giá.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Sơ đồ đọc được như văn bản: bước sau nằm sau bước trước, Kết thúc gom cuối, ít cắt nhau (nguồn: CR-125 x10)
Bố cục theo đúng thứ tự flow ở cả Ngang và Dọc (không gập hàng, không chữ U ngược chiều); mọi node Kết thúc nằm ở tầng cuối; cạnh cắt nhau tối đa một lần ở flow demo; nhãn đầu ra không đè nhau hay đè node.
- Kịch bản: khi vẽ flow demo cộng Kế toán duyệt chi thì mọi bước đích nằm sau bước nguồn theo chiều flow [test: packages/flow-canvas/src/layout/clean-layout.test.ts » bước sau nằm sau bước trước theo chiều flow (mọi cạnh tiến)]
- Kịch bản: khi có node Kết thúc kể cả node không cạnh nào thì chúng cùng nằm ở tầng cuối [test: packages/flow-canvas/src/layout/clean-layout.test.ts » các node Kết thúc gom ở tầng cuối, Bắt đầu khi ở tầng đầu, không node mồ côi ở đầu sơ đồ]
- Kịch bản: khi định tuyến cạnh của flow demo thì số cạnh cắt nhau không quá một [test: packages/flow-canvas/src/layout/clean-layout.test.ts » số cạnh cắt nhau ≤ 1]
- Kịch bản: khi Từ chối và Hết hạn cùng đi tới một đích thì hai nhãn không đè nhau và không đè node [test: packages/flow-canvas/src/layout/clean-layout.test.ts » nhãn Từ chối / Hết hạn không đè nhau và không đè node]
- Kịch bản: khi đi theo đường chính của flow demo thì không quay đầu ngược chiều flow [test: packages/flow-canvas/src/layout/clean-layout.test.ts » đường chính (Bắt đầu khi → … → Kế toán duyệt chi → Kết thúc) không quay đầu ngược chiều flow]
- Kịch bản: khi mở flow thật rồi thêm Kế toán duyệt chi và đổi hướng thì không chồng nhau, cạnh không đi dưới node [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]

## Việc còn lại
- Không.
