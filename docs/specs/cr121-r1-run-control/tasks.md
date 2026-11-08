---
id: cr121-r1-run-control
lát: cr121-r1-run-control
cr: CR-121
làn: đầy đủ (máy trạng thái run, quyền, đồng thời)
migration: hub 0098_run_rerun_of
phụ thuộc: —
---
## Plan (ngắn)
Ba thao tác quản trị trên một lượt chạy (`hub.process_runs`), lý do bắt buộc (enum `sent_by_mistake | needs_edit | bad_data | other`):
Dừng · Chạy lại bước · Chạy lại cả lượt. Điểm vào `gates.routes.ts` → `RunControlService` (quyền + khoá + CAS) → hiệu ứng có sẵn.

## Làm
- [x] contract `chat/run-control.ts`: `StopProcessRunRequest`, `RerunStepRequest`, `RerunProcessRunRequest`, `RunControlReason`.
- [x] domain `runs/run-control.rules.ts` (thuần): vai × thao tác, trạng thái được phép + unit.
- [x] `POST /process-runs/:id/stop` — platform_admin, tenant_admin cùng tenant. Dùng `cancelEnd` (huỷ hub.runs, stage, hẹn, đóng task mở
      ⇒ người chờ không còn thấy việc, run `cancelled`, run_end + notifier) + `cancelled_by` + audit. Đã dừng ⇒ 200 cùng kết quả, không ghi.
- [x] `POST /process-runs/:id/rerun-step` — CHỈ platform_admin. Bước `done|failed|needs_decision|waiting_timer`, run không `cancelled|expired`.
      Dùng `applyBack` (quay lại bước của stage: reset stage ≥ bước, vòng +1, task mở `superseded`, huỷ hẹn, run `running`) với
      `raiseLimit` (không tiêu số lần quay lại của người duyệt), KHÔNG ghi `process_back_events` (`backEvent:false` — CHECK `to_step < from_step`; đây không phải "quay lại" của người duyệt) + audit. Output cũ giữ (theo version).
- [x] `POST /process-runs/:id/rerun` — platform_admin, tenant_admin cùng tenant; run đã kết thúc. Run MỚI cùng snapshot + input/inputs/nguồn
      ghim, người bắt đầu giữ nguyên, origin `admin`, `rerun_of` = run cũ; 201 (mới) / 200 (đã có — bấm lại trả cùng run).
- [x] hub 0098: `process_runs.rerun_of` (FK + unique một phần).
- [x] int `tests/acceptance/CR-121/run-control.int.test.ts`.

## Không làm / Chạm
UI, API nhật ký (R-2), e2e. Không sửa `runs.routes.ts`, `runs/view.service.ts`, code gói contracts.
Chạm: `gates/back.effects.ts` (`taskId` nullable, cờ `backEvent`), `gates/gates.repo.ts` (`setRunBack` xoá `finished_at` — run `done` chạy lại bước).

## Test tối thiểu
- unit `apps/hub-api/src/modules/processes/domain/runs/run-control.rules.test.ts`
- int `tests/acceptance/CR-121/run-control.int.test.ts` (đường chính 3 thao tác, quyền, chéo tenant, đua 2 lần, job trả muộn sau Dừng).

## Quyết định trong lúc làm
- Người làm + lý do + thời điểm: nguồn DUY NHẤT `hub.audit_log` (entity `process_run`; action có sẵn `cancel` cho Dừng, `start` cho chạy lại;
  `summary.op` = `stop|rerun_step|rerun`, `summary.reason`). Không thêm cột stop_reason/stopped_by (đã có `cancelled_by`) — R-2 đọc audit.
- Gói (contracts) — HĐ về "chưa duyệt": `process_run_events` là chiều GÓI → HUB (chờ sự kiện), không có chiều ngược. Cơ chế có sẵn chiều
  HUB → GÓI là quét đối soát (`approval-sweep.repo` `reconcile`): run engine kết thúc không phải Từ chối ⇒ lượt duyệt `stalled`
  (`ENGINE_RUN_CANCELLED`), HĐ giữ `needs_review` (chưa duyệt), chờ "Mở lại quy trình". Không sửa code gói.
- Dừng run GẮN GÓI: cho admin (khác `cancel` thường — chỉ gói huỷ) vì đây là thao tác quản trị có lý do; gói đối soát như trên.
- Chạy lại cả lượt cho run gắn gói ⇒ 409 `PROCESS_RUN_STATE` `{pack_bound:true}`: run mới không gắn lượt duyệt sẽ bị quét "run mồ côi"
  (CR-107) huỷ; gói có "Mở lại quy trình" riêng.
- Run gốc chỉ chạy lại cả lượt MỘT lần (unique `rerun_of`); bấm lại ⇒ trả run mới đã có. Chạy lại tiếp ⇒ chạy lại từ run mới.
- Chạy lại cả lượt: scope `system` (hội thoại nền/flow thuộc người bắt đầu — RLS theo user), quyền + tenant kiểm trước trong cùng tx, mọi câu
  lọc `tenant_id`; không tính trần run/tenant (thao tác quản trị).
