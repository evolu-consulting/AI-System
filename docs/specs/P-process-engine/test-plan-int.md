# Test plan phụ lục · Int P-a (qc) — ca theo Bước 0 / PF1–PF4 + ma trận cách ly + kịch bản seed

Thuộc [`test-plan.md`](test-plan.md) (persona §2, bố cục §1). Hub thật in-process (`createApp`, cờ `processEngine` on trừ khi ghi), runtime giả claim `hub.jobs` và trả `done{text}` / `need_input{question,choices}` / `failed{code}` + ghi `usage_logs` (step_id theo payload). "⇢PF1" = cần PF1 trên `main`. Mã lỗi/trường theo plan-contract §3–§4.

## 1. Bước 0 — `tests/acceptance/P-a/step0/*.int.test.ts`
| Mã | Yêu cầu | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| S0-01 | B1 | `migration` | chạy `0019` 2 lần | lần 2 không lỗi; 11 bảng + 5 cột mới (`runs` ×3, `conversations`, `room_messages`) tồn tại, cột null |
| S0-02 | BR-25 | `rls` | 1 run acme + 1 run beta mọi bảng con (SQL scope system) | scope `user` acme: SELECT beta = 0 hàng ở `process_runs`, `stage_runs`, `team_runs`, `process_outputs`, `review_tasks`, `review_task_assignees`; UPDATE beta = 0 hàng; DELETE `process_runs` ⇒ lỗi quyền |
| S0-03 | D12 | ″ | notice cho A và T | scope user T: SELECT chỉ của T; UPDATE `read_at` notice A = 0 hàng; INSERT notice cho A (cùng tenant) được; tenant khác ⇒ lỗi RLS |
| S0-04 | §2 CHECK | ″ | task review không `output_id`; ask không `question`; assignee cả user+group / cả hai null; `runs.process_run_id` không kèm `stage_run_id`; 2 task `open` cùng (stage_run, kind) | mỗi cái lỗi ràng buộc; audit action `authorize_real_action` + entity `process_run` chèn được |
| S0-05 | §2.2 | ″ | `room_messages.process_run_id` = run của người khác / run phòng khác / run tenant khác (scope user B) | lỗi policy `room_messages_insert`; run của chính A ở R ⇒ được |
| S0-06 | BR-25 | ″ | `hub.process_run_viewer(run)` dưới scope user A, X, T(assignee), H, L, D | 'full','full','task',NULL,NULL,NULL |
| S0-07 | §2 GRANT | ″ | role `agent_runtime` | SELECT bảng mới ⇒ permission denied |
| S0-08 | T4, plan-contract §8 | `rls` | scope user A (thành viên R): INSERT `room_messages` `sender_type='process'` (đủ cột process, `flow_id` thread run của A); gọi `hub.room_post_process_message(ev)` | **42501** cả hai; 0 tin mới; `last_seq` R không đổi |
| S0-09 | plan-thread §3 | ″ | scope user A: INSERT `process_thread_events` acme / beta; SELECT, UPDATE `process_thread_events` | INSERT acme được, beta lỗi RLS; SELECT = 0 hàng, UPDATE = 0 hàng (chỉ `system`); CHECK `kind` ∉ 7 / `content` 501 ký tự ⇒ lỗi; `room_messages_process_ck` (process thiếu `process_meta`, có `run_id`) ⇒ lỗi; uq 2 `block` cùng run ⇒ lỗi |
| S0-10 | D15 | `flag` | cờ **off**: `GET /processes`, `POST /process-runs`, `GET /process-runs/x`, `/review-tasks/x/decision`, `/me/review-tasks`, `/me/process-inbox`, `/process-defs`, `/agent-teams` | 404 tất cả; A gửi `"!hoa-don x"` ở R ⇒ 201 tin thường, không header, 0 `process_runs`; Hỏi AI ⇒ đường SSE cũ (xanh trước code) |
| S0-11 | M2, BR-28 | ″ | cờ on: phòng `"!!abc"`; Hỏi AI `"!!abc"` | 201 tin nội dung `"!abc"`, 0 run; Hỏi AI gửi `"!abc"` qua đường cũ |
| S0-12 | C1, BR-25 | ″ | hội thoại có `process_run_id` (SQL) của A | không có trong `GET /conversations` của A; `GET/POST /conversations/:id` ⇒ 404; `/runs` liệt kê không lộ |
| S0-13 | D16 | ″ | `/me/stream` nhận `process.updated` XADD tay | client parse được; sự kiện X2a/X2b cũ vẫn đến |
| S0-14 | T7, CHAT-AC-52 | `thread-route` | fixture SQL: run A origin R, `flow_id` F, khối `block` đã đăng; B `POST /rooms/R/messages {flow_id:F}`: "Đã gửi file"; "@hd-read xem lại"; "!hoa-don-t x"; "!!x"; kèm `answer_run_id` của run X2b; `flow_id` F ở phòng khác | 201, 0 `hub.runs`, tin `user` trong thread (`GET ?flow_id=F`); **422 `PROCESS_THREAD_NO_AGENT`**, không lưu tin, 0 run; 201 chữ thường, 0 `process_runs`; 201 nội dung "!x"; 404 `NOT_FOUND`; 404 |
| S0-15 | T5 | `thread-poster` | 3 sự kiện chưa đăng của run (SQL, `created_at` t1<t2<t3, kind block/output/ask); `postThreadOnce` ×2; thêm 1 sự kiện ⇒ `ThreadPoster.post(run)` ∥ `postThreadOnce` | 3 tin `sender_type='process'`, `id = event.id`, `seq` tăng theo t1→t3, `placement` main/flow/flow, `sender_id` = `process_def_id`, `process_kind` + `process_meta` đúng; lần 2 = 0 tin; song song ⇒ đúng 1 tin; mọi sự kiện `posted_at` + `outcome=posted` |
| S0-16 | T10 | ″ | phòng R xoá mềm (X2a) trước khi đăng; run origin không phải room (`enqueueThread` origin conversation/none) | sự kiện `outcome=skipped`, 0 tin, run không đổi trạng thái; `enqueueThread` trả `""`, 0 hàng sự kiện |
| S0-17 | §10, plan-thread §3 | ″ | ×20 vòng: `postThreadOnce` ∥ tx giả lập start (`rooms` FOR UPDATE → INSERT `process_runs`) ∥ tx giả lập cổng (`process_runs` FOR UPDATE → INSERT sự kiện) cùng phòng | không `40P01`/timeout; mọi sự kiện đăng đúng 1 lần |
| S0-18 | T1, plan-thread §4 | `thread-read` | fixture: khối `block` + 2 tin flow `output`/`task_result`; `process_meta` hỏng ở 1 tin | `GET /rooms/R/messages` (main): khối có `sender.display_name` = tên quy trình snapshot, `process.kind=block`, `flow{message_count:2, recent[].process.kind}`; `?flow_id=F` trả 2 tin + tin gọi, `process` parse `RoomProcessPart`; tin hỏng: không có `process`, giữ `content`; danh sách phòng: preview tin cuối có tên quy trình; tin `agent` X2b cùng phòng không đổi dạng |
| S0-19 | T9 | `thread-unread` | B, X là thành viên, đang không mở R; đăng 1 khối + 1 tin flow; X mở flow (`room_flow_reads`) | B, X nhận `room.message` + `room.unread` (đếm như tin agent trong thread X2b, theo `last_seq` + `room_flow_reads`); X đọc flow ⇒ chưa đọc thread về 0; T (ngoài R) không nhận sự kiện nào; không loại sự kiện `/me/stream` mới; mốc đọc của ai cũng không bị poster đổi |
| S0-20 | ADM-FR-65 | `defs` | tadmin `GET /process-defs` | có mẫu `sdlc`, `hoa-don` (`is_template`) + quy trình acme; không có của beta; member ⇒ 403 |
| S0-21 | ″ | ″ | tadmin `POST /process-defs/:sdlc/copy` | 201 `enabled=false`, mọi `after.group_id=null`, `source_template_id`; lần 2 cùng key ⇒ 409 `PROCESS_KEY_TAKEN`; `{key:"sdlc-2"}` ⇒ 201 |
| S0-22 | ″ | ″ | P `POST /process-defs` không `tenant_id` | 201 mẫu `tenant_id=null`; tadmin `PUT` mẫu ⇒ 403 `TEMPLATE_READ_ONLY` |
| S0-23 | ″ | ″ | P `GET /process-defs` không `tenant_id` | chỉ mẫu hoặc 400 `TENANT_REQUIRED` cho dữ liệu tenant (theo contract §6) |
| S0-24 | ″ | ″ | `tadmin_beta` `GET/PUT /process-defs/:id_acme` | 404 |
| S0-25 | ADM-FR-66 | ″ | `PUT … enabled=true` khi stage review `group_id=null` | 422 `PROCESS_DEF_INCOMPLETE{paths:["stages.0.after.group_id"]}` |
| S0-26 | HUB-FR-109 | ″ | `real_action` ở stage 0; stage trước `after.auto` | 422 `PROCESS_DEF_INVALID{paths}` |
| S0-27 | P-R02 | ″ | agent chưa bật cho acme; team chưa bật; group beta; user beta | 422 `PROCESS_REF_INVALID{path, ref}` đúng ref |
| S0-28 | ″ | ″ | `PUT` version cũ; `DELETE ?version=` cũ | 409 `VERSION_CONFLICT` |
| S0-29 | ″ | ″ | tạo/sửa/chép/xoá | mỗi lần 1 audit (`copy` cho chép); `version`+1; xoá mềm (`deleted_at`), `GET` ⇒ 404 |
| S0-30 | HUB-FR-114 | ″ | `GET /agent-teams` tadmin acme; member | chỉ nhóm có entitlement acme chưa revoke (members theo `position`, `sections`); 403 |
| S0-31 | ADM-FR-67 | ″ | `POST /process-defs/:id/run` P; quy trình tắt / mẫu | 403 `FORBIDDEN`; 404 `PROCESS_NOT_FOUND` |
| S0-32 | D18 | `seed` | `hub:seed` dev | mẫu `sdlc` 8 stage: key/executor (`intake-analyst`, `docs-architect`, `plan-team`, `qc`, `spec-readiness`, `dev-team`, `test-team`, `reviewer`), `after` review ở 1, 5, 8, auto ở 2–4, 6–7; required_sections đúng bảng D18 |
| S0-33 | ″ | ″ | ″ | mẫu `hoa-don` 2 stage (1 review, 2 `real_action`); `plan-team`/`dev-team`/`test-team` `sequential` đúng thứ tự thành viên; bản `hoa-don` của tenant dev gán Group "Kế toán", bật; seed lần 2 không nhân đôi |

