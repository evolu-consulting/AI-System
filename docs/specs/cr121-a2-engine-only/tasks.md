---
id: cr121-a2-engine-only
lát: cr121-a2-engine-only
cr: CR-121
làn: đầy đủ (máy trạng thái duyệt)
migration: không
phụ thuộc: cr121-d4-assign-engine
---
## Plan (ngắn)
Quyết định người dùng 2026-11-05: công ty chưa gán quy trình duyệt ⇒ dùng quy trình MẶC ĐỊNH của khe trên engine; không còn máy cũ
cho lượt duyệt MỚI. Gỡ env `CONTRACTS_APPROVAL_ENGINE`, cổng "đã gán" (`slotAssigned`/`engineAllowedForTenant`), cờ `engine_off`.

## Làm
- `approval.mount.ts approvalEngine`: bỏ env + cổng; null chỉ khi HD2 (`transport`), cầu engine vắng, hoặc seam TEST `approvalEngine: false`.
- `startEngineApproval`: engine vắng / ném ⇒ lượt KẸT `ENGINE_RUN_FAILED` (mode='engine', chưa run; UI sẵn "gặp lỗi, chờ mở lại"),
  không còn kết quả `"machine"`. Ghi kẹt có điều kiện `engine_run_id is null` (đua với lần mở đã gắn run ⇒ không ghi).
- Gỡ `engineOff`/`engine_off` (usecase, mount, extraction.mount, DTO `approval.ts`, `EngineOffNote` + `use-approval-ui`, i18n vi/en),
  port `slotAssigned` (approval-engine.ports, pack-runs.ports, pack-runs.ts), env ở hub-dev `dev.ts`, `dev-up.ps1`, prod `env.template` + `gen-env.sh`.
- `needsLevel2` giữ (đường `decide` cũ còn cần), đánh dấu `@deprecated`.
- Test: `CF/engine-only.int` (mới) thay `CF/approval-engine-off.int` + `CF/engine-tenant-gate.int` (xoá); HD3 `_hd3.ts` thêm seam
  `approvalEngine: false` để HD3/K1/K4 tiếp tục khoá đường decide máy cũ (còn sống cho lượt đang dở).

## Không làm / Chạm
- KHÔNG sửa đường gán (`slot-assign*.ts`, `library.service.ts`) — lát F-1. `slot-assigned.repo.ts` (+ int) giữ nguyên, nay không còn
  chỗ gọi trong hub ⇒ F-1/lát sau quyết gỡ.
- Không gỡ máy cũ (`decide`, `approval-machine.rules.ts`, guard `mode='machine'` ở `approval.repo.ts`) — lượt đang dở còn cần.
- e2e stack (`e2e/journey-approval/_ja-stack.ts`, `e2e/P-a/_pa-stack.ts`, pm config) + `deploy/stg-*` vẫn đặt env cũ: vô hại (không còn
  ai đọc), dọn ở lát e2e cuối đợt.

## Test tối thiểu
- unit: `approval-engine.usecase.test.ts` (engine vắng/ném ⇒ kẹt `ENGINE_RUN_FAILED`), `approval-engine.rules.test.ts`, `done-h2b.test.ts`.
- int: `tests/acceptance/CF/engine-only.int.test.ts`; hồi quy CF + HD3 (`-All`).

## Quyết định trong lúc làm
- Công ty chưa có luật nào: KHÔNG gọi `ensureSlotDefaults` trong đường mở lượt — `routeSlot` không luật đã rơi về mẫu khe
  (`process_slots.default_def_id`, `RESOLVE_SLOT_SQL`) trong CÙNG một câu ⇒ chạy engine với quy trình mặc định, 0 SQL thêm. Khe không có
  bản xuất bản nào ⇒ lượt kẹt `FLOW_MISSING` (thẻ: "chưa có quy trình duyệt được xuất bản, cần quản trị viên gán rồi bấm Mở lại") — an toàn
  hơn ghi luật từ đường người dùng (không ghi dữ liệu cấu hình ngoài admin, không đua với F-1).
- Engine vắng/ném lúc mở ⇒ lượt kẹt thay vì máy cũ (đúng "không máy cũ cho lượt mới"); owner/admin "Mở lại quy trình" (đường `reopen`
  đã nhận lượt kẹt chưa run).
- Lượt máy cũ đang dở quay lại `level1` (Đọc lại / heal của sweep) ⇒ mở run engine (bắt đầu lại từ bước đầu, như lượt mới) — không
  phải chuyển giữa chừng vì mọi quyết định cũ đã bị Đọc lại xoá.
