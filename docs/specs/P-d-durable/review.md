# Review T12 — P-d1 (code + bảo mật)

## Kết luận: CHANGES REQUESTED · Spec: P-d-durable (P-d1) · Vòng: 1

Phạm vi: `git diff 75ec598..HEAD` (nhánh `platform/gd0`, 72 commit), trọng tâm `apps/hub-api/src/modules/processes/**`,
`packages/db/migrations-hub/0036*`, `packages/db/migrations/0011*`, `packages/contracts/src/{chat,hub-admin,tenants}*`,
`apps/admin-api/src/modules/{tenants,transfer}`, `apps/{admin,chat}-web/src/features/{processes,tenants}`.

**Bảo mật / cách ly tenant: SAFE** — 0 Blocker. Không tìm thấy đường nào để đọc/ghi chéo tenant (chi tiết ở mục "Bảo mật").

## Lệnh đã chạy
- `bun test apps/hub-api` → 517 pass · 1 skip · 0 fail (518 test / 106 file, 2.47 s).
- `bun run depcruise` → **đỏ, 4 vi phạm, tất cả có từ trước 75ec598** (đã kiểm bằng `git show 75ec598:<file>`):
  `processes/runs/step-persist.ts` → `kh/kh.writes.repo.ts`; `processes/runs/view-knowledge.ts` → `kh/kh.writes.repo.ts`;
  `kh/kh.agent.service.ts` → `studio/agents/agents.repo.ts`; vòng `mcp/mcp-call.ts` ↔ `mcp/mcp.service.ts`.
  P-d1 không thêm vi phạm mới. Luật lớp `ca-domain-builtin-only` / `ca-application-inward-only` cho `domain/` và `application/` mới đều xanh.