## 2. PF1 — `tests/acceptance/P-a/pf1/`
| Mã | Yêu cầu | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| P1-01 | AC-H28, FR-105, D13 | `start` | A `"!hoa-don-t HD-12"` ở R | 201 `RoomMessage{process_run_id, flow_id}` + `X-Process-Run-Id` + `X-Flow-Id` (= `process_runs.flow_id`); 1 `process_runs` (origin room, `started_by`=A, `def_version`, `snapshot` = def); 1 `hub.runs` `direct` user A có `process_run_id`/`stage_run_id`; hội thoại nền; sau `postThreadOnce`: đúng 1 tin `process` kind `block` (main, cùng `flow_id`, `seq` sau tin gọi) — tổng tin main +2; `trigger_message_id` = tin gọi |
| P1-02 | BR-28 | ″ | `"!hoa-dn x"`; `"!"` | 404 `PROCESS_NOT_FOUND{suggestions:["hoa-don-t"]}`; tin không lưu; 0 run; 0 job Orchestrator |
| P1-03 | M1 | ″ | `run_group_ids=[Kế toán]`, X gửi; quy trình tắt; đã xoá; mẫu | 404 cùng dạng P1-02 (không phân biệt) |
| P1-04 | §7 | ″ | tin có `answer_run_id` + nội dung `"!hoa-don-t"` | đi đường trả lời X2b, không tạo run |
| P1-05 | CHAT-AC-52, D14 | ″ | `POST /conversations/:id/messages "!hoa-don-t x"` | **202** `{process_run}` + header; không tin mới trong hội thoại; origin conversation; `GET /process-runs?conversation_id=` có run; 0 `process_thread_events` (D14: không thread); `GET` view `thread=null` |
| P1-06 | §3 | ″ | `POST /process-runs` origin none / room không là thành viên / conversation của B | 201 / 404 `NOT_FOUND` / 404 |
| P1-07 | FR-105, §2.1 | ″ | 5 run active acme (SQL) | lần 6 ⇒ 429 `TOO_MANY_PROCESS_RUNS` + `Retry-After: 30`, tin phòng không lưu (ROLLBACK), 0 `process_thread_events` (outbox cùng tx); beta vẫn 201; 1 run → done ⇒ 201 |
| P1-08 | ″ | ″ | 4 active, 6 yêu cầu song song | đúng 1 × 201, 5 × 429 (advisory lock) |
| P1-09 | X2b | ″ | trùng `client_msg_id` | 200 tin cũ, vẫn 1 run |
| P1-10 | CHAT-AC-51 | ″ | `GET /processes` A / X | chỉ quy trình bật + group cho phép, sort tên, không mẫu, không beta; X không thấy `hoa-don-t` |
| P1-11 | ADM-FR-67 | ″ | `GET /process-runs` mine; `scope=tenant` member / tadmin; `room_id` R của H; cursor 3/2 | của A; 403 / mọi run acme; 404; trang 2 đúng |
| P1-12 | ADM-FR-67 | ″ | tadmin `POST /process-defs/:id/run` | 201 origin admin, `started_by`=tadmin |
| P1-13 | BR-24, BR-21 | ″ | run qua gate do B, T | mọi `hub.runs` stage `user_id`=A; `usage_logs` chỉ A; B, T usage = 0 |
| P1-14 | Q5 | ″ | quota A hết (H2b) giữa run | stage ⇒ needs_decision `agent_failed`; không job theo B |
| P1-20 | AC-H28, P-R03 | `stage` | runtime trả md đủ mục | `process_outputs` v1 `template_ok`; attachment `origin=output` của A; review_task open group Kế toán (assignee group); run `waiting_review` |
| P1-21 | M3 | ″ | lần 1 thiếu `## Tổng tiền` | v1 `template_ok=false` `template_missing`; attempt 2 tự chạy, prompt job chứa lỗi kiểm; hết lượt ⇒ needs_decision `template_invalid` |
| P1-22 | FR-106, D6 | ″ | stage 2 | payload job có file output đã chốt stage 1; làm lại có góp ý trong prompt |
| P1-23 | BR-27, AC-H33 | ″ | run ở gate 1; tadmin `PUT` đổi agent stage 2 + tên | stage 2 chạy agent **cũ** theo snapshot; run mới dùng bản mới; `DELETE` def ⇒ run đang chạy vẫn chạy |
| P1-24 | AC-H33, BR-23 | ″ | ở gate 1: thu hồi grant A cho `hd-post` (bump config) / khoá A | B Đạt ⇒ 0 `hub.runs` stage 2; run needs_decision `permission_lost` / `user_inactive`, options 3 |
| P1-25 | §2.1 | ″ | `timeout_s=60`, runtime `failed{TIMEOUT}` | needs_decision `job_timeout` |
| P1-26 | BR-26 | ″ | runtime `failed` | needs_decision `agent_failed`; không chạy stage kế |
| P1-27 | HUB-FR-116, C1 | ″ | `token_budget` stage 1 000, usage 1 500; def 2 000 run; null | `stage_tokens`; `run_tokens`; null ⇒ chạy tiếp |
| P1-28 | D11 | ″ | stage `running`, `hub.runs` kết thúc > 60 s (SQL) + `sweepOnce`; `POST /runs/:stage/cancel` | needs_decision `interrupted` (cả hai) |
| P1-29 | K4 | ″ | `stage_runs.status=queued` không kick (SQL) + `sweepOnce` | stage `running`, đúng 1 `hub.runs` (chạy 2 vòng quét ⇒ vẫn 1) |
| P1-30 | FR-114, Q6 | `team` | `p-team`, `qc-team` 3 thành viên | 3 job riêng (`team_run_id`); job k nhận file chung version k; mục không sở hữu bị bỏ; output ghép đủ 3 mục |
| P1-31 | D7 | ″ | `lead-team`: kế hoạch JSON 2 bước; kế hoạch hỏng | 1 job plan + 2 job member; hỏng ⇒ `plan_fallback` chạy tuần tự |
| P1-32 | AC-H32 | ″ | runtime luôn đổi nội dung; usage 30k/lần; `active_ms` 600 000 (SQL); 2 lần trả y hệt | lần gọi 11 không phát, `stop_reason=calls` ⇒ needs_decision `team_calls`; `team_tokens`; `team_time`; `team_no_change`; mỗi lần options = 3 |
| P1-33 | §2.1 | ″ | Chưa đạt sau P1-30 | `team_runs` mới attempt 2, `calls=0` |
| P1-34 | D8 | ″ | Chưa đạt `sections:["Phần B"]`; góp ý nhắc "phần c"; không khớp | chỉ job m2; m3; cả nhóm |
| P1-35 | AC-H32 | ″ | nhóm need_input lúc `active_ms`=300 000, chờ 20 phút (SQL lùi `segment_started_at`) rồi trả lời | `active_ms` không tính thời gian chờ |
| P1-36 | **C2**, HUB-BR-23 ngoại lệ | `team` | (a) `p-team`: A **không** có `agent_grants` cho `m1`–`m3`, `qc-team` bật cho acme, 3 thành viên bật; (b) như (a), `platform_admin` thu entitlement `qc-team` của acme trước `kick`; (c) tắt agent `m2` trước `kick`; (d) stage agent đơn `hd-read`, A không có grant | (a) stage chạy, 3 job, output ghép; (b) 0 job, needs_decision `permission_lost`, options 3; (c) như (b) (`team_runs` không tạo hoặc `stop_reason` ghi rõ — không chạy thành viên còn lại); (d) needs_decision `permission_lost` (grant vẫn kiểm cho stage agent) |
| P1-37 (cũ P2-01) | AC-H30, FR-110 | `ask-open` | runtime `need_input{"Định dạng ngày?", ["dd/mm","ISO"]}`; input run 1 500 ký tự | stage `waiting_answer`; job kết thúc (không giữ slot); task ask open: question, choices, `excerpt` = 1 000 ký tự đầu (C4), assignee theo `stage.answerer` (mặc định A); `asks_count=1`, `attempt` giữ; sự kiện thread `ask` (`asks_count`, `ask_limit`) (notice `ask_requested` kiểm ở PF3, không ở đây) |
| P1-38 (cũ P2-10) | AC-H30 | ″ | need_input lần 4 cùng stage (SQL `asks_count=3`) | needs_decision `ask_limit`; `attempt` không đổi; A `decide add_attempt` ⇒ `ask_limit=4`, stage queued |
| P1-39 (cũ P2-11 nửa đầu) | FR-110, D7 | ″ | nhóm `parallel_merge`, 2 thành viên need_input | đúng 1 task ask (câu gộp `mergeQuestions`, có vai), team `waiting_answer`, 1 sự kiện thread `ask` |
| P1-40 | AC-H28 | `gates` | B `decision fail` không / `"   "` feedback | 422 `FEEDBACK_REQUIRED`; task vẫn open |
| P1-41 | AC-H28 | ″ | B fail "Thiếu MST" | 200 `TaskDetail result=fail`; stage attempt 2, job mới prompt chứa "Thiếu MST"; history `review` |
| P1-42 | AC-H28 | ″ | B pass | stage 2 chạy (1 `hub.runs` mới); `passed_by`=B |
| P1-43 | AC-H28, FR-107 | ″ | fail lần 4 (attempt 4) | needs_decision `redo_limit`, task `decision` open, options `[add_attempt,use_current,cancel]` |
| P1-44 | M5 | ″ | `decide add_attempt` bởi B (Group kiểm); X; T (Q2) | 200 `attempt_limit=5` chạy lại; 403 `NOT_PROCESS_DECIDER`; 200 |
| P1-45 | §3.1 | ″ | `use_current` redo_limit; chưa output; khi không ở needs_decision; B với lý do `team_calls` | như pass; 409 `NO_OUTPUT`; 409 `PROCESS_RUN_STATE`; 403 |
| P1-46 | §3 cancel | ″ | A; tadmin; B; T; H; lần 2 | 200 cancelled (task `cancelled`, `hub.runs` stage huỷ); 200; 403; 403; 404; 409 `PROCESS_RUN_STATE` |
| P1-47 | FR-107 | ″ | B và T `pass` đồng thời ×10 | mỗi vòng đúng 1×200, 1×409 `REVIEW_TASK_CLOSED`; đúng 1 stage 2 |
| P1-48 | §10 | `lock-order` | decision ∥ cancel ∥ expire (`sweepOnce`) cùng run ×20 | không `40P01`/timeout; trạng thái cuối nhất quán, đúng 1 hàng kết thúc |
| P1-49 | §3.4 | ″ | `decision` trên task ask | 409 `TASK_KIND_MISMATCH` |
| P1-50 | §3 | ″ | task đã đóng; X (không assignee); D | 409 `REVIEW_TASK_CLOSED`; 404; 404 |
| P1-51 | readiness #2, M5 | `gates` | needs_decision `redo_limit` (Group duyệt Kế toán); needs_decision `team_calls` | task `decision` assignee: hàng user A + hàng group Kế toán; `team_calls` ⇒ chỉ A; **không** hàng tenant_admin; sự kiện thread `decision {reason, options}` |
| P1-52 | readiness #2 | `view` | P1-51 `redo_limit`, có output / chưa output: T (ngoài R) `GET` run; B; Adm; X | T `access=task`, `my_tasks[0]` kind decision `options` 3 / 2 (không `use_current`), `has_output` true/false, `can_act=true`; B full `my_tasks` có decision `can_act=true`; Adm full `decision.can_decide=true`, `my_tasks` **không** có decision; X `can_decide=false`, `my_tasks=[]` |
| P1-60 | AC-H31, FR-109 | `real-action` | `hoa-don-t`, B pass stage 1; stage 2 gọi `ghi-so` | `tool_confirmations` confirmed `decided_run_id`= run stage 2; mock Dify 1 lần; A không nhận ask xác nhận; audit `authorize_real_action` actor B |
| P1-61 | AC-H31 | ″ | job stage 2 gọi `ghi-so` lần 2 | `CONFIRMATION_REQUIRED`, Dify vẫn 1 lần |
| P1-62 | AC-H31 | ″ | def SQL lách luật: stage 2 `real_action` sau stage auto | không preconfirm; tool ⇒ `CONFIRMATION_REQUIRED`; run needs_decision, không gọi Dify |
| P1-63 | AC-H31 | ″ | `kick` 2 lần song song (2 instance) | 1 `hub.runs` stage 2 (`current_run_id` idempotent), Dify 1 lần |
| P1-70 | FR-113 | `view` | A `GET /process-runs/:id` | `access=full`, stages, history, `my_tasks`, `can_cancel=true`, `decision.can_decide` đúng |
| P1-71 | ″ | ″ | X | full, `can_cancel=false`, `can_decide=false` |
| P1-72 | ″ | ″ | A `GET /outputs/:oid` v1, v2 | 200 cả hai |
| P1-73 | AC-H32, BR-26 | ″ | `expires_at` quá khứ + `sweepOnce` | `expired`, task `expired`, không stage pass; mọi lệnh ⇒ 409 |
| P1-74 | §5 sự kiện | ″ | B pass | `process.updated` tới A, X, T sau COMMIT (đọc `/me/stream`); không tới H, D |
| P1-75 | P-R10, T10, U5 | ″ | starter A rời R giữa run (`waiting_review`); sau đó X gửi góp ý "FB-AFTER-LEAVE" trong F | run chạy tiếp, tin thread vẫn đăng (P1-85); A `GET` run ⇒ 200 **dạng ngoài phòng** (không `full`: `thread=null`, không `history`/tên phòng/tin R, body không chứa "FB-AFTER-LEAVE"; có tiến độ stages, output, `my_tasks` của A); A `GET /me/process-inbox` vẫn thấy task của mình; mỗi lần xem ⇒ audit `view` |
| P1-76 | T8 | ″ | run `waiting_review` (task group Kế toán): X `GET` | full, `my_tasks=[]`, `open_tasks[0]` `{kind:review, group:{name:"Kế toán"}, assignees}`, `thread={room_id:R, flow_id:F}` |
| P1-77 | T8 | ″ | X `POST /review-tasks/:id/decision pass` | 404 (không assignee); task vẫn open; 0 tin `task_result` |

