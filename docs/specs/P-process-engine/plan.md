# Plan · P-process-engine — Backend P-a (Hub TS)

Phụ lục: [`plan-contract.md`](plan-contract.md) (zod, mã lỗi, chữ ký luật) · [`plan-thread.md`](plan-thread.md) (U1) · [`plan-step0.md`](plan-step0.md) (chủ sở hữu, Bước 0 bổ sung, mock, U2/U3). Nghiệp vụ: spec §2, BA-H §6.10. Mọi số giới hạn: spec §2.1 (không đổi sau spike).

## 1. Quyết định chính
| # | Quyết định | Lý do / nguồn |
|---|---|---|
| D1 | **Stage chạy = `hub.runs` thường của người bắt đầu** (`kind='direct'`, `user_id = started_by`) trên **hội thoại nền ẩn** của process run (`conversations.process_run_id`), driver riêng qua `RunService.launch(p, files, {driver})` (X2b D6). Không qua Orchestrator | Tái dùng job/lease/sweeper/trace/usage/`side_effect`; HUB-BR-24 (quyền/quota/usage người bắt đầu) tự đúng; X2b D1 |
| D2 | **Điểm nóng Orchestrator: không sửa.** "Tắt passthrough cho nhóm" không cần — stage không đi Orchestrator (D1); team-run do `processes/runs/team-runner.ts` gọi `runJob` từng thành viên | Ít đụng file khoá; spike: Hub điều phối |
| D3 | Thêm `RunService.prepareProcess(u, conv, req, stage)` (Bước 0): ảnh + `directOnSnapshot` cho stage agent (kiểm `agent_grants` người bắt đầu = HUB-BR-23); stage nhóm: kiểm nhóm bật cho tenant + thành viên `enabled` (không kiểm grant từng thành viên — Câu hỏi C2); `maxConcurrentRuns` **bỏ qua** (giới hạn bằng ~5 run/tenant) | Run nền không có HTTP để trả 429; HUB-FR-105 |
| D4 | Hành động thật: trong tx tạo run stage, Hub chèn `tool_confirmations` `confirmed` (`decided_run_id` = run stage) cho mọi workflow `side_effect` của agent ⇒ MCP `consumeConfirmation` sẵn có cho chạy **đúng 1 lần**, không hỏi A; audit `authorize_real_action` ghi người duyệt (B) | HUB-FR-109, AC-H31; không sửa `mcp/` |
| D5 | Output stage = văn bản Markdown (`done.text`, ≤ 64 000 ký tự `AGENT_TEXT_MAX`); mỗi lần ra = 1 hàng `process_outputs` (version tăng) + 1 `attachments` (`origin=output`, `text/markdown`, của người bắt đầu, `job_id` = job cuối). Người xem khác đọc nội dung qua `/process-runs/:id/outputs/:oid` (không qua RLS attachments) | P-R03; attachments RLS chỉ chủ — người duyệt ngoài phòng không đụng |
| D6 | Input stage: input lúc bắt đầu + góp ý/Q&A trong prompt; output **đã chốt** các stage trước + bản nháp hiện tại (nhóm) qua `RunContext.files` (H2c → `work/<job_id>/`, WRK-BR-07) | Q6; ≤ 10 file (stage ≤ 10) |
| D7 | **Nhóm (spike):** mặc định `sequential` (thứ tự cố định, A); `lead_plan` = trưởng nhóm trả JSON kế hoạch **1 lần** (≤ 5 bước), Hub chạy, **không** lần kiểm cuối bằng LLM — Hub kiểm template bằng mã; `parallel_merge` = thành viên chạy song song, **Hub ghép theo mục** (không lần gộp LLM). Thành viên **chỉ trả mục mình sở hữu** (`agent_team_members.sections`); Hub ghép file có phiên bản; tóm tắt thành viên cắt cứng 200 token (≈ 4 ký tự/token). Kế hoạch hỏng/thành viên lạ ⇒ chạy theo thứ tự `sequential` (bước `plan_fallback`) | spike.md Khuyến nghị 1–4 |
| D8 | **Làm lại chọn lọc mặc định:** `sequential`/`parallel_merge` ⇒ chỉ thành viên sở hữu mục bị góp ý (`sections` người duyệt chọn; vắng ⇒ mục có tên xuất hiện trong góp ý; không khớp ⇒ cả nhóm); `lead_plan` ⇒ trưởng nhóm lập kế hoạch làm lại (1 lần gọi) | spike "Làm lại" −35% token |
| D9 | MCP lai không có ở P-a (CR-023 Hoãn); không thiết kế quanh prompt cache; giới hạn team-run giữ 10 lần gọi / 200k token / 10 phút chạy; token = in + out + cache_read + cache_write (cùng công thức spike) | spike Khuyến nghị 3, 5, 6 |
| D10 | Chuyển trạng thái do **người** (duyệt/trả lời/quyết/huỷ) ghi trong tx scope `user` của người đó (RLS bảng quy trình = theo tenant) rồi **sau COMMIT** `StageLauncher.kick(runId)`: tx scope `user` của **người bắt đầu** khoá run → kiểm lại quyền (P-R10) → `createRunTx` → `launch`. Instance chết giữa chừng ⇒ vòng quét 30 s nhặt `stage_runs.status='queued'` | Tách tx như X2b D4; `createRunTx` cần scope người bắt đầu |
| D11 | Kết quả job ⇒ tx quy trình (người bắt đầu) **trước**, `writer.finish` run stage **sau**; idempotent theo `stage_runs.current_run_id`. Vòng đối chiếu: stage `running` mà run đã kết thúc > 60 s không có kết quả ⇒ `needs_decision{interrupted}`. Huỷ run stage bằng `/runs/:id/cancel` ⇒ cũng `interrupted` | K4; một đường ghi |
| D12 | **Tài khoản hệ thống "Quy trình" (M6):** danh tính **ảo** — hằng `PROCESS_SYSTEM_SENDER` (không hàng `admin.users`, không đăng nhập, không vào nhóm, không có trong danh bạ), tên theo locale. "DM" = hộp thư `process_notices` riêng từng user (`GET /me/process-inbox`, sự kiện `process.notice`), FE hiển thị như một DM ghim; không có composer (không nhận tin chữ). Không thêm kiểu phòng; sender `process` chỉ cho tin thread (plan-thread T3) | Không đổi enum khoá X2a (`ROOM_KINDS`, `ROOM_SENDER_TYPES`), không đụng admin; Câu hỏi C3 |
| D13 | **[U1 2026-10-10, thay]** Run trong phòng = **thread X2b**; Hub đăng tin `sender_type=process` qua outbox — [`plan-thread.md`](plan-thread.md) | Mockup ④ |
| D14 | Hỏi AI: `!key` trên `POST /conversations/:id/messages` ⇒ **202** JSON `{process_run}` + `X-Process-Run-Id` (không SSE, không lưu tin vào hội thoại); thẻ dựng lại từ `GET /process-runs?conversation_id=` | Chỉ thêm; C1 SSE giữ nguyên |
| D15 | Cờ `HUB_PROCESS_ENGINE=on|off` (mặc định `off`): `off` ⇒ không mount route quy trình (404), `!` là chữ thường như hiện nay (test khoá H2b/X2b không đổi). Dev bật ở F6 | CR-059 cờ feature |
| D16 | Mã lỗi ở khối **mới** `CHAT_PROCESS_ERRORS` / `HUB_ADMIN_PROCESS_ERRORS`; sự kiện ở hằng mới `ME_STREAM_PROCESS_EVENTS` (hằng X2a/X2b giữ số lượng — test khoá R24/R31/K7/K8) | X2b D9, D10 |
| D17 | `process_defs` ghi qua `withConfigWrite` (`modules/studio/studio-write.ts`: scope `system`, khoá `config_meta`, `version` 409, audit, NOTIFY); cách ly tenant ở repo (`tenant_id = $T`, như agent-grants) | Task yêu cầu; H4a |

