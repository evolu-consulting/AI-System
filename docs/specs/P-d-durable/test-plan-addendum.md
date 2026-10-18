# Test plan · P-d · phụ lục bổ sung (readiness lần 2 · qc) — của [test-plan.md](test-plan.md) §6

`test-plan.md` sát trần 30 720 B nên phần thêm nằm ở đây.

## 1. Test khoá phải SỬA — K30
| # | File:dòng | Lý do | Sửa thành | Khi |
|---|---|---|---|---|
| K30 | `P-a/step0/rules/run-access.test.ts` | T8s dời `core/run-access.rules.ts` ⇒ `domain/runs/run-access.rules.ts` (plan-domain §7); file mới import contract ⇒ khai lại hằng trong domain (ADR-0023, CA-R03) | nạp bằng `loadDomain("runs/run-access.rules.ts")` (hoặc `loadAnyOf` nếu T8s/T8q lệch pha); ca cũ giữ nguyên ý định và dữ liệu; hằng khai lại được đối chiếu hằng contract ở `rules/domain-contract.test.ts` (PD-C10) | T8q (cùng task dời, relock) |
Kiểm ở bước 8 của test-plan §8: `bun test tests/acceptance/P-a/step0/rules/run-access.test.ts` xanh trước và sau T8s; `bun run test:lock:verify` sau relock. spec-ac §2 trỏ test-plan §6 (K01–K30).

K30 khớp T8s: docs-architect chốt `run-access.rules.ts` dời **toàn file** ở T8s (plan-addendum A6, 67 dòng) ⇒ K30 sửa ở T8q cùng task dời (không phải T9q).

## 1b. Rà A6 — đường dẫn test khoá (kết quả grep `tests/acceptance`, 2026-10-17)
Không thêm K31: mọi test khoá bị A6 chạm đã có K19–K26, K30. Đối chiếu:
| Test khoá | Nạp hiện tại | Sau A6 | Số K |
|---|---|---|---|
| `P-c/rules/autofix-rules.test.ts:21` (dùng ở `:109`, `decisionOptionsFor`) | `loadProcRules("core/task.rules.ts")` | `domain/tasks/decision.rules.ts` (T8s) | K21 (giữ) |
| `P-c2/rules/_rules2.ts:25` (`loadCoreTask`, chỉ dùng ở `apply-rules.test.ts:259` `decisionOptionsFor`) | ″ | ″ | K22 (giữ) |
| `P-a/step0/rules/task.test.ts:43` (`loadCoreRules("task")`, một hàm nạp cho cả file) | `core/task.rules.ts` | tách 3 nơi: `canAct` ⇒ `domain/tasks/task-access.rules.ts`, `decisionAssignees` ⇒ `domain/tasks/decision.rules.ts`, `askExcerpt` ⇒ `core/task.rules.ts` (giữ, Luật 4) | K20 (giữ) |
| `P-a/step0/rules/run-access.test.ts:21` | `loadCoreRules("run-access")` | `domain/runs/run-access.rules.ts` | K30 |
| autofix `runs/autofix.rules.ts` (PC-R10, PD-U92, `loadAutofix`) | không dời, không sửa (A6) | **không đổi** | — |
Ghi chú: `_rules2.ts:25` chỉ đổi đích loader; `loadAutofix` ở dòng 23 không đổi. Parity `isAutofixReason` (domain ↔ `runs/autofix.rules`) do backend-lead (mapper test A6), qc chỉ rà tồn tại ở PD-C12.