- Perf: Chạy lại cả lượt = 5 câu (đọc tenant, khoá, tìm rerun, CTE ghi, đọc tóm tắt). Dừng/Chạy lại bước DÙNG LẠI `cancelEnd`/`applyBack`
  (một nguồn hiệu ứng) ⇒ ~14 câu cố định / ~12 câu + 1 câu mỗi stage bị reset (vòng `resetStage` có sẵn, ≤ số stage của def) — vượt
  ngân sách 5 câu của brief; thao tác quản trị hiếm, không phải đường nóng. Gộp set-based ⇒ lát sau nếu cần.

- Migration 0098 (review Opus): FK `rerun_of` thêm NOT VALID rồi VALIDATE (câu riêng, như 0063). Unique index KHÔNG `CONCURRENTLY`: migrator
  drizzle bọc một tx, repo chưa có tiền lệ (0066/0070 ghi rõ). Cột mới toàn NULL; index một phần vẫn quét `process_runs` một lần dưới khoá
  SHARE (chặn ghi trong lúc quét). Kích thước `process_runs` prod chưa đo (không chạm prod) — ước lượng nhỏ (hàng nghìn–chục nghìn hàng
  ⇒ dưới 1 s). Bảng lớn hơn nhiều ⇒ điều phối quyết tạo index CONCURRENTLY tay trước khi migrate (như 0010).
- Chạy lại bước đã xong khi bước sau đang chạy: `applyBack` reset bước sau (`current_run_id` = null) ⇒ kết quả muộn bị driver bỏ (int xanh,
  không cần chặn 409).
## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED hub/dieu-khien-luot-chay.md
#### Yêu cầu: Dừng lượt chạy
Quản trị (platform_admin; tenant_admin cùng tenant) dừng run chưa kết thúc kèm lý do: run `cancelled`, việc duyệt mở đóng, hẹn huỷ,
ghi người dừng + lý do + thời điểm vào audit. Bấm lại ⇒ cùng kết quả. Kết quả job đến sau khi dừng không đổi trạng thái.
- Kịch bản: khi tenant_admin dừng run đang chạy hai lần đồng thời thì cả hai 200, một audit, job trả muộn không ghi đè [test: tests/acceptance/CR-121/run-control.int.test.ts » Dừng: tenant_admin dừng run đang chạy hai lần đồng thời ⇒ cancelled, một audit, job trả muộn không ghi đè]
- Kịch bản: khi thành viên dừng thì 403; tenant_admin tenant khác thì 404; thiếu lý do thì 400 [test: tests/acceptance/CR-121/run-control.int.test.ts » Quyền: thành viên 403, tenant_admin tenant khác 404, tenant_admin chạy lại bước 403]

#### Yêu cầu: Chạy lại bước
Chỉ platform_admin; bước lỗi hoặc đã xong; trong CÙNG run chạy lại từ bước đó trở đi (vòng tăng), kết quả cũ giữ, audit lý do.
- Kịch bản: khi platform_admin chạy lại bước 2 của run xong hai lần đồng thời thì một lần quay lại (200 + 409), run chạy tới xong với output mới [test: tests/acceptance/CR-121/run-control.int.test.ts » Chạy lại bước: platform_admin trên run xong hai lần đồng thời ⇒ một lần quay lại, cùng run, kết quả cũ giữ]
- Kịch bản: khi tenant_admin chạy lại bước thì 403 [test: tests/acceptance/CR-121/run-control.int.test.ts » Quyền: thành viên 403, tenant_admin tenant khác 404, tenant_admin chạy lại bước 403]
- Kịch bản: luật vai × thao tác và trạng thái được phép [test: apps/hub-api/src/modules/processes/domain/runs/run-control.rules.test.ts » Chạy lại bước: bước lỗi/xong, run đã dừng/hết hạn ⇒ không]

- Kịch bản: khi chạy lại bước đã xong trong lúc bước sau đang chạy thì kết quả muộn của bước sau không ghi vào run [test: tests/acceptance/CR-121/run-control.int.test.ts » Chạy lại bước đã xong khi run đang chạy bước sau ⇒ kết quả muộn của bước sau không ghi vào run]

#### Yêu cầu: Chạy lại cả lượt
platform_admin hoặc tenant_admin cùng tenant; run đã kết thúc, không gắn gói; tạo run MỚI cùng định nghĩa đã chụp + đầu vào, `rerun_of` = run cũ.
- Kịch bản: khi chạy lại run đã dừng hai lần đồng thời thì một run mới (201 + 200 cùng id), cùng snapshot + input, chạy tới xong [test: tests/acceptance/CR-121/run-control.int.test.ts » Chạy lại cả lượt: run đã dừng, hai lần đồng thời ⇒ một run mới rerun_of cùng snapshot + input]
- Kịch bản: luật chỉ run đã kết thúc, không gắn gói [test: apps/hub-api/src/modules/processes/domain/runs/run-control.rules.test.ts » Chạy lại cả lượt: chỉ run đã kết thúc, không gắn gói]

## Việc còn lại
- UI (Tpl-Run) + i18n; R-2 hiển thị audit `summary.op` trên dòng thời gian.
- e2e hành trình thật (D5) cuối đợt.
- Điều phối: journal 0098 ghi `when` 1804700000000 sau 0096 — chèn sau 0097 (D-1) khi merge.