- Sau rebase lên F-1 (8b4b81b7): `CF/assign-default-rule.int` bước "chưa gán ⇒ máy cũ" đổi thành "⇒ engine" (đổi hành vi được duyệt);
  bỏ seam `approvalEngineTenantGate` (đã gỡ). `engine-only.int` gán qua đúng API "Gán quy trình" của F-1.
- Seam `contractsAi.approvalEngine: false` chỉ đặt được từ deps test (không env) ⇒ prod không thể mở lượt máy cũ.
- Perf: mở lượt bớt 1 câu (`slotAssigned`) so với trước; không thêm truy vấn theo hàng.
- Check ops đếm lượt máy cũ còn mở: hub KHÔNG đọc được `contracts.approvals` (cách ly gói, xem `flow-coverage.check.ts`) ⇒ cần cổng đếm
  phía gói ⇒ để lát gỡ máy cũ (Việc còn lại).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Lượt duyệt mới luôn chạy trên engine
Mọi lượt duyệt HĐ MỚI mở run engine theo luật định tuyến của khe `contracts.approval`: luật admin nếu có, không thì luật mặc định / mẫu
khe. Không còn env `CONTRACTS_APPROVAL_ENGINE`, cổng "đã gán quy trình" hay ghi chú `engine_off`. Engine không mở được ⇒ lượt kẹt
`ENGINE_RUN_FAILED` chờ "Mở lại quy trình", không về máy cũ.
- Kịch bản: khi công ty chưa có luật nào thì lượt mới chạy engine với quy trình mặc định của khe; khi đã gán thì chạy quy trình gán [test: tests/acceptance/CF/engine-only.int.test.ts » chưa gán (không luật) ⇒ engine với quy trình mặc định của khe, gán ⇒ quy trình gán, không lượt máy cũ mới]
- Kịch bản: khi engine vắng hoặc ném lúc mở run thì lượt kẹt ENGINE_RUN_FAILED, không chạy máy cũ [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine.usecase.test.ts » cr121-a2 · engine ném ⇒ log + lượt kẹt ENGINE_RUN_FAILED (không máy cũ, không ném), lượt đã gắn run ⇒ không ghi]
- Kịch bản: khi mở lượt 2 lần đồng thời thì chỉ một lượt duyệt và một run engine [test: tests/acceptance/CF/engine-only.int.test.ts » đua · mở lượt 2 lần đồng thời ⇒ đúng 1 lượt duyệt, 1 run engine]

#### Yêu cầu: Lượt máy cũ đang dở quyết nốt
Lượt `mode='machine'` chưa gắn run, chưa kết thúc (mở trước lát này) vẫn quyết qua đường `decide` 2 bước cũ tới khi xong; không chuyển
sang engine giữa chừng, không tạo run engine.
- Kịch bản: khi lượt máy cũ đang ở cấp 1 thì Duyệt cấp 1 rồi cấp 2 ra Đã duyệt, vẫn mode machine, không run engine [test: tests/acceptance/CF/engine-only.int.test.ts » lượt máy cũ đang dở ⇒ quyết xong qua decide cũ (cấp 1 → cấp 2 → Đã duyệt), không mở run engine]

#### Yêu cầu: Không còn cờ bật engine (§3 cũ)
Env `CONTRACTS_APPROVAL_ENGINE` và cổng theo công ty (feature, rồi "đã gán") đã gỡ; thẻ duyệt không còn ghi chú `engine_off`. §3 bỏ khi gộp.
- Kịch bản: khi chạy hub-dev thì không đặt env CONTRACTS_APPROVAL_ENGINE [test: tools/scripts/src/done-h2b.test.ts » hub-dev: HUB_MAX_CONCURRENT_RUNS mặc định 20, env ghi đè]

## Việc còn lại
- Lát gỡ máy cũ (sau khi đếm lượt `contracts.approvals` `mode='machine' and engine_run_id is null and status in ('level1','level2')`
  = 0 trên prod): thêm check ops đếm lượt máy cũ còn mở (cổng đếm phía gói contracts, hub không đọc được bảng gói), rồi gỡ `decide`,
  `approval-machine.rules.ts`, `needsLevel2`, guard `mode='machine'`, seam test `approvalEngine: false` + chuyển HD3/K1/K4 sang engine.
- F-1/lát sau: gỡ `slot-assigned.repo.ts` (+ int) nếu không còn dùng.
- Dọn env cũ ở e2e stack + `deploy/stg-*` (vô hại).
- `docs/current/sht/duyet-ky-so.md` dòng 32 (thiếu Group ⇒ "máy 2 bước") đã cũ từ CR-107 — sửa khi gộp.
