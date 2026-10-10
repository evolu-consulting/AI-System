# Phụ lục plan · Bước 0 + chủ sở hữu (sửa sau readiness lần 1, 2026-10-10)

Bổ sung plan §4, §8, §9 (plan.md hết chỗ). Chữ ký: [`plan-contract.md`](plan-contract.md) §7. Thread phòng: [`plan-thread.md`](plan-thread.md).

## 1. Chủ sở hữu luồng (sửa readiness #1 Chặn, #2, #3)
| Việc | Chủ | Cách làm |
|---|---|---|
| need_input ⇒ mở task `ask` | **PF1** (`runs/stage-driver.ts`, `runs/team-runner.ts`) | thực thi hiệu ứng `open_ask` trong tx kết quả job: `core.insertTask(tx, {kind:"ask", question, choices, excerpt: askExcerpt(run.input)}, assignees theo `stage.answerer`)` (nhóm song song: `mergeQuestions`, PF1) + `ProcessNotifier.taskOpened` + `enqueueThread(ask)`. Giới hạn hỏi lại ≤ 3 = `transition` (PF1) |
| Trả lời / chuyển ask | **PF2** (`asks/**`) | chỉ: `answer` (khoá task, đầu thắng, `stage_runs` → queued) + `forward` + sau COMMIT `StageLauncher.kick` + `enqueueThread(task_result|forward)`. **Không** mở task, không đụng `stage-driver` |
| Task `decision` | **PF1** (hiệu ứng `open_decision`) | assignee = `decisionAssignees(reason, startedBy, reviewGroupId)`: hàng user = người bắt đầu; hàng group = Group duyệt của stage **chỉ khi** `reason="redo_limit"`. `tenant_admin`/`platform_admin` không là assignee (thấy qua Evolu Control, quyết được qua `canDecide`). Notice `decision_requested` cho assignee |
| `TaskDetail` + `can_act` | **Bước 0** `core/task-view.ts` + `core/task.rules.ts` | `loadTaskDetails` + `toTaskDetail` + `canAct` dùng chung cho PF1 view, PF2 answer/forward, PF3 `/me/review-tasks` — PF không tự dựng |
| `askExcerpt` | **Bước 0** `core/task.rules.ts` (chuyển từ `asks/ask.rules.ts`; test R-AK04 → `step0/rules`) | |
| Đăng tin thread phòng | **Bước 0** `core/thread.ts`, `core/thread-poster.ts` | PF1 + PF2 gọi `enqueueThread(tx, ev)` (bảng plan-thread §2) |

