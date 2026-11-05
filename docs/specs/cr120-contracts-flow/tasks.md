---
id: cr120-contracts-flow
lát: cr120-contracts-flow
cr: CR-120
làn: đầy đủ (máy trạng thái run: node chờ + hẹn giờ + sự kiện; Opus đã soát diff lõi — không Blocker)
migration: hub 0093 (when 1803900000000)
phụ thuộc: slot-contract (khai khe `contracts.intake` — lát này chỉ dùng key khe)
---
## Plan (ngắn)
Spec `docs/specs/CR-120/spec.md` §5–§6. Thêm node `wait_for` (G3) + `wait_event` (G4) cho engine (dùng lại hẹn `wait_until`), tool gói
contracts cho bước trích/ký số/nhắc nghĩa vụ (G6), def thư viện mặc định của khe `contracts.intake` (hub 0093).

## Làm
- [x] contract: `EXECUTOR_KINDS += wait_for, wait_event`; `WaitForExecutorSchema` (hours 1…8760), `WaitEventExecutorSchema` (event, timeout_h).
- [x] hub `nodes/wait-for`, `nodes/wait-event` (+ luật WAIT_INVALID, ép trường như `wait_until`); `enterTimedWait` (hẹn `wait_until` due = now + N giờ /
      hạn); `signalEvent` (khoá run → stage → huỷ hẹn → `finishWait`); `PackRunsPort.signalEvent(tenant, ref gói, event)`.
- [x] hub 0093: `hub.process_run_events` (PK run+event, `consumed_by`, RLS) + khe `contracts.intake` + def "Nhận hợp đồng (mặc định)" v1.
      Sự kiện được TIÊU THỤ bởi stage chờ; chỉ ghi khi run còn stage `wait_event` đúng khoá (đang chờ/phía trước).
- [x] gói contracts: tool `contracts-extract` (đọc trạng thái trích), `contracts-esign-send` (side_effect, real_action), `contracts-obligation-remind`;
      hook ký xong ⇒ `esign.completed`.
- [x] admin-web editor: 2 loại node (draft `wait`, `StageTimedWait`, validate, i18n).
- [x] workspace-web: gợi ý cạnh "Lưu nháp"; "Đã chuyển: <bước kế>" sau Xác nhận và lưu; HĐ nháp/không quyền ⇒ câu chung (404/403).

## Không làm / Chạm
- G2 (bước tool MCP), trigger mở run intake khi tải HĐ lên, chuyển giao sang `contracts.approval` khi add-on bật: NGOÀI lát này.
- Chạm lõi engine (đã Opus soát): settle-step.usecase (loại hẹn), stage-timer.repo (`finishWait`), ports, hub-uow, pack-runs, wait-stage.rules.

## Test tối thiểu
- unit: `timed-wait.usecase.test.ts`, `wait-timed.node.test.ts`, `contracts-intake.seed.test.ts`, `intake.tools.test.ts`, admin-web
  `timed-wait-form.test.ts`, workspace-web `moved-to.test.ts`, `load-error.test.ts`.
- int (evotest): `tests/acceptance/CR-120/timed-wait.int.test.ts` + CF approval-engine / eng-reliable + P-d d1/wait.
- e2e (viết, chạy cuối đợt): `e2e/contracts-web/cr120-intake-flow.cw.ts`.

## Quyết định trong lúc làm
- `wait_for`/`wait_event` dùng lại loại hẹn `wait_until` (không đổi CHECK `process_timers_kind_ck`); `settleStep` coi cả ba là chờ-hẹn.
- Hết hạn `wait_event` ⇒ stage chạy tiếp, .md "Hết hạn chờ" (không mở quyết định; tránh thêm lý do vào CHECK).
- Bước "AI trích xuất" = tool đọc trạng thái (library def không tham chiếu được agent theo key; trích chạy nền từ lúc tải lên).
- "Xác nhận và lưu" = hoàn tất stage form `confirm` ⇒ run TỰ chạy tiếp tới duyệt (không có "Gửi duyệt" tay); def đặt tên stage đúng vậy.