## 2. DB — migration `0019_pa_process_engine.sql` (viết tay, idempotent, `_journal` idx 19; Drizzle `packages/db/src/schema/hub-processes.ts`)
Không FK sang `admin.*` (P3). `ts` = `timestamptz`. RLS mặc định: `FOR ALL TO hub_rw USING/WITH CHECK (scope='system' OR (scope='user' AND tenant_id = app.tenant_id))` — gọi tắt **T**.

### 2.1 Bảng mới
| Bảng | Cột (kiểu · null · default · CHECK) | Khoá/FK/index | RLS |
|---|---|---|---|
| `process_defs` | id uuid pk gen · tenant_id uuid **null** (null = mẫu `platform_admin`) · key text (`^[a-z0-9-]{2,32}$`) · name text 1..80 · description text '' ≤500 · input_hint text '' ≤200 · run_group_ids uuid[] '{}' (≤20; rỗng = cả công ty) · stages jsonb (mảng 1..10, zod `ProcessStageDef` ở biên) · token_budget int null (1 000..5 000 000) · enabled bool false · source_template_id uuid null · version int 1 · created_by/updated_by uuid null · created_at/updated_at ts now · deleted_at ts null | FK source_template_id→process_defs SET NULL · uq (tenant_id,key) WHERE deleted_at IS NULL AND tenant_id IS NOT NULL · uq (key) WHERE tenant_id IS NULL AND deleted_at IS NULL · idx (tenant_id, updated_at DESC) WHERE deleted_at IS NULL | SELECT: system OR (user AND (tenant_id = app OR tenant_id IS NULL)); ghi: **chỉ system** (D17) |
| `process_runs` | id · tenant_id · process_def_id uuid · def_version int · snapshot jsonb (key,name,stages,token_budget,run_group_ids) · started_by uuid · origin_kind text ∈ room/conversation/admin · origin_room_id uuid null · origin_conversation_id uuid null · trigger_message_id uuid null · input text ≤ 8 000 · conversation_id uuid (hội thoại nền) · flow_id uuid · status text ∈ `PROCESS_RUN_STATUSES` (§3.1) · current_stage_idx smallint 0 · decision jsonb null `{reason, stage_idx, options, at}` · tokens_total int 0 (bộ đếm; nguồn thật usage_logs) · expires_at ts (= started_at + 7 ngày) · cancelled_by uuid null · started_at/updated_at ts now · finished_at ts null | CHECK origin_kind ↔ cột origin · FK def RESTRICT, room SET NULL, conversations (2 cột) SET NULL/RESTRICT, trigger→room_messages SET NULL · idx `process_runs_active_idx` (tenant_id) WHERE status IN (running,waiting_review,waiting_answer,needs_decision) · (started_by, started_at DESC) · (origin_room_id) WHERE NOT NULL · (origin_conversation_id) WHERE NOT NULL · (tenant_id, started_at DESC) · (process_def_id, started_at DESC) · (expires_at) WHERE active | T (không DELETE) |
| `stage_runs` | id · tenant_id · process_run_id · stage_idx smallint 0..9 · status ∈ `STAGE_RUN_STATUSES` · attempt smallint 1 · attempt_limit smallint 4 (1 + 3 làm lại; +1 mỗi "thêm lượt") · asks_count smallint 0 · ask_limit smallint 3 · template_failures smallint 0 · current_run_id uuid null · current_output_id uuid null · feedback text null ≤4 000 · redo_sections text[] null · passed_by uuid null · passed_at/started_at/finished_at ts null · updated_at ts now | uq (process_run_id, stage_idx) · FK run CASCADE, current_run_id→runs SET NULL · idx (updated_at) WHERE status='queued' · idx (current_run_id) WHERE NOT NULL | T |
| `team_runs` | id · tenant_id · stage_run_id · process_run_id · attempt smallint · team_id uuid · mode text ∈ `TEAM_MODES` · plan jsonb null · cursor smallint 0 · status ∈ `TEAM_RUN_STATUSES` · stop_reason text null ∈ calls/tokens/time/no_change/member_failed/cancelled · calls smallint 0 · tokens int 0 · active_ms int 0 · segment_started_at ts null · last_hash text null · same_count smallint 0 · started_at ts now · finished_at ts null | FK stage CASCADE, team RESTRICT · idx (stage_run_id, attempt) | T |
| `process_outputs` | id · tenant_id · process_run_id · stage_run_id · stage_idx · version smallint · attempt smallint · content text ≤ 200 000 · sections jsonb null `{<mục>: <member_key>}` · fields jsonb null · summaries jsonb null `{<member_key>: text≤800}` · template_ok bool · template_missing text[] '{}' · attachment_id uuid null · created_at ts now | uq (stage_run_id, version) · FK CASCADE, attachment SET NULL | T |
| `review_tasks` | id · tenant_id · process_run_id · stage_run_id · kind ∈ review/ask/decision · status ∈ open/closed · output_id uuid null (review) · question text null ≤2 000 · choices jsonb null · excerpt text null ≤1 000 · reason text null (decision) · assignee_group_id uuid null · remind_at ts (= created+1 ngày) · reminded_at ts null · result text null ∈ `TASK_RESULTS` · feedback/answer text null ≤4 000 · sections text[] null · decided_by uuid null · decided_at ts null · created_at ts now | CHECK kind↔cột (review ⇒ output_id; ask ⇒ question; decision ⇒ reason) · uq (stage_run_id, kind) WHERE status='open' · idx (process_run_id, created_at) · (remind_at) WHERE status='open' AND reminded_at IS NULL · (assignee_group_id) WHERE status='open' | T |
| `review_task_assignees` (= **grant**) | id · tenant_id · task_id · user_id uuid null · group_id uuid null · via ∈ initial/forward · from_user_id uuid null · note text null ≤500 · depth smallint 0..3 · first_viewed_at ts null · created_at ts now | CHECK đúng một trong user_id/group_id · uq (task_id,user_id) WHERE user_id NOT NULL · idx (user_id, created_at DESC) WHERE user_id NOT NULL · (group_id) WHERE group_id NOT NULL · FK task CASCADE | T |
| `process_notices` (DM "Quy trình") | id · tenant_id · user_id · kind ∈ `NOTICE_KINDS` · process_run_id · task_id uuid null · payload jsonb (tên quy trình/stage, kết quả; không nội dung output) · created_at ts now · read_at ts null | idx (user_id, created_at DESC) · (user_id) WHERE read_at IS NULL · FK run CASCADE, task SET NULL | SELECT/UPDATE: system OR (user AND tenant AND user_id = app.user_id); INSERT: T (người quyết ghi thông báo cho người khác) |
| `agent_teams` | id · key uq (`^[a-z0-9-]{2,32}$`) · name jsonb {vi,en} · description text '' · mode text ∈ `TEAM_MODES` 'sequential' · lead_agent_id uuid null · limits jsonb `{max_calls:10,max_tokens:200000,max_active_s:600,summary_tokens:200,max_plan_steps:5}` · enabled bool true · version int 1 · created_at/updated_at | FK lead→agents RESTRICT | không RLS (cấu hình như `agents`); hub_rw SELECT; ghi seed/system |
| `agent_team_members` | team_id · agent_id · role text 1..40 · sections text[] '{}' · position smallint | pk (team_id, agent_id) · uq (team_id, position) · FK CASCADE/agents RESTRICT | như trên |
| `agent_team_entitlements` | team_id · tenant_id · granted_by uuid null · granted_at ts now · revoked_at ts null | pk (team_id, tenant_id) | như `agent_entitlements` |

