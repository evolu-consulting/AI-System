# Phụ lục plan · Run trong phòng = thread X2b (U1, người dùng chốt 2026-10-10)

**Thay D13, sửa D12** (plan §1). Mockup ④ CopilotRoom + ⑦ AskForward. Hỏi AI / chạy từ admin: **không đổi** (D14, không thread). Contract chi tiết: [`plan-contract.md`](plan-contract.md) §2 `RoomProcessPart`, §3. Bước 0: [`plan-step0.md`](plan-step0.md) §2.

## 1. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| T1 | `!key` ở **timeline** phòng (không `flow_id`, không `answer_run_id`) ⇒ tin gọi = tin user `main`, `flow_id` = `process_runs.flow_id`, `process_run_id` (thẻ gốc). Hub đăng **khối quy trình** (`sender_type='process'`, `kind=block`, `main`, cùng `flow_id`) ngay sau ⇒ gốc thread, mang `flow{message_count, last_active_at, recent, unread}` như tin agent gốc X2b (CR-050). Mọi sự kiện sau = tin `process` `placement='flow'` ⇒ dùng lại `?flow=` pane, FlowRecent, FlowFooter "Trả lời tiếp". Nút "▶ Quy trình" (`POST /process-runs` origin room) ⇒ không có tin gọi, chỉ khối gốc | U1; dùng lại X2b, không mô hình mới |
| T2 | Thread id = `process_runs.flow_id` (flow của hội thoại nền quy trình, chủ = người bắt đầu) ⇒ thoả FK `room_messages.flow_id → flows`; không tạo shim phòng/`room_flow_id`. Ngữ cảnh stage vẫn D6 (input + góp ý/Q&A + output đã chốt) — **không** đọc tin phòng (`roomHistory` không dùng) | Một flow/run; không rò tin phòng vào prompt |
| T3 | `ROOM_SENDER_TYPES` += `"process"` (chỉ thêm; **sửa D12** "không thêm sender"). Tin `process`: `sender_id` = `process_runs.process_def_id`, `sender.display_name` = tên quy trình (snapshot). Người thực thi (agent/nhóm) ở `process.executor`, người bấm ở `process.actor`. Vẫn không có user hệ thống; DM "Quy trình" (`process_notices`, D12) giữ nguyên | Không giả danh agent (`room_messages_agent_ck` đòi `run_id`, X2b đọc tin agent theo run) |
| T4 | Chỉ Hub đăng tin `process`: definer `hub.room_post_process_message` **chỉ scope `system`**. Policy `room_messages_insert` giữ `sender_type='user'` ⇒ user chèn tin `process` = 42501 | Không ai giả mạo kết quả kiểm |
| T5 | **Outbox**: tx quy trình (scope user của người làm, §10) chèn `process_thread_events`; **sau COMMIT** `ThreadPoster.post(runId)` (tx `system`: khoá `rooms` → sự kiện chưa đăng của run theo `created_at,id` → chèn tin → `room_fanout_sys`); vòng `reconcile` 5 s (`postThreadOnce`). Idempotent: `room_messages.id = event.id` | Đăng trong tx quy trình ⇒ khoá `process_runs → rooms` ngược đường start (`rooms → process_runs`) ⇒ deadlock (như X2b D4) |
| T6 | Hành động trong pane = gọi API task, **không** POST tin phòng: nút Đạt/Chưa đạt, chip, nút quyết; composer flow khi người xem có task mở `can_act` — `ask` ⇒ `POST /review-tasks/:id/answer`; `review` sau khi bấm "Chưa đạt" ⇒ `/decision {fail, feedback}`. Kết quả hiện bằng tin `task_result` (actor = người làm, kèm góp ý/câu trả lời). Composer flow không có task của mình ⇒ tin người↔người (X2b D13a) | Một đường ghi luật; kết quả hiện giống nhau dù làm từ phòng hay từ ngoài |
| T7 | Trong thread quy trình: tin chữ thường = OK (0 run) · tag `@agent` đầu tin ⇒ 422 `PROCESS_THREAD_NO_AGENT` (không lưu) · `answer_run_id` ⇒ 404 `NOT_FOUND` (luật X2b) · `!…` có `flow_id` ⇒ chữ thường (không bắt đầu quy trình) | Run stage thuộc người bắt đầu; tránh run X2b chen vào flow quy trình |
| T8 | Thành viên phòng: thấy cả thread (quyền `full`, §5); chỉ assignee có nút (`can_act`), người khác thấy WaitingNote (`ProcessRunView.open_tasks`). Người kiểm/trả lời **ngoài phòng**: không đổi — inbox + `/runs/:id` (`access:"task"`), **không** đọc thread (RLS `is_room_member`); việc họ làm vẫn sinh `task_result` trong thread (tên + kết quả + nội dung) cho thành viên phòng | HUB-BR-25 giữ; mockup ⑦ |
| T9 | Thông báo: tin `process` là tin phòng thường — `room.message` + `room.unread` cho thành viên hiện tại, chưa đọc theo `last_seq` + `room_flow_reads` (như tin agent trong thread, X2b D14 không áp). Không thêm sự kiện `/me/stream`; `process.updated` vẫn phát (khối gốc cập nhật trạng thái sống). `process_notices` chỉ assignee/người bắt đầu (PF3, không đổi) | Không đổi bộ đếm O(1) |
| T10 | Phòng bị xoá ⇒ sự kiện đánh `skipped`, **run chạy tiếp** (xem ở `/runs/:id`). Người bắt đầu rời phòng ⇒ run chạy tiếp, vẫn đăng (khác X2b R17: run quy trình dài, có người kiểm khác) | Không mất việc đang kiểm |
| T11 | Ít tin: bước thành viên nằm trong meta tin `output` (không mỗi lần gọi một tin); tiến độ đang chạy lấy từ khối gốc (`process.updated` + `GET /process-runs/:id`) | ≤ ~2 + 2×lần làm lại tin/stage |

