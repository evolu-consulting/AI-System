---
id: cr118-route-kind
lát: cr118-route-kind
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-flow-routing
---
## Plan (ngắn)
Thêm điều kiện **loại hợp đồng** vào luật chọn quy trình (CR-118 §11.2): `condition = {departmentIds?: uuid[], contractKinds?: ("buy"|"sell"|"referral")[]}`.
Cả hai tuỳ chọn, AND, rỗng/vắng = mọi giá trị; luật thường cần ≥ 1 điều kiện không rỗng. Enum = `CONTRACT_DEALS` (Mua/Bán/Giới thiệu).

## Làm
- [x] Contract zod `RoutingConditionSchema` + `ROUTING_CONTRACT_KINDS` (tương thích ngược: luật chỉ `departmentIds` vẫn hợp lệ).
- [x] `pickProcess(rules, depts, facts)` — `facts.contractKind` vắng ⇒ bỏ qua điều kiện loại; `null` ⇒ luật có loại không khớp.
- [x] Launch: `startState` đọc `c.deal` ⇒ `slotFlowOf(..., deal)` ⇒ `port.routeSlot(t, slot, user, {contractKind})` ⇒ `routeSlot` ⇒ `pickProcess`.
- [x] `normalize` (PUT): lưu chỉ phần không rỗng; không điều kiện ⇒ 422 `ROUTING_RULES_INVALID {reason:"no_condition"}`; kind ngoài enum ⇒ 400.
- [x] Web: `@ai/web-kit/routing-rules` (`contractKinds`, `toggleKind`, `slotHasKinds`); sohoptac-web `KindPicker` (chunk lười Cài đặt); admin-web SlotRouting ô "Loại hợp đồng".

## Không làm / Chạm
- Không migration: `condition` là jsonb (CHECK chỉ `jsonb_typeof = 'object'`, hub 0087).
- Không đổi DLC, không đổi engine.

## Test tối thiểu
- unit `routing.rules.test.ts` (ma trận phòng ban × loại, thứ tự, mặc định, khe không loại), `routing-rules.test.ts` (web-kit).
- int `routing-launch.int.test.ts` (Kinh doanh+mua ⇒ A, Kinh doanh+bán ⇒ B, BGĐ+mua ⇒ C, BGĐ+bán ⇒ chặn), `routing.routes.int.test.ts` (lưu/400/422).
- e2e `e2e/contracts-web/tenant-routing.cw.ts` (chọn Mua ⇒ PUT có `contractKinds`).

## Quyết định trong lúc làm
- Mã lỗi UI giữ `noDepartment` (nghĩa mới: chưa có điều kiện nào) để không đổi khoá i18n; chữ cập nhật.
- `reason` 422 đổi `no_departments` ⇒ `no_condition` (chưa client nào đọc reason).
- Ô chọn loại chỉ hiện ở khe `contracts.approval` (`slotHasKinds`).
- Enum giữ bản sao ở `hub-admin/process-routing.ts` để không kéo zod gói hợp đồng vào hub-admin.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Chọn quy trình theo phòng ban và loại hợp đồng
Điều kiện luật `{departmentIds?, contractKinds?}` kết hợp AND, rỗng/vắng = mọi giá trị; `contractKinds` ∈ {buy, sell, referral}. Lượt duyệt HĐ gửi loại HĐ (`deal`) khi launch; khe không có loại bỏ qua điều kiện loại. Luật thường cần ≥ 1 điều kiện.
- Kịch bản: ma trận phòng ban × loại, thứ tự, mặc định [test: apps/hub-api/src/modules/processes/library/routing.rules.test.ts » ma trận phòng ban × loại]
- Kịch bản: khe không cung cấp loại ⇒ bỏ qua điều kiện loại [test: apps/hub-api/src/modules/processes/library/routing.rules.test.ts » khe không cung cấp loại ⇒ bỏ qua điều kiện loại]
- Kịch bản: launch Kinh doanh+mua ⇒ A, Kinh doanh+bán ⇒ B, BGĐ+mua ⇒ C, BGĐ+bán ⇒ chặn [test: apps/hub-api/src/modules/processes/library/routing-launch.int.test.ts » cr118-route-kind · launch chọn theo phòng ban + loại HĐ]
- Kịch bản: lưu luật có loại; loại ngoài enum ⇒ 400; không điều kiện ⇒ 422 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » cr118-route-kind · luật theo loại HĐ: lưu, loại ngoài enum ⇒ 400, không điều kiện ⇒ 422]

## Việc còn lại
- (không)