### 2.2 Cột/ràng buộc thêm trên bảng chung (mọi cột null, không default ⇒ không đổi hàng cũ)
| Bảng | Thêm | Dùng bởi |
|---|---|---|
| `runs` | process_run_id, stage_run_id, team_run_id uuid null · CHECK (process_run_id IS NULL) = (stage_run_id IS NULL) · idx `runs_process_run_idx` (process_run_id) WHERE NOT NULL | PF1 ghi, PF4 đọc usage |
| `conversations` | process_run_id uuid null (đánh dấu hội thoại nền, không FK) · uq WHERE NOT NULL | Bước 0 lọc C1 |
| `room_messages` | process_run_id uuid null FK process_runs SET NULL · idx WHERE NOT NULL · `ALTER POLICY room_messages_insert` thêm `AND (process_run_id IS NULL OR hub.is_process_trigger(room_id, process_run_id, flow_id))` (definer: run cùng tenant, `origin_room_id = room_id`, `started_by = app.user_id`) | PF1 ghi, FE đọc |
| `audit_log` CHECK | action += start, cancel, decide, review, answer, forward, view, copy, authorize_real_action · entity += process_def, process_run, review_task, agent_team | mọi PF |
GRANT: hub_rw SELECT/INSERT/UPDATE bảng mới (không DELETE, trừ process_defs qua system), agent_runtime không quyền. Hàm definer: `hub.is_process_trigger(uuid,uuid,uuid)`, `hub.process_run_viewer(p_run uuid) RETURNS text` ('full'/'task'/NULL — dùng trong repo xem, §5), search_path cố định như 0011.

