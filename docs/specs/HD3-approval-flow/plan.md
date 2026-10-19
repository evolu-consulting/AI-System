# Plan · HD3 flow duyệt (BE + FE)

## 1. Engine (processes, rủi ro cao — test trước)
- `PackRunsPort` += `ensureDef(u, input)` (tạo def tenant nếu khoá chưa có — `DefsService.create`, cùng luật lưu), `agent(req)` (job agent không tool trên `hub.runs` đang chạy của stage tool), `approval(u, runId)` (bước + task mở + `can_act`, 1 câu), `act(u, runId, action)` (tìm task duyệt mở của run ⇒ `GateService.review`), `outcomesOf(tenantId, runIds)` (vòng quét, scope system + lọc tenant).
- `PackToolCtx.processRunId` (stage: run gọi; `/mcp`: null). `AgentTask.noTools` ⇒ `allowed_tools=[]`, `mcp=null`.
- `assertDecisionAllowed(..., option)`: stage `exclude_starter` + người bắt đầu + `use_current` ⇒ 403 mọi lý do.

## 2. Gói contracts
- Tool (`contracts.tools.ts`, action `write`, không side_effect): `contracts-extract` (đặt `extracting` khi có nguồn rồi chạy `runExtraction` với transport = `PackRuns.agent`; trả `{total_value?}`), `contracts-value` (đọc), `contracts-finalize` (`needs_review → active`). Mọi tool: `where id = $contract and run_id = $processRunId` (D3-03).
- `approval-def.rules.ts` (thuần): dựng def từ id Group `contracts-editor`/`contracts-owner`, ngưỡng 500.000.000.
- `approval-starter.ts` thay `ExtractionStarter` khi KHÔNG có seam transport (HD2 test giữ hàng đợi cũ): `ensureDef` (cache/tenant) → `startPackRun` → lỗi ⇒ `saveFailure`.
- Use case `getApproval` / `actApproval` (ownedRun: id run đọc trong tx gói); reject ⇒ ghi `rejected` + event `rejected` ngay; `/extract` ở chế độ flow: không run sống ⇒ mở run mới (`run_id` thay khi run cũ đã kết thúc), có ⇒ 409 `EXTRACT_BUSY`.
- Quét (`approval-sweep.ts`, 60 s, theo tenant bật gói): 1 câu đọc HĐ `extracting`/`needs_review` có `run_id`, 1 câu `outcomesOf`, 1 câu UPDATE theo JSON (rejected / STALE). Trần tần suất: `redisActionCounter` (khoá `contracts:act:<tenant>:<ngày>`, mặc định 100/ngày, env `CONTRACTS_ACTIONS_TENANT_DAY`).

## 3. FE
- contracts-web S05: `ApprovalBar` (Xác nhận = approve cấp 1, kiểu `btn-primary` như mgmt-app; Duyệt cấp 2; Từ chối mở hộp lý do; Trích lại = redo). Nhãn trạng thái "Đã duyệt"/"Bị từ chối". Bỏ ẩn nút Xác nhận ở `scenes.cw.ts`; nút Từ chối/Duyệt là lệch có chủ ý (DEVIATIONS).
- chat-web: `ReviewTaskCard` thêm Từ chối (lý do bắt buộc) + nhãn `STARTER_CANNOT_REVIEW`; 429 `TOO_MANY_PROCESS_RUNS` dùng `details.max`.

## 4. Test
Trước code (cao): `tests/acceptance/HD3/{starter-l2,flow,isolation}.int.test.ts`, unit luật def/quyết định. Sau: unit FE, e2e `e2e/contracts-web/hd3-flow.cw.ts`, perf quét `approval-sweep.perf.int.test.ts`.