## 2. Bước 0 — thêm vào ranh giới plan §8–§9
| Phần | Thêm |
|---|---|
| 0a contract (B2) | `chat/room-process.ts` (`ROOM_PROCESS_KINDS`, `RoomProcessPartSchema`) + `rooms.ts` (`ROOM_SENDER_TYPES` += `process`; `RoomMessage.process_run_id?`, `process?`; `RoomFlowRecent.process?: {kind}`); `TaskDetail.options/has_output`, `ProcessRunView.full.open_tasks/thread`, `/me/review-tasks.open_count`, `GET /process-runs?process_key`, mã `PROCESS_THREAD_NO_AGENT` (plan-contract §2–§4) |
| 0b DB (B1) | plan-thread §3 (cột `process_kind/process_meta`, CHECK, uq block, bảng `process_thread_events`, 3 definer) |
| 0b khung (B0) | `core/task.rules.ts` (`canAct`, `askExcerpt`, `decisionAssignees`) · `core/task-view.ts` · `core/thread.rules.ts` (`threadContent`) · `core/thread.ts` (`enqueueThread`) · `core/thread-poster.ts` (`post`, `postThreadOnce`, vòng 5 s) · `core/handles.ts` (`ProcessHandles`, plan-contract §7 seam) · `core/clock.ts` (`now` của deps) |
| 0b điểm nóng (B0) | (10) `rooms/messages/messages.repo.ts`, `rooms/rooms.map.ts`, `rooms/manage/rooms.repo.ts`, `rooms/messages/messages.service.ts` (T7), `rooms/room-messages.routes.ts` (`X-Flow-Id`) — plan-thread §4 · (11) `app.ts` `AppDeps` += seam N3 (plan-contract §7) · (12) `tools/mocks/src/dify.ts` đếm `ghi-so` (N6) · (13) `tools/scripts/src/i18n-check.ts` thư mục `locales/process/` (readiness #11; frontend-lead viết, file thuộc B0) |
| 0c (B3) seed | D18 [`plan-seed.md`](plan-seed.md): mẫu `sdlc` 8 giai đoạn + `hoa-don`; `agents.yaml` + **8 agent vai** (`intake-analyst`, `docs-architect`, `backend-lead`, `frontend-lead`, `qc`, `qc-uat`, `spec-readiness`, `reviewer`; fake-cli dev); nhóm `plan-team`, `dev-team`, `test-team` (`sequential`) + **giữ** `ba-team` (+ 4 agent BA); bật nhóm cho tenant dev; chép `hoa-don` vào tenant dev gán Group "Kế toán" |
PF không còn file Bước 0 phải sửa: PF1 dùng `enqueueThread` + `insertTask` + `loadTaskDetails`; PF2 dùng `loadTaskDetails` + `enqueueThread` + `kick`; PF3 dùng `loadTaskDetails` + `canAct`.

## 3. Mock + fixture B2 (N5, N6) — `tools/mocks/src/chat/processes/`
| File | Nội dung (id cố định `00000000-0000-4000-8000-0000000pa<NNN>`, hằng `PA_FIX` export cho FE/e2e) |
|---|---|
| `fixtures.ts` | Persona A `lan` (bắt đầu), B `hoa` (kiểm trong phòng), X `tam`, T `cuc` (Thomas, ngoài phòng), H `q01` (Hải, được nhờ), Adm `tadmin`; phòng R; quy trình `sdlc`, `hoa-don`; 6 run: `running` (stage 1 nhóm đang chạy) · `waiting_review` (task review B + Group "Kế toán" có T ngoài phòng) · `waiting_answer` (ask, chuỗi chuyển 2: A→H→H2) · `needs_decision` (`redo_limit`, có output) · `done` (usage 2 stage, stage 2 nhóm 3 thành viên + 1 plan) · `cancelled`. Mỗi run phòng có tin thread đủ 7 loại (khối + output + ask/decision + task_result + forward + `run_end` cho run `done`/`cancelled`, actor A) theo plan-thread §2; `open_tasks` + `thread` theo persona (A/B assignee có, X không); persona `lan-left` (A đã rời phòng): `access:"task"`, `my_tasks=[]`, `outputs` ≥1, `can_cancel:true`, không thread |
| `runs.ts`, `gates.ts`, `asks.ts` | `GET /processes`, `POST/GET /process-runs(*)`, view full/task theo persona Bearer, cancel/decide/decision/answer/forward đổi trạng thái fixture + phát sự kiện |
| `inbox.ts` | 3 notice (`review_requested`, `ask_requested`, `run_finished`), `/me/review-tasks` (+`open_count`), `/me/process-inbox*` |
| `usage.ts` | `ProcessRunUsage` full (A) + summary (T) cho run `done` |
| `control.ts` (đăng ký vào `/__mock/*`) | `POST /__mock/process {run_id, action: "advance"\|"output"\|"ask"\|"decision"\|"finish"}` ⇒ đổi fixture + phát `process.updated`, `review_task.*`, `process.notice`, `room.message` (tin `process`); `POST /__mock/reset` khôi phục |
N6: `tools/mocks/src/dify.ts` đếm mỗi `POST /v1/workflows/run` theo `inputs`/workflow key (`ghi-so`), `GET /__mock/calls` ⇒ `{workflows: {[key]: number}}`, `POST /__mock/reset` về 0.

## 4. Khác
- **U2:** Import/Export JSON quy trình (ADM-FR-65, HUB-FR-104 vế) ⇒ **P-b** (Pb1); P-a không có contract/task/test.
- **U3:** mặc định nhóm `sequential`, `lead_plan` chọn được (D7, `agent_teams.mode`).
- **B8:** bỏ "seed usage dev" — test dùng fixture SQL (qc), FE dùng mock `usage.ts`; dữ liệu dev thật đến từ run fake-cli.
- FE #1 `process_key` ⇒ **làm** (query `GET /process-runs`); FE #2 `open_count` ⇒ **làm** (`/me/review-tasks`); FE #4 `StageView.sections` ⇒ P-b.
- Giới hạn chính xác (readiness #17): "5 (`PROCESS_RUNS_PER_TENANT`)", "7 ngày (`PROCESS_RUN_TTL_DAYS`)".