## 2. Loại tin `process.kind` (`ROOM_PROCESS_KINDS`, 7) — người enqueue
| kind | placement | Khi | PF enqueue |
|---|---|---|---|
| `block` | main | start (cùng tx tạo run) | PF1 |
| `output` | flow | mỗi `process_outputs` (kèm `review_task_id` nếu mở task review cùng tx; template hỏng ⇒ `template_ok=false`) | PF1 |
| `ask` | flow | mở task ask (hiệu ứng `open_ask`) | PF1 |
| `decision` | flow | mở task decision | PF1 |
| `task_result` | flow | đóng task bởi người: review pass/fail (+feedback), decide, answer (+answer/choice) | PF1 (review, decide) · PF2 (answer) |
| `forward` | flow | nhờ/chuyển (`from`, `to`, `depth`; **không** chép `note`) | PF2 |
| `run_end` | flow | done/cancelled/failed/expired (+actor khi huỷ) | PF1 |
Đóng task do hệ thống (`cancelled/expired/superseded`) không sinh tin riêng (gộp trong `run_end`/`output` mới). `content` = câu tóm tắt ≤ 500 ký tự theo locale mặc định của tenant (preview danh sách phòng + dự phòng); FE dựng hiển thị từ `process` theo locale người xem.

## 3. DB (bổ sung migration 0019, B1)
| Đối tượng | Nội dung |
|---|---|
| `room_messages` | + `process_kind text NULL` CHECK ∈ 7 · `process_meta jsonb NULL`. DROP/ADD `room_messages_sender_type_ck` ∈ (user, agent, process). ADD `room_messages_process_ck`: `sender_type<>'process' OR (process_run_id, process_kind, flow_id, process_meta NOT NULL AND run_id, trigger_message_id, run_status, wait_kind, ask IS NULL)` · `room_messages_process_kind_ck`: `process_kind IS NULL OR sender_type='process'`. uq `room_messages_process_block_uq (process_run_id) WHERE process_kind='block'`. CHECK X2b (`user_ck`, `agent_ck`) giữ nguyên (test khoá X2b-0014) |
| `process_thread_events` | id uuid pk · tenant_id · process_run_id FK CASCADE · room_id uuid · kind text ∈ 7 · placement text · meta jsonb · content text 1..500 · created_at ts now · posted_at ts null · outcome text null ∈ posted/skipped. idx `(created_at) WHERE posted_at IS NULL`, `(process_run_id, created_at)`. RLS: INSERT **T**; SELECT/UPDATE chỉ `scope='system'` (người dùng không đọc được nội dung qua bảng) |
| `hub.room_post_process_message(p_event uuid) RETURNS TABLE(posted bool, reason text, room_id uuid, seq bigint, created_at timestamptz)` | Chỉ `system` (khác ⇒ 42501). Đọc sự kiện → khoá `rooms` → khoá sự kiện FOR UPDATE: `posted_at` có ⇒ `already`; phòng xoá ⇒ `outcome=skipped`. Khác: `last_seq+1`, `last_activity_at`, INSERT (`id = event.id`, `sender_type='process'`, `sender_id = process_def_id`, cột process), `posted_at`. Không đổi mốc đọc ai |
| `hub.is_room_thread` | + nhánh (iii): `EXISTS process_runs pr WHERE pr.flow_id = p_flow AND pr.origin_room_id = p_room AND tenant` ⇒ tin gọi + tin người↔người vào thread quy trình qua policy hiện có |
| `hub.is_process_trigger(p_room, p_run, p_flow)` | thêm `p_flow`: run cùng tenant, `origin_room_id = p_room`, `flow_id = p_flow`, `started_by = app.user_id`, chưa có tin gọi (`trigger_message_id IS NULL`). Policy: `… AND (process_run_id IS NULL OR hub.is_process_trigger(room_id, process_run_id, flow_id))` |
GRANT EXECUTE `hub_rw`; REVOKE PUBLIC. Thứ tự khoá §10 += `process_thread_events` sau `process_notices` (chỉ INSERT); poster: `rooms → process_thread_events → room_messages → room_members` — không khoá `process_runs` ⇒ không chu trình.