- Kích thước (đếm dòng các file đổi): không file code nào vượt 400. `runs/team-exec.ts` = 400, `runs/team-runner.ts` = 400,
  `runs/stage-driver.ts` = 398 (sát trần).

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| 1 | Major | 2 Nghiệp vụ (đồng thời) / 4 Dữ liệu | `adapters/notify/review-tasks.repo.ts:51-76, 145-178` + `notify/batch.repo.ts:84-100` ↔ `gates/gates.service.ts:191,201` | **Đảo thứ tự khoá task → run trong tx lô nhắc/chuyển cấp.** Câu 1 khoá `review_tasks` `FOR UPDATE SKIP LOCKED`; câu chèn `process_notices` (FK `process_notices_run_fk` → `process_runs`) sau đó lấy `FOR KEY SHARE` trên run. Tx cổng duyệt/trả lời/huỷ khoá run `FOR UPDATE` (`core.lockRun`) rồi `closeTask` cập nhật đúng task đó ⇒ chu trình run↔task ⇒ 40P01. Tương tự với `claimExpired` (khoá run SKIP LOCKED rồi `update review_tasks` chờ task đang bị lô nhắc giữ). `withHubScope` chạy lại 40P01 nên không mất dữ liệu, nhưng người duyệt chịu `deadlock_timeout` (≥ 1 s) và có thể bị chọn làm nạn nhân. **Cần xác minh** bằng int test: tx A `lockRun(R)` giữ khoá; gọi `remindOnce` với task của R tới hạn; tx A `closeTask` ⇒ kỳ vọng hiện tại 40P01 ở một bên. | Trong CTE claim, khoá cả run cha theo cùng SKIP LOCKED: `join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id … for update of t for key share of pr skip locked` (task có run đang bị tx khác giữ ⇒ để lô sau). Áp cho `claimDueReminders` và `claimDueEscalations`; thêm int test lock-order ở trên. | backend |
| 2 | Minor | 5 Hiệu năng | `adapters/timers/timer-sweep.ts:2-4, 22, 41-47` | `dueTimers` khoá `FOR UPDATE SKIP LOCKED` trong một tx riêng đã COMMIT trước khi bắn ⇒ khoá nhả ngay; hai Hub lấy cùng ≤ 100 ứng viên, hàng nào cũng xếp hàng sau khoá run rồi `skipped`. Đúng (kiểm lại sau khoá — `fire-timer.usecase.ts:17-22`) nhưng việc đôi và comment "instance khác đang bắn hàng đó thì bỏ qua" sai. | Sửa comment cho đúng; hoặc bỏ `for update skip locked` (vô tác dụng), hoặc dùng `pg_try_advisory_xact_lock(hashtext(id))` trong tx từng hẹn để Hub thứ hai bỏ qua sớm. | backend |
| 3 | Minor | 5 Hiệu năng (Luật 4c) | `adapters/timers/timer-sweep.ts:24-36`; `tests/acceptance/P-d/perf/timers.perf.int.test.ts:1-3` | Vòng hẹn giờ mở **một tx mỗi hẹn** (≤ 100 tx/lượt), trái ý Luật 4c, nhưng **đúng thiết kế đã duyệt**: plan-addendum A11 (dòng 200) ghi "vòng hẹn giờ T8 giữ `system(tenantId)` từng hàng", và readiness lần 7 READY. Perf PD-P01/P02 chỉ in p50/p95, không có ngưỡng. Không chặn. | Ghi TECH-DEBT: đo `sweepOnce` với 100 hẹn tới hạn (p95, trước → sau) và cân nhắc gom bắn `retry` theo tập (requeue = update theo tập) cho P-d2. | docs-architect |
| 4 | Minor | 2 Nghiệp vụ | `adapters/timers/timer-sweep.ts:26-35, 43-46` | Hẹn ném lỗi mãi (dữ liệu hỏng) không bao giờ bị đánh dấu, vẫn đứng đầu `order by due_at limit 100` ⇒ ≥ 100 hàng như vậy chặn mọi hẹn khác. **Cần xác minh**: chèn 100 hẹn có `stage_run_id` làm `finishWait` ném, rồi 1 hẹn hợp lệ ⇒ hẹn hợp lệ có bắn không. | Thêm `attempts`/`last_error_at` để lùi lịch (backoff), hoặc sau N lỗi thì `cancelled_at` + log. | backend |
| 5 | Minor | 2 Nghiệp vụ | `domain/notify/remind.rules.ts:41-49` + `application/notify/remind-tasks.usecase.ts:46-55` | Nhắc lặp tính `remindAt += N h` từ mốc cũ ⇒ sau khi Hub ngừng lâu, mốc kế vẫn ≤ now ⇒ mỗi lượt 300 s lại nhắc thêm một lần tới khi đuổi kịp (tối đa 10). **Cần xác minh** với PD-R19 (spec có muốn đuổi kịp như vậy không). | Nếu không muốn: `remindAt = max(remindAt + N h, now + N h)` (luật lớp 1 + test). | backend |
| 6 | Minor | 2 Nghiệp vụ | `domain/timers/due-at.rules.ts:15-31`; `adapters/timers/tenant-tz.repo.ts:11-17` | Múi giờ trong DB chỉ có CHECK độ dài (0011). Một giá trị Bun không hỗ trợ (sửa DB tay, Intl khác phiên bản) ⇒ `Intl.DateTimeFormat` ném `RangeError` khi vào stage chờ ⇒ stage kẹt, orphan sweep kick lại mỗi 3 s. **Cần xác minh**: đặt `admin.tenants.timezone = 'X/Y'` rồi chạy run có stage `wait_until`. | `tenantTzRepo.read()`: nếu `!isSupportedTimeZone(tz)` ⇒ warn + `TENANT_TZ_DEFAULT`, hoặc trả `timer_invalid`. | backend |
| 7 | Minor | 3 Bảo mật (hàng rào) | `uow-boundary.test.ts:59-61` | Test ranh giới cho phép rõ `withHubScope(d.db, { kind: "system" }, …)` trong route/service, nên chỉ chặn `SystemUow`, không chặn scope system trực tiếp (`defs/defs.service.ts:69`, `gates/gates.service.ts:348`, `runs/view.service.ts:177,192` đang dùng — có từ trước, đều lọc tenant tường minh). | Ghi TECH-DEBT; khi chuyển các service này sang `TenantUow` thì thêm `kind: "system"` vào `FORBIDDEN`. | docs-architect |
| 8 | Minor | 7 Chuẩn code | `apps/admin-web/src/features/tenants/components/TenantTimezoneField.tsx:7` | Feature `tenants` import thẳng `@/features/processes/domain/tz-format` (import chéo feature). | Dời `tz-format` sang `src/lib/` hoặc shared domain. | frontend |
| 9 | Minor | 5 Hiệu năng | `adapters/timers/stage-timer.repo.ts:122-126` + `application/timers/fire-timer.usecase.ts:34` | Đọc `timezone` bằng câu riêng, dù hàng hẹn vừa khoá ở `lockById`. | Trả `timezone` trong `Timer` từ `lockById` (bớt một câu mỗi lần bắn `wait_until`). | backend |
| 10 | Minor | 7 Chuẩn code | `runs/team-exec.ts`, `runs/team-runner.ts` (400 dòng), `runs/stage-driver.ts` (398) | Ở đúng trần §4, thêm một dòng là đỏ. | Tách ở task kế chạm tới (vd chuyển nhánh chờ/thử lại sang `application/`). | backend |
| 11 | Minor | 7 Chuẩn code | depcruise (4 vi phạm có từ trước) | `bun run depcruise` đỏ trên nhánh, không do P-d1. | Kiểm có mục TECH-DEBT chưa; nếu chưa thì thêm. | docs-architect |

