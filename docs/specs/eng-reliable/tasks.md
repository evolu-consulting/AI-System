---
id: eng-reliable
lát: eng-reliable
cr: CR-107
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
CR-107 phần A — flow duyệt HĐ trên engine tin cậy hơn (4 việc, không đổi máy trạng thái engine, không migration):
1. Run `needs_decision` (vd `retry_exhausted`, `tool_failed`) không còn "im lặng ở cấp 1": thẻ duyệt có `attention`; owner/admin gói có **Thử lại** (`add_attempt` của engine) và **Huỷ & mở lại** (huỷ run + đường mở lại có sẵn).
2. Mẫu không mở được lúc vào cấp 1 (thiếu Group, mẫu hỏng, khe không có bản) ⇒ **không về máy 2 bước cũ**: lượt kẹt `mode='engine'` không run + lý do `FLOW_GROUP_MISSING:<mã>` / `FLOW_INVALID` / `FLOW_MISSING`; "Mở lại quy trình" mở run khi Group đã có lại.
3. Lỗi logic của tool hệ thống `contracts-route` / `contracts-finalize` ném `PackToolBusinessError` ⇒ registry trả mã nghiệp vụ (`PACK_TOOL_BUSINESS`) ⇒ engine phân loại `business` ⇒ `needs_decision` (`tool_failed`) ngay, không thử lại ~10,5'. Lỗi hạ tầng (DB, mạng, hết hạn) vẫn `UPSTREAM_ERROR`/`TIMEOUT` (thử lại).
4. Vòng quét duyệt dọn run mồ côi (sập giữa `port.start` và `attach`): run gói `contracts` chưa kết thúc, bắt đầu trước `now − 10'`, không lượt nào giữ ⇒ `cancelSys`.

## Làm
- [x] Kit `PackRunsPort`: `stepsView.decision` ({reason, at} khi `needs_decision`), `retryDecision(u, runId)`, `openPackRuns(tenant, pack, before, limit)` (engine `processes/runs/pack-runs*.ts`).
- [x] Gói: `approval-engine-reopen.usecase.ts` (reopen/retry/cancel-reopen), `markStalled` (repo), `attentionOf` (card rules), routes + mount.
- [x] `slotFlowOf` trả `{invalid: lý do}`; `startEngineApproval` ⇒ `"stalled"`.
- [x] `kit/domain/pack-tool-error.ts` + registry; usecase tool ném `PackToolBusinessError`.
- [x] `cancelOrphans` trong `approval-sweep.ts` (+ `SweepRepo.attachedRuns`, `SweepDeps.now`).
- [x] Contract `@ai/contracts` `ContractApproval.attention` (`ApprovalAttentionSchema`).

### API mới (cho lát UI contracts-web)
Quyền: guard gói `admin` (owner gói) — như `POST …/approval/reopen`. Không thân request (gửi `{}`).
| Đường | Làm gì | 200 | Lỗi |
|---|---|---|---|
| `POST /pack/contracts/contracts/:id/approval/retry` | Run đang `needs_decision` ⇒ engine `add_attempt` (chạy lại bước lỗi) | `ContractApproval` (thẻ mới) | 400 id sai · 403 không phải owner gói · 404 HĐ không thấy · 409 `APPROVAL_NOT_OPEN` (lượt không ở engine/level1, hoặc run không chờ quyết) · 503 `ENGINE_UNAVAILABLE` |
| `POST /pack/contracts/contracts/:id/approval/cancel-reopen` | Huỷ run hiện tại, ghi lý do `CANCELLED_BY_OWNER`, mở run mới dưới người gửi với quy trình hiện hành | `ContractApproval` | như trên + 422 `APPROVAL_GROUP_MISSING` (quy trình vẫn thiếu Group/hỏng — lượt giữ kẹt, `attention.reason` = lý do mới) |
| `POST …/approval/reopen` (có sẵn) | Thêm: mở được lượt kẹt chưa có run (thiếu Group lúc mở) | `ContractApproval` | thêm 422 `APPROVAL_GROUP_MISSING` |

