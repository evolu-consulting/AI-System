---
id: cr123-u14-end-terminal
lát: cr123-u14-end-terminal
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u13 (đã gộp)
---
## Plan (ngắn)
Ảnh demo (bố cục cũ) vẽ cổng ra và mũi tên từ "Kết thúc · Đã duyệt" tới "Kết thúc · Từ chối" (cạnh "bước kế theo thứ tự" ngầm). Kết thúc là ĐIỂM CUỐI. Thêm: sau thả / nối / ELK bố cục lại, khung nhìn phải giữ node mới + node vừa nối trọn trong khung (node thả bị cắt nửa ⇒ không kéo mũi tên được).

## Làm
1. ELK còn bị không? Cạnh ngầm đã hết từ u13 (`stepEdges` bỏ cạnh tiến ra khỏi `terminal`); nhưng node Kết thúc VẪN vẽ cổng ra ⇒ gỡ: `StageNode` không dựng cổng ra / cổng quay lại / rẽ nhánh cho điểm cuối (`isTerminalView` = Kết thúc, hoặc chờ sự kiện thường không thuộc node module); `ProcessCanvas` truyền `terminal` theo cùng hàm.
2. Luật mũi tên chung: `connectPatch` kiểm "nguồn là Kết thúc / chờ sự kiện thường ⇒ `noNext`" TRƯỚC mọi luật khác (trước đây tới bước nằm trước còn đi vào đường "sắp lại bước"); `applyConnect` kế thừa.
3. Luật lưu: contracts `FLOW_FINISH_NEXT` thêm trường hợp Kết thúc có luật rẽ nhánh (`after.branch`) — cùng `next_step` đã có; bản nháp (vd mở def cũ) còn "Gộp tới" ở Kết thúc ⇒ lỗi chặn Lưu tại `stages.i.nextStep` (`endNextErrors`).
4. Khung nhìn đi theo việc đang làm: `view-focus.ts` (`focusViewport`, hàm thuần: pan/thu nhỏ mượt tới khung nhìn đích, zoom ≥ 0.75, không phóng to, không dịch khi đã thấy đủ); `useViewFit` chạy lại khi vị trí các node đang làm việc đổi (ELK xếp lại sau khi sửa) và KHÔNG khi người dùng tự kéo/zoom; host (`ProcessCanvas.useFocusIds`) lấy node mới + hai đầu của cạnh mới (tối đa 3), "Sắp xếp" xoá để fit toàn sơ đồ.
5. e2e `cr123-arrow-drag.spec.ts`: node Kết thúc không có `.react-flow__handle.source` (bước thường có); sau thả và sau nối, node mới nằm trọn trong khung canvas.

## Không làm / Chạm
- Không engine / hub-api / migration. Contracts chỉ thêm một luật lưu (cùng mã `FLOW_FINISH_NEXT`).

## Test tối thiểu
Unit: `view-focus.test.ts` (6), `u12b-demo-sequence.test.ts` (+2), contracts `process-flowdef.test.ts` (+1), `canvas-connect.test.ts` cập nhật; tsc admin-web + flow-canvas; e2e arrow-drag + palette-drop (xem báo cáo); ảnh `docs/specs/CR-123/shots/u14/` (evolu, julian.bui, vi, 1440).

## Quyết định trong lúc làm
- "Điểm cuối" gồm cả chờ sự kiện thường (không thuộc node module): `connectPatch` vốn đã coi là không có bước đi tiếp.
- Node nhìn thấy "trọn" = trong khung trừ lề 24 px và ngăn chi tiết; không vừa ở zoom 0.75 ⇒ chỉ giữ node mới (đầu danh sách).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Kết thúc là điểm cuối; khung nhìn đi theo node đang làm việc (nguồn: CR-123 u14)
Bước Kết thúc không có cổng ra và không có cạnh đi tiếp; mũi tên không bao giờ xuất phát từ Kết thúc; lưu bị chặn nếu Kết thúc còn bước đi tiếp. Sau thả / nối / bố cục lại, node mới và node vừa nối nằm trọn trong khung (zoom ≥ 0.75).
- Kịch bản: khi kéo mũi tên xuất phát từ Kết thúc thì bị từ chối [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » mũi tên xuất phát từ Kết thúc luôn bị từ chối (kể cả tới bước nằm trước / sau)]
- Kịch bản: khi bản nháp còn Gộp tới ở Kết thúc thì chặn Lưu [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » bản nháp còn 'Gộp tới' ở Kết thúc ⇒ lỗi chặn Lưu tại stages.i.nextStep]
- Kịch bản: khi def lưu có Kết thúc rẽ nhánh đi tiếp thì bị từ chối [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » u14 · Kết thúc là điểm cuối: có luật rẽ nhánh đi tiếp ⇒ FLOW_FINISH_NEXT]
- Kịch bản: khi node mới nằm nửa ngoài khung thì khung nhìn đưa nó và node vừa nối vào trọn khung, zoom không dưới 0.75 [test: packages/flow-canvas/src/view-focus.test.ts » node mới nằm nửa ngoài khung ⇒ khung nhìn đích đưa nó (cùng node vừa nối) vào trọn khung, zoom giữ nguyên]
- Kịch bản: khi mở flow thì Kết thúc không có cổng ra và node thả nằm trọn trong khung [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12 · mũi tên tới bước nằm trước (Thông báo → Kết thúc · Đã duyệt) sắp lại bước, nối ngược bị từ chối vì vòng lặp, Bắt đầu khi → Ký số báo lý do]

## Việc còn lại
- Không.