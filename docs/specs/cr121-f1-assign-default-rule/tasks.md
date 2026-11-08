---
id: cr121-f1-assign-default-rule
lát: cr121-f1-assign-default-rule
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lỗi D-5: "Gán quy trình" ở admin-web (PUT `/tenants/:tid/process-routing/:slot/processes/:defId`, `RoutingService.assign`) chỉ thêm def vào
tập gán; luật mặc định của khe không đổi ⇒ cổng engine (`slotAssigned` = luật `source='admin'`) không mở / engine chạy quy trình cũ
(thao tác ẩn bắt buộc, Luật GỐC 3). Sửa: đường gán đó gọi `upsertAssignment` (đường duy nhất đã có của D-4) trong CÙNG tx.

## Làm
- `routing.service.ts` `assign`: `assignable` (B2) → `defaultRuleOf` (đã là mặc định do admin đặt ⇒ không đổi, không bump) → `upsertAssignment`
  (tập gán + đầu luật version+1 + luật `is_default` = def, `source='admin'`). Audit `assign_process` ghi `default_def_id` trước/sau.
- `routing.repo.ts`: thêm `defaultRuleOf` (một câu); `insertAssigned` chỉ còn là dữ liệu mồi của test (`community-optin.int`), không còn đường gán thật nào dùng.
- Test: `tests/acceptance/CF/assign-default-rule.int.test.ts` (gán qua API ⇒ lượt mới chạy engine đúng quy trình; gán B ⇒ đổi theo;
  công ty khác đọc HĐ/lượt duyệt ⇒ 404); `routing.routes.int.test.ts` cập nhật theo hành vi mới.

## Không làm / Chạm
- Không đổi UI/i18n (gán xong là chạy đã đúng Luật GỐC 3), không migration. Luật theo phòng ban/loại HĐ giữ nguyên khi gán.
- Bỏ gán quy trình đang là luật mặc định vẫn 409 `ROUTING_PROCESS_IN_USE` (gán quy trình khác trước).
- Ca phụ "400 khi công ty khác truy cập": `GET /contracts/:id` và `/contracts/:id/approval` đã trả 404 `NOT_FOUND` (không lộ); int khoá lại.

## Test tối thiểu
int: `tests/acceptance/CF/assign-default-rule.int.test.ts`, `apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts`;
giữ xanh: `slot-assigned.int.test.ts`, `tests/acceptance/CF/engine-tenant-gate.int.test.ts`.

## Quyết định trong lúc làm
- Một nguồn: luật định tuyến. `process_tenant_defs` do `upsertAssignment` ghi cùng tx. Def mặc định cũ vẫn nằm trong tập gán (người dùng bỏ gán sau).
- Perf: không chạm đường nóng (thêm 1 SELECT + đường ghi sẵn có, chỉ platform_admin).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Gán nhiều quy trình cho tenant (platform_admin) (nguồn: cr118-flow-routing)
Gán quy trình đã xuất bản của khe cho công ty (admin-web, Công ty › Quy trình) đồng thời đặt luật mặc định của khe = quy trình đó
(`source='admin'`) trong cùng giao dịch; gán quy trình khác thì luật mặc định đổi theo; gán lại đúng quy trình đang là mặc định thì không đổi.
- Kịch bản: khi platform admin gán quy trình A cho công ty chưa gán gì rồi gán B thì lượt duyệt mới chạy engine với A, sau đó với B, không cần đặt luật nào khác [test: tests/acceptance/CF/assign-default-rule.int.test.ts » gán qua API ⇒ lượt mới chạy engine với quy trình đó, gán quy trình khác ⇒ đổi theo]
- Kịch bản: khi gán quy trình thì luật mặc định đổi theo, gán lại đúng mặc định không bump, bỏ gán quy trình đang là mặc định bị chặn [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » platform_admin gán và bỏ gán quy trình]
- Kịch bản: khi khe opt-in (duyệt bài Community) chưa gán thì tắt, gán thì bật và luật mặc định = quy trình đó, bỏ gán quy trình mặc định duy nhất thì tắt lại [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » CR-121 F-1 · khe opt-in (duyệt bài Community): chưa gán ⇒ tắt · gán ⇒ bật và chạy đúng quy trình đó · bỏ gán ⇒ tắt lại]
- Kịch bản: khi bỏ gán quy trình đang là mặc định của khe thường thì 409 kèm câu cách sửa gán quy trình khác làm mặc định trước [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » platform_admin gán và bỏ gán quy trình]

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Người công ty khác không lộ tồn tại HĐ/lượt duyệt
Đọc chi tiết HĐ hoặc lượt duyệt của công ty khác trả 404 `NOT_FOUND` như id không tồn tại.
- Kịch bản: khi người công ty 2 đọc HĐ và lượt duyệt của công ty 1 thì nhận 404 NOT_FOUND [test: tests/acceptance/CF/assign-default-rule.int.test.ts » người công ty khác đọc HĐ / lượt duyệt của công ty này ⇒ 404 (không lộ tồn tại, không 400)]

## Quyết định bổ sung (điều phối, sau soát Opus)
- Khe opt-in: `slotActive`/`moderationOn` đã coi "có luật hoặc có quy trình trong tập" = bật ⇒ gán (luật mặc định admin + tập gán) là bật, không cần công tắc; không đổi cổng. Int mới khoá hành vi.
- `RoutingService.unassign`: khe opt-in + quy trình chỉ còn được luật MẶC ĐỊNH dùng ⇒ bỏ gán = tắt khe (xoá luật mặc định cùng tx; trước F-1 không có luật nên bỏ gán được, giữ khả năng "tắt"). Khe thường vẫn 409. 409 có `message` tiếng Việt nói cách sửa (mặc định ⇒ gán quy trình khác trước; luật điều kiện ⇒ sửa/xoá luật) + i18n vi/en `tenants.slots.routing.err.inUse` cập nhật câu cách sửa.

## Việc còn lại
- D-5: bỏ workaround đã gỡ; chạy lại e2e hành trình sau khi F-1 merge.
