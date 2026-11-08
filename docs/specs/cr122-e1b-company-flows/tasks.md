---
id: cr122-e1b-company-flows
lát: cr122-e1b-company-flows
cr: CR-122
làn: đầy đủ (tenant/RLS + hàng đợi + migration)
migration: 0109
phụ thuộc: E1
---
## Plan (ngắn)
Ghi sự kiện từ role gói (0109), API danh sách flow công ty + sao chép/xuất bản/quay về, flow Thư viện chạy thẳng, sửa 3 điểm soát E1, int launch thật + perf.

## Làm
- 0109 `hub.emit_flow_event` (SECURITY DEFINER, `search_path` cố định, chỉ tenant hiện tại); `insertFlowEvents` gọi hàm.
- Soát E1: #1 `closeExhausted` (attempts=5 kẹt ⇒ `lease_exhausted`) gọi mỗi lượt; #2 `candidatesOf` + danh sách + gán chỉ nhận def Thư viện hoặc của chính công ty; #3 `isFlowEventDup` chỉ `process_runs_flow_event_uq`.
- `library/company-flows.{repo,service,routes}.ts`: `GET/POST /tenants/:tid/company-flows`, `PATCH …/:id {enabled}`, `PUT …/order {ids}`, `POST …/:id/clone|publish|revert`.
- Flow Thư viện được gán chạy thẳng bản xuất bản mới nhất: `runs.repo.libraryFlowDef` + `flow-launch.ts` đổi Group theo mã → id công ty (`group-keys.rules.ts`), truyền `flowEvent.def` vào `StartService.createFromApi`.

## Quyết định trong lúc làm
- (c) Dispatcher/adapter đọc thẳng def Thư viện (scope system, release tại `published_version`) chứ không sửa `findDefByKey` — giữ đường chạy cũ theo key của công ty nguyên vẹn; Group theo mã đổi lúc mở lượt, thiếu ⇒ `refused: group_missing:<mã>`.
- Gán (POST) chỉ platform_admin; mọi thao tác khác tenant_admin công ty mình (`companyAccess`); service chạy tx scope system + lọc tenant tường minh, khoá dòng `FOR UPDATE`.
- Gán mới ⇒ Bật ngay (không thao tác ẩn). Bản sao tạo Tắt (`not_published`); "Xuất bản" bản sao = Bật bản sao + Tắt gốc (`replaced`, `replaced_by`) một tx; "Quay về bản gốc" đảo lại, bản sao `reverted`.
- Lưới cuối FR-20: chặn tắt flow không điều kiện cuối cùng của sự kiện `required` (409 `FLOW_REQUIRED_LAST`, câu sửa).
- Perf thật (evotest `-Step perf`): 1000 sự kiện, lô 100 ⇒ 10 lô, p95 lô 20.6 ms, tổng 127 ms (ngưỡng 100 ms / 2 s), launch giả.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### ADDED current/engine/company-flows.md
#### Yêu cầu: Danh sách flow của công ty (FLOW2-FR-05..09/20)
Platform admin gán flow Thư viện (đã xuất bản, có Bắt đầu khi) cho công ty; tenant admin xem, bật/tắt, xếp thứ tự, sao chép để sửa, xuất bản bản sao (gốc tự Tắt), quay về bản gốc — mỗi thao tác một tx. Không trỏ được def của công ty khác. Không tắt được flow không điều kiện cuối cùng của sự kiện bắt buộc.
- Kịch bản: khi gán và xem từ công ty khác thì bị chặn, def công ty khác không gán được [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » gán: platform_admin được, tenant_admin 403, vai: member 403, công ty khác 404, def công ty khác 422 và không lộ]
- Kịch bản: khi tắt flow không điều kiện cuối của sự kiện bắt buộc thì 409 [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » tắt flow không điều kiện cuối của sự kiện required ⇒ 409, có flow khác không điều kiện thì tắt được]
- Kịch bản: khi sao chép thì có bản công ty đổi Group theo mã, bấm lại trả bản cũ [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts]
- Kịch bản: khi xuất bản bản sao thì gốc Tắt, quay về thì đảo lại [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » xuất bản bản sao ⇒ bản sao Bật + gốc Tắt (replaced_by), quay về bản gốc ⇒ đảo lại, bản sao giữ (reverted)]

### ADDED current/engine/flow-events-emit.md
#### Yêu cầu: App ghi sự kiện cùng tx, flow Thư viện chạy thẳng (FLOW2-FR-19/20)
Role gói ghi sự kiện qua `hub.emit_flow_event` chỉ cho tenant hiện tại. Flow Thư viện được gán mở lượt từ bản xuất bản mới nhất; một sự kiện × flow chỉ một lượt kể cả khi gửi lại hoặc xử lý lại. Sự kiện hết lượt thử bị kẹt được chốt `lease_exhausted`.
- Kịch bản: khi role gói ghi cho tenant khác thì bị chặn [test: apps/hub-api/src/modules/processes/triggers/emit-flow-event.int.test.ts » ghi cho tenant khác / chưa đặt tenant ⇒ 42501, không đọc thẳng được bảng]
- Kịch bản: khi một sự kiện tới thì engine thật mở đúng một lượt [test: apps/hub-api/src/modules/processes/triggers/launch-real.int.test.ts » flow Thư viện được gán: một sự kiện ⇒ một lượt (snapshot bản xuất bản), gửi lại / mở lại ⇒ vẫn một]
- Kịch bản: khi sự kiện hết lượt thử mà kẹt thì chốt lỗi [test: apps/hub-api/src/modules/processes/triggers/launch-real.int.test.ts » soát E1 #1: attempts = 5, lease đã qua, chưa xong ⇒ chốt lease_exhausted]

## Việc còn lại
- CHECK `process_defs_published_ck` (0068) đòi `slot` khi có `published_version` ⇒ flow Thư viện mới không khe (U1) chưa xuất bản được; cần migration nới `slot IS NOT NULL OR trigger IS NOT NULL` (xin số). Test tạm đặt `slot`.
- `community_rw` chỉ được GRANT nếu role đã có lúc chạy 0109; bước cài gói community cần chạy lại khối GRANT.
