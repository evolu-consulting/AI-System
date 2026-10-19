# Review · N2-engine-ext (mở rộng engine quy trình)

- Phạm vi: `feae3775` (spec/plan/tasks/readiness + test trước) · `42767d4f` (Từ chối, `exclude_starter`, hub 0041) · `e61572f4` (trần theo tenant, admin 0013, admin-web) · `c7dcb639` (`PackRuns`, tool gói, `/mcp`, pkdemo 0002) · `48571f97` (tách `#review`, mock 409) · `8da10761` + `8213d6da` (`tests/.lock`, tasks).
- Reviewer: một vòng, chỉ đọc (Luật 1b). Ngày 2026-10-19.
- Viết tắt: `pr/` = `apps/hub-api/src/modules/processes/`, `pk/` = `apps/hub-api/src/modules/packs/`.

## Kết luận: **APPROVED**

0 Cao · 5 Trung · 10 Thấp. Không có Cao ⇒ không chặn. Trung #1 (tool gói không có timeout) nên sửa trước HD3/HD6 dùng tool gói thật; các Trung còn lại là thiếu test cho đường đã viết đúng.

## Đã kiểm, đạt

| Điểm | Kết quả |
|---|---|
| Từ chối ⇒ run `cancelled` + task `reject` | `pr/domain/runs/run-state.rules.ts:139` `reject ⇒ end(s,"cancelled")`. `pr/gates/gates.service.ts:137` bắt buộc lý do (422 trước khi khoá). `closeTask(result: reject, feedback)` first-wins (`gates.service.ts:190-199`) ⇒ quyết sau đó 409 `REVIEW_TASK_CLOSED`. `pr/gates/review-out.ts:46-62` `rejectOut`: tin `task_result` ∥ notice đóng task, rồi `cancelEnd` (stage/timer huỷ, task khác `cancelled`, run `cancelled`, `run_end`). Hậu COMMIT `cancelRunOf` ⇒ `cancelStageRuns` scope system (`gates.service.ts:213`, `:340-353`) như huỷ run. `back_to_step` kèm reject bị bỏ qua (`back.effects.ts:52`). "Chưa đạt" giữ nguyên (AC05). |
| Migration hub 0041 | Idempotent (dựng lại CHECK chỉ khi chưa chứa `'reject'`), danh sách cũ giữ đủ + `reject` cuối. Không bảng/cột mới. |
| Contract chỉ thêm (P-d khoá) | `TASK_RESULTS` thêm `reject` cuối; `ReviewDecisionRequest.result` += `reject`; mã mới ở khối riêng `CHAT_PROCESS_N2_ERRORS` (khối 13 mã P-a/P-b2 không đổi); `exclude_starter` `.default(false)` + type đọc `?:` cho snapshot cũ; `process_runs_max` optional ở response/PATCH. |
| Start-from-pack: thứ tự | `pk/kit/application/start-pack-run.usecase.ts:35-48`: (1) tx gói `check` (có, cùng tenant qua RLS + `tenant_id` tường minh, `run_id is null`) ⇒ `not_found`/`has_run` trước khi mở run (0 run mới — AC02, 409) → (2) `port.start` (`createFromApi` origin none, `deferKick`; mọi kiểm def/Group/trần/inputs như route, lỗi ném nguyên AppError 404/429) → (3) tx gói `attachRun` có điều kiện `run_id is null … returning id` (`pk/pkdemo/adapters/items.repo.ts:39-44`) → (4) `kick`. `attach` false/ném ⇒ `finally` huỷ bù (`GateService.cancel`, người bắt đầu được huỷ) rồi `has_run`/ném lại; không giữ hai khoá cùng lúc (tx hub COMMIT trước tx gói). Hai request đua cùng item: cả hai mở run, một bên gắn, bên kia huỷ bù ⇒ đúng một run sống gắn vào item. |
| Trần theo tenant đọc TRONG câu đếm | `pr/runs/runs.repo.ts:84-92` `activeAndCap`: MỘT câu `select (count … CAP_COUNTED), (select process_runs_max from admin.tenants where id=$t)`; gọi sau `lockTenant` (`pr/runs/start-inputs.ts:46-49`); trần = seam `?? cột ?? 5` (N2-D11); mount bỏ `?? PROCESS_RUNS_PER_TENANT` (`processes.mount.ts`). 0 câu thêm so với trước. `waiting_review` vẫn đếm (AC10). Admin: route tenants đã `requireRole("platform_admin")`; zod 1…1000 int; CHECK DB `BETWEEN 1 AND 1000`; audit/version theo khuôn có sẵn. |
| `STARTER_CANNOT_REVIEW` cả ở cấp 2 | `assertReviewAllowed` (`review-out.ts:31-38`) chạy SAU `assertMayDecide` (đã cho qua người được giao / Group duyệt / Group chuyển cấp `escalated_group_id`) và SAU `lockRun`, đọc cờ từ snapshot đã khoá (0 câu thêm), không phụ thuộc grant nào ⇒ người bắt đầu bị chặn 403 dù quyết với tư cách Group duyệt, Group chuyển cấp (cấp 2) hay người được chuyển. Trước `closeTask` ⇒ task vẫn mở. `canAct` (`pr/domain/tasks/task-access.rules.ts:42`) trả false tương ứng; chỉ áp `kind = review` (N2-D06). |
| Tool gói trong stage `tool` | `loadCallRow` vẫn MỘT câu (left join `admin.workflows` ⇒ khoá gói vẫn ra hàng); `withPackTool` (`pr/adapters/tools/pack-tool-load.ts`) đè `switchOn` = gói bật cho tenant CỦA RUN (cache), `sideEffect` theo registry ⇒ `preCallReason` giữ `usable/canRun/D2-49`; audit `tool_call` giữ nguyên. Tool chạy `uow.tenant({tenantId run, userId = started_by})` (tx gói, RLS). Lưu def: `toolSwitchReader` gộp tool gói đã bật (0 câu thêm). |
| `/mcp` | `pk/../mcp/pack-tools.provider.ts`: liệt kê/gọi chỉ khi khoá ∈ `payload.mcp.tools` ∧ gói bật ∧ user job có `read` ∧ ¬`side_effect`; `call` kiểm lại (`accepts`) + `validateToolArgs`. |
| Perf (Luật 4c) | Start +0 câu; quyết review +0 câu; tool gói: kiểm gói bật qua cache. Int N2 21 test chạy 9 s. Perf d2 theo T9 (P04 đỏ đã có trong danh sách cho phép). |
| Lock | `git diff 8da10761^ 8213d6da -- tests/.lock` = đúng 7 dòng thêm (6 test + `_n2.ts` của `tests/acceptance/N2/`), 0 dòng của lát khác đổi (kể cả bỏ qua CR/LF). Hash 7 dòng khớp file hiện tại. HEAD `tests/.lock` = `8213d6da`. |

