# Readiness · P-d-durable

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng.

Điều kiện Gate đã biết trước: ADR-0017 **Accepted** (còn thiếu Redis thật + tải 10.000 run trên staging); mockup/artboard panel stage + nhãn chat (D13); security review cho chuyển cấp và vòng hẹn giờ; mốc dọn-seed (CR-081) đã đóng.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-18 | NOT READY (lần 5) | 0 | 2 | 34 | Diff 75ec598..3efb39f (ADR-0017 Accepted, CR-081 đóng, mockup duyệt, A9/A10, test-plan-addendum §2–§3, test T3/T3a). Cao: #81 A10 một tx hệ thống/lô nhiều tenant ↔ spec-ca CA-R06/K1 (UoW theo tenant, mỗi hàng); #82 NFR "đo riêng phần DB" ↔ PD-P13/P14 đo cả lời gọi. 18 tranh chấp qc đều Thấp, có mặc định. Không hỏi người dùng (Luật 2b). Điều kiện Gate ngoài spec đã đủ (D0a–D0c). |
| 2026-10-17 | READY (lần 4) | 0 (+điều kiện Gate ADR-0017 — chờ staging) | 0 | 9 | Đóng #54–#70, #72; #55–#58 đã đóng. Còn Thấp: #71, #73, #74–#80 (sửa khi BUILD, T4 chạy lại readiness chỉ diff). Không hỏi người dùng. Gate P-d1 chờ điều kiện ngoài spec (ADR-0017 staging, mockup, security review T6c/T12/T20, CR-081). |
| 2026-10-17 | NOT READY (lần 3) | 0 (+1 điều kiện Gate ADR-0017 — chờ staging) | 4 | 19 | Đóng #33–#35, #37–#39, #41–#48, #50–#52; #40 sinh mâu thuẫn mới. Còn: plan-addendum chưa được trỏ từ tasks/plan (#55), escalate ở stage auto 422↔400 (#56), PD-U68↔plan-domain:119 (#57), path WAIT phía contract + PD-C13 (#58). Mọi mục (a) sửa theo mặc định (Luật 2b); không hỏi người dùng. |
| 2026-10-17 | NOT READY (lần 2) | 4 (1 là điều kiện Gate ADR-0017) | 10 | 8 | Đã có plan/plan-frontend/test-plan/mockup; đóng #1,#3,#6,#8–#12,#14,#15,#17,#19–#21,#24,#25,#27–#32. Còn: lệch spec↔plan (400/422, run_steps 'tool', vị trí step.rules/T18s, ngưỡng escalate, audit grant/revoke, quyết định plan chưa vào spec), ADR-0023 khi dời file import contract, e2e lệch nhãn FE, G1–G7, teamResumePlan, T10 rủi ro. Mọi mục (a) sửa theo mặc định (Luật 2b); hỏi người dùng 1 câu (ADR-0017). |
| 2026-10-17 | NOT READY (lần 1) | 6 | 13 | 6 (+7 Vừa) | Chưa có plan/plan-frontend/test-plan/mockup; phân loại lỗi (Q2), side_effect, team retry (Q1), quyền tool P-d2; khoá idempotency va chạm; thứ tự khoá timer↔run; FORCE RLS sai; thiếu nới CHECK audit/thread; ESCALATE_INVALID↔PROCESS_REF_INVALID; AC-H41 sai trần. Hỏi người dùng 4 câu. |

## Lần chạy

### Lần 5 · 2026-10-18 · NOT READY

