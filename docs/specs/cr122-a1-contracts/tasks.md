---
id: cr122-a1-contracts
lát: cr122-a1-contracts
cr: CR-122
làn: nhanh (phần OutcomeHandler đổi dữ liệu HĐ + role ⇒ Opus low soát)
migration: gói contracts 0077 (GRANT emit_flow_event cho contracts_rw)
phụ thuộc: hub 0109 (E1b), kit registry
---
## Plan (ngắn)
Gói Hợp đồng bắn `contract.submitted|uploaded|approved` vào `hub.flow_events` qua `hub.emit_flow_event` CÙNG tx bản ghi, chỉ khi cờ công ty bật;
đăng ký `FactsReader` + `OutcomeHandler` lúc mount. Cờ tắt ⇒ giữ đường khe cũ (`startEngineApproval`).

## Làm
- `domain/contract-flow-events.rules.ts` (khoá, `event_id` ổn định, kết cục → trạng thái lượt), `application/contract-flow.ports.ts` (cổng cờ + repo).
- `adapters/contract-flow.repo.ts`: `emitContract|emitUploaded` (facts dựng trong chính câu SQL, 1 câu/sự kiện), `readFacts`, `applyContractOutcome`.
- `flow-events.mount.ts`: `mountContractFlow(db)` = cổng cờ (`hub.tenant_flow_settings`, đọc TRƯỚC tx vì role gói không đọc bảng) + đăng ký reader/handler.
- Gắn: `startApproval` (level1), `handleExtractJob` (sau AI đọc → level1), sweep heal, `actApproval` (approve) + tool `contracts-finalize`, `createUploadContract` (persist).
  Cờ bật ⇒ KHÔNG gọi `engine.start` (dispatcher mở lượt). `event_id`: `contract.submitted|approved:<HĐ>:<id lượt duyệt>`, `contract.uploaded:<HĐ>`.
- Kit: `flowPortRegistry` (sổ reader/handler; gói contracts cấm import `processes`); `processes/adapters/runs/flow-ports.ts` uỷ quyền cho sổ này (cùng API).
- Migration gói `0077_emit_flow_event_grant.sql` (+ journal `when` 1806000000000, idx 73).

## Không làm / Chạm
- Không đụng settle/node (E2b), triggers/dispatcher (E1b), admin-web, DLC. Chưa gỡ `slotFlowOf`/`withConfirmStep`/`approval-slot*.rules`/`routing-def.ts` (R1, D6: còn đường khe khi cờ tắt).

## Test tối thiểu
- unit: `contract-flow.usecase.test.ts`, `flow-events.mount.test.ts`. int: `adapters/contract-flow.int.test.ts` (gửi duyệt ghi cùng tx + trùng không ghi thêm, chặn đọc chéo tenant ở FactsReader và OutcomeHandler; OutcomeHandler Đã duyệt / Từ chối / Trả lại, gọi lại ⇒ `already_applied`).

## Quyết định trong lúc làm
- Cờ đọc trước tx bằng cổng (`ContractFlowGate`) vì `contracts_rw` không có quyền bảng `hub.tenant_flow_settings`; lỗi đọc cờ ⇒ coi như TẮT.
- `creator_department` = mảng mã Group (kể cả phòng cha) như `creator_departments` cũ; `new_partner` giữ định nghĩa CR-121.
- Trả lại ⇒ lượt `cancelled` + HĐ `needs_review` bỏ `run_id` (= Nháp: `approvals_status_ck` không có `returned`).
- `OutcomeHandler` ghi bảng gói trong tx engine bằng `withPackRoleInTx` (helper chung kit, A2b); `actorId` do engine truyền (người duyệt cuối từ `fields.decided_by`, E3) ⇒ `confirmed_by`/`decided_by`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED current/pack-contracts/flow-events.md
#### Yêu cầu: Hợp đồng bắn sự kiện flow cùng giao dịch
Khi cờ flow của công ty bật, gửi duyệt / tải lên / duyệt xong ghi `contract.submitted|uploaded|approved` vào hàng đợi sự kiện cùng giao dịch với bản ghi; mã sự kiện ổn định theo bản ghi và lượt duyệt. Cờ tắt giữ đường cũ.
- Kịch bản: khi cờ bật và gửi duyệt thì có đúng một sự kiện contract.submitted kèm dữ kiện của hợp đồng, gửi lại cùng lượt không tạo thêm [test: apps/hub-api/src/modules/packs/contracts/application/contract-flow.usecase.test.ts » cờ BẬT: ghi contract.submitted sau open, cùng tx, theo lượt, không gọi engine cũ]
- Kịch bản: khi cờ tắt thì không ghi sự kiện và vẫn mở lượt theo đường cũ [test: apps/hub-api/src/modules/packs/contracts/application/contract-flow.usecase.test.ts » cờ TẮT: không ghi sự kiện, vẫn mở run theo đường cũ]
- Kịch bản: khi hợp đồng của công ty khác thì đọc dữ kiện trả về rỗng [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-flow.int.test.ts » FactsReader/OutcomeHandler của tenant khác không thấy và không đổi HĐ]
#### Yêu cầu: Kết cục Kết thúc áp lên hợp đồng một lần
Đã duyệt khoá hợp đồng và gắn sản phẩm, Từ chối, Trả lại về Nháp; gọi lại cùng lượt và kết cục trả `already_applied`.
- Kịch bản: khi định tuyến kết cục theo sự kiện thì chỉ đúng cặp (sự kiện, kết cục) đã khai được áp [test: apps/hub-api/src/modules/packs/contracts/flow-events.mount.test.ts » approved/done và uploaded/accepted không đổi HĐ, kết cục chưa hỗ trợ thì ném]

## Việc còn lại
- R1 gỡ đường khe (`slotFlowOf`, `withConfirmStep`, `approval-slot*.rules`, `routing-def.ts`).