## Việc còn lại
- G2 bước tool MCP (nguồn catalog `mcp` của Agent Hub) — COULD.
- Trigger mở run `contracts.intake` khi HĐ được tải lên (hiện chỉ có def + khe + tool).
- Chuyển giao sang `contracts.approval` khi add-on bật (def hiện duyệt trưởng phòng bằng stage `set` + review).
- e2e hành trình thật (D5) chạy ở cuối đợt; khai khe/`SlotSpec` `contracts.intake` do cr120-slot-contract.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Node chờ N giờ `wait_for` (G3) (nguồn: cr120-contracts-flow)
Stage `wait_for` chờ N giờ (1…8760) kể từ lúc tới lượt bằng hẹn giờ bền; tới hạn ⇒ stage xong và run chạy tiếp; chưa tới hạn không đổi gì.
- Kịch bản: khi stage chờ 2 giờ thì 1 giờ sau vẫn chờ, quá 2 giờ ⇒ xong và bước kế chạy [test: tests/acceptance/CR-120/timed-wait.int.test.ts » G3 · wait_for 2 h: chưa tới hạn giữ nguyên]
- Kịch bản: khi lưu def có stage chờ với after ≠ auto hoặc hành động thật thì WAIT_INVALID [test: apps/hub-api/src/modules/processes/nodes/wait-for/wait-timed.node.test.ts » after ≠ auto ⇒ WAIT_INVALID .after]
#### Yêu cầu: Node chờ sự kiện `wait_event` (G4) (nguồn: cr120-contracts-flow)
Stage `wait_event` chờ sự kiện theo khoá do gói bắn cho bản ghi gói của run (tenant lọc tường minh); sự kiện thả đúng stage ngay và huỷ hẹn
hạn; hết `timeout_h` giờ không sự kiện ⇒ chạy tiếp, ghi "Hết hạn chờ". Sự kiện tới trước bước chờ được giữ và tiêu thụ khi vào bước; chỉ
ghi khi run còn stage chờ đúng khoá; mỗi sự kiện chỉ qua MỘT lần chờ.
- Kịch bản: khi gói bắn esign.completed thì stage chờ xong, hẹn hạn huỷ, run chạy tiếp [test: tests/acceptance/CR-120/timed-wait.int.test.ts » G4 · signalEvent thả đúng stage ngay, huỷ hẹn hạn, ghi .md 'Đã nhận sự kiện', run chạy tiếp tới done]
- Kịch bản: khi quá hạn không có sự kiện thì chạy tiếp [test: tests/acceptance/CR-120/timed-wait.int.test.ts » G4 · hết hạn 48 h không sự kiện ⇒ chạy tiếp, .md 'Hết hạn chờ']
- Kịch bản: khi sự kiện tới trước bước chờ thì vào bước là qua [test: tests/acceptance/CR-120/timed-wait.int.test.ts » G4 · sự kiện tới TRƯỚC bước chờ ⇒ chỉ ghi (0 thả)]
- Kịch bản: khi tenant khác bắn cùng bản ghi thì không thả, không ghi [test: tests/acceptance/CR-120/timed-wait.int.test.ts » tenant khác bắn cùng bản ghi ⇒ 0 thả, 0 hàng sự kiện]
- Kịch bản: khi run không còn stage chờ đúng khoá thì không ghi sự kiện [test: apps/hub-api/src/modules/processes/application/timers/timed-wait.usecase.test.ts » run không còn stage wait_event đúng khoá (đã qua / không có) ⇒ KHÔNG ghi sự kiện (tránh sự kiện cũ qua bước chờ sau)]
#### Yêu cầu: Def mặc định khe `contracts.intake` (FLOW-FR-08) (nguồn: cr120-contracts-flow)
Khe `contracts.intake` có def thư viện mặc định (hub 0093): AI trích xuất → Xác nhận và lưu (form, nhắc 24 giờ, chuyển cấp 48 giờ) → duyệt theo
luật → ký số (tool, hành động thật) → chờ ký → chờ ngày nghĩa vụ − 7 → nhắc nghĩa vụ. Group theo mã.
- Kịch bản: khi đọc seed 0093 thì stages khớp builder, hợp lệ theo contract và luật node [test: apps/hub-api/src/modules/processes/library/contracts-intake.seed.test.ts » stages trong SQL = builder (đã normalize), inputs khớp, id/khe cố định]
#### Yêu cầu: Tool gói contracts cho khe intake (nguồn: cr120-contracts-flow)
Tool `contracts-extract` (đọc trạng thái trích), `contracts-esign-send` (gửi ký; người ký công ty = người bắt đầu), `contracts-obligation-remind`
(chuông idempotent); HĐ không thấy ⇒ lỗi tool.
- Kịch bản: khi gọi tool với HĐ không thấy thì lỗi CONTRACT_NOT_FOUND [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.test.ts » contracts-extract: trả trạng thái]

### ADDED web/hop-dong-review.md
#### Yêu cầu: Màn xác nhận HĐ nói rõ bản nháp và bước kế (nguồn: cr120-contracts-flow)
Cạnh "Lưu nháp" có gợi ý "Bản nháp chỉ bạn thấy — bấm Xác nhận và lưu để chuyển duyệt"; sau Xác nhận và lưu thẻ báo "Đã chuyển: <bước kế>";
HĐ nháp/không quyền xem (404/403) hiện một câu chung, không lộ HĐ có tồn tại.
- Kịch bản: khi bước mở sau bước soạn thì có tên bước kế [test: apps/workspace-web/src/features/contract-approval/lib/moved-to.test.ts » bước soạn đã Đạt, bước kế mở ⇒ tên bước kế]
- Kịch bản: khi hub trả 404 hoặc 403 thì cùng một khoá câu chung [test: apps/workspace-web/src/features/contract-review/lib/load-error.test.ts » 404 và 403 ⇒ cùng khoá chung]