Phạm vi: `git diff 75ec598..HEAD` (spec, spec-decisions, tasks, plan-addendum A9–A10, test-plan, test-plan-addendum §2–§3, ADR-0017, CHANGE-REQUESTS CR-081/CR-093) + `git show --stat 7e27b8c 3efb39f` (`tests/acceptance/P-d/**`); đối chiếu spec-ca:13 (CA-R06), :54 (`UnitOfWork`), plan:67 (repo port), plan §4.9/§5/§6/§7 K1/K3, plan-db:33–35/128–135, plan-contract:79/87, spec PD-R10, `packages/db/src/hub-scope.ts`, `schema/hub.ts:361` (`hub.audit_log`), `migrations-hub/0019:391`, `notify/reminder.ts`, `core/task.rules.ts:51`, `runs/start-inputs.ts` `shapeValid`, `package.json` `test:perf`, test `d1/{batch-queries,_count,remind-load}`, `perf/background`, `P-a/pf1/thread.int.test.ts:485`. Trần: spec 25462/25600 · plan 30708/30720 · test-plan 30431/30720 (đạt, sát — sửa vào phụ lục/spec-ca, không vào spec/plan).

Đóng điều kiện Gate: D0a (ADR-0017 Accepted, điều kiện #190 ⇒ T9, có PD-P10), D0b (CR-081 Xong), D0c (mockup 01–04 duyệt).

#### Cao (sửa trước T6b — `UnitOfWork` thiết kế ở T6b, security review T6c)
| # | Vấn đề | Mặc định (theo CR-093 người dùng chốt, mới hơn spec-ca) |
|---|---|---|
| 81 | A10 "một tx mỗi lô" scope system nhiều tenant ↔ spec-ca CA-R06 ("mỗi hàng … `UnitOfWork.system(tenantId)`"), spec-ca:54 + plan K1 ("repo luôn nhận `tenantId` từ UoW"), plan:67 port từng hàng (`dueReminders`, `markReminded`), plan §4.9/§5 vòng từng hàng, K3 "`tenant_id = $t`"; A10 `runsFinished(tx, ids)` truyền `Tx` (trái K1). Chia theo tenant thì PD-P15 ≤ 6 câu không đạt (thêm câu đọc ứng viên) | Thêm `UnitOfWork.systemBatch(fn)` (scope system, chỉ vòng nền theo tập); repo lô nhận/trả hàng mang `tenant_id`: `ReviewTaskRepo.{claimDueReminders(limit,now), markRemindedMany(rows), claimDueEscalations(limit,now)}`, `NoticeWriter.insertMany`, `RunRepo.claimExpired(limit,now)`, `Notifier.runsFinished(ids)` (không `Tx`). K3 viết lại cho lô: mọi join khớp `tenant_id` của hàng nguồn, insert lấy `tenant_id` từ hàng nguồn, khoá `FOR UPDATE SKIP LOCKED` theo `(id, tenant_id)`; test 2 tenant cùng lô (AC-H46). CA-R06 thêm ngoại lệ "vòng nền theo tập (CR-093)". T6c review cả `systemBatch` |
| 82 | A10 "p95 ≤ 50 ms … đo riêng phần DB, Redis ghi kèm" ↔ PD-P13/P14 đo **cả lời gọi** `remindOnce`/`sweepOnce` (gồm phát Redis, và phần hẹn giờ/quét orphan của `sweepOnce`); "20.000 run ≤ 12 s" là tổng các lời gọi liên tiếp (không tính nhịp 3 s) — A10 không nói | Theo test khoá (chặt hơn, qc sở hữu): đo cả lời gọi; 10.000/20.000 = tổng lời gọi liên tiếp tới khi trả 0. Sửa câu A10 |

#### Tranh chấp qc (test-plan-addendum §3) — đều Thấp, test đang theo đúng mặc định
| TC | Tranh chấp | Mặc định (nguồn) |
|---|---|---|
| 1 | PD-I28 hậu tố `:2` | `:1` — PD-R10 (`n` = số hẹn cùng kind + 1; ca (a) PD-I26 có 0 hẹn). Sửa test-plan-int:39 |
| 2 | def `pd-wait-field` cần `ttl_days:30` | `ttl_days:30` (ttl 7 ⇒ hạn 2026-11-08 < `due_at` 11-17 ⇒ `timer_invalid`, PD-I26b). Thêm vào fixture test-plan §2 |
| 3 | PD-I42 không có cột `details` | `summary {from_group,to_group}`, `actor_id` NULL (`hub.audit_log` chỉ có `before/after/summary`; code: `launcher-step.ts:111`). Sửa plan §4.9 + test-plan-int:57 |
| 4 | PD-I39b chỉ một thứ tự | "huỷ XOR bắn": quay lại trước ⇒ `cancelled_at`, 0 output; bắn trước ⇒ `fired_at` + output rồi bị reset (đối xứng hàng retry∥huỷ plan §6). Thêm hàng plan §6, sửa test-plan-int:50 |
| 5 | PD-I39d/PD-P01 250/1.000 job một user vs trần | Không giới hạn trong test (`maxConcurrentRuns` vắng ⇒ không trần, `app.ts:109`, H2b L1); `startPd` không đặt |
| 6 | PD-I05 hai decision mở cùng run | Cho phép, `view.decision` = cũ nhất (hành vi P-b2 PI-14, K05) |
| 7 | PD-I09 `permission_lost` không kiểm `retry_count` | Không kiểm (spec không có luật reset ở ca này). Sửa test-plan-int:16 "trừ `permission_lost`" |
| 8 | PD-U34 `date` required vắng ⇒ `[]`; PD-U35 suy từ contract | `[]` — code hiện có (`start-inputs.ts` `shapeValid` chỉ kiểm giá trị gửi lên). Sửa test-plan:86 |
| 9 | `FORCE_USE_CURRENT`/`AUTOFIX_REASONS` Set hay mảng | `ReadonlySet` (code `core/task.rules.ts:51`) |
| 10 | A8 `escalateIssues` ↔ `escalateStageIssues` | `escalateStageIssues` (plan-domain, plan §4.9:134) — = #74 |
| 11 | `processDefStageIssues` vắng `ctx` | Bỏ kiểm nguồn input, vẫn kiểm nguồn field (plan-contract:79) — không phải tranh chấp |
| 12 | `ProcessEditorContextSchema` nạp từ đâu | `@ai/contracts/hub-admin` (`packages/contracts/src/hub-admin/processes.ts`, cùng endpoint process-defs). Ghi file vào plan-contract §4 |
| 13 | Tên/chữ ký repo UoW | Theo test: `runs.lock(runId)`, `timers.lockById(id)` ⇒ `null` khi không thấy, `timers.markFired(id, now)`, `timers.cancelForRun(runId, "all", now)` (plan:67 có tên, thiếu tham số). Ghi vào plan-addendum |
| 14 | PD-P03 "≤ 100/lượt" lỗi thời | A9 thắng: một lượt xả nhiều lô; PD-P03 chỉ log ms/lượt. Sửa test-plan-int:120 |
| 15 | PD-A01 gọi depcruise qua bin | `tools/scripts/src/depcruise.ts` (= `bun run depcruise`, có sẵn). Sửa test-plan:111 |
| 16 | PD-P15 có tính `set_config` | Không tính (hạ tầng `withHubScope`, một câu/tx). **Bắt buộc** để ≤ 6 khả thi: ngân sách nhắc = khoá ứng viên 1 + update `unnest` 1 + người nhận 1 + insert notice 1 + unread 1 + ứng viên chuyển cấp 1 = 6 (một tx/lô, 0 chuyển cấp); tính `set_config` hoặc chia tx theo tenant ⇒ 7. Ghi vào A10 |
| 17 | PD-P12 "không `postThread` trong vòng" đo bằng `run_end.posted_at` NULL (`processLoops:false`) thay vì stub | Theo test (không có seam stub; đơn giản nhất). Sửa test-plan-addendum §2. Test khoá `P-a/pf1/thread.int:490` gọi `postThread` tường minh ⇒ vẫn xanh |
| 18 | PD-P15 đo lô 10/99 (lô 100 kéo lô rỗng sau A9), hết hạn tính chênh so lượt rỗng | Theo test ("không phụ thuộc số hàng" — A10). Ghi vào test-plan-addendum §2 |

#### Thấp khác (sửa khi BUILD)
83 Lệnh xong T9/T10 `bun run test:perf -- P-d`: bun lọc OR ⇒ chạy mọi test có `P-d` + mọi `.perf.int.test` của mốc khác; dùng `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test tests/acceptance/P-d/perf/`; CLAUDE.md "test:perf không thuộc Lệnh xong" thêm ngoại lệ CR-093 · 84 A10 index `unread` "nếu chưa có": đã có `process_notices_unread_idx (user_id) WHERE read_at IS NULL` (0019:391) ⇒ không thêm DDL, thêm dòng bảng plan-db §6 · 85 cột Đọc T9/T10 thiếu `plan-addendum A9, A10` (gộp #76) · 86 ADR-0017 "ghi khi build T7" ⇒ T10 (A10) · 87 A9 ghi rõ handle `remindOnce` = một lượt xả (trả tổng), test PD-P10/P11 dựa vào đó · 88 A10 chưa nói chuyển cấp theo tập và lịch nhắc tính ở đâu (CTE `update` một câu ↔ "luật thuần trên mảng"): mặc định khoá → luật lớp 1 → `update … from unnest`; chuyển cấp claim-update một câu, khi có hàng thì assignee/audit/notice nhiều hàng · 89 `packages/db/src/hub-rls.int.test.ts` thêm `process_timers` ở T6 (ghi cột File) · còn mở từ lần 4: 71, 73, 74–80

#### Câu hỏi người dùng
Không có (mọi mục có mặc định từ CR-093/spec/plan/code; A10 người dùng đã chốt "lọc `tenant_id` tường minh").

#### Điều kiện Gate (ngoài spec)
1–2, 4 đạt (D0a–D0c). 3. Security review T6c (gồm `systemBatch` #81), T12, T20 — trong BUILD. 5. P-d2: ADR-0022 Accepted hoặc `/mcp` hiện có. 6. Báo ở Gate: vòng nhắc bật lần đầu nhắc ngay task cũ quá hạn; retry `parallel_merge` tốn token; NFR 50 ms đo cả lời gọi (#82) — số đo T3 hiện tại p95 441 ms (nhắc) / 1.676 ms (hết hạn).

Lần 6: docs-architect/backend-lead áp #81, #82 (+ TC/Thấp nếu tiện) vào plan-addendum/spec-ca ⇒ chạy lại chỉ diff.

### Lần 4 · 2026-10-17 · READY

Phạm vi: diff 4034d4f..40e6ca9 (17 file P-d-durable) + #54–#73; đối chiếu plan-contract:60–79, plan-domain:121–123, plan-addendum A2–A3/A8, plan-frontend:58/93/115, plan-frontend-i18n:62, `admin-web/.../StageGeneral.tsx:83`. Trần: spec 25584/25600 · plan 30708/30720 · plan-frontend 24826/25600 · test-plan 30423/30720 (đạt, sát).

Đóng: #54–#70, #72. Cao #55–#58 đã đóng (tasks:3 + cột Đọc; 400 qua API cho escalate ở auto; PD-U68 bốn ca; path WAIT phía contract theo A2/A8 + PD-C13/C15).

#### Thấp (sửa khi BUILD)
74 A8:168 `escalateIssues` ⇒ `escalateStageIssues` · 75 PD-C13/C15 thiếu path `stages.<i>.executor` (A8 nói 5 ca) · 76 Đọc T5/T9/T11 + A8 · 77 Đọc T15 + A1/A2/A7 · 78 Đọc T4 "lần 3" cũ · 79 plan-frontend-d2 ô timeout_s dùng lại `process.admin.editor.stage.timeout`, ẩn budget · 80 câu i18n ESCALATE_INVALID (vô hại) · 71 trùng nhãn A (giữ tiền tố) · 73 trần sát

#### Câu hỏi người dùng
Không có.

#### Điều kiện Gate (ngoài spec)
1. ADR-0017 Accepted (chờ staging: Redis thật + tải 10.000 run). 2. Người dùng duyệt `mockup/01–04`. 3. Security review T6c, T12, T20. 4. CR-081 đóng. 5. P-d2: ADR-0022 Accepted hoặc dùng `/mcp` hiện có. 6. Báo ở Gate: vòng nhắc bật lần đầu nhắc ngay task cũ quá hạn; retry `parallel_merge` tốn token.

Spec/plan/tasks đổi sau lần này (kể cả khi sửa #74–#80) ⇒ T4 chạy lại readiness, chỉ kiểm diff.

### Lần 3 · 2026-10-17 · NOT READY

Phạm vi: diff 6f50f67..40055fd (spec, spec-ac/ca/d2/decisions/tz-tools, tasks, test-plan*, BA-admin AC-A14, INDEX) + plan-addendum A1–A7; đối chiếu plan-contract §3/§6, plan-domain:65/115–119, plan-d2 §1–§4, plan-frontend §6/§14–§15, plan-frontend-d2, i18n; code `hub-admin/processes.ts:154`, `common.ts:64-68`, `core/handles.ts:4`, `mcp.service.ts:185,258`, `hub-scope.ts:21`, loader test khoá A6/K30. Trần: spec 25592/25600 · plan 30708/30720 · plan-frontend 25541/25600 · test-plan 30303/30720 (đạt, rất sát).

#### Cao
| # | Vấn đề | Mặc định |
|---|---|---|
| 55 | plan-addendum không được trỏ từ tasks.md (cột Đọc) và từ các mục bị thay | dòng "plan-addendum thắng" đầu tasks + cột Đọc theo task + "→ thay bởi plan-addendum Ax" ở từng mục |
| 56 | `escalate` ở stage `auto` ⇒ 422 (PD-R23, AC-H42, PD-I47b) ↔ contract `after.auto` strict ⇒ 400 | 400 qua API; ESCALATE_INVALID chỉ bắt ở bản nháp FE |
| 57 | PD-U68 `afterH` sai ⇒ `[]` ↔ plan-domain:119 ⇒ ESCALATE_INVALID | theo plan-domain; API vẫn 400 (zod) |
| 58 | path WAIT phía contract (plan-contract:79) ↔ plan-addendum A2; PD-C13 cho WAIT chạy qua hàm tool/branch | A2 áp cả phía contract; PD-C13 dùng `processDefStageIssues`; ca path WAIT ở `contracts-pd1` |

#### Thấp
59 spec §9 câu ADR-0017 cũ · 60 spec-ca run-access "import từ domain" · 61 `DECISION_OPTIONS`↔`DECISION_OPTION_ORDER` · 62 test A1 params 50 · 63 PD-E04 "hoặc" · 64 PD2-I06 `base_url` qua cache catalog · 65 PD-I75 ép 40P01 · 66 "PD-C08-nối tiếp" ⇒ PD-C14 · 67 Q-D2-4/5 cũ · 68 spec-d2 §4 catalog ⇒ D-PD11 · 69 plan-frontend-d2 ô ẩn của tool theo A3 · 70 PD-I36 `timeout_s` · 71 trùng nhãn A1–A7 · 72 T4 tên lần 2 · 73 trần sát · 54 FE Q1/Q3/Q4 (mặc định)

#### Câu hỏi người dùng
Không có.

#### Điều kiện Gate (ngoài spec)
1. ADR-0017 Accepted (chờ staging: Redis thật + tải 10.000 run). 2. Người dùng duyệt `mockup/01–04`. 3. Security review T6c, T12, T20. 4. CR-081 đóng. 5. P-d2: ADR-0022 Accepted hoặc dùng cách gọi `/mcp` hiện có. 6. Báo ở Gate: vòng nhắc bật lần đầu nhắc ngay task cũ quá hạn; retry `parallel_merge` tốn token.

Lần chạy 4: chỉ diff sau khi áp #55–#73.

### Lần 2 · 2026-10-17 · NOT READY

Phạm vi: diff 8c0b473..5cfae09 thư mục spec + plan, plan-contract, plan-db, plan-domain, plan-d2, plan-frontend(-d2,-i18n), mockup 01–04, test-plan(-rules,-int,-d2,-e2e), ADR-0023; đối chiếu `common.ts:210`, `audit.ts`, `mcp.repo.ts:75`, CHECK audit hub 0029/0030, import của `ask/notify/back/step/task/run-access/autofix.rules.ts`. Trần: spec 24923/25600 · plan 30708/30720 · plan-frontend 25541/25600 · test-plan 30571/30720 (đạt, sát).

#### Chặn
| # | Vấn đề | Mặc định |
|---|---|---|
| 33 | `VALIDATION_ERROR` 422 (spec/BA) ↔ 400 (contract) | 400, sửa spec/BA |
| 34 | side_effect: type 'workflow' ↔ 'tool'; cột `retry_since/retry_attempt/retry_round` chưa vào spec | theo D-PD03/D2-03 |
| 35 | file đích task lệch (step.rules, run-status, T7s, task-access, thiếu T18s, chia T7/T8/T18) | theo plan-domain §7 / plan-d2 §8–9 |
| 36 | ADR-0017 Proposed (điều kiện Gate) | hỏi người dùng |

#### Cao
37 import contract trong file dời vào domain (run-access, autofix, `FORWARD_CHAIN_MAX`, `DECISION_OPTIONS`) · 38 e2e lệch nhãn FE · 39 G1–G7 (contract FE cần) · 40 PD-R23 ngưỡng ⇒ 400 · 41 audit `workflow` + `grant`/`revoke` · 42 quyết định plan chưa vào spec · 43 retry team `lead_plan`/`parallel_merge` · 44 spec-ac §2 ⇒ trỏ test-plan §6 (+K30) · 45 T10 → rủi ro cao · 46 chữ ký `teamResumePlan`

#### Thấp
47 câu Q4/Q6/Q9/Q10/Q-D2-1…3 của qc · 48 Lệnh xong T5/T11/T12/T20 (+`test:all`) · 49 trạng thái cũ · 50 "nếu backend-lead thấy cần" · 51 ép `answerer`/`timeout_s` · 52 câu PD-R02 · 53 trần sát (sửa vào phụ lục) · 54 FE Q1–Q4

#### Câu hỏi người dùng
1. ADR-0017: chờ staging (mặc định) hay Accept dựa trên spike local + PD-P01/P02? → **Người dùng trả lời 2026-10-17: chờ staging.** Gate P-d1 chỉ khi ADR-0017 Accepted sau spike Redis thật + tải 10.000 run trên staging (dựng staging, deploy là việc ra ngoài — hỏi người dùng trước).

Báo người dùng ở Gate (không hỏi): vòng nhắc production bật lần đầu sẽ nhắc ngay các task cũ quá hạn; retry `parallel_merge` gọi lại cả lượt (tốn token).

Lần chạy 3: chỉ diff sau khi docs-architect / backend-lead / qc áp #33–#54 (a).

### Lần 1 · 2026-10-17 · NOT READY

Phạm vi: 6/6 file spec, CLAUDE.md, WORKFLOW, BA §6.10 / BR-12, 25, 26, 38, 41–43 / §8 / §11, CR-083…087, ADR-0017; đối chiếu `chat/processes.ts`, `processes-entities.ts`, `hub-admin/processes.ts`, `process-steps.ts`, `hub/errors.ts`, `db/schema/hub-processes.ts`, `hub.ts`, `admin.ts`, `migrations-hub/0019`, `runs/sweeps.ts`, `executor-ref.ts`, `notify/reminder.ts`, `core/task.rules.ts`, `mcp/mcp.service.ts`.

#### Lỗ hổng Chặn
| # | Vấn đề | Mặc định đề xuất |
|---|---|---|
| 1 | Chưa có `plan.md`, `plan-frontend.md`, `test-plan.md`; contract còn dời sang plan | Chạy T1 (BE), T2 (FE), T3 (qc), rồi readiness lần 2 chỉ kiểm phần đổi |
| 2 | Chưa có mockup, câu chữ VI/EN, trạng thái tải/rỗng/lỗi, nhãn e2e | frontend-lead dựng mockup artifact panel stage + nhãn chat trong T2, trình cùng Gate |
| 3 | Phân loại lỗi đọc được hai cách (6 lý do job chưa xếp loại; code ↔ reason mâu thuẫn; `provider_state` toàn cục; lỗi mạng giả định) | Hàm thuần `classifyJobError(code, reason)`: xét `error_reason` trước (tạm = timeout, upstream, crash, orphaned, provider_busy, tenant_slots); reason null thì tạm = `TIMEOUT`, `UPSTREAM_ERROR`; `ALL_PROVIDERS_EXHAUSTED` tạm chỉ khi reason ∈ provider_busy/tenant_slots; còn lại nghiệp vụ; `interrupted` = tạm; không đọc `provider_state` |
| 4 | "Đã gửi side_effect" chưa rõ nguồn cờ, phạm vi, trạng thái | Có `hub.run_steps` type=`workflow`, status ≠ `skipped`, thuộc `hub.runs` có `stage_run_id` = stage, tạo từ đầu attempt/round hiện tại, `admin.workflows.side_effect=true` |
| 5 | Stage team: PD-R03 ↔ PD-R08 mâu thuẫn khi retry bắn | Mức thành viên: team-run giữ `running`, dừng tính `active_ms`; bắn thì gọi lại thành viên ở `cursor`, không tăng `calls`; khoá idempotency theo `stage_run_id` |
| 6 | Quyền gọi tool không có mô hình (`admin.workflows` không có `tenant_id`; stage tool không có agent) | Tool khả dụng = workflow `enabled` gắn ≥ 1 agent đã bật cho tenant mà người bắt đầu có grant; lưu kiểm theo tenant, chạy kiểm theo người bắt đầu; tool của gói để sau |

#### Lỗ hổng Cao
| # | Vấn đề | Mặc định đề xuất |
|---|---|---|
| 7 | Trường bắt buộc của stage chưa định nghĩa cho `wait_until`/`tool` | `wait_until`: ép `required_sections=["Bàn giao"]`, template cố định, `fields=[]`, `answerer=starter`, `token_budget=null`, bỏ `timeout_s`. `tool`: ép `["Kết quả","Bàn giao"]` + template nguyên văn, bỏ `answerer` |
| 8 | `ExecutorRef` chưa có dạng cho executor mới | Theo `APPLY_EXECUTOR_REF`: wait_until key `wait_until`, name "Chờ tới ngày"/"Wait until date"; tool key = `tool_key`, name = tên workflow |
| 9 | `idempotency_key` va chạm sau `add_attempt` | Thêm hậu tố `:<n>` (số hẹn giờ cùng kind của stage_run + 1) tính dưới khoá run |
| 10 | Thứ tự khoá timer ↔ run ngược nhau, có thể deadlock | Đọc ứng viên không khoá; mỗi hàng một tx: khoá run → `SELECT … FOR UPDATE` timer → áp hiệu ứng; mọi đường run → stage → timer |
| 11 | "FORCE RLS" sai so với 0019 | ENABLE, không FORCE; policy `process_timers_hub_rw` theo tenant như 0019 |
| 12 | Thiếu nới CHECK audit, loại tin thread, `HistoryItem.kind` | Thêm cuối: audit `escalate`, `escalate_skipped` (0036), `tool_call`, `branch` (0037); `ROOM_PROCESS_KINDS` + `branch`; `HistoryItem.kind` + `escalate`, `branch` |
| 13 | `ESCALATE_INVALID`/`TOOL_INVALID` ↔ `PROCESS_REF_INVALID` | Không tồn tại / khác tenant ⇒ 422 `PROCESS_REF_INVALID`; lỗi cấu hình khác ⇒ `PROCESS_DEF_INVALID` rules[] |
| 14 | `use_current` của `timer_invalid` mâu thuẫn `decisionOptionsFor` | Thêm `timer_invalid` vào `FORCE_USE_CURRENT`; Hub ghi .md "Bỏ chờ theo quyết định"; người quyết như `agent_failed`; `tool_failed` chỉ `use_current` khi có output |
| 15 | "Bước trước" chưa rõ | Mọi bước nhỏ hơn; nguồn `skipped`/không output ⇒ `timer_invalid` / `tool_failed` |
| 16 | Chưa có hình value của input `date` | `{key,type:'date',value}`, `^\d{4}-\d{2}-\d{2}$` + ngày lịch hợp lệ; sai ⇒ 422 `VALIDATION_ERROR` |
| 17 | AC-H41 trái trần 5 run | "4 running + 1 waiting_timer ⇒ bắt đầu được; 5 running + 1 waiting_timer ⇒ chặn" |
| 18 | ADR-0017/0018/0022 còn Proposed | Gate P-d1 chỉ cần ADR-0017 Accepted; P-d2 (T16) cần ADR-0022 Accepted hoặc dùng cách gọi workflow hiện có |
| 19 | D7 "múi giờ theo tenant" ↔ spec dùng hằng | Hỏi người dùng (câu 2) |

#### Vừa / Thấp (xử lý trong plan, không chặn)
#20 thứ tự ưu tiên trạng thái run khi có `waiting_timer`; #21 `remind_count`/`reminded_at` khi không cấu hình, độ trễ ≤ 5 phút; #22 bổ sung test khoá (`contracts-pa.test.ts:175`, `P-b/pfs3/rules/sources.rules.test.ts`, `P-a/pf1/start.int.test.ts`); #23 import/export `ttl_days`; #24 regex `time`, câu .md nguyên văn; #25 sửa tham chiếu `gates/forward*` trong tasks; #26 ghi `hub.runs`/`run_steps`/`usage_logs` cho tool ngoài job; #27 BA ghi "AC-H38 giữ chỗ (X2b2)"; #28 frontmatter thêm ADM-FR-71, CHAT-AC-59; #29 AC-H45 đánh số bước; #30 `DATE_RE` kiểm ngày lịch; #31 migration 0036/0037 hợp lệ; #32 kích thước đạt.

#### Mâu thuẫn giữa tài liệu
- ADR-0017:32 "thử lại tới `attempt_limit`" ↔ D3 `retry_count` riêng → giữ D3, sửa ADR khi Accepted.
- D7/CR-084/HUB-FR-144 "múi giờ theo tenant" ↔ spec dùng hằng → hỏi người dùng.
- spec.md:130 FORCE ↔ 0019 không FORCE → theo 0019.
- `ESCALATE_INVALID` ↔ `PROCESS_REF_INVALID` → theo #13.
- AC-H41 ↔ trần 5 run → sửa câu AC.
- PD-R14 `use_current` ↔ `decisionOptionsFor` → theo #14.

#### Câu hỏi cho người dùng (một lượt)
1. Chấp nhận trọn gói mặc định A1–A12, Q1 theo #5, Q2 theo #3, Q4–Q7, và #4, #7–#18, #20–#26?
2. GĐ1 dùng hằng `Asia/Ho_Chi_Minh`, cột múi giờ theo tenant để giai đoạn sau?
3. Quyền gọi tool (P-d2): theo #6, hay thêm công tắc bật tool theo tenant trong Admin?
4. Mockup: frontend-lead tự dựng trong T2 và duyệt ở Gate, hay người dùng cung cấp?

Lần chạy 2: chỉ kiểm diff thư mục spec cùng plan/plan-frontend/test-plan mới và các mục #1–#26 còn mở.

> 2026-10-17 · Đã áp trả lời người dùng, chờ T1–T3 rồi readiness lần 2.
> 2026-10-17 · Áp ADR-0023 (CR-088…091): thêm [`spec-ca.md`](spec-ca.md), task T3a/T6b/T6c/T7s…T19s trong `tasks.md`; chờ T1–T3 rồi readiness lần 2 (kiểm cả phần đặt code theo lớp).
