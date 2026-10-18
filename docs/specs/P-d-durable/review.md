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

## Vòng 2

## Kết luận: APPROVED · Spec: P-d-durable (P-d1) · Vòng: 2

Phạm vi: chỉ diff `ae6d290` (#1), `ac9485b` (#2, #4, #6, #8, #9), `a90286a` (TECH-DEBT #196–199 cho #3, #7, #10, #11; #5 giữ theo PD-R19) + mục lỗi vòng 1.
**Bảo mật / cách ly tenant: SAFE** — không có đường đọc/ghi chéo tenant mới.

### Lệnh đã chạy
- `bun --env-file=.env.local --config=bunfig.int.toml test … adapters/notify/review-tasks.lock-order.int.test.ts` → 1 pass · 0 fail (1.64 s).
- `bun run check:fn` → đỏ 7 vi phạm, **không file nào thuộc 3 commit sửa** (`runs/launcher-step.ts:34`, `runs/launcher.ts:207`,
  `contracts/.../process-steps-pd1.test.ts:38`, `db/src/hub-pd1.int.test.ts:91,173`, `tools/scripts/src/test-int-par{,.test}.ts`) ⇒ có từ trước, ngoài phạm vi vòng 2.
- Perf: không chạy lại; dùng số đo máy yên của tác giả — PD-P13 p95 35 → 46 ms (≤ 50, còn 4 ms biên), 10.000 task 4,2 → 5,1 s (trong NFR).

### Đối chiếu lỗi vòng 1
| # | Trạng thái | Ghi chú |
|---|---|---|
| 1 | **Đã sửa** | Xem "Lập luận deadlock" dưới. |
| 2 | Đã sửa | Comment `timer-sweep.ts:1-5` đúng thực tế (khoá nhả trước khi bắn; đúng nhờ kiểm lại trong `fireTimer`). |
| 3, 7, 10, 11 | Ghi nợ | TECH-DEBT #196, #197, #198, #199 — đủ vị trí và cách xử lý. |
| 4 | Đã sửa (còn Minor R2-2, R2-3) | `postponeFailed` lùi `due_at` ⇒ hẹn lỗi rời đầu `limit 100`. |
| 5 | Giữ theo quyết định | `spec-decisions.md` ghi "Review T12 #5" khớp PD-R19 (đuổi kịp, trần 10). Chấp nhận. |
| 6 | Đã sửa | `tenant-tz.repo.ts` `isValidTimeZone` ⇒ mặc định + warn chỉ `tenantId`; unit test 3 ca. |
| 8 | Đã sửa | `tz-format` dời `apps/admin-web/src/lib/`; test dời theo. |
| 9 | Đã sửa | `lockById` trả `timezone` cùng câu `FOR UPDATE`; bỏ `timezoneOf`. |

### Lập luận deadlock (#1) — đạt
Lô nhắc/chuyển cấp không có câu nào CHỜ khoá:
- `c0` khoá task `FOR UPDATE SKIP LOCKED`; `r` khoá run `FOR KEY SHARE SKIP LOCKED` (`review-tasks.repo.ts:61-76`, `169-182`). FOR KEY SHARE xung đột với `lockRun` FOR UPDATE ⇒ bỏ qua, không chờ. Với FOR NO KEY UPDATE (update thường) thì tương thích ⇒ cũng không chờ.
- Các câu sau chỉ chạm hàng đã giữ:
  - FK `process_notices_run_fk` → run đã có KEY SHARE của chính tx;
  - `process_notices_task_fk` và `review_task_assignees_task_fk` → task đã FOR UPDATE;
  - `markRemindedMany` / `u` update chỉ hàng trong `c` (không đổi cột khoá ⇒ không kiểm FK);
  - `hub.audit_log` không có FK; `admin.users` / `admin.groups` / `stage_runs` chỉ đọc không khoá.
- Phía duyệt (`lockRun` → `closeTask`) hoặc `claimExpired` có thể chờ task tối đa một lô, nhưng lô không chờ ai ⇒ không có chu trình.
- **Tenant:** `r` lọc `id = any(…) and tenant_id = any(…)`. Tích chéo chỉ là tập trên, vì `id` duy nhất. `c` join lại theo cặp `(id, tenant_id)` ⇒ đúng.
- **Test:** `review-tasks.lock-order.int.test.ts` đặt `lock_timeout = 200ms` ⇒ nếu B chờ khoá thì ném 55P03. Test chứng minh "bỏ qua, không chờ" cho cả claim và câu chèn notice (FK run R2), rồi lô kế nhận T. Hợp lệ.
- **Drain:** `claimed` = `count(c0)` gồm task bị bỏ; `more` = còn hàng tới hạn ngoài `c` (gồm task bị bỏ). Dừng khi lô < limit, hoặc theo ngân sách `DRAIN_BUDGET_MS = 60_000` (`remind-tasks.usecase.ts:13,25`) ⇒ không lặp vô hạn (xem R2-1).

### Lỗi còn lại (chỉ Minor)
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| R2-1 | Minor | 5 Hiệu năng | `remind-tasks.usecase.ts:21-26,43`; `escalate-task.usecase.ts:19-22`; `review-tasks.repo.ts:86-87,197-198` | Khi ≥ 100 task đầu hàng (`order by remind_at, id`) đều thuộc run đang bị giữ: mỗi lô khoá lại đúng 100 task đó và bỏ hết. Khi đó `claimed = 100`, `more = true` ⇒ lặp tx liên tục (không tiến) tới khi run nhả hoặc hết 60 s. Task phía sau cũng đói trong lượt đó. Không vô hạn. Chỉ xảy ra nếu một run có ≥ 100 task tới hạn và bị giữ lâu. **Cần xác minh**: có tx nào giữ `lockRun` lâu (qua lời gọi AI/mạng) không — `grep -n "lockRun\|lock(runId" apps/hub-api/src/modules/processes/runs/*.ts` rồi xem tx có `await` mạng bên trong. | Nếu lô trả 0 task mà `claimed ≥ limit` thì dừng lượt (`more = false`), để lượt 300 s sau thử lại; kèm unit test. | backend |
| R2-2 | Minor | 2 Nghiệp vụ | `domain/timers/timer.rules.ts:31-37`; `adapters/timers/timer-sweep.ts:44-59` | Comment ghi "tự nhân đôi" nhưng sai. Sau lần lùi đầu, `due_at` mới ≈ lúc bắn lại ⇒ `late` ≈ chu kỳ quét (vài giây) ⇒ trễ luôn kẹp 1 phút (không tăng dần). Đúng chức năng (hẹn lỗi rời đầu hàng), nhưng mô tả sai. Ngoài ra, `postponeFailed` (đọc + update, tx riêng) chỉ có unit test luật lớp 1, không có int test (Luật 4b). | Sửa comment (backoff cố định 1 phút), hoặc thêm cột đếm lần nếu muốn tăng dần; thêm int test tái hiện #4 vòng 1 (100 hẹn lỗi + 1 hẹn hợp lệ ⇒ hẹn hợp lệ bắn ở lượt kế). | backend |
| R2-3 | Minor | 2 Nghiệp vụ | `timer-sweep.ts:53` ↔ `adapters/timers/stage-timer.repo.ts:89` | Lùi `due_at` ghi đè mốc gốc. Hẹn `wait_until` lỗi một lần rồi bắn được sẽ in `waitedText(dueAt)` theo giờ đã lùi, không phải giờ người dùng cấu hình. **Cần xác minh**: cho `finishWait` ném một lần với hẹn `wait_until`, rồi bắn lại ⇒ so văn bản output với `due_at` gốc. | Thêm cột `next_try_at` (hoặc lùi bằng cột riêng) để giữ `due_at` gốc; hoặc chấp nhận và ghi vào spec-decisions. | backend |
| R2-4 | Minor | 6 Test | `review-tasks.lock-order.int.test.ts:63-90` | Lô B trong test không gọi `markRemindedMany` / `addEscalatedGroups` / `auditEscalations` dưới `lock_timeout`. Lập luận đọc code cho thấy các câu này chỉ chạm hàng đã giữ, nhưng test chưa phủ. | Gọi thêm 3 câu đó trong `batchB` (hoặc gọi thẳng `remindBatch` qua `systemBatch` có `lock_timeout`). | qc |

### Rubric (vòng 2)
1 ✓ · 2 ✓ (#1 đã sửa; R2-1..3 Minor) · 3 ✓ SAFE · 4 ✓ · 5 ✓ (PD-P13 46 ms ≤ 50, 10k 5,1 s; R2-1 Minor) · 6 ✓ (lock-order 1/0; R2-4 Minor) · 7 ✓ (check:fn đỏ có từ trước, không thuộc file sửa) · 8 ✓ (#8) · 9 ✓ (HUB-FR-145/144 trong commit và test)

## Security P-d2 (T20, plan-d2 §10) · Kết luận: SAFE (0 Blocker, 1 Major, 2 Minor)
Phạm vi: `git diff 8300aa1..HEAD` phần stage `tool`, công tắc tool (admin 0012, hub 0037, contract), rẽ nhánh, FE tab tool. Không xét POST Đạt/join. Lệnh: `bun test uow-boundary.test.ts + processes/{application,adapters}/tools + domain` → 36 pass/0 fail. Int/e2e không chạy (đối chiếu test có sẵn).

| # | Kết quả | Bằng chứng |
|---|---|---|
| S1 | Đạt | `mcp-tool-invoker.ts:67-75` (userId = `started_by`, agentId null); `workflow-invoker.ts:151-154` `difyUser(tenantKeyOf(catalog, ctx.tenantId), ctx.userId)` |
| S2 | Đạt | lưu: `teams.repo.ts` `toolRefs` → `tool-switch.repo.ts:32-37`; trước gọi: `tool-stage.repo.ts:79-81` (`w.enabled`, `t.tenant_id = r.tenant_id`, `revoked_at is null`) → `run-tool-stage.usecase.ts:44-49,127-128` (tắt ⇒ `tool_failed`, invoker không gọi) |
| S3 | Đạt | `base_url`/`app_type` lấy từ `admin.workflows` cùng câu (`tool-stage.repo.ts:69-70`), `app_type` ngoài {workflow,chat,agent} ⇒ NOT_CONFIGURED (`mcp-tool-invoker.ts:41-43`); không URL từ def/người dùng |
| S4 | Không (một phần) | lưu def đạt `tool-def.rules.ts:96`; không gọi lại khi đã gửi `tool-run.rules.ts:87`; `template_invalid` ⇒ decide `run-tool-stage.usecase.ts:64-68`. **Thiếu** kiểm lại lúc gọi — xem Major M1 |
| S5 | Đạt | audit chỉ id/mã/ms `tool-stage.repo.ts:208-221`; trace bước `maskInputs(args, apiKey)` như `/mcp` `workflow-invoker.ts:125`; log chỉ `safeErrorFields` `tool-driver.ts:46` |
| S6 | Đạt | `defs.routes.ts:50` tenant_admin luôn tenant mình; `list-tools.usecase.ts` mẫu ⇒ `[]`; câu lọc `t.tenant_id` `tool-switch.repo.ts:35` |
| S7 | Đạt | `workflow-tools.routes.ts:28-29` `requireRole("platform_admin")`; RLS `0012_pd2_tenant_workflow_tools.sql` policy `admin_rw` theo `app.tenant_id`; int PD2-I46 `tests/acceptance/P-d/admin/workflow-tools.int.test.ts:157` |
| S8 | Đạt | `/mcp` vẫn qua cổng `mcp.service.ts:174-177`; stage tool trace `gate_review` `mcp-tool-invoker.ts:77` |
| S9 | Đạt | mọi câu Hub đọc công tắc có `tenant_id` tường minh: `tool-stage.repo.ts:81`, `tool-switch.repo.ts:35`; int PD2-I23 `tests/acceptance/P-d/d2/tool-switch.int.test.ts:122` (chưa chạy ở review này) |
| S10 | Đạt | `can_run` + `usable` cùng câu ngay trước gọi `tool-stage.repo.ts:71-73`, thứ tự `run-tool-stage.usecase.ts:44-49` |
| S11 | Đạt | `processes.mount.ts:130-143` (`systemOnly(uow)` trong closure), launcher chỉ nhận factory; `uow-boundary.test.ts` xanh |
| S12 | Đạt | `run-tool-stage.usecase.ts:60` `utf8Bytes > 65_536` trước `JSON.parse` (dòng 63); đếm không cấp phát `tool-output.rules.ts:15-27` |

Khác đã kiểm: SQL tham số hoá/văn bản cố định (`tool-switch.repo.ts:30` mảng qua tham số bind; `step.repo.ts:56-63` tham số); `branch.repo.ts` mọi câu lọc `tenant_id`; FE tab tool không `dangerouslySetInnerHTML`.

| # | Mức | file:dòng | Vấn đề | Đề xuất |
|---|---|---|---|---|
| M1 | Major | `run-tool-stage.usecase.ts:44-49`, `tool-stage.repo.ts:61-74` | `side_effect` chỉ kiểm lúc lưu def. Admin bật `side_effect` cho workflow SAU khi def đã lưu ⇒ stage không `real_action` vẫn gọi tool có tác dụng phụ mà không qua gate (lệch PD2-R04/S4) | `loadCall` lấy thêm `(st->>'real_action')::boolean`; `preCallReason`: `sideEffect && !realAction ⇒ tool_failed`; thêm 1 unit + 1 int · **ĐÃ SỬA 2026-10-18** (PD2-U30, PD2-I53 xanh) |
| m1 | Minor | `mcp-tool-invoker.ts:41-56`, `tool-stage.repo.ts:79` | (b) tool có `input_schema` hỏng: catalog `/mcp` bỏ (`catalog.rules.ts:104-107`) nhưng stage tool vẫn chạy được | lọc `jsonb_typeof(w.input_schema) = 'array'` trong `loadCall` (hoặc parse `InputSchemaSchema` ở `toLoad`) ⇒ `tool_failed` · **ĐÃ SỬA 2026-10-18** (parse ở `toLoad`; PD2-I54 xanh) |
| m2 | Minor | `launcher.ts:114` | thiếu `toolDriver` ⇒ rơi về `stageDriver` cho stage `tool` (mount hiện luôn cấp, không khai thác được) | thiếu driver ⇒ `decide(tool_failed)` thay vì fallback · **ĐÃ SỬA 2026-10-18** (`runs/driver-choice.ts` + unit) |

**3 điểm gate (`P-d2-gate.md`):**
- (a) Bỏ tx read-only repeatable-read ở `editorContext` (`defs.service.ts:114`): **an toàn**. Hai câu (múi giờ, tools) độc lập, chỉ SELECT, cả hai lọc tenant tường minh; lệch snapshot tối đa là thấy công tắc vừa đổi ở một lần tải — lưu def vẫn kiểm lại công tắc (`loadDefRefs`), chạy kiểm lại lần nữa. Không sai dữ liệu, không lộ.
- (b) Đọc thẳng `admin.workflows`: workflow **disabled/công tắc tắt KHÔNG chạy được** (`tool-stage.repo.ts:69,79-81` ⇒ `tool_failed`); `app_type` lạ ⇒ NOT_CONFIGURED. Schema hỏng **vẫn chạy được** (m1) — không phải lỗ cách ly/secret (đích, key, danh tính không đổi), nên chặn cho nhất quán với `/mcp`.
- (c) Bỏ khoá advisory `run_steps` khi `ownRun` (`workflow-invoker.ts:249`, `run-steps.ts:49-59`): **an toàn**. Hub run của stage tool chỉ driver ghi bước (không Orchestrator; thử lại tạo hub run mới qua launch); đua bất thường vẫn đúng nhờ unique `run_steps_run_seq_uq` + thử lại savepoint (READ COMMITTED thấy `max(seq)` mới), tối đa 3 lần rồi lỗi rõ. `/mcp` giữ khoá (`ownRun` vắng).