## 3. Máy trạng thái (hàm thuần `core/process-state.rules.ts`, Bước 0)
### 3.1 process_run — `running | waiting_review | waiting_answer | needs_decision | done | cancelled | failed | expired`
| Từ | Sự kiện | Điều kiện | Tới |
|---|---|---|---|
| — | start | `canRun` + active < 5/tenant (khoá advisory `process:<tenant>`) | running (stage 0 `queued`) |
| running | stage → waiting_review / waiting_answer / needs_decision | theo stage hiện tại | cùng tên |
| running | stage done, còn stage | — | running (stage kế `queued`) |
| running | stage done, stage cuối | — | done |
| waiting_review | review pass | task open, người quyết hợp lệ | running (stage kế queued) / done |
| waiting_review | review fail | `feedback` ≠ rỗng; `attempt < attempt_limit` | running (cùng stage, attempt+1, queued) |
| waiting_review | review fail | `attempt = attempt_limit` | needs_decision{redo_limit} |
| waiting_answer | answer | task open | running (stage `queued`, tiếp attempt) |
| needs_decision | decide add_attempt | người quyết (M5) | running (`attempt_limit`/`ask_limit` +1 theo lý do; stage queued) |
| needs_decision | decide use_current | có output | stage có gate & lý do ≠ redo_limit ⇒ waiting_review (task mới, output hiện có) · lý do redo_limit ⇒ như pass (người quyết thuộc Group) · gate auto ⇒ như done |
| needs_decision | decide cancel / cancel | — | cancelled |
| bất kỳ chưa kết thúc | cancel | người bắt đầu / tenant_admin | cancelled (huỷ run stage đang chạy, đóng task `cancelled`) |
| bất kỳ chưa kết thúc | `now ≥ expires_at` | vòng quét | expired (đóng task `expired`; **không** tự duyệt) |
| running | lỗi không phục hồi (snapshot hỏng) | — | failed |
Kết thúc: done/cancelled/failed/expired — không chuyển tiếp; mọi lệnh ⇒ 409 `PROCESS_RUN_STATE`.