Thẻ `GET …/approval` (lượt `mode='engine'`) thêm `attention: {kind, reason, since} | null`:
- `kind: "needs_decision"` — run chờ quyết; `reason` = lý do engine (`tool_failed`, `retry_exhausted`, `job_timeout`…); `since` = ISO lúc engine mở quyết định (có thể null). UI: hiện cho owner nút **Thử lại** + **Huỷ & mở lại**; `needs_reopen = false`.
- `kind: "stalled"` — run đã kết thúc bất thường hoặc lượt chưa mở được run; `reason` = `approvals.feedback` (`ENGINE_RUN_<STATUS>`, `FLOW_GROUP_MISSING:<mã,…>`, `FLOW_INVALID`, `FLOW_MISSING`, `CANCELLED_BY_OWNER`, có thể null trước vòng quét); `since` null. `needs_reopen = true` ⇒ nút **Mở lại quy trình** (như cũ).
- `null` — lượt chạy bình thường / đã đóng. Không đổi `step`/trạng thái HĐ.

## Không làm / Chạm
- Không đổi máy trạng thái engine; "Thử lại" dùng đúng `GateService.decide` (`add_attempt`) với vai admin (run gắn gói chỉ admin quyết — quyền thật = admin gói, gói kiểm trước).
- Không sửa `pass()`/`pending_links` (`approval-engine-card.usecase.ts` — agent khác); chỉ thêm `engineRunId` vào `input()`.
- Không UI (lát sau, Sonnet). Không thông báo chuông khi lượt kẹt: chưa có đường thông báo "stalled" sẵn ⇒ ghi vào Việc còn lại.
- Không migration, không bảng mới (⇒ không cần test chặn đọc chéo tenant).

## Test tối thiểu
- Unit: `approval-engine.usecase.test.ts` (kẹt FLOW_MISSING/FLOW_GROUP_MISSING, mở lại lượt không run, Thử lại, Huỷ & mở lại, lỗi nghiệp vụ tool), `approval-engine-card.rules.test.ts` (attention), `pack-tool-error.test.ts` (phân loại), `approval-sweep-orphans.test.ts` (đồng hồ giả).
- Int: `tests/acceptance/CF/eng-reliable.int.test.ts` (retry, cancel-reopen, orphan — hub thật), `approval-engine-slot.int.test.ts` (thiếu Group ⇒ kẹt), `CF/fix-pack.int.test.ts` (hồi quy reopen).