## Bảo mật (đã kiểm, đạt)
- **Lô `systemBatch`.**
  - `claimDueReminders`: người nhận lọc theo `a.tenant_id = c.tenant_id` / `gm.tenant_id = c.tenant_id`; join stage/run khớp `tenant_id`.
  - `markRemindedMany`: so `tenant_id` theo vị trí.
  - `claimDueEscalations`: `g.tenant_id = u.tenant_id` ⇒ Group khác tenant thì `group_tenant_id` NULL ⇒ `escalate_skipped`.
  - `addEscalatedGroups`: `exists admin.groups … g.tenant_id = x.tenant_id`.
  - `writeNotices`: `exists admin.users … u.tenant_id = x.tenant_id`.
  - `claimExpired`: dựa vào PK + FK kép, có comment.
  - `SKIP LOCKED` có ở mọi câu claim (nhắc, chuyển cấp, hết hạn, ứng viên hẹn giờ).
- **Quyền chuyển cấp (T9).**
  - Hàng `via='escalated'` chỉ được chèn bởi `escalateBatch` sau khi đặt `escalated_at`, nên Group chuyển cấp chỉ có quyền **sau** chuyển cấp.
  - `gates.service.ts:179` chặn khác tenant (404) trước khi xét Group.
  - `task-view.ts` / `asks.repo.ts` / `gates.repo.ts:31` đọc Group chuyển cấp lọc `a.tenant_id = t.tenant_id`.
  - `canAct` kiểm tenant trước (`task-access.rules.ts:26`).
  - Def chỉ chấp nhận Group cùng tenant (`def.rules.ts:56-61`, `refs.groupIds` theo tenant; phạm vi mẫu = tập rỗng ⇒ từ chối).
- **Bắn hẹn.**
  - `fireTimer` chạy trong `sysUow.system(tenantId)`, khoá run → stage → timer.
  - Kiểm lại `fired_at`/`cancelled_at` sau khoá; `markFired` có guard.
  - Mọi câu trong `timers.repo`, `stage-timer.repo`, `run.repo` lọc `tenant_id = $t`; FK kép `process_timers` (run, stage).
  - RLS bật, policy giống `v_t`, không cấp DELETE.
- **Ranh giới.** `tenantOnly`/`systemOnly` (`hub-uow.ts:147-154`), `assertTenantId` kiểm uuid trước tx. `uow-boundary.test.ts` xanh (giới hạn ở lỗi #7).
- **Def-save.** `team-sections`, `escalate-def`, `wait-def` (`processDefStageIssues(…, {inputs})`), `ensureWaitStage` ép trường. `GET /process-editor/context`: `tenant_admin` luôn dùng tenant của mình.
- **Múi giờ admin.**
  - `TimezoneInputSchema` kiểm danh sách IANA ở create/PATCH/import.
  - Audit `tenantAudit` có `before`/`after` đủ trường `timezone`.
  - Import: `mergeTenant` giữ giá trị DB khi file vắng; export ghi `t.timezone`.
- **Thread poster.** `lockEventRun` khoá run `FOR SHARE` trước definer ⇒ thứ tự run → room.
- **Migration.** 0036 idempotent, chỉ thêm/nới, có index cho mọi truy vấn quét mới (`process_timers_due_idx`, `review_tasks_remind_due_idx`, `review_tasks_escalate_idx`, `process_runs_expiring_idx`). 0011 do drizzle sinh (cùng mẫu với admin).

## Hiệu năng (Luật 4c)
- Nhắc, chuyển cấp, hết hạn: số câu cố định mỗi lô, dữ liệu qua một tham số JSON, không join `unnest`, không đăng tin/gọi mạng trong vòng (outbox sau COMMIT, `run_end` để thread-poster đăng).
- Không có `sleep`/poll trong code đã đổi.
- Còn lại: vòng hẹn giờ chạy từng hàng theo plan (#3); vòng `interrupted`/`resolveTimeouts`/`requeueOrphans` chạy từng hàng nhưng có từ trước (không thuộc P-d1).

## Rubric
1 ✓ · 2 ✗ (#1 khoá đồng thời; #4–#6 cần xác minh) · 3 ✓ (SAFE; #7 Minor) · 4 ✓ · 5 ✓ có ghi chú (#2, #3, #9 Minor) · 6 ✓ (hub-api 517/0 fail; không chạy `test:lock:verify` theo brief) · 7 ✓ có ghi chú (#8, #10, #11) · 8 ✓ (đọc mẫu: i18n qua `t()`, `role=alert`; chưa kiểm hết UI) · 9 ✓ (mã FR ở comment đầu module và commit)
