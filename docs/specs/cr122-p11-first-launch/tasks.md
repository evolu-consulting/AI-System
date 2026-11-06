---
id: cr122-p11-first-launch
lát: cr122-p11-first-launch
cr: CR-122
làn: đầy đủ (máy trạng thái run)
migration: không
phụ thuộc: cr122-q1-e2e (G1.2, G2)
---
## Plan (ngắn)
Chẩn đoán lỗi sản phẩm #4 (q1-e2e): "HĐ đầu tiên sau khi gán flow không mở bước Duyệt giá trị lớn". Lát này (50 phút) CHỈ chẩn
đoán có bằng chứng; sửa code là lát kế (Opus medium, máy trạng thái run).

## Bằng chứng (trace Playwright của evotest, không đoán)
- `cr122-q1-e2e/.data/evotest/20261106-230252-8432-e2e` (G2, HĐ A `01a1b19b-8cde…`) và `20261106-225713-2884-e2e` (G1.2, HĐ g1
  `01a1b196-632c…` + HĐ gửi lại g1b `01a1b197-22ac…`): mọi phản hồi `GET /pack/contracts/flow/contracts.approval/<id>` của công ty
  `e2e-c22-*` (cờ FLOW_TRIGGERS bật) là `run.mode = "machine"`: `extract` → `level1` (task = id lượt máy cũ, `finalizes_on_approve:
  true`) → nhân viên bấm "Xác nhận và lưu" (`POST …/tasks/<id lượt>/actions/approve`) → `done`, HĐ `active`, `locked: true` sau 0,3 s.
  Không lần nào thẻ chuyển `mode = "engine"`; bước "Duyệt giá trị lớn" không bao giờ là bước của thẻ.
- Cùng lượt chạy, các công ty cờ TẮT (cr121-d, d6b) đi `machine → engine` trong ≤ 2 s (đường cũ `startEngineApproval` gắn run).
- ⇒ KHÔNG phải "chỉ HĐ đầu", không phải backoff/lease/duplicate của bộ điều phối: mọi HĐ của công ty cờ BẬT đều bị máy cũ duyệt + khoá.
  (Nhận định "HĐ ca G2 chạy đúng" trước đây không tái hiện: G2 bị bỏ qua mỗi khi G1.2 đỏ do `mode: serial`.)

## Nguyên nhân
1. `apps/hub-api/src/modules/packs/contracts/application/extract-job.usecase.ts:49-53` (và `approval.usecase.ts:97,102`): cờ bật ⇒
   ghi `contract.submitted` rồi KHÔNG mở run engine (`!prep.on`), lượt duyệt giữ `mode = 'machine'`.
2. Không chỗ nào gắn run do bộ điều phối mở vào lượt duyệt: `processes/triggers/flow-launch.ts:87-91` chỉ gắn `pack_record_id`
   + `flow_event_id`; `contracts.approvals.mode = 'engine'` chỉ được đặt ở `adapters/approval-engine.repo.ts:90` (đường cũ) và
   `adapters/contract-flow.repo.ts:107` (lúc KẾT CỤC).
3. Vì vậy `getApproval` (`approval.usecase.ts:168-170`) trả thẻ máy cũ; "Xác nhận và lưu" của nhân viên đi `decideInTx` →
   `finalizeOrLevel2` (`approval.usecase.ts:212`) ⇒ HĐ khoá ngay, lượt flow (nếu đã mở) mồ côi; kết cục của nó gặp HĐ không còn
   `needs_review` ⇒ `not_found`.
4. Thẻ engine (`domain/approval-engine-card.rules.ts:114-143`) dựng bước từ `flow_steps` dạng khe (`s<i>` = bước review thứ i) —
   không dựng được từ FlowDef (Nếu / Duyệt / Thông báo / Kết thúc), nên dù gắn run vẫn cần nguồn bước mới.

## Hướng sửa (lát kế, Opus medium)
- (a) Cờ bật: CÙNG tx ghi `contract.submitted`, lượt duyệt chuyển `mode = 'engine'`, `engine_run_id = null`, lý do `FLOW_STARTING`
  (máy cũ không còn quyết được; thẻ không báo "kẹt" với lý do này).
- (b) Hook gói sau khi `flowLaunchOf` mở run cho `contract.submitted` (đăng ký qua `flowPortRegistry`, như `OutcomeHandler`): gắn
  `engine_run_id = run`, `flow_steps = '[]'`, xoá lý do — có điều kiện `engine_run_id is null` (idempotent, đua an toàn).
- (c) `cardSteps`: `flow_steps` rỗng ⇒ dựng bước từ `stepsView` của run (tên stage, `s<idx>`).
- Test: int `triggers/first-launch.int.test.ts` thêm ca thật (gói contracts: HĐ level1 cờ bật ⇒ 1 `dispatchOnce` ⇒ thẻ `mode engine`,
  bước "Duyệt giá trị lớn" `open`, approve máy cũ ⇒ APPROVAL_NOT_OPEN) + perf int event→task mở ≤ 5 s ở vòng thật.

## Không làm / Chạm
Không sửa code trong lát này (hết 50 phút cho chẩn đoán). Triệu chứng (B) community 200 s: CHƯA điều tra.

## Quyết định trong lúc làm
- Dừng ở chẩn đoán thay vì vá dở máy trạng thái run (Luật 0c: lõi run giao Opus medium, có int trạng thái).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chẩn đoán, chưa sửa code; Delta thật đi cùng lát sửa).

## Việc còn lại
- [ ] Sửa (a)(b)(c) + int đỏ→xanh + perf int.
- [ ] Gỡ `fixme` G1.2/G2 (qc) sau khi sửa.
- [ ] Điều tra (B) community: bước duyệt bài mở chậm tới 200 s.