### 3.2 stage_run — `pending | queued | running | waiting_answer | waiting_review | needs_decision | done | cancelled | failed`
pending → queued (tới lượt) → running (kick: kiểm quyền đạt) · running →(output, template đạt) waiting_review (gate review) / done (gate auto) · running →(template hỏng, `attempt < limit`) queued (attempt+1, `feedback` = lỗi kiểm, M3) / needs_decision{template_invalid} · running → waiting_answer (need_input, `asks_count < ask_limit`, `asks_count`+1) / needs_decision{ask_limit} · running → needs_decision{team_calls|team_tokens|team_time|team_no_change|job_timeout|stage_tokens|run_tokens|agent_failed|interrupted} · queued →(kiểm lại quyền hỏng) needs_decision{permission_lost|user_inactive}. Hàng `pending` tạo đủ lúc start (≤ 10).

### 3.3 team_run — `running | waiting_answer | done | limit | failed | cancelled`
Trước **mỗi** lần gọi: `teamLimitHit` (calls ≥ max_calls ⇒ calls; tokens ≥ max_tokens ⇒ tokens; active_ms ≥ max_active_s·1000 ⇒ time) ⇒ `limit` + stage needs_decision. Sau mỗi lần gọi: cộng usage job (in+out+cache), hash file ghép; trùng hash 2 lần liền ⇒ `limit{no_change}`. need_input (gộp câu hỏi khi song song) ⇒ waiting_answer, `active_ms += now − segment_started_at`; trả lời ⇒ running tại `cursor`. Làm lại = team_run **mới** (giới hạn mới).

### 3.4 review_task — `open → closed` (khoá: `UPDATE … WHERE id=$1 AND status='open' RETURNING`; 0 hàng ⇒ 409 `REVIEW_TASK_CLOSED`)
| kind | Đóng bởi | result | Ghi chú |
|---|---|---|---|
| review | `POST /review-tasks/:id/decision` | pass / fail (fail cần feedback ⇒ else 422) | người quyết ∈ assignee (user hoặc thuộc group); không sửa output |
| ask | `POST /review-tasks/:id/answer` | answer | trả lời đầu thắng; người khác sau ⇒ 409 |
| decision | `POST /process-runs/:id/decide` | add_attempt / use_current / cancel | M5 |
| mọi kind | run cancel / expired / stage bị thay | cancelled / expired / superseded | |
**Forward** (`POST /review-tasks/:id/forward`, task vẫn open): thêm `review_task_assignees{via:forward, depth = số forward hiện có + 1}`; depth > 3 ⇒ 409 `FORWARD_LIMIT`; review: người nhận phải thuộc `assignee_group_id` (ConfigCache `groupIds`) ⇒ else 403 `FORWARD_OUT_OF_GROUP`; ask: user active cùng tenant, ≠ chính mình, chưa là assignee ⇒ else 422 `FORWARD_TARGET_INVALID`; decision ⇒ 409 `TASK_KIND_MISMATCH`. Người chuyển vẫn giữ quyền trả lời.