## Chạy lại test (reviewer)

- Unit: `n2-review.rules.test`, `pack-tools.provider.test`, `start-pack-run.usecase.test` — 10 pass.
- Int: `bun --config=bunfig.int.toml test tests/acceptance/N2/` — 21 pass, 0 fail, 9,0 s (log `CONNECTION_ENDED` lúc teardown là nhiễu có sẵn của khung).

## Phát hiện

| # | Mức | Chỗ | Vấn đề | Đề xuất |
|---|---|---|---|---|
| 1 | Trung | `pr/adapters/tools/mcp-tool-invoker.ts:68-72`; `pk/kit/adapters/pack-tools.registry.ts:162-187` | Nhánh tool gói bỏ qua `timeoutS` và `signal` của lời gọi: `t.run(ctx,args)` không có hạn ⇒ tool gói treo (khoá hàng, I/O ngoài) giữ stage `running` và slot driver vô hạn, khác hợp đồng P-d2 (stage tool có `timeout_s`). | `Promise.race` với `timeoutS` (+ `AbortSignal` vào `PackToolCtx`), hết hạn ⇒ `failed{code:"TIMEOUT", sent: side_effect}`. |
| 2 | Trung | `pr/runs/pack-runs.ts:40-53` | `PackRuns.outcomes` (N2-D08, xử lý readiness #1 mức Cao) không có test nào — readiness ghi "AC trong `pack-run.int`" nhưng file không gọi. Chưa ai dùng nên lỗi sẽ lộ ở HD3. Phụ: `(rj.feedback is not null or rj.id is not null)` thừa vế đầu. | Thêm int: reject run gói ⇒ `outcomes` trả `{status:"cancelled", rejected:true, feedback}`; run tenant khác không trả. |
| 3 | Trung | `tests/acceptance/N2/pack-tool.int.test.ts:90-97` | AC08 trong spec là đường CHẠY ("`side_effect` ở stage không `real_action` ⇒ `tool_failed`, 0 lời gọi") nhưng test chỉ kiểm lưu def 422 `TOOL_SIDE_EFFECT`. Đường runtime D2-49 cho tool gói (và đường dương `pkdemo-mark` ở stage `real_action` sau duyệt) không được khoá. | Thêm ca: def cũ/snapshot sửa tay có `pkdemo-mark` không `real_action` ⇒ `needs_decision tool_failed`, 0 hàng gói; và ca `real_action` sau Đạt ⇒ chạy. |
| 4 | Trung | `pk/kit/application/start-pack-run.usecase.ts:38-46` | Đường bù (gắn thua đua / gắn lỗi ⇒ huỷ run) chỉ có unit với port giả; chưa int nào chứng minh run thật về `cancelled` và không còn `hub.runs` sống. Đây là chỗ rủi ro nhất của FR-01. | Int: chèn `run_id` vào item giữa check và attach (hoặc hook attach ném) ⇒ 409/500, run `cancelled`, `items.run_id` không đổi. |
| 5 | Trung | `apps/admin-web` (readiness #4) | UI đổi (ô trần run, checkbox `exclude_starter`) không có e2e — Luật 4b; đã ghi nợ ở `tasks.md`. | Giao qc/frontend-lead như tasks.md ghi; không chặn lát BE. |
| 6 | Thấp | `pr/runs/sweeps.ts:199-204` | `orphanCands` không lọc tuổi ⇒ vòng quét (~3 s) có thể `kick` run vừa mở bằng `deferKick` TRƯỚC khi gói gắn `run_id` — N2-D04 "kick sau khi gắn" không tuyệt đối. Vô hại hiện tại (kick idempotent, huỷ bù vẫn đúng) nhưng tool/stage đọc `run_id` của bản ghi gói có thể thấy null. | Ghi rõ vào plan §2 hoặc lọc `updated_at < now() - interval` trong `orphanCands`. |
| 7 | Thấp | `tests/acceptance/N2/starter.int.test.ts:59,69` | `if (mine) expect(can_act)` — assert có điều kiện, không thấy task thì test vẫn xanh. Vòng lặp mô tả "Đạt / Từ chối" nhưng gửi `fail`; không có ca starter `reject`, không có ca starter ở Group chuyển cấp / người được chuyển (code đúng, xem bảng trên). | Assert `mine` tồn tại; thêm `reject` và một ca `escalated`. |
| 8 | Thấp | `tests/acceptance/N2/reject.int.test.ts:53` | `expect(again.status).not.toBe(200)` lỏng; AC04 nói 409 `REVIEW_TASK_CLOSED`. | So `{status:409, code:"REVIEW_TASK_CLOSED"}`. |
| 9 | Thấp | `pk/kit/adapters/pack-tools.registry.ts:178` | `catch {}` nuốt lỗi tool gói, không log ⇒ khó điều tra `UPSTREAM_ERROR`. | Log `pack-tool-failed` (tên lỗi, khoá tool, run). |
| 10 | Thấp | `apps/chat-web/src/features/composer/lib/send-error.ts:107`, `apps/chat-web/src/features/processes/inputs/hooks/use-inputs-form.ts:104`, `apps/admin-web/src/features/processes/lib/errors.ts:30` | Thông báo 429 vẫn dùng hằng 5 trong khi trần nay theo tenant (đã ghi nợ cho chat-web; admin-web cũng vậy). | Bỏ số khỏi câu hoặc trả `max` trong `details` của 429. |
| 11 | Thấp | `apps/chat-web` | Không có nhãn i18n cho `STARTER_CANNOT_REVIEW` ⇒ người dùng thấy lỗi chung. | Thêm key cùng lúc làm nút Từ chối (HD3). |
| 12 | Thấp | `pk/pkdemo/adapters/pkdemo.routes.ts:55-56` | 503 `PROCESS_ENGINE_OFF` dựng tay (status + message) thay vì lấy từ `CHAT_PROCESS_N2_ERRORS` — hai nguồn. | Dùng status từ contract. |
| 13 | Thấp | `pr/gates/gates.service.ts:137` vs `review-out.ts:31` | Starter gửi `reject` không lý do nhận 422 `FEEDBACK_REQUIRED` thay vì 403 (kiểm lý do trước kiểm starter). Không lộ gì; chỉ là thứ tự lỗi. | Chấp nhận hoặc ghi vào spec. |
| 14 | Thấp | `pr/adapters/tools/mcp-tool-invoker.ts:70` | `PackToolCtx.runId` = id `hub.runs` (job của stage), không phải `process_run_id`; gói muốn liên kết bản ghi với run quy trình sẽ nhầm. | Ghi rõ trong `pack-tools.ports.ts` hoặc thêm `processRunId`. |
| 15 | Thấp | `apps/admin-api/src/modules/tenants/tenants.rules.ts:46-47` | `changedTenantFields` thêm `process_runs_max` nhưng `tenants.rules.test.ts` chưa có ca (đã có int AC11). | Thêm một ca unit. |