## Quyết định trong lúc làm
- "Thử lại" gọi `GateService.decide` dưới người bấm với `role: tenant_admin` (port `retryDecision`): `canDecide` của run gắn gói chỉ cho admin; route gói đã chặn bằng quyền `admin` gói. Port kiểm run gắn gói + đang `needs_decision` trước (MỘT câu).
- Lượt kẹt chưa có run = `mode='engine' ∧ engine_run_id IS NULL ∧ level1` (`noRunStalled`); trạng thái này chỉ `markStalled` ghi (CHECK 0047 cho phép). `attach` với `replaces = null` nay nhận cả lượt này (bỏ điều kiện `mode='machine'`).
- Khe chưa có bản áp được (`resolveSlot` null) cũng coi là kẹt (`FLOW_MISSING`) — "không bao giờ về máy cũ". Chỉ engine vắng / engine ném / công ty không có entitlement mới giữ máy cũ (như trước).
- `cancelReopen` huỷ run trước rồi ghi `CANCELLED_BY_OWNER` (lượt vẫn kẹt nếu mở lại thất bại) rồi đi đúng `reopenEngineApproval`.
- Mồ côi: engine trả MẪU NGẪU NHIÊN ≤ 100 run mở của gói trước `now − 10'` (như `engineRuns` — run chờ duyệt lâu không che mồ côi), gói lọc run đang gắn bằng MỘT câu `= any`; huỷ từng run qua `cancelSys` (đường huỷ có sẵn của engine — sự kiện/thread; mồ côi hiếm, trần = cỡ mẫu). Int test lùi `started_at` 11' thay vì tiêm đồng hồ vào sweep đã mount; đồng hồ giả (`SweepDeps.now`) kiểm ở unit.
- Thiếu Group lúc `compileDef` (đua sau khi phân giải mã) ⇒ `FLOW_GROUP_MISSING` không kèm mã (chỉ có id).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Engine mở lượt theo quy trình gán cho tenant
Mỗi lần mở lượt duyệt (kể cả mở lại), gói tra quy trình theo tenant của HĐ: gán của khe `contracts.approval`, không có ⇒ mặc định; lấy bản xuất bản, phân giải mã phòng ban theo tenant, đồng bộ def tenant `contracts-approval` khi `source_ref` khác; lượt đang chạy giữ snapshot. Không còn đọc `contracts.approval_flows`. CR-107: quy trình không mở được (thiếu mã Group ở tenant, body hỏng, khe không có bản) ⇒ KHÔNG về máy 2 bước: lượt giữ `level1`, `mode='engine'`, chưa có run, `feedback` = `FLOW_GROUP_MISSING:<mã>` / `FLOW_INVALID` / `FLOW_MISSING`; thẻ `attention.kind = "stalled"`, `needs_reopen`; owner/admin "Mở lại quy trình" mở run khi quy trình đã hợp lệ (còn thiếu ⇒ 422 `APPROVAL_GROUP_MISSING`, ghi lý do mới).
- Kịch bản: khi X gán A, Y gán B thì HĐ của X chạy các bước của A, HĐ của Y chạy các bước của B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » X gán A, Y gán B chạy đúng quy trình]
- Kịch bản: khi đổi gán X từ A sang B lúc một HĐ đang duyệt thì lượt đó chạy hết theo A, HĐ vào duyệt sau chạy B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » đổi gán: lượt dở giữ snapshot, lượt mới chạy quy trình mới]
- Kịch bản: khi Group theo mã đã bị xoá khỏi tenant thì lượt kẹt `mode='engine'` không run với lý do `FLOW_GROUP_MISSING:<mã>` và log `contract-engine-flow-stalled` [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » CR-107 · thiếu Group lúc chạy ⇒ lượt kẹt FLOW_GROUP_MISSING:phap-che (mode engine, không run, KHÔNG về máy cũ)]
- Kịch bản: khi khe chưa có bản xuất bản thì lượt kẹt `FLOW_MISSING` [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine.usecase.test.ts » CR-107 · khe chưa có bản xuất bản ⇒ lượt kẹt FLOW_MISSING (không về máy cũ)]
- Kịch bản: khi owner mở lại lượt kẹt chưa có run và Group đã có lại thì run mới được gắn; còn thiếu thì trả `flow_invalid` và ghi lại lý do [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine.usecase.test.ts » CR-107 · lượt kẹt chưa có run: mở lại ⇒ run mới gắn như lượt mới · Group vẫn thiếu ⇒ flow_invalid + ghi lại lý do]
- Kịch bản: khi mở lượt với 10.000 tenant và 500 bản phát hành thì `resolveSlot` p95 ≤ 5 ms với số câu SQL cố định [test: apps/hub-api/src/modules/processes/library/slot-resolve.perf.int.test.ts » resolveSlot p95 ≤ 5 ms]

### ADDED sht/duyet-ky-so.md
#### Yêu cầu: Lượt chờ quyết định hiện cho owner + Thử lại / Huỷ & mở lại
Run engine của lượt `level1` ở `needs_decision` (vd `tool_failed`, `retry_exhausted`) không đổi trạng thái HĐ/lượt; thẻ `GET …/approval` có `attention {kind:"needs_decision", reason, since}` (`reason`/`since` từ `process_runs.decision`). Owner/admin gói (guard `admin`): `POST …/approval/retry` ⇒ engine `add_attempt` (chạy lại bước lỗi); `POST …/approval/cancel-reopen` ⇒ huỷ run, ghi `CANCELLED_BY_OWNER`, mở run mới dưới người gửi theo quy trình hiện hành. Không chờ quyết ⇒ 409 `APPROVAL_NOT_OPEN`; không phải owner ⇒ 403.
- Kịch bản: khi run chờ quyết thì thẻ có `attention.kind = needs_decision` + lý do, người không phải owner Thử lại bị 403, owner Thử lại thì run chạy tiếp tới "Đã duyệt" [test: tests/acceptance/CF/eng-reliable.int.test.ts » (1) lỗi logic tool ⇒ needs_decision tool_failed ngay · thẻ có attention · B 403 · A Thử lại ⇒ Đã duyệt]
- Kịch bản: khi owner Huỷ & mở lại thì run cũ `cancelled`, lượt giữ engine với run mới dưới người gửi, Thử lại sau đó 409 [test: tests/acceptance/CF/eng-reliable.int.test.ts » (2) Huỷ & mở lại ⇒ run cũ cancelled, lượt giữ engine + run mới dưới A, bước 0 mở]
- Kịch bản: khi lượt đang chạy / đã đóng thì `attention = null`; lượt kẹt chưa có run thì `attention.kind = stalled` + lý do [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.rules.test.ts » CR-107 · attention: needs_decision (lý do + lúc mở, không needs_reopen) · lượt kẹt chưa có run ⇒ stalled + lý do · chạy ⇒ null]
- Kịch bản: khi Thử lại thì gọi quyết định của engine trên đúng run đang gắn; lượt máy ⇒ not_open [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine.usecase.test.ts » CR-107 · Thử lại ⇒ retryDecision của engine trên run đang gắn · lượt máy ⇒ not_open]
- Kịch bản: khi Huỷ & mở lại thì thứ tự là huỷ run → ghi lý do → mở lại thay run cũ [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine.usecase.test.ts » CR-107 · Huỷ & mở lại ⇒ cancelSys → ghi CANCELLED_BY_OWNER → mở lại thay run cũ]