## 4. Đọc tin phòng (điểm nóng Bước 0, `modules/rooms/**`)
`messages.repo.ts`: `ROOT` = `(sender_type IN ('agent','process')) AND placement='main' AND flow_id IS NOT NULL`; cột + `process_run_id, process_kind, process_meta`; tên người gửi `process` = `process_runs.snapshot->>'name'` (join theo `process_run_id`, cùng tenant); FlowRecent nhận `process`. `rooms.map.ts`: map `RoomProcessPart` (zod parse meta; hỏng ⇒ bỏ `process`, giữ `content`). `manage/rooms.repo.ts` (tin cuối/preview): người gửi `process`. `messages.service.ts`: luật T7 (cần `flow_id` là thread quy trình ⇒ một truy vấn `process_runs` theo `flow_id`). `room-messages.routes.ts`: tin gọi trả thêm `X-Flow-Id` (= thread) cạnh `X-Process-Run-Id`. `room_run_states`/reconcile X2b không đổi (lọc `sender_type='agent'`).

## 5. Ca test yêu cầu qc (đề xuất, PF ghi trong ngoặc)
Khối + tin gọi cùng `flow_id`, `GET ?flow_id=` trả đủ loại (PF1) · user chèn `sender_type='process'` ⇒ 42501 (B1) · poster 2 lần ⇒ 1 tin (B0) · phòng xoá giữa run ⇒ `skipped`, run tiếp (PF1) · tag trong thread quy trình ⇒ 422, chữ thường ⇒ 201 0 run (B0) · T ngoài phòng Đạt ⇒ `task_result` actor T trong thread, T `GET /rooms/R/messages` ⇒ 404 (PF3) · H trả lời ask ⇒ `task_result` + `forward` không chứa `note` (PF2) · thành viên X thấy khối, `my_tasks` rỗng, `open_tasks` có assignee (PF1).