## 4. Giới hạn — điểm thực thi
| Giới hạn | Ở đâu (file) | Hành vi |
|---|---|---|
| 5 run đồng thời/tenant (`PROCESS_RUNS_PER_TENANT`) | start (`runs/start.service.ts`), dưới `pg_advisory_xact_lock(hashtext('process:'‖tenant))`, đếm `process_runs_active_idx` | 429 `TOO_MANY_PROCESS_RUNS` + `Retry-After: 30` |
| Làm lại ≤ 3/stage | gate fail (`gates/gates.service.ts`) | needs_decision{redo_limit} |
| Hỏi lại ≤ 3/stage | kết quả need_input (`runs/stage-driver.ts`) | needs_decision{ask_limit} (không tính làm lại) |
| Chuyển ≤ 3 | forward (`asks/asks.service.ts`) | 409 `FORWARD_LIMIT` |
| Team-run 10 lần gọi / 200k token / 10 phút chạy / 2 lần không đổi | `runs/team-runner.ts` trước/sau mỗi job | team_run limit ⇒ needs_decision |
| Job 10 phút (≤ 60) | `stage.timeout_s` (60..3600) ⇒ `AgentTask.agent.timeoutS` | TIMEOUT ⇒ needs_decision{job_timeout} |
| Ngân sách token stage/run | sau mỗi job: Σ usage stage ≥ `stage.token_budget` / Σ run ≥ `def.token_budget` (null = không) | needs_decision{stage_tokens|run_tokens} |
| Sống 7 ngày (`PROCESS_RUN_TTL_DAYS`) | vòng quét 60 s (`runs/sweeps.ts`) | expired |
| Nhắc sau 1 ngày | vòng quét 5 phút (`notify/reminder.ts`) `remind_at ≤ now AND reminded_at IS NULL` | notice `reminder` + reminded_at; chỉ nhắc 1 lần |

## 5. Quyền xem / thao tác (`core/run-access.rules.ts`, Bước 0) — HUB-BR-25 (hard stop)
| Ai | Truy cập | Được |
|---|---|---|
| started_by | full | xem mọi thứ, huỷ, quyết (M5), trả lời ask của mình |
| Thành viên **đang hoạt động** của `origin_room_id` | full | xem; không huỷ/quyết |
| `tenant_admin` cùng tenant · `platform_admin` (`?tenant_id`) | full | xem, huỷ, quyết |
| Assignee task (user, thành viên group, người được chuyển) | task | chỉ task của mình: output đang kiểm (review) hoặc câu hỏi + ghi chú + trích đoạn (ask) + tiến độ stage (tên + trạng thái); run kết thúc ⇒ chỉ phần task (M4); token chỉ tổng run/stage |
| Khác / tenant khác | — | **404** (không lộ tồn tại) |
Luôn: repo đọc dưới scope `user` của người xem (RLS T); quyền tính bằng **một** truy vấn `hub.process_run_viewer` + rule thuần. Truy cập `task`: audit `view` (entity review_task) **lần đầu** mỗi (task, user) + **mỗi** lần đọc output (`/outputs/:oid`). Người ngoài phòng **không** có đường tới `room_messages` (RLS X2a `is_room_member` giữ nguyên), hội thoại nền (C1 lọc `process_run_id IS NULL`), `hub.runs` stage (RLS chủ run).

## 6. Token (HUB-FR-116, 117)
Nguồn duy nhất `hub.usage_logs` (Runtime ghi, `job_id` unique, `run_id`, `step_id`, model, in/out/cache, latency_ms). `GET /process-runs/:id/usage` = `usage_logs ul JOIN runs r ON r.id = ul.run_id AND r.process_run_id = $1` (`runs_process_run_idx` → `usage_logs_run_idx`) `LEFT JOIN run_steps s ON s.id = ul.step_id` (`detail.team_run_id`, `member_key`, `role` plan/member/agent) — đọc scope `system` **sau** khi kiểm quyền (run_steps RLS chủ). Gom thuần `usage/usage.rules.ts` (run → stage → team-run → lần gọi); tổng phải = Σ usage_logs (AC-H34). `process_runs.tokens_total`/`team_runs.tokens` chỉ để chặn giới hạn nhanh.

## 7. Cú pháp `!` (`core/bang.rules.ts`, Bước 0; HUB-BR-28, M2)
Bỏ khoảng trắng ASCII đầu (như `routeMessage`). `!!…` ⇒ chữ, bỏ một `!` · `!<tok>` với `tok` (tới khoảng trắng) khớp `^[a-z0-9-]{2,32}$` (so sánh chữ thường) ⇒ `{process, key, input = phần còn lại trim}` · `!` trơn / tok sai dạng ⇒ `{invalid}` ⇒ 404 `PROCESS_NOT_FOUND{suggestions ≤ 3}` · khác ⇒ `none` (đường cũ). Phòng: kiểm **trước** `routeRoomMessage`, bỏ qua khi có `answer_run_id`; Hỏi AI: trước `routeMessage`. Namespace riêng: `/` (command) và `@` không bị ảnh hưởng; `/` trong phòng vẫn là chữ (X2b Q10).

## 8. Bước 0 — ranh giới (CR-059; ≥ 2 PF ⇒ Bước 0; **bổ sung: plan-step0 §2**)
| Phần | Nội dung chính xác | File |
|---|---|---|
| **0a** contract (B2) | Toàn bộ `plan-contract.md` §1–§5 (zod + mã lỗi + sự kiện + hằng trạng thái), export subpath; fixture + mock cho cả 4 PF | `packages/contracts/src/chat/processes.ts`, `chat/processes-errors.ts`, `chat/me-stream-process.ts`, `chat/index.ts` (+export), `chat/rooms.ts` (+`process_run_id?` ở `RoomMessage`), `hub-admin/processes.ts`, `hub-admin/index.ts`; `tools/mocks/src/chat/processes/{fixtures,runs,gates,asks,inbox,usage}.ts` + đăng ký route mock |
| **0b** DB (B1) | §2 đủ (mọi bảng/cột/RLS/definer/GRANT/CHECK audit) | `packages/db/migrations-hub/0019_pa_process_engine.sql`, `meta/_journal.json`, `src/schema/hub-processes.ts`, `src/schema/hub.ts` (+3 cột `runs`, 1 cột `conversations`, enum audit), `hub-rooms.ts` (+cột) , `packages/db/README.md` |
| **0b** khung (B0) | Module + stub rỗng đúng chữ ký (§9), luật thuần dùng chung **có thân** (`process-state`, `run-access`, `bang`, `limits`), ports, `events.ts` (dựng `UserEvent` quy trình), repo lõi (`lockRun`, `loadRunHead`, `insertTask`+assignees, `closeTask`) | `apps/hub-api/src/modules/processes/{README.md, processes.mount.ts, core/*}` + file stub mỗi PF (§9) |
| **0b** điểm nóng | (1) `app.ts`: `PROTECTED_PREFIXES` += `/processes`, `/process-runs`, `/review-tasks`, `/process-defs`, `/agent-teams`; gọi `mountProcesses` khi cờ bật · (2) `config/env.ts`: `HUB_PROCESS_ENGINE` · (3) `runs/create-run.ts` + `runs.repo.ts`: `CreateRunInput.process?: {processRunId, stageRunId, teamRunId, files, preconfirm?: {workflowIds, decidedBy}}` (ghi 3 cột, bỏ giới hạn user, chèn `tool_confirmations` D4 sau bước tool_confirmations) · (4) `runs/runs.service.ts`: `prepareProcess` (D3) · (5) `conversations/conversations.repo.ts:34` + `runs/runs.repo.ts:41`: thêm `isNull(c.processRunId)` cho C1 · (6) `runs/runs.routes.ts` sendMessage: tham số `processStart?: ProcessStartPort` — `classifyBang` trước `routeMessage` ⇒ 202 · (7) `rooms/messages/messages.service.ts`: `useProcesses(RoomProcessSender)` + nhánh bang trước `routeRoomMessage`; `SendResult.processRunId?`; `room-messages.routes.ts` header `X-Process-Run-Id` · (8) `me-stream/user-stream-reader.ts` `parseFields` += `parseMeStreamProcessEvent`; `lib/user-stream.ts` `UserEvent` += `MeStreamProcessEvent`, `roomIdOf` an toàn khi không có `room_id` · (9) audit: `lib/hub-audit.ts` không đổi (enum lấy từ schema) | như cột trái |
| **0c** defs + seed (B3) | `process_defs` CRUD + chép mẫu + run từ admin (stub → PF1 `StartPort`), `GET /agent-teams`; seed `processes.yaml`: 2 mẫu (SDLC 8 stage theo WORKFLOW — **xem `plan-seed.md` D18**, hoá đơn 2 stage + "Hành động thật"), nhóm `ba-team` + `plan-team`/`dev-team`/`test-team`, agent vai (`fake-cli` dev), bật nhóm cho tenant dev, chép `hoa-don` vào tenant dev gán Group "Kế toán" | `modules/processes/defs/**`, `modules/seed/seed.processes.ts` (+đăng ký trong `seed.ts`, `seed.schema.ts`), `apps/hub-api/seed/processes.yaml`, `agents.yaml` (+8 agent vai, D18) |
| FE (frontend-lead, B0) | Thư mục feature + route/nav rỗng + i18n namespace `process` + đọc cờ (plan-frontend): chat-web `features/processes/{composer,run-block,run-page,inbox,ask,usage}/`, route `/runs/$id`; admin-web `features/processes/`, nav "Quy trình" | `apps/chat-web/**`, `apps/admin-web/**` (chỉ khung) |
Sau Bước 0: đổi contract/DB chỉ qua backend-lead, báo session chính. Bảng/cột **chỉ một** PF dùng mà chưa có ở §2 ⇒ PF tự thêm migration `0020+` chỉ-thêm (đánh lại số khi rebase).

## 9. File theo PF (ngoài cột ⇒ dừng, báo session chính; mở task ask/decision = PF1 — plan-step0 §1)
| PF | Thư mục/file BE (`apps/hub-api/src/modules/processes/…`) | Endpoint/sự kiện sở hữu |
|---|---|---|
| Bước 0 | `processes.mount.ts`, `core/{process-state.rules,run-access.rules,bang.rules,limits.rules,ports,events,core.repo,core.types}.ts`, `README.md` | — |
| 0c (B3) | `defs/{def.rules,defs.repo,defs.service,defs.routes,teams.repo,teams.routes}.ts` | `/process-defs*`, `GET /agent-teams` |
| PF1 | `runs/{start.service,room-start,conversation-start,stage-driver,team-runner,team.rules,template.rules,launcher,view.service,runs.repo,runs.routes,sweeps}.ts`, `gates/{gate.rules,gates.service,gates.repo,gates.routes}.ts` | `GET /processes`, `POST/GET /process-runs`, `GET /process-runs/:id`, `/outputs/:oid`, `POST /process-runs/:id/{cancel,decide}`, `POST /review-tasks/:id/decision`; phát `process.updated` |
| PF2 | `asks/{ask.rules,asks.service,asks.repo,asks.routes}.ts` | `POST /review-tasks/:id/{answer,forward}` |
| PF3 | `notify/{notify.rules,notifier,inbox.repo,inbox.service,inbox.routes,reminder}.ts` | `GET /me/review-tasks`, `GET /me/process-inbox`, `POST /me/process-inbox/read`; `review_task.*`, `process.notice` (implement `ProcessNotifier`; Bước 0 = no-op) |
| PF4 | `usage/{usage.rules,usage.repo,usage.service,usage.routes}.ts` | `GET /process-runs/:id/usage` |
Ports (Bước 0, `core/ports.ts`): `ProcessStartPort` (PF1) · `StageLauncher.kick(runId)` (PF1; PF2 gọi sau trả lời) · `ProcessNotifier` (PF3; PF1/PF2 gọi trong tx, trả `UserEvent[]` phát sau COMMIT). PF2 test được trước PF1 nhờ fixture run `waiting_answer` (seed test) + `kick` giả.

## 10. Thứ tự khoá (mọi tx ghi quy trình)
`rooms` (chỉ khi bắt đầu từ phòng) → advisory `process:<tenant>` (chỉ start) → `process_runs` FOR UPDATE → `stage_runs` → `team_runs` → `process_outputs` → `review_tasks` → `review_task_assignees` → `process_notices` → [`createRunTx`: advisory user → conversations → flows → runs → messages → tool_confirmations] → `audit_log`. `writer.finish` run stage luôn ở tx **sau** (D11). Int test `lock-order` cho: duyệt ∥ huỷ ∥ hết hạn trên cùng run; trả lời ∥ chuyển cùng task.

## 11. Hiệu năng (CONVENTIONS §6, ưu tiên thấp — `test:perf`, không chặn)
| Truy vấn | Index | Ngân sách |
|---|---|---|
| `GET /processes` | `process_defs (tenant_id, updated_at)` + lọc group trong bộ nhớ (≤ 200) | p95 < 100 ms |
| Đếm run đồng thời | `process_runs_active_idx` | < 5 ms |
| `GET /me/review-tasks` | assignees `(user_id, created_at)` ∪ `(group_id)` + tasks open | p95 < 300 ms với 5 000 task |
| `GET /process-runs/:id` | pk + `stage_runs` uq + tasks `(process_run_id, created_at)` (history ≤ 200) | < 300 ms |
| usage | `runs_process_run_idx` + `usage_logs_run_idx` | < 300 ms với 200 lần gọi |
| Vòng quét | partial index queued / active expires / remind_at | mỗi vòng ≤ 100 hàng (`LIMIT`) |
`/me/stream`: ≤ 100 lệnh Redis/lần phát (như X2b §10); người nhận group lấy từ `admin.group_members` một truy vấn.

## 12–13. Security review + `done:pa` — [`plan-contract.md`](plan-contract.md) §8–9

## 14. Quyết định M1–M6 (Luật 2) và câu hỏi — xem spec §9 "Trong lúc làm" (ghi đủ ở đó).