#### Yêu cầu: Lỗi logic của tool hệ thống không thử lại
`contracts-route` / `contracts-finalize` ném lỗi nghiệp vụ (`PackToolBusinessError`: không thuộc run, thiếu bước bắt buộc, lượt không mở, gắn SP lỗi…) ⇒ registry trả mã nghiệp vụ (mặc định `PACK_TOOL_BUSINESS`) ⇒ engine phân loại `business` ⇒ `needs_decision` `tool_failed` ngay. Lỗi khác (DB, mạng) giữ `UPSTREAM_ERROR` ⇒ thử lại 30 s/2'/8' như cũ.
- Kịch bản: khi lỗi nghiệp vụ thì mã nghiệp vụ được phân loại business; lỗi thường thì UPSTREAM_ERROR transient [test: apps/hub-api/src/modules/processes/domain/tools/pack-tool-error.test.ts » lỗi nghiệp vụ ⇒ mã nghiệp vụ ⇒ business · lỗi thường ⇒ UPSTREAM_ERROR ⇒ transient]
- Kịch bản: khi finalize thiếu bước / route sai thì ném lỗi nghiệp vụ; lỗi hạ tầng giữ nguyên [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine.usecase.test.ts » finalize thiếu bước / route sai ⇒ PackToolBusinessError · lỗi hạ tầng (repo ném) giữ nguyên]

#### Yêu cầu: Dọn run engine mồ côi
Vòng quét duyệt mỗi tenant: engine trả mẫu ngẫu nhiên ≤ 100 run gói `contracts` chưa kết thúc bắt đầu trước `now − 10'` (1 câu), gói lọc run đang gắn một lượt (1 câu `= any`), run còn lại ⇒ `cancelSys`. Kết quả quét có `orphans`.
- Kịch bản: khi run mở chưa gắn lượt quá 10' thì bị huỷ, run đang gắn giữ nguyên; chưa quá 10' thì không huỷ [test: tests/acceptance/CF/eng-reliable.int.test.ts » (3) run gói mở chưa gắn lượt, quá 10' ⇒ vòng quét huỷ · run đang gắn lượt giữ]
- Kịch bản: khi đồng hồ giả ở mốc T thì chỉ hỏi run trước T − 10' và chỉ huỷ run chưa gắn [test: apps/hub-api/src/modules/packs/contracts/application/approval-sweep-orphans.test.ts » run mở trước now-10' chưa gắn lượt ⇒ huỷ · run đã gắn ⇒ giữ · 1 câu engine + 1 câu gói]

## Việc còn lại
- UI contracts-web (lát sau): banner `attention` + nút Thử lại / Huỷ & mở lại cho owner; nhãn lý do `FLOW_GROUP_MISSING:<mã>` / `tool_failed` / `retry_exhausted`; e2e.
- Thông báo chuông cho owner khi lượt kẹt (chưa có đường thông báo "stalled" sẵn trong gói).
- Vòng quét reconcile có thể ghi đè lý do `FLOW_GROUP_MISSING` bằng `ENGINE_RUN_CANCELLED` khi mở lại thất bại sau Huỷ & mở lại (lý do vẫn là "kẹt", chỉ mất mã Group) — nhỏ.
- CR-107 phần B (chống ghi đè SP khi hai người cùng Đạt, thẻ duyệt nghe `/me/stream`): lát khác.