### PF1 · tin thread phòng (U1) — `pf1/thread.int.test.ts` (`processLoops:false`; đăng bằng `postThreadOnce` hoặc chờ `post` sau COMMIT)
| Mã | Yêu cầu | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| P1-80 | T1, plan-thread §2 | `hoa-don-t` ở R: output v1 → B Chưa đạt "Thiếu MST" → v2 → B Đạt → stage 2 xong | `GET /rooms/R/messages?flow_id=F` theo `seq`: tin gọi (user), `output` v1 (`review_task_id`), `task_result {result:fail, feedback:"Thiếu MST", actor:B, outside:false}`, `output` v2, `task_result pass`, `output` stage 2 (`after:auto`, `review_task_id:null`), `run_end {status:done, actor:null}`; khối `block` main; tổng tin process = 7 (T11: không tin mỗi lần gọi) |
| P1-81 | T5 outbox | (a) B Đạt; (b) tx cổng ROLLBACK (B ∥ T Đạt — người thua 409); (c) mô phỏng sập sau COMMIT: sự kiện `output` chèn SQL `posted_at` null, app **bật** vòng (`processLoops` vắng) | (a) tin `task_result` có sau khi 200 trả (chờ điều kiện ≤ 2 s), sự kiện `task_result` cùng tx với đóng task (không có sự kiện nếu task chưa đóng); (b) đúng 1 sự kiện `task_result`; (c) tin xuất hiện trong ≤ 5 s + biên (`waitFor` 8 s), `outcome=posted` |
| P1-82 | §10 | ×20: B Đạt ∥ A `!hoa-don-t` mới ở R ∥ `postThreadOnce` ∥ `sweepOnce` | không `40P01`/timeout; mọi sự kiện đăng đúng 1 lần |
| P1-83 | T6, T8 | run `waiting_review`; B Đạt qua API (không POST tin phòng) | 0 tin `user` mới; 1 tin `task_result` actor B; T (đồng assignee qua group) `can_act=false` sau đó |
| P1-84 | T10 | phòng R xoá (X2a) khi run `running` | run chạy tới `done`; sự kiện sau xoá `outcome=skipped`; A `GET` run full, `thread=null` |
| P1-85 | T10, U5 | A rời R khi run `waiting_review`; B Đạt | run chạy tiếp; `task_result` + `output` stage 2 vẫn đăng vào thread F (`outcome=posted`, không `skipped`); A `GET /rooms/R/messages` và `?flow_id=F` ⇒ 404 như mọi người ngoài phòng (body = `M-404-same`); A `/me/stream` không nhận `room.message`/`room.unread` của R; `GET` run = dạng ngoài phòng (P1-75), không `full` |
| P1-86 | T9, §5 | B Đạt; theo dõi `/me/stream` của A, X, T, H | X (không mở R) nhận `room.message` + `room.unread` +1 cho tin `task_result`; `process.updated` tới A, X, T; T, H **không** nhận `room.*` của R |
| P1-87 | T11, N4 | `p-team` 3 thành viên xong | 1 tin `output`, `process.steps` 3 hàng (`role:member`, `member_key`, `tokens`); `lead-team` ⇒ 1 `plan` + n `member` |
| P1-88 | plan-thread §2 | output thiếu mục (M3); needs_decision `redo_limit`; A huỷ; `sweepOnce` hết hạn | `output.template_ok=false` + `template_missing`; tin `decision {reason, options}`; `run_end {cancelled, actor:A}`; `run_end {expired, actor:null}`; đóng task do hệ thống không sinh `task_result` |
| P1-89 | T1 | `POST /process-runs` origin room R (nút "▶ Quy trình") | 0 tin gọi, 1 khối `block` (`trigger_message_id` null); origin `none`/`admin` ⇒ 0 sự kiện |