## 2. Ca thêm ở phụ lục khác
- PD-C13 (mới, contract/mapper, lớp 3): `P/adapters/defs/def-rules-parity.test.ts` — backend-lead viết cạnh code (plan-addendum A2), qc **rà** như PD-C12: bộ def mẫu ≥ 1 ca mỗi hàng bảng path A2 (`WAIT_INVALID` ×4 path, `TOOL_INVALID` ×2 path, `TOOL_SIDE_EFFECT`, `BRANCH_INVALID` ×5 path) chạy qua hàm contract (snake_case) và hàm domain (sau mapper): hàng `TOOL`/`BRANCH` qua `toolStageIssues`/`branchStageIssues`; hàng `WAIT` (×4 path) qua `processDefStageIssues(stages,{inputs})` so với domain `waitStageIssues` (không qua tool/branch) ⇒ `toEqual` (path + rule, thứ tự `i` tăng). Kiểm tồn tại + xanh ở VERIFY; không thuộc lock qc.
- qc không viết trùng parity ở `tests/acceptance`; hai nơi được test độc lập: contract hàm FE ở PD-C14 (`rules/contracts-pd1`: gọi `toolStageIssues`/`branchStageIssues` với 1 ca hợp lệ ⇒ `[]` và 1 ca/hàng path A2 ⇒ path đúng) và PD-C15 (`rules/contracts-pd1`, hàng WAIT: `processDefStageIssues(stages,{inputs})` 1 ca/path: `stages.<i>.after` ⇒ `WAIT_INVALID`; `stages.<i>.executor.from`; `stages.<i>.executor.offset_days`; `stages.<i>.executor.time`, mỗi ca đúng path + rule; 1 ca hợp lệ ⇒ `[]`); domain ở PD-U59…U61b, PD2-U01…U03, PD2-U10/U11.
- Q4/Q6/Q9/Q10/Q-D2-1/Q-D2-2 đã trả lời (plan-addendum A7): PD-I75…I77 (`publish` giả), PD-U04b, PD-I01/I02/I60, PD2-U09, PD2-I06/I06b.
- `teamResumePlan`: PD-U93…U98 trong [test-plan-rules](test-plan-rules.md) (đầu vào có `cursor`; theo A5; đã đếm vào test-plan §9).
- PD-I47 (`ESCALATE_INVALID` 422 chỉ khi trùng Group duyệt; `escalate` ở stage `auto` và `after_h` sai qua API ⇒ 400 `VALIDATION_ERROR`): [test-plan-int](test-plan-int.md).
- e2e: [test-plan-e2e](test-plan-e2e.md) viết lại theo `plan-frontend.md` §7, `plan-frontend-d2.md` §13, `plan-frontend-i18n.md`.