## Quyết định
| Mã | Quyết định |
|---|---|
| D3-01 | Trích là stage TOOL `contracts-extract` (không stage agent): giữ prompt có rào + parse strict + verify của HD2; agent chạy trong tool qua `PackRuns.agent` (job không tool trên `hub.runs` của stage) ⇒ bền theo engine (#218), trần run theo tenant (#221 phần đồng thời) |
| D3-02 | Cấp 1 = review của stage `extract` (Group `contracts-editor`, người tải lên được duyệt — câu 5); "Chưa đạt" = trích lại. Rẽ nhánh đọc `total_value` hiện tại ở stage `value` (không dùng giá trị lúc trích ⇒ sửa tay không lách cấp 2); trống ⇒ cấp 2 |
| D3-03 | Tool gói chỉ chạm HĐ có `run_id` = `processRunId` của lời gọi ⇒ def tự dựng / `/mcp` không duyệt được HĐ tuỳ ý |
| D3-04 | PDF/ảnh không văn bản: agent không tool không đọc được tệp FileBox org tenant ⇒ `extract_failed AGENT_UNAVAILABLE`; nợ mới (chép tệp sang kho attachment hub) |
| D3-05 | Def do gói dựng lần đầu dùng (actor = người tải lên, nội dung cố định của gói, audit `create`); admin tenant sửa được như def khác (ngưỡng/Group) |
| D3-06 | Từ chối ở chat-web: HĐ về `rejected` ở lượt quét kế (≤ 60 s) hoặc khi mở S05 (`GET approval` hoà giải) |
| D3-07 | Người bắt đầu ở task `decision` của stage cấp 2: `use_current` bị chặn mọi lý do; `add_attempt`/`cancel` vẫn được (không là duyệt) |
| D3-08 | Readiness #3 (mặc định áp): người bắt đầu ở cấp 2 bị chặn MỌI kết quả review (Đạt/Chưa đạt/Từ chối) — đúng hành vi `exclude_starter` N2 |
| D3-09 | Readiness #6/#7: quét gộp mọi tenant một lượt (60 s, `CONTRACTS_SWEEP_S`); `extracting` > 15 phút mà run không sống ⇒ `STALE`; ghi có điều kiện trạng thái (idempotent, nhiều instance an toàn không cần khoá) |
| D3-10 | Readiness #8: đếm mỗi POST đã qua kiểm thân, chung 1 khoá/tenant/ngày theo múi tenant (như tải lên D-16), Redis lỗi ⇒ 503 `UPLOAD_QUOTA_UNAVAILABLE` (fail-closed như D-17) |
| D3-12 | Điều phối 2026-10-19: ngưỡng + Group cấp 1/2 là cài đặt tenant (`contracts.approval_settings`, migration gói 0005; số do trùng 0003 của HD4/HD9). Ngưỡng đọc lúc chạy (tool `contracts-value` trả `level2`), Group ghi vào def lúc dựng / khi đổi cài đặt (đồng bộ qua `PackRuns.ensureDef(sync)`) |
| D3-13 | **Người dùng chốt 2026-10-19** (review S1): sửa trường tiền (`total_value`, `vat_rate`, `vat_included`) của HĐ đã duyệt ⇒ PATCH 200, HĐ về `needs_review` (bỏ `confirmed_*`, gỡ run cũ — cùng câu UPDATE), mở run duyệt mới với giá trị mới (cấp 1, rồi cấp 2 nếu ≥ ngưỡng); lịch sử duyệt cũ giữ (event `approved` + `field_edited.approval_reopened`). Seam `ApprovalEditPolicy.confirmed` (`reopen` mặc định, `lock` = 409 `CONTRACT_LOCKED` dự phòng). Trong flow sau cấp 1: sửa `total_value` ⇒ 409 `CONTRACT_IN_APPROVAL`; ở cấp 1 vẫn sửa được (D3-02, `allowLevel1`) |
| D3-14 | Review S1(1): `contracts-finalize` đọc lại `total_value` + ngưỡng hiện tại cùng tx ghi; cần cấp 2 mà run không có Đạt ở stage `approve` ⇒ `tool_failed`, không "Đã duyệt" |
| D3-15 | Review M1/m2–m5: nhật ký `contracts.approval_settings_audit` (migration gói 0006, trước/sau/người/lúc, append-only); đồng bộ def TRƯỚC khi lưu cài đặt và chỉ vá `group_id`/`run_group_ids` (giữ sửa tay khác); quét con trỏ `(updated_at,id)` xoay vòng, ≤ 4 tenant song song; run `failed`/`expired` ⇒ `extract_failed FLOW_FAILED` (chỉ `cancelled` ⇒ "Bị từ chối"); "Đọc lại" đánh dấu `extracting` trước khi engine chạy lại stage trích, tool trích chỉ trích khi `extracting`/`extract_failed` (mở lại duyệt không gọi AI lại) |
| D3-11 | Readiness #13: test int dùng runtime giả `ScriptRuntime` (trả JSON trích như agent); unit dùng `FakeAgent` test-kit; không gọi AI thật |