## 3. PF2 — `tests/acceptance/P-a/pf2/` (fixture SQL run `waiting_answer` origin R + `stageLauncher` giả ghi runId, trừ khi ⇢PF1; mở task ask là PF1 — P1-37…39)
| Mã | Yêu cầu | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| P2-02 | FR-110 | ″ | A `answer` | 200 `result=answer`; task closed; stage `queued`; `kick(runId)` ghi 1 lần |
| P2-03 | AC-H30, FR-111 | `forward` | A `forward` → H, note "Hỏi kế toán giúp" | 200, `forwards[0]`; assignee `via=forward depth=1`; H `GET` run ⇒ `access=task`, `my_tasks` ask có question + note + excerpt, không output |
| P2-04 | AC-H30, BR-24 | ″ | H trả lời rồi A trả lời | H 200; A 409 `REVIEW_TASK_CLOSED`; audit `answer` actor H; ⇢PF1: job tiếp `user_id`=A, usage A |
| P2-05 | FR-111 | ″ | A ∥ H trả lời ×10 | 1×200, 1×409; `kick` 1 lần |
| P2-06 | AC-H30 | ″ | H→H2→H3 (depth 3); lần 4 | 200 ×3; 409 `FORWARD_LIMIT`; A (người chuyển) vẫn trả lời được |
| P2-07 | FR-111 | ″ | đích K (khoá), D (beta), chính mình, đã là assignee, uuid lạ | 422 `FORWARD_TARGET_INVALID` |
| P2-08 | FR-107 | ″ | B chuyển review → T (cùng Kế toán) / → H | 200 (T thành assignee) / 403 `FORWARD_OUT_OF_GROUP` |
| P2-09 | §3.4 | ″ | `forward` task decision; `answer` task review | 409 `TASK_KIND_MISMATCH` |
| P2-11 ⇢PF1 | FR-110 | `ask` | sau P1-39 (task ask gộp của nhóm) A trả lời | team chạy tiếp tại `cursor` (không chạy lại thành viên đã xong) |
| P2-12 | CHAT-AC-57 | `forward` | A gửi tin phòng "@Thomas trả lời giúp" | 0 assignee mới, task không đổi |
| P2-13 | §3 | ″ | `answer` bởi X; D; stage `answerer=group` | 404; 404; mọi thành viên group là assignee (Q7) |
| P2-14 | §10 | `lock-order` | answer ∥ forward cùng task ×20 | không deadlock; nếu answer thắng thì forward ⇒ 409 |
| P2-15 | contract | `forward` | answer `""`, 4 001 ký tự; note 501 | 400 `VALIDATION_ERROR` |
| P2-16 | T6, T8, plan-thread §2 | `thread` | fixture run origin R (thread F) `waiting_answer`; A chuyển → H note "NOTE-SECRET-P2"; H (ngoài R) trả lời "dd/mm"; sau `postThreadOnce` | thread F có `forward {from:A, to:H, depth:1}` (không `note`; chuỗi "NOTE-SECRET-P2" không có trong `content`/`process_meta` mọi tin R) rồi `task_result {task_kind:ask, actor:H, outside:true, answer:"dd/mm"}`; H `GET /rooms/R/messages?flow_id=F` ⇒ 404; X (thành viên R) đọc được cả hai |