## 2. Hiệu năng vòng nền + nhắc nhiều Hub (CR-093, A9, A10, #190)
| # | Test | Loại | Đạt khi |
|---|---|---|---|
| PD-P10 | nhắc 2 Hub song song, 250 task tới hạn | int | đúng 250 lượt nhắc, notice = 250 × người nhận (không trùng — #190) |
| PD-P11 | một lượt vòng nhắc với 250 task tới hạn | int | một lượt nhắc đủ 250 (xả nhiều lô — A9) |
| PD-P12 | hết hạn 250 run (đồng hồ giả +ttl) | int | 250 `expired`, task `closed/expired`, mỗi run đúng một sự kiện `run_end`; không gọi `postThread` trong vòng: `run_end.posted_at` còn NULL (`processLoops:false`, không có seam stub — TC17) |
| PD-P13 | lô nhắc 100 | perf (lệnh perf P-d) | p95 ≤ 50 ms đo **cả lời gọi** `remindOnce` (gồm phát Redis) qua 20 lần; 10.000 task ≤ 6 s = tổng lời gọi liên tiếp tới khi trả 0 (A10, #82) |
| PD-P14 | lô hết hạn 100 | perf | p95 ≤ 50 ms đo **cả lời gọi** `sweepOnce` (gồm Redis + các phần quét khác) qua 20 lần; 20.000 run ≤ 12 s = tổng lời gọi liên tiếp tới khi trả 0 |
| PD-P15 | đếm truy vấn mỗi lô | int | nhắc ≤ 6 câu SQL/lô, hết hạn ≤ 6 câu/lô, không phụ thuộc số hàng; đo lô 10 và 99 (lô 100 kéo thêm lô rỗng sau A9), hết hạn tính phần chênh so với lượt rỗng (TC18); không tính `set_config` (TC16, ngân sách A10) |
Đồng hồ giả (`d.now`), không chờ thời gian thật. Bài 10.000 chỉ trong lệnh perf (`PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test tests/acceptance/P-d/perf/`, #83), không trong `test:int`.
## 3. Kết quả T3 + T3a (qc, 2026-10-18) — "đỏ đúng lý do" trước code (thay test-plan §11)
**T3a:** `P-a/_support/modules.ts` `tryLoad` nghiêm (file vắng ⇒ Proxy ném `module vắng: <rel>`; file có mà lỗi ⇒ ném lại kèm `cause`) + `loadAnyOf` (K29); `P-a/pf1/rules/gate.test.ts` dùng `loadAnyOf` (K27); helper mới `P-d/_support/modules.ts` (`loadDomain/loadUsecase/loadAdapter`), tự kiểm `P-d/rules/_support.test.ts` (6 xanh). Bộ unit `tests/acceptance` không đổi (1461 pass / 9 fail sẵn #191). Test khoá trỏ file dời: như test-plan §7 + **K30** (T8s, `run-access`); T18s/T19s 0 test nạp. Lưu ý thêm: `packages/db/src/hub-rls.int.test.ts` (không thuộc lock) liệt kê bảng RLS ⇒ backend-lead thêm `process_timers` ở T6.
**T3** (`bun test` + `bun run test:int` trên DB riêng qc1…qc4): 420 ca (unit 321 · int 99) + perf 7; **8 xanh** (6 tự kiểm helper, ô đếm lưới PD-U01, PD-C15 "hợp lệ ⇒ []" — giữ luật sau code), còn lại đỏ đúng lý do; 0 lỗi cú pháp/`TypeError`/`PostgresError` ở fixture.
| Nhóm | File | Đỏ ở |
|---|---|---|
| Luật lớp 1 PD-U01…U98 | `rules/{job-error,retry,run-state,step-status,active-cap,start-inputs,timer-key,timer,team-retry,due-at,wait-def,escalate-def,ttl,remind,escalate,forward,decision}` | `module vắng: P/domain/…` |
| Contract PD-C01…C08, C15 + ESCALATE contract | `rules/contracts-pd1`, `rules/contracts-pd1-issues`, `admin/timezone-rules` | expect (export/trường mới vắng) |
| Domain↔contract, kiến trúc PD-C10/C11, A01…A03 | `rules/domain-contract`, `arch/layers` | `module vắng` / `expect({domain: exists})` |
| Int PD-I01…I54, I60…I87 | `d1/{retry,team-retry,wait,wait-restart,wait-def,cap,cancel-timers,race,remind,remind-escalate,ttl,isolation,editor-context,db,uow}`, `admin/timezone` | `needPdSchema` (0036/0011 vắng) |
| CR-093 PD-P10, P11, P12, P15 (int, cột cũ ⇒ `needSchema`) | `d1/{remind-load,expire-load,batch-queries}` | **lỗi thật hiện tại**: P11 một lượt chỉ 100/250 (A9); P10 2 Hub nhắc trùng 500 cặp (#190); P12 vòng hết hạn tự đăng 250 `run_end`; P15 nhắc 53/496 câu (lô 10/99), hết hạn 144/1390 câu |
| Perf PD-P01…P03, P13, P14 (`test:perf`) | `perf/{timers,remind,background}` | P01–P03 `needPdSchema`; P13 p95 441 ms, 10k sau 24,9 s chỉ 3.000; P14 p95 1.676 ms, 20k sau 48,5 s chỉ 2.700 |
Quy ước đo (CR-093): PD-P12 kiểm "không postThread trong vòng" bằng `run_end.posted_at` còn NULL (`processLoops:false`, không có seam stub); PD-P15 đếm qua `debug` của pool postgres.js Hub (`d1/_count.ts`), không tính BEGIN/COMMIT/SAVEPOINT, `set_config('app.scope')`, `pg_type`; hết hạn tính phần chênh so với lượt rỗng; lô 10 và 99 (lô đúng 100 kéo thêm lô rỗng sau A9). Perf: lô = một lời gọi với đúng 100 hàng tới hạn, 20 lô; tải lớn dừng ở trần 4× ngân sách.
**Tranh chấp / cần backend-lead chốt** (test đang theo mặc định ghi bên phải): (1) PD-I28 hậu tố khoá `:2` (test-plan-int) ↔ A7 Q9 (`n` đếm hẹn cùng kind) ⇒ test khẳng định `:1`; (2) def `pd-wait-field` cần `ttl_days:30` (ttl 7 ⇒ hạn 2026-11-17 quá `expires_at` ⇒ `timer_invalid`) — test-plan §2 thiếu; (3) PD-I42 audit không có cột `details` ⇒ chấp nhận `summary`/`after`, actor NULL; (4) PD-I39b plan §6 cho hai thứ tự ⇒ khẳng định "huỷ XOR bắn"; (5) PD-I39d/PD-P01 250/1.000 job một user — nếu launcher áp trần `maxConcurrentRuns` theo user sẽ thiếu job; (6) PD-I05 hai decision mở cùng run; (7) PD-I09 `permission_lost` không kiểm `retry_count`; (8) PD-U34 input `date` required vắng ⇒ `[]` (hành vi cũ IN-03), PD-U35 suy hành vi cũ từ contract; (9) `FORCE_USE_CURRENT`/`AUTOFIX_REASONS` Set hay mảng (test nhận cả hai); (10) A8 viết `escalateIssues` ↔ plan-domain `escalateStageIssues` (test theo plan-domain); (11) `processDefStageIssues` vắng `ctx`: test chỉ bỏ kiểm nguồn input, nguồn field vẫn kiểm; (12) `ProcessEditorContextSchema` nạp từ `@ai/contracts/hub-admin`; (13) UoW repo: `runs.lock`, `timers.lockById` trả null, `timers.markFired(id, now)`, `cancelForRun(runId,"all",now)`; (14) PD-P03 test-plan §9 "≤ 100/lượt" lỗi thời sau A9 ⇒ chỉ log; (15) PD-A01 gọi depcruise qua bin (`tools/scripts/src/depcruise.ts`), không qua API `cruise`; (16) PD-P15 có tính `set_config` hay không (A10 chưa nói) ⇒ không tính.

**Mặc định đã áp (readiness lần 5, Luật 2b, 2026-10-18)** — test hiện tại đã theo đúng, không sửa `tests/**`:
- TC1: PD-I28 khoá hậu tố `:1` (PD-R10) — đã sửa test-plan-int §3.
- TC2: `pd-wait-field` có `ttl_days: 30` — đã ghi fixture ở test-plan-int §3.
- TC3: PD-I42 audit `summary {from_group,to_group}`, `actor_id` NULL — test-plan-int §4, plan-addendum A11.
- TC4: PD-I39b "huỷ XOR bắn" — test-plan-int §3, plan-addendum A11 (hàng thêm cho plan §6).
- TC5: PD-I39d/PD-P01 không trần job theo user (`maxConcurrentRuns` vắng ⇒ không trần, `app.ts:109`); `startPd` không đặt.
- TC6: PD-I05 cho phép hai decision mở cùng run, `view.decision` = cũ nhất (P-b2 PI-14, K05).
- TC7: PD-I09 `permission_lost` không kiểm `retry_count` — test-plan-int §1.
- TC8: PD-U34 `date` required vắng ⇒ `[]` (`start-inputs.ts` `shapeValid` chỉ kiểm giá trị gửi lên); PD-U35 theo hành vi cũ.
- TC9: `FORCE_USE_CURRENT`/`AUTOFIX_REASONS` là `ReadonlySet` (`core/task.rules.ts:51`).
- TC10: tên `escalateStageIssues` (= #74, đã sửa A8).
- TC11: `processDefStageIssues` vắng `ctx` ⇒ bỏ kiểm nguồn input, vẫn kiểm nguồn field (plan-contract:79) — không phải tranh chấp.
- TC12: `ProcessEditorContextSchema` từ `@ai/contracts/hub-admin` (`hub-admin/processes.ts`) — plan-addendum A11.
- TC13: repo UoW `runs.lock(runId)`, `timers.lockById(id)` ⇒ `null`, `timers.markFired(id, now)`, `timers.cancelForRun(runId, "all", now)` — plan-addendum A11.
- TC14: PD-P03 chỉ log ms/lượt (A9: một lượt xả nhiều lô) — test-plan-int §9.
- TC15: PD-A01 gọi `tools/scripts/src/depcruise.ts` (= `bun run depcruise`).
- TC16: PD-P15 không tính `set_config` — ngân sách 6 câu ghi ở plan-addendum A10.
- TC17: PD-P12 đo bằng `run_end.posted_at` NULL — §2; test khoá `P-a/pf1/thread.int:490` gọi `postThread` tường minh nên vẫn xanh.
- TC18: PD-P15 đo lô 10/99, hết hạn tính chênh so với lượt rỗng — §2.

## 4. Tranh chấp test trong BUILD (spec §10 trỏ về đây — spec.md sát trần)

- 2026-10-18 (backend-lead, T5) · `tests/acceptance/P-d/rules/contracts-pd1-issues.test.ts:55` (PD-C15 "vắng ctx ⇒ bỏ kiểm nguồn input"): `issuesOf(stages, rule, ctx: unknown = { inputs: DRAFT_INPUTS })` — gọi `issuesOf(..., undefined)` thì JS dùng **giá trị mặc định**, nên hàm nhận `{inputs: DRAFT_INPUTS}` y hệt ca dòng 36 (cùng đầu vào, kỳ vọng `[from]`) mà lại kỳ vọng `[]` ⇒ không code nào xanh cả hai. Đề xuất qc: gọi thẳng `fn(ha, "processDefStageIssues")([inp("khong-co")])` (không đối số thứ 2) hoặc cho `issuesOf` nhận `ctx` qua cờ riêng. Contract đã làm đúng plan-contract §3 (vắng `ctx` ⇒ bỏ kiểm nguồn input — có unit test `process-steps-pd1.test.ts`).
- 2026-10-18 (qc, xử lý) · PD-C15 dòng 55: test SAI, contract ĐÚNG. Đã sửa: gọi thẳng `processDefStageIssues(stages)` không đối số thứ 2 (`noCtx`) — vắng ctx ⇒ bỏ kiểm nguồn input (`[]`) nhưng vẫn giữ kiểm nguồn field (thêm `sameStep` ⇒ `stages.1.executor.from`). Ngoài ra qc sửa K13/K14 (`contracts-pa` R-K01), K16/K17/K18 (`contracts-pc2` C06/C07/C12) theo test-plan §6 (so tiền tố).
- 2026-10-18 (backend-lead, T6a) · Test khoá đếm cứng số migration admin `main: 11` — sau `0011_pd1_tenant_timezone.sql` (plan-db §2) đúng là **12**: `M1/db-schema.int.test.ts:69-70, 284-287` (đã thấy đỏ), `M2/db-schema.int.test.ts:143-144, 462-465`, `M3/db-schema.int.test.ts:100-101` (+ chữ "11 hàng __drizzle_migrations"), `:439-441`, `ADM-NFR-06/migrate.int.test.ts:53, 153, 173`, `H1/db.int.test.ts:123-128`. Test SAI (lỗi thời), code ĐÚNG. Đề xuất qc: đổi 11 → 12 (hoặc đếm theo `migrations/meta/_journal.json`). Test không khoá `packages/db/src/migrate*.int.test.ts` backend-lead đã đổi cùng T6a.
- 2026-10-18 (qc, xử lý) · Tranh chấp T6a (main 11 → 12): test SAI, code ĐÚNG — đã giải quyết. 5 file đếm số migration main theo entry của `migrations/meta/_journal.json` (M1/M2/M3 `db-schema`, `ADM-NFR-06/migrate`, `H1/db`; dev vẫn 3), nên migration sau không phải sửa lại.
- 2026-10-18 (qc, Luật 4c "không chờ hết giờ") · Test đỏ-trước-code fail nhanh: helper P-d (`_support/pd.ts`) không còn `waitFor` theo giờ — chỉ lặp 10 ms ở bước bất đồng bộ thật và ném lỗi ngay khi thấy trạng thái cuối sai hoặc thiếu tính năng (`chưa có tính năng: … (T8/T9)`); `noStageJob` đo một lần sau lời gọi đã `await`; ca sau `sweepOnce`/API đã `await` dùng `waitStageStatus(…, 0)` (đo một lần). **Backend cần cung cấp tín hiệu** (chưa có, test đang lặp 10 ms): (1) Hub tiêu thụ xong sự kiện job do Runtime giả XADD (`jobDone`/`rt.fail`/`interruptJob` → stage đổi trạng thái) — đề xuất `handles.settled()` trả promise khi stream đã xử lý hết; (2) ca "sự kiện lỗi muộn không tạo hẹn thứ hai" (PD-I39c) cần cùng tín hiệu để khẳng định vắng mặt mà không chờ cửa sổ 300 ms; (3) PD-I39d chờ `jobs >= 250` (≤ 30 s lưới an toàn) cần `sweepOnce` trả sau khi job đã tạo.