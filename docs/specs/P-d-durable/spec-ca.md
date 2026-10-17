# P-d · Đặt code theo Clean Architecture (CR-090, ADR-0023)

Phần của [`spec.md`](spec.md). Áp [ADR-0023](../../adr/0023-clean-architecture.md) và `CONVENTIONS.md` §2, §5, §10 cho P-d: **code mới** của P-d1/P-d2 viết theo bốn lớp; file cũ của `processes/` chỉ tách khi task **sửa logic** trong file đó; phần còn lại thuộc mốc **CA-processes** sau P-d1 (ROADMAP). Nghiệp vụ không đổi — luật PD-R/PD2-R/TZ-R/TT-R giữ nguyên nghĩa; file này chỉ nói **đặt ở đâu**. Viết tắt `P/` = `apps/hub-api/src/modules/processes/`.

## 1. Nguyên tắc (CA-R)
| Luật | Nội dung |
|---|---|
| CA-R01 | Luật mới đặt theo bảng §2–§3. Không thêm logic mới vào file cũ — file cũ chỉ thêm **lời gọi** tới code mới (khi đó không bắt buộc tách) |
| CA-R02 | Task sửa logic có sẵn trong file cũ ⇒ trước đó task `Ns` (backend-lead) tách phần chạm tới sang lớp, **không đổi hành vi**, commit `refactor(processes): … [CR-090]`; cùng lúc task `Nq` (qc) sửa đường dẫn test khoá + lock, **không shim re-export** (`CONVENTIONS.md` §10) |
| CA-R03 | Lớp 1–2 không import `@ai/contracts`/`@ai/db`/`zod` (kể cả `import type`). Hằng nghiệp vụ (`STAGE_RETRY_MAX`, `RETRY_BACKOFF_S`, `REMIND_MAX`, `WAIT_HORIZON_DAYS`, `TOOL_ARGS_MAX`, `BRANCH_RULES_MAX`…) **giữ trong contract** (FE, validate) **và** khai lại ở `P/domain/limits.ts`; `P/adapters/processes.mapper.test.ts` khẳng định bằng nhau |
| CA-R04 | Enum dùng chung (trạng thái stage/run, lý do quyết định, executor kind, luật def): domain khai union chuỗi riêng; mapper test khẳng định union domain = (hoặc ⊆, khi domain chỉ cần một phần) mảng contract |
| CA-R05 | Domain không đọc giờ/DB/id: use case lấy `now` từ `Clock`, id từ `IdGen`, truyền giá trị vào hàm domain. Múi giờ: hàm domain nhận chuỗi IANA + ngày gốc, tính bằng `Intl.DateTimeFormat` (built-in) |
| CA-R06 | Vòng nền: runner lớp 4 (`startProcessSweeper`, `lib/loop.ts`) → adapter đọc ứng viên scope `system` không khoá → mỗi hàng gọi use case trong `UnitOfWork.system(tenantId, …)`; repo trong scope `system` nhận `tenantId` **bắt buộc ở chữ ký** (PD-R11, S1) |
| CA-R07 | `kick`, `process.updated`, notice, DM hệ thống: use case gọi port `Notifier`/`StageKicker` — adapter phát **sau COMMIT** |
| CA-R08 | Lỗi luật def mới (`WAIT_INVALID`, `ESCALATE_INVALID`, `TOOL_INVALID`, `TOOL_SIDE_EFFECT`, `BRANCH_INVALID`): domain trả danh sách vi phạm (union chuỗi); adapter map ⇒ 422 `PROCESS_DEF_INVALID` + `rules[]`; `PROCESS_REF_INVALID` do adapter quyết sau khi repo tra tham chiếu |
| CA-R09 | Phép đo không thuộc ECMAScript (cỡ byte kết quả tool — `TextEncoder`) làm ở adapter, truyền số vào domain |

## 2. P-d1 — đặt file mới
| Luật | Lớp 1 `P/domain/` | Lớp 2 `P/application/` | Lớp 3 `P/adapters/` |
|---|---|---|---|
| PD-R01/02 phân loại lỗi | `runs/job-error.rules.ts` (`classifyJobError`) | — | mapper: mã/lý do job (contract) → union domain |
| PD-R03/04/06/08 thử lại | `runs/retry.rules.ts` (còn lượt?, `due_at` backoff, reset `retry_count`, quyết định theo stage/thành viên team) | `runs/handle-job-failure.usecase.ts` | `runs/retry.repo.ts` (stage_runs, hẹn giờ `retry`) |
| PD-R05 đã gửi `side_effect` | `runs/retry.rules.ts` nhận cờ `sideEffectSent: boolean` | port `SideEffectProbe` | `runs/side-effect.repo.ts` (truy vấn `run_steps` + `admin.workflows`) |
| PD-R10 khoá idempotency | `timers/timer-key.rules.ts` | — | — |
| PD-R11/12 vòng quét, huỷ hẹn | `timers/timer.rules.ts` (tới hạn?, stage bị ảnh hưởng khi quay lại/huỷ) | `timers/fire-timer.usecase.ts`, `timers/cancel-timers.usecase.ts` | `timers/timers.repo.ts`, `timers/timer-sweep.ts` (đọc ứng viên, gọi use case từng hàng) |
| PD-R13/14 `wait_until` | `timers/due-at.rules.ts` (ngày gốc + offset + giờ + IANA ⇒ UTC; giới hạn 730 ngày, `expires_at`) | `timers/enter-wait.usecase.ts` | port `TenantTzReader` ⇒ `timers/tenant-tz.repo.ts` (đọc `admin.tenants.timezone` trong tx) |
| PD-R15/16 trạng thái run, trần | `runs/run-status.rules.ts` (thứ tự ưu tiên có `waiting_timer`), `runs/active-cap.rules.ts` (tập trạng thái đếm trần) | dùng trong use case sẵn có | — |
| PD-R14 `FORCE_USE_CURRENT` | `tasks/decision.rules.ts` (tách từ `core/task.rules.ts`, T8s) | — | — |
| PD-R17 lưu def `wait_until` | `defs/wait-def.rules.ts` (kiểu def tối thiểu tự khai) | — | mapper: contract def → kiểu def domain |
| PD-R18/19 nhắc lặp | `notify/remind.rules.ts` (`remind_at`, `remind_count`, dừng ở 10) | `notify/remind-tasks.usecase.ts` | `notify/review-tasks.repo.ts` |
| PD-R20/22 chuyển cấp | `notify/escalate.rules.ts` (tới hạn?, Group hợp lệ ⇒ thêm / bỏ qua) | `notify/escalate-task.usecase.ts`; port `GroupReader`, `AuditWriter` | `notify/escalation.repo.ts` (lọc `tenant_id` tường minh) |
| PD-R21 forward theo Group | `asks/forward.rules.ts` (tách từ `asks/ask.rules.ts`, T9s) | — | — |
| PD-R23 lưu def `escalate` | `defs/escalate-def.rules.ts` | — | adapter tra Group ⇒ `PROCESS_REF_INVALID` |
| PD-R24/25 `ttl_days` | `defs/ttl.rules.ts` (mặc định, `expires_at` hay `null`) | — | mapper def + export/import |
| Hằng | `limits.ts`, `errors.ts` | `ports.ts` chung | `processes.mapper.ts` (+ `.test.ts`) |

Lớp 4: `P/processes.mount.ts` nối port → adapter; vòng hẹn giờ + vòng nhắc nằm trong `sweepOnce`/`startProcessSweeper` sẵn có, chỉ thêm lời gọi adapter.

## 3. P-d2 — đặt file mới
| Luật | Lớp 1 `P/domain/` | Lớp 2 `P/application/` | Lớp 3 `P/adapters/` |
|---|---|---|---|
| PD2-R01/02 lưu def `tool` | `defs/tool-def.rules.ts` (≤ 20 tham số, nguồn tồn tại trong def, bước nhỏ hơn) | — | adapter tra tool khả dụng (TT-R04/05) ⇒ `PROCESS_REF_INVALID` |
| PD2-R03/05 chạy, lỗi | `tools/tool-run.rules.ts` (dựng args từ nguồn; phân loại lỗi trước/sau gửi; `tool_failed`) | `tools/run-tool-stage.usecase.ts`; port `ToolInvoker`, `ToolSwitchReader` | `tools/mcp-tool-invoker.ts` (bộ điều phối `/mcp`, danh tính người bắt đầu), `tools/tool-switch.repo.ts` (lọc `tenant_id` của run, TT-R08) |
| PD2-R04/08 `side_effect`, ép trường | `defs/tool-def.rules.ts` | — | — |
| PD2-R06/07 output | `tools/tool-output.rules.ts` (lọc `fields`, kiểu, nhận `byteSize` từ adapter — CA-R09; sinh .md) | trong use case | — |
| PD2-R09 audit/usage | — | port `AuditWriter`, `UsageWriter` | repo ghi `hub.runs`/`run_steps`/`usage_logs` |
| PD2-R10…R12 lưu def nhánh | `branch/branch-def.rules.ts` | — | — |
| PD2-R13…R15 đánh giá nhánh, `skipped` | `branch/branch.rules.ts` (luật đầu tiên khớp ⇒ bước đích, stage bị nhảy) | gọi từ use case join bước (T19s) | thread/audit qua `Notifier`/`AuditWriter` |
| Catalog tool cho editor | — | `tools/list-tools.usecase.ts` | `tools/tools.routes.ts` (mới, Hono mỏng) |