## 4. PF3 — `tests/acceptance/P-a/pf3/` (fixture SQL `review_tasks` + assignees)
| Mã | Yêu cầu | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| P3-01 | CHAT-AC-54, FR-112 | `inbox` | task review group Kế toán | `GET /me/review-tasks` T, B có; H, X không; `status=closed` tách; cursor |
| P3-02 | FR-112 | ″ | task đóng (SQL) | biến khỏi `open` của T, B |
| P3-03 | CHAT-AC-55, D12 | ″ | notice `review_requested` T | `GET /me/process-inbox` `sender`=`PROCESS_SYSTEM_SENDER`, `unread=1`, item strict (không nội dung output); `read{up_to_id}` ⇒ `unread=0`; id notice của A ⇒ 404 |
| P3-04 | AC-H32, BR-26 | `reminder` | `remind_at` quá khứ + `remindOnce` ×2 | 1 notice `reminder`/assignee, `reminded_at` set; lần 2 không thêm; task vẫn open, run không đổi trạng thái; task closed ⇒ không nhắc |
| P3-05 | M6 | `system-sender` | — | không có `admin.users` tên "Quy trình"; danh bạ/tìm user không có; số phòng không đổi; không endpoint gửi tin vào inbox (POST ⇒ 404/405) |
| P3-06 | §5 | `events` | `remindOnce` | `process.notice{notice, unread}` tới chủ, sau COMMIT |
| P3-07 ⇢PF1 | CHAT-AC-54 | ″ | B pass task chung với T | T nhận `review_task.closed{result:pass}`; `/me/review-tasks` T rỗng; notice `task_closed` |
| P3-08 ⇢PF1 | AC-H29 | `outside` | T mở task | xem ma trận §6 (cột T) + audit `view` |
| P3-09 | BR-25 | `inbox` | B bị gỡ khỏi Group; D | B không còn thấy task; D thấy 0 |
| P3-10 ⇢PF1 | T8, AC-H29 | `outside` | run ở R `waiting_review` (Group Kế toán có T); T Đạt từ `/me/process-inbox` / `/runs/:id?task=` (API `decision`) | B, X thấy trong thread F tin `task_result {actor:T, outside:true, result:pass}`; T `GET /rooms/R/messages?flow_id=F` và `GET /rooms/R` ⇒ 404; `/me/review-tasks` của T trả `TaskDetail` qua `loadTaskDetails` (`can_act` false sau khi đóng) |
| P3-11 | T8, T9 | `outside` | fixture: 3 tin `process` được đăng vào R (SQL + `postThreadOnce`) | T không nhận `room.message`/`room.unread` của R; `process_notices` chỉ cho assignee (T có `review_requested` khi task mở), không notice cho X |
| P3-12 ⇢PF1 | readiness #2 | `inbox` | P1-51 `redo_limit` | notice `decision_requested` cho A + thành viên Group Kế toán (B, T); không cho Adm/X; `/me/review-tasks` T có task decision `can_act=true`; `team_calls` ⇒ chỉ A |

## 5. PF4 — `tests/acceptance/P-a/pf4/` (fixture SQL: run 2 stage, stage 0 làm lại 1 lần, stage 1 nhóm 3 + 1 plan; `usage_logs` + `run_steps`)
| Mã | Yêu cầu | File | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| P4-01 | AC-H34, FR-117 | `usage` | A `GET /process-runs/:id/usage` | `detail=full`; `totals.total` = Σ(in+out+cr+cw) `usage_logs` các run có `process_run_id`; stage 0 `attempts=2`; stage 1 `team_runs[0].calls` 4 (model, latency_ms, member_key, role) |
| P4-02 | C5 | ″ | T (task) | `detail=summary`, totals bằng P4-01, `team_runs=[]`, `calls=[]` |
| P4-03 | BR-25 | ″ | H (không task), D, cờ off | 404 |
| P4-04 | AC-H34 | ″ | thêm usage run thường của A + run quy trình khác | không cộng vào |
| P4-05 | ADM-FR-67 | ″ | tadmin; P `?tenant_id=acme`; X | full; full; full |
| P4-06 | Q4 | ″ | 60 lần gọi stage 0 | `calls.length=50`, totals đủ 60 |
| P4-07 ⇢PF1 | AC-H34 | ″ | run thật P1-30 xong | totals = Σ usage_logs (khớp tuyệt đối) |

