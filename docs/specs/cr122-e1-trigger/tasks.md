---
id: cr122-e1-trigger
lát: cr122-e1-trigger
cr: CR-122
làn: đầy đủ (hàng đợi/khoá/idempotent/tenant + migration)
migration: 0105, 0106
phụ thuộc: F0
---
## Plan (ngắn)
Hàng đợi sự kiện `hub.flow_events` + `hub.company_flows` + cờ `FLOW_TRIGGERS` (`hub.tenant_flow_settings`) + bộ điều phối
`processes/triggers/` mở lượt bằng engine hiện có (`StartService.createFromApi`).

## Làm
- `0105_flow_events.sql`: hàng đợi, unique `(tenant_id, event_id)`, `attempts ≤ 5`, `next_at`, `processed_at`, `error`, `outcome`, RLS; `process_runs.flow_event_id` + `company_flow_id` + unique partial (sự kiện × flow).
- `0106_company_flows.sql`: `process_defs.trigger` jsonb + `trigger_event` sinh + index; `company_flows` (enabled, position, replaced_by, off_reason, RLS); `tenant_flow_settings` (chỉ system ghi).
- `processes/triggers/`: `match.rules.ts` (điều kiện trên dữ kiện, decides ⇒ flow đầu, lùi thử lại), `dispatcher.repo.ts` (ghi sự kiện, nhận lô SKIP LOCKED + giữ chỗ, ứng viên, chốt lô), `dispatcher.ts` (`dispatchOnce`, `startFlowDispatcher`), `flags.ts`, `flow-launch.ts`; đăng ký vòng nền ở `processes.mount.ts`; `start.service.ts` thêm tuỳ chọn `flowEvent`.
- Drizzle: `flowEvents`, `companyFlows`, `tenantFlowSettings` ở `hub-process-library.ts`.

## Không làm / Chạm
Không node executor, `apply-settle.ts`, if/cond (E2); không admin-web (U1). Chưa làm: API company-flows, clone dùng thay / quay về (một tx), chặn tắt flow required, perf int chọn flow — xem Việc còn lại.

## Test tối thiểu
`bun test apps/hub-api/src/modules/processes/triggers/match.rules.test.ts` (7 pass); evotest int `-Filter .../triggers/dispatcher.int.test.ts` (9 pass, 2 lượt).

## Quyết định trong lúc làm
- `trigger` lưu trên `process_defs` (một nguồn, `trigger_event` sinh), `company_flows` không chép trigger.
- Giữ chỗ khi nhận lô (`attempts+1`, `next_at = now + 2 phút`) rồi commit; mở lượt ngoài tx; idempotent nhờ unique `(flow_event_id, company_flow_id)` trên `process_runs` ghi cùng tx tạo run ⇒ Hub chết giữa chừng không mở trùng.
- Người bắt đầu lượt = `actor_id` của sự kiện; không có actor mà có flow khớp ⇒ xong + `error = no_actor`.
- Lỗi 4xx của engine ⇒ `FlowLaunchRefused` (ghi `outcome.refused`, không thử lại); lỗi khác ⇒ thử lại lùi 30 s·2^(n-1), tối đa 5 lần.
- `decides`/app của sự kiện đọc từ `APP_MANIFESTS` (một nguồn); sự kiện lạ ⇒ xong + `error = unknown_event`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED current/engine/flow-triggers.md
#### Yêu cầu: Sự kiện app mở lượt cho flow đang bật khớp (FLOW2-FR-03/19/20)
App ghi sự kiện vào `hub.flow_events` (trùng `(tenant, event_id)` bỏ qua). Bộ điều phối nhận lô `FOR UPDATE SKIP LOCKED`, chọn flow đang bật của công ty có `trigger_event` = sự kiện và điều kiện khớp dữ kiện; sự kiện `decides` chỉ flow đầu theo `position`, flow khác ghi lý do; cờ `FLOW_TRIGGERS` tắt ⇒ chỉ ghi "lẽ ra chạy". Lỗi tạm thử lại có lùi tối đa 5 lần.
- Kịch bản: khi ghi cùng sự kiện hai lần thì chỉ một dòng [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » ghi sự kiện hai lần cùng (tenant, event_id) ⇒ một dòng]
- Kịch bản: khi sự kiện decides khớp nhiều flow thì chỉ flow đầu chạy [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » decides: chỉ flow khớp đầu theo position chạy, flow tắt không xét, điều kiện không khớp ghi lý do]
- Kịch bản: khi hai Hub chạy cùng lúc thì mỗi sự kiện × flow một lần [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » hai Hub chạy đồng thời ⇒ mỗi sự kiện × flow đúng một lần]
- Kịch bản: khi cờ tắt thì không mở lượt, ghi would_run [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » cờ FLOW_TRIGGERS tắt (Y) ⇒ bóng: không mở lượt, ghi would_run]
- Kịch bản: khi công ty khác đọc thì không thấy dữ liệu 3 bảng mới [test: apps/hub-api/src/modules/processes/triggers/dispatcher.int.test.ts » scope user công ty Y không thấy flow_events / company_flows / tenant_flow_settings của X]
- Kịch bản: khi điều kiện lồng AND/OR trên dữ kiện thì khớp đúng [test: apps/hub-api/src/modules/processes/triggers/match.rules.test.ts » OR ngoài, AND lồng một cấp, kiểu lệch (chuỗi so số) ⇒ không khớp]

### ADDED current/engine/flow-def-save.md
#### Yêu cầu: Lưu và đọc def có Bắt đầu khi (FLOW2-FR-01/02/15)
`POST/PUT /process-defs` nhận `trigger` + `app` ở gốc body (như admin-web gửi), lưu `process_defs.trigger`/`app`; GET trả lại (chỉ khi có). Stage giữ `outcome` + `next_step`. Có `trigger` ⇒ kiểm `parseFlowDef` + `flowDefIssues` theo sự kiện của app; sai ⇒ 422 `PROCESS_DEF_INVALID` + `paths`. PUT không gửi `trigger`/`app` ⇒ giữ nguyên; `null` ⇒ xoá.
- Kịch bản: khi tạo def có trigger thì đọc lại đủ trigger, app, outcome, next_step [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » POST + GET: trigger/app/outcome/next_step lưu và đọc lại, trigger_event sinh]
- Kịch bản: khi kết quả không thuộc sự kiện thì 422, sửa không gửi trigger thì giữ [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » PUT sai luật FlowDef ⇒ 422 + paths, không ghi, PUT không gửi trigger ⇒ giữ nguyên]

## Việc còn lại
- Flow "Được gán" trỏ def Thư viện (`tenant_id null`): `findDefByKey` theo tenant không thấy ⇒ hiện `refused`. Cần vật chất hoá bản công ty (như `ensureSlotDef`) trước khi mở lượt — lát kế (E1b) hoặc M1.
- API company-flows (danh sách/bật-tắt/thứ tự, `CompanyFlowRowSchema`), clone dùng thay / quay về một tx, chặn tắt flow required duy nhất, perf int chọn flow p95 ≤ 5 ms + đếm câu SQL.
- A1/A2: ghi sự kiện bằng `insertFlowEvents(tx, …)` — role gói (`contracts_*`) chưa có quyền ghi `hub.flow_events`: cần GRANT/hàm SECURITY DEFINER (xin số 0109).