## 4. Port (`P/application/ports.ts` + port theo nhóm)
| Port | Dùng bởi | Adapter |
|---|---|---|
| `UnitOfWork` — `tenant(tenantId, fn)` / `system(tenantId, fn)`; `fn` nhận các repo đã gắn tx, **không** nhận `Tx` | mọi use case | `adapters/hub-uow.ts` bằng `withHubScope` (T6b; security review T6c) |
| `Clock` (`now(): Date`), `IdGen` | mọi use case | `systemClock` / `AppDeps.now`; `crypto.randomUUID`. `core/clock.ts` cũ dùng lại kiểu `Clock` này |
| `Notifier`, `StageKicker` | thử lại, hẹn giờ, chuyển cấp, nhánh | NOTIFY/Redis + `kick` sẵn có, gọi sau COMMIT |
| `Logger` | vòng nền | logger app |
| repo port theo nhóm (`TimerRepo`, `RetryRepo`, `ReviewTaskRepo`, `GroupReader`, `AuditWriter`, `TenantTzReader`, `SideEffectProbe`, `ToolInvoker`, `ToolSwitchReader`, `UsageWriter`) | §2–§3 | `adapters/**.repo.ts` |

`P/core/ports.ts` cũ (cổng giữa PF, kiểu từ contract/db) **không** phải lớp 2 — giữ tới CA-processes.

## 5. File cũ bị chạm — tách gì, task nào
| File cũ | Task logic | Tách (task `Ns`) | Sang |
|---|---|---|---|
| `core/process-state.rules.ts` (`transition`) | T7, T8 | nhánh chuyển trạng thái do lỗi job / `waiting_timer` | `domain/runs/run-state.rules.ts` |
| `runs/stage-driver.ts`, `runs/team-member.ts`, `runs/team-exec.ts` | T7 | đoạn xử lý job lỗi ⇒ gọi `handleJobFailure` | `application/runs/handle-job-failure.usecase.ts` + adapter |
| `runs/sweeps.ts` (`sweepOnce`) | T7 (`interrupted`), T8 (hẹn giờ), T10 (`expireRuns`) | thân vòng `interrupted`/hết hạn chạm tới ⇒ use case; `sweepOnce` còn là danh sách lời gọi | `application/runs/*.usecase.ts`, `adapters/runs/sweep-*.ts` |
| `core/task.rules.ts` (`decisionOptionsFor`) | T8 | `FORCE_USE_CURRENT`, `decisionOptionsFor` | `domain/tasks/decision.rules.ts` |
| `core/limits.rules.ts` / đếm trần | T8 | tập trạng thái đếm trần | `domain/runs/active-cap.rules.ts` |
| `runs/start-inputs.ts` | T8 (input `date`), T10 (`ttl_days`) | kiểm input + tính `expires_at` | `domain/runs/start-inputs.rules.ts` |
| `gates/back.effects.ts` | T8 (huỷ hẹn), T19 (`skipped`) | đoạn chọn stage bị reset | `domain/gates/back.rules.ts` (gộp với `gates/back.rules.ts` cũ) |
| `notify/reminder.ts` (`remindOnce`), `notify/notify.rules.ts` (`dueReminder`) | T9 | toàn bộ (file nhỏ) | `application/notify/remind-tasks.usecase.ts`, `domain/notify/remind.rules.ts`, `adapters/notify/review-tasks.repo.ts` |
| `asks/ask.rules.ts` (`forwardCheck`) | T9 | toàn bộ (41 dòng) | `domain/asks/forward.rules.ts` |
| `defs/def.rules.ts` (`validateProcessDef`) | T8, T9, T10, T18, T19 | **không tách** trong P-d: chỉ thêm lời gọi tới `domain/defs/*-def.rules.ts` (CA-R01); tách ở CA-processes | — |
| `core/step.rules.ts` (`stepJoin`), `runs/step-persist.ts` (`settleStep`) | T19 | `stepJoin` + chỗ chọn bước kế | `domain/runs/step-join.rules.ts`, `application/runs/settle-step.usecase.ts` |

Plan (T1/T13) được đổi tên file đích nếu cần, giữ đúng lớp; ghi vào "Quyết định trong lúc làm".

## 6. Ngoài hub-api
- **admin-api** T6a (múi giờ): chỉ thêm trường vào luồng `tenants` sẵn có, IANA kiểm ở contract (TZ-R02) ⇒ không bắt buộc tách. T18a (công tắc tool): logic mới ⇒ bốn lớp (module mới `workflow-tools/` hoặc lớp trong `tenants/`, plan chốt).
- **Web** (CR-091): logic thuần mới (nhãn "Chờ tới {ngày}"/"Đang thử lại (n/3)", kiểm luật nhánh/tham số phía form) ⇒ `apps/{admin,chat}-web/src/features/processes/domain/`; component/`api.ts` như cũ.
- **Python**: P-d chỉ thêm ca `#fake:` cho `fake-cli` (công cụ test) — ngoài lộ trình chuyển.

## 7. Bảo mật và kiểm
- **T6c security review `UnitOfWork`** (hard stop tenant): scope `tenant` ⇒ `withHubScope(tenantId)`; scope `system` chỉ cho vòng nền, repo bắt buộc `tenantId`; không lộ `Tx` lên lớp 2; Notifier sau COMMIT; test 2 tenant (AC-H46) chạy qua use case thật.
- Lệnh kiểm mỗi task có file lớp 1–2: `bun run depcruise` (0 vi phạm `ca-*`), test lớp 1 chạy không DB, `adapters/processes.mapper.test.ts` xanh.