## 6. Ma trận cách ly (HUB-BR-25, AC-H29, plan-contract §8) — `pf<n>/isolation.int.test.ts`
Run R1 (`hoa-don-t`) do A bắt đầu ở R, đang `waiting_review` stage 0 (task review gán Group Kế toán + T qua forward của B); task ask stage 0 đã đóng (H đã trả lời). Đ = được (200), 4 = 404, 3 = 403, s = `summary`. Mỗi ô một `it` (`M-<vai>-<cột>`).
| Vai \ Hành động | GET run (PF1) | output đang kiểm (PF1) | output stage/phiên bản khác (PF1) | usage (PF4) | decision (PF1) | answer (PF2) | forward (PF2) | decide (PF1) | cancel (PF1) | `GET /rooms/R`, tin R (X2a) | hội thoại nền (C1) | `/runs/:stage` events (H1) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A starter | full | Đ | Đ | full | 4 (không assignee) | 409 closed | Đ¹ | 409 state | Đ | Đ | 4 | Đ |
| X thành viên R | full | Đ | Đ | full | 4 | 4 | 4 | 3 | 3 | Đ | 4 | 4 |
| A' starter đã rời R (U5) | ngoài³ | Đ | Đ | s | 4 | 409 closed | Đ¹ | 409 state | Đ | **4** | 4 | Đ |
| L rời R | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| B Group trong R | full | Đ | Đ | full | Đ | 4 | Đ (trong Group) | 3² | 3 | Đ | 4 | 4 |
| T Group ngoài R | task | Đ | **4** | s | Đ | 4 | Đ (trong Group) | 3² | 3 | **4** | 4 | 4 |
| H được nhờ (ask đóng) | task (ask) | **4** | 4 | s | 4 | 409 closed | 409 closed | 3 | 3 | **4** | 4 | 4 |
| user khác acme (q06) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| D tenant khác (+`?tenant_id=acme`) | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 4 |
| Adm tenant_admin | full | Đ | Đ | full | 4 | 4 | 4 | 409 state | Đ | theo X2a | 4 | 4 |
| P platform_admin `?tenant_id` | full | Đ | Đ | full | 4 | 4 | 4 | 409 state | Đ | theo X2a | 4 | 4 |
¹ A chỉ forward task mình là assignee (ở R1 không có ⇒ 4); ô riêng dùng R2 có ask open. ² decide khi `needs_decision redo_limit` ⇒ Đ (Q2). ³ U5: 200 dạng ngoài phòng (như P1-75: tiến độ, output, task của mình, audit `view`; không `history`/tin R); giá trị `access` theo plan-contract bản U5 — lệch ⇒ qc theo contract ở QC1 (A' cancel/decide/H1 = mặc định qc giữ quyền người bắt đầu). Thêm: `M-audit` T `GET` run 2 lần ⇒ đúng 1 audit `view` (entity review_task); mỗi `GET output` ⇒ +1 · `M-M4` sau run `done`: T `GET` run ⇒ `access=task`, `stages=[]`, output task mình Đ, output khác 4 · `M-body` body T/H/A' không chứa `input`, `history`, tên phòng, nội dung tin R (so chuỗi cắm sẵn `ROOM-SECRET-P1`) · `M-404-same` 404 của run không tồn tại và run không được thấy giống hệt body.
Cột "tin R" gồm cả thread quy trình F (`GET /rooms/R/messages?flow_id=F`): A', T, H, L, q06, D ⇒ 404 dù việc của họ có `task_result` trong F.
| Dòng thêm (plan-contract §8) | Ca | Kỳ vọng |
|---|---|---|
| `M-thread-insert` (cột U1) | mọi vai có quyền ghi R (A, B, X) chèn `sender_type='process'` bằng scope user; gọi `room_post_process_message` | 42501 (= S0-08, chạy lại trong ma trận pf1) |
| `M-thread-events` (cột U1) | mọi vai scope user SELECT `process_thread_events` của R1 | 0 hàng |
| `M-thread-agent` | B gửi `@hd-read …` trong F | 422 `PROCESS_THREAD_NO_AGENT`, 0 `hub.runs` (không run X2b chen vào thread, không dùng quota/grant ai) |
| **`M-C2`** (C2, bảo mật) | stage nhóm `qc-team` của run do A bắt đầu: A không có grant thành viên ⇒ chạy (job `user_id`=A); nhóm bị thu entitlement acme / thành viên bị tắt lúc `kick` ⇒ `permission_lost`, 0 job; nhóm **chưa bật** cho beta: def beta tham chiếu `qc-team` ⇒ 422 `PROCESS_REF_INVALID{ref:"team"}`; stage agent đơn không grant ⇒ `permission_lost` | RV1 đối chiếu với P1-36; không vai nào khác A trở thành chủ job/usage |

## 7. Kịch bản seed — `tests/acceptance/P-a/scenario/` (chỉ cổng merge PF4 + `done:pa`, Q1 — cần PF1–PF4 vì kiểm usage)
| Mã | Mẫu | Bước | Kỳ vọng chính |
|---|---|---|---|
| SC-1 | `sdlc` (chép, Group "PO"={B}, "Tech lead"={B,T}, bật) | A `"!sdlc Thêm xuất CSV"` ở R → Intake `need_input` → A nhờ H (note) → H trả lời → Intake output → B Đạt (cổng 1) → 2–4 tự chạy (3 = `plan-team` 2 job) → 5 Sẵn sàng → T (ngoài phòng, qua `/me/process-inbox`) Chưa đạt "Thiếu ma trận luật" → 5 làm lại (attempt 2) → T Đạt (cổng 2) → 6–7 nhóm tự chạy → 8 Review → B Đạt (cổng 3) | run `done`; 8 stage `done`; 3 review pass + 1 fail; stage 5 `attempt=2`, các stage khác 1; 1 ask, 1 forward; 13 job đều `user_id`=A; T, H 0 tin phòng đọc được (M-*); notice `run_finished` cho A; usage totals = Σ; thread F có 18 tin `process` (1 block · 9 output · 1 ask · 1 forward · 5 task_result (H answer, B, T fail, T, B) · 1 run_end), task_result của T/H `outside:true` |
| SC-2 | `hoa-don` (tenant dev copy, Kế toán={T}) | A `"!hoa-don HD-12 12.000.000"` ở R → stage 1 output có `fields.tong_tien` → T (Thomas, ngoài phòng) Đạt từ DM → stage 2 `ghi-so` | Dify 1 lần, audit `authorize_real_action` actor T; A không được hỏi xác nhận; T sau `done` chỉ thấy task mình (M4); thread R: block · output s1 · task_result T (`outside:true`) · output s2 · run_end done (5 tin) |
