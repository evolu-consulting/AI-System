---
id: cr123-u12-arrow-order
lát: cr123-u12-arrow-order
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u8 (đã gộp)
---
## Plan (ngắn)
Demo: kéo "Thông báo" → "Kết thúc · Đã duyệt" bị từ chối "Chỉ nối được tới bước đứng sau" dù không tạo vòng. Giám đốc không thấy thứ tự bước bên trong ⇒ luật phải là "không tạo vòng lặp", không phải "số bước".

## Làm
1. `lib/arrow-rules.ts` (MỘT nguồn, thuần): `arrowOrder` / `laterTarget` / `triggerArrow`. Đích nằm trước nguồn mà không phải tổ tiên ⇒ sắp lại các bước theo thứ tự tô-pô ổn định (chỉ ô bị ép mới dời chỗ; cạnh "bước kế" ngầm được ghi tường minh rồi đánh lại số; cụm Ký số là một ô, không bị xen). Kiểm vòng bằng `getOutgoers` của React Flow (mẫu "prevent cycles").
2. Chỉ từ chối vòng lặp thật (đích là tổ tiên / chính nguồn / bước đầu): "Không nối ngược lại bước trước — sẽ tạo vòng lặp". Ký số vẫn cần bước Duyệt ngay trước (luật của node, `connectPatch`).
3. Kéo mới, nối lại đầu đích và "Bắt đầu khi" cùng đi qua `useCanvasEdit.connect` → `laterTarget` / `triggerArrow`; "Bắt đầu khi" → Ký số báo lý do (kiểm trên stack và e2e: toast hiện).
4. e2e `cr123-arrow-drag.spec.ts` thêm ca U12 (Thông báo → Kết thúc · Đã duyệt, nối ngược bị từ chối, Bắt đầu khi → Ký số).

## Không làm / Chạm
- Không engine / hub-api / migration. Luật lưu của hub (đích ở bước sau) giữ nguyên: bản nháp luôn được sắp lại cho hợp lệ trước khi lưu.
- Ô chọn "Gộp tới" ở ngăn chi tiết vẫn chỉ liệt kê bước sau (tập con của luật mới, không sai); chưa cho chọn bước trước ở đó.

## Test tối thiểu
Unit `lib/u12-arrow-order.test.ts` (7); admin-web processes 478 pass; tsc admin-web sạch; e2e `cr123-arrow-drag.spec.ts` 3 pass trên evotest (gồm ca U8 cũ và ca U12 mới). Ảnh `docs/specs/CR-123/shots/u12/` (evolu, julian.bui, vi, 1440×900).

## Quyết định trong lúc làm
- Cùng cột song song (hai bước cùng một cột) vẫn coi là "cùng ô" ⇒ báo vòng lặp (hiếm; chưa tách cột).
- `backTo` (cổng Từ chối quay lại) không tính là cạnh của đồ thị; `rebuild` đổi số và bỏ đích không còn đứng trước.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Mũi tên chỉ bị từ chối khi tạo vòng lặp (nguồn: CR-123 FLOW3-FR-04 u12)
Kéo mũi tên tới bất kỳ bước nào không phải tổ tiên của nguồn đều nối được; bước đích nằm trước nguồn thì các bước được sắp lại để bản nháp vẫn hợp lệ. Nối ngược về tổ tiên bị từ chối bằng "Không nối ngược lại bước trước — sẽ tạo vòng lặp". Ký số vẫn cần Duyệt ngay trước; "Bắt đầu khi" → Ký số báo lý do.
- Kịch bản: khi nối bước đứng sau tới bước nằm trước nhưng không phải tổ tiên thì các bước được sắp lại và mũi tên nối được [test: apps/admin-web/src/features/processes/lib/u12-arrow-order.test.ts » đích nằm trước nguồn và không phải tổ tiên ⇒ sắp lại, mũi tên nối được]
- Kịch bản: khi đích là tổ tiên của nguồn thì bị từ chối vì vòng lặp [test: apps/admin-web/src/features/processes/lib/u12-arrow-order.test.ts » đích là tổ tiên (hoặc bước đầu) ⇒ từ chối vì tạo vòng lặp, không đổi gì]
- Kịch bản: khi nối từ Bắt đầu khi tới Ký số thì bị từ chối kèm lý do [test: apps/admin-web/src/features/processes/lib/u12-arrow-order.test.ts » bị từ chối kèm mã lý do `realNeeds` (hook báo toast)]
- Kịch bản: khi kéo Thông báo tới Kết thúc · Đã duyệt nằm trước nó thì nối được, nối ngược bị từ chối và Bắt đầu khi → Ký số hiện toast [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12 · mũi tên tới bước nằm trước (Thông báo → Kết thúc · Đã duyệt) sắp lại bước, nối ngược bị từ chối vì vòng lặp, Bắt đầu khi → Ký số báo lý do]

## Việc còn lại
- Ô "Gộp tới" cho chọn cả bước trước (dùng `arrowOrder`) — hàng chờ.
