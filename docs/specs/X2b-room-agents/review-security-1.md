# X2b · Security review agent trong phòng — vòng 1

## Kết luận: PASS (APPROVED, 6 Minor) · Spec: X2b-room-agents · Vòng: 1 · Reviewer: bảo mật (Opus, riêng — plan §11)

Hard stop §9 đạt: không tìm thấy đường nào **từ HTTP / SSE** để (a) chạy agent bằng quyền/quota của người khác, (b) đọc
ngữ cảnh/thread của phòng khác hoặc `hub.messages` riêng, (c) nhận tham số `side_effect` khi không phải người tag, (d) đăng
tin agent vào phòng/tenant khác, (e) vào hội thoại nền qua `/conversations*`. Định nghĩa DB khớp file migration (đã đối chiếu
`pg_proc`/`pg_policy`/grant trên DB dev). Các Minor bên dưới đều là **lưới thứ hai** (chỉ khai thác được nếu đã có SQL ở quyền
`hub_api` scope user) hoặc biên nghiệp vụ; không chặn mốc, nên sửa trong X2b-2 hoặc ghi TECH-DEBT.

## Phạm vi
Commit `8947b4c..HEAD` (`1a86b2d`). Đã đọc: `packages/db/migrations-hub/0014_x2b_room_agents.sql` (toàn bộ) ·
`apps/hub-api/src/modules/rooms/agents/{room-run.service,room-run.tx,room-agent.rules,room-context.repo,agent-msg.sql,
room-post.view,room-post,room-post.repo,room-run-events,room-active-runs.repo}.ts` · diff `rooms/messages/*`,
`room-messages.routes.ts`, `rooms/manage/{rooms,members}.service.ts`, `runs/{runs.service,create-run}.ts`,
`runs/close/cancel.{repo,service}.ts`, `conversations/conversations.repo.ts`, `orchestrator/orchestrator.service.ts`,
`mention/direct-driver.ts`, `me-stream/user-stream-reader.ts`, `app.x2a.ts`; `runs/confirm.repo.ts`, `mcp/mcp.repo.ts:106-111`
(tiêu thụ xác nhận); `0001_hub_rls.sql` (policy `runs/messages/flows/conversations`).
**Chưa xem:** FE `apps/chat-web/**` (chỉ hiển thị, dữ liệu đã lọc ở API), `contracts/chat/{rooms,me-stream}.ts` chi tiết schema,
`lib/user-stream.ts` diff (12 dòng), `tools/hub-dev/src/fixture-agents.ts`, nội dung test QC (chỉ liệt kê tên ca `db.int`).
Không chạy int/e2e (điều phối đang chạy `done:x2b`).

## Lệnh đã chạy (chỉ đọc, `docker exec ai-system-postgres-1 psql -U ai -d ai_system`)
| Kiểm | Kết quả |
|---|---|
| `pg_proc` 4 hàm mới + `is_room_member`, `room_last_seq` | `prosecdef=t`, `search_path=pg_catalog, pg_temp`, chủ `ai`, ACL `ai=X, hub_rw=X` — không PUBLIC ✓ |
| `pg_policy room_messages_insert` | đúng file: scope user + tenant + `sender_type='user'` + `sender_id`=GUC + thành viên + `seq = room_last_seq` + `(flow_id IS NULL OR is_room_thread)` — không nới gì khác ✓ |
| RLS bảng | `runs/conversations/flows/room_messages/tool_confirmations` `relrowsecurity=t`; `hub_api`, `hub_rw` NOBYPASSRLS ✓ |
| Grant bảng `hub_rw` | `room_messages` chỉ SELECT/INSERT ✓; `runs/flows/conversations` SIUD toàn cột (có từ H1 — xem #1) |
| FK `runs` | `conversation_id`, `flow_id`, `runs_room_fk (room_id, tenant_id)`; **không** FK `answer_message_id`/`user_message_id` |
| `room_messages` PK/unique | `pkey(id)`, `seq_uq`, `client_uq`, `run_uq` |

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề + kịch bản | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| 1 | Minor | 3 (lưới, confused deputy) | `0014_x2b_room_agents.sql:137,149-151,165-168`; `room-post.repo.ts:78,85-87` | tx2 chạy scope **system** nhưng tin mọi cột của hàng `runs` mà chủ run sửa được ở scope user (`hub_rw` UPDATE toàn cột, RLS chỉ đòi `user_id`=mình): `answer_message_id`, `flow_id`, `agent_id`, `status`, `room_posted_at`. Kịch bản (cần SQL ở quyền `hub_api`): A là thành viên phòng R, có run phòng đang chạy; `UPDATE hub.runs SET status='finished', answer_message_id=<id tin riêng của B>, agent_id=<agent X>, flow_id=<flow thread phòng khác>` ⇒ `reconcile` (system) đọc `pm.content` **không lọc `user_id`** và đăng vào R dưới tên agent X, gắn thread phòng khác. Hiện **không khai thác được thực tế**: id tin riêng của run phòng đều trùng id `room_messages` (tin gọi/tin agent) ⇒ INSERT đụng `room_messages_pkey`; id tin C1 của người khác không lộ. Nhưng plan §11 "definer suy từ run" ngầm giả định hàng `runs` đáng tin — giả định đó sai ở mức DB | (a) `runOutcome`: `join hub.flows f … AND f.user_id = r.user_id`, `join hub.conversations c ON c.id = f.conversation_id AND c.room_id = r.room_id AND c.user_id = r.user_id`, `pm … AND pm.user_id = r.user_id AND pm.flow_id = r.flow_id AND pm.role = 'assistant'`; (b) definer kiểm tương tự (`v_thread` phải là thread có tin gốc `main` trong `v_room`, flow thuộc hội thoại nền `(v_room, run.user_id)`); (c) tuỳ chọn TECH-DEBT: grant UPDATE theo cột trên `hub.runs` cho `hub_rw` (bỏ `room_id`, `*_message_id`, `flow_id`, `agent_id`) | backend-lead |
| 2 | Minor | 3 (lưới) | `0014_x2b_room_agents.sql:208-211` | Nhánh `running` của `room_run_states` không kiểm người gọi run còn là thành viên (nhánh `waiting` có, `:219-220`). Qua SQL, người **ngoài** phòng đặt `runs.room_id` = phòng nạn nhân (FK chỉ đòi cùng tenant) ⇒ run của họ (id, agent, tên) hiện trong `active_runs` của phòng đó. App không bao giờ làm vậy (`setRunRoom` sau `lockFor`); cửa sổ ngắn giữa bớt thành viên và `cancelRuns` cũng hiện run người đã bị bớt | Thêm `EXISTS (room_members … user_id = r.user_id AND left_at IS NULL)` vào nhánh `running` (như nhánh `waiting`) | backend-lead |
| 3 | Minor | 2 (vòng đời) | `runs/close/cancel.repo.ts:78`, `members.service.ts:67,88` | `cancelRoomRuns` chỉ huỷ run `running`. Lượt **chờ** (`side_effect`, `tool_confirmations` `pending`) của người rời/bị bớt vẫn còn; nếu người đó được thêm lại, `room_run_states` hiện lại lượt chờ và họ xác nhận được thao tác cũ (đã chờ từ trước khi rời). Không vượt quyền (vẫn đúng người tag, `mustDecline` vẫn kiểm AU) nhưng lệch tinh thần R17 "rời ⇒ huỷ" | Khi rời/bớt/xoá: `UPDATE hub.tool_confirmations SET status='declined' WHERE flow_id IN (flow nền của user trong phòng) AND status='pending'` (system), hoặc ghi rõ chấp nhận vào spec R17 | backend-lead |
| 4 | Minor | 2 (D15) | `room-run.service.ts:179-180,193-203`; `create-run.ts:66-72` | D15 chỉ áp cho `answer_run_id`. Người tag mất quyền agent X đang chờ `side_effect` vẫn gửi `@orchestrator đồng ý` trong thread ⇒ route `orchestrator`, không plan ⇒ `confirmReply` `agree=true` ⇒ xác nhận chuyển `confirmed`, run **không** bị huỷ. Đã kiểm: **không thực thi được** — xác nhận chỉ tiêu thụ trong đúng run (`mcp.repo.ts:111` `decided_run_id`) và Orchestrator dựng `access` từ AU hiện hành (`orchestrator.service.ts:41`) nên không gọi được X. Chỉ lệch hiển thị (không ra tin "đã huỷ") và trạng thái xác nhận | Áp `#mustDecline` cho mọi lượt tạo run trên flow nền có xác nhận `pending` (route `agents`/`orchestrator` trong thread), không chỉ `answer` | backend-lead |
| 5 | Minor | 3 (phòng thủ chiều sâu) | `runs/runs.repo.ts:23-31` (`touchConversation`) | D2 lọc `room_id IS NULL` ở `conversations.repo` (đủ cho mọi E5–E15: đã kiểm `listConversations`, `findConversation`, `rename`, `softDelete`; E12 gọi `conversations.get` trước `runs.start`). `touchConversation` trong `createRunTx` không lọc `room_id` ⇒ an toàn chỉ nhờ route kiểm trước; một đường gọi `runs.start` mới quên `conversations.get` sẽ chạy run C1 trên hội thoại nền | Truyền cờ `room: boolean` vào `createRunTx` và lọc `room_id IS NULL` / `IS NOT NULL` tương ứng, hoặc ghi chú bất biến ở `runs.start` | backend-lead |
| 6 | Minor | 3 (lưới) | `0014_x2b_room_agents.sql:114,165` | Definer nhận `p_sender` tự do, không đối chiếu `runs.agent_id`/flow agent/Orchestrator của tenant. Chỉ scope system gọi được ⇒ không khai thác từ user; ghi lại để definer tự suy `sender_id` như các cột khác (đúng nguyên tắc plan §11 "không nhận từ tham số") | Bỏ `p_sender`, suy trong definer `coalesce(r.agent_id, f.agent_id, r.orchestrator_tenant_id …)` | backend-lead |

## Đối chiếu plan §11 / trọng tâm
1. **Migration 0014** ✓ — 4 definer `search_path` cố định, tên đủ schema, không SQL động (DO block chỉ `format(%I)` hằng), REVOKE
   PUBLIC + GRANT `hub_rw`. `is_room_thread`: scope user + `is_room_member` + tenant GUC, không nhận user_id; nhánh (ii) chỉ flow
   nền **của chính người gọi** có `room_flow_id = id` trong hội thoại nền của đúng phòng. Policy insert chỉ thêm điều kiện thread
   (không nới `sender_type`, không nới thành viên). CHECK `user_ck/agent_ck/flow_ck/ask_ck` + FK `flow_id/run_id/trigger_message_id`
   giữ RV2-N2c. `room_post_agent_message`: chỉ system; `room_id` suy từ run; kiểm phòng chưa xoá + `runs.user_id` còn thành viên;
   tin gọi phải thuộc `v_room` ⇒ không đăng vào phòng/tenant khác từ app (từ SQL: #1). `room_fanout_sys`: chỉ system.
   `room_run_states`: thành viên, không nội dung/tham số (#2).
2. **Quyền theo người tag** ✓ — `config.poll()` (`room-run.service.ts:173`) trước `prepareMention`/`prepare` (AU + quota của `u`);
   `createRunTx` chạy trong tx scope user của người gửi (`runs.user_id` = người gửi, advisory/`TOO_MANY_RUNS`/`FLOW_BUSY` của họ);
   thiếu AU ⇒ `MentionService.prepare` ném `AGENT_NOT_FOUND` **trước** tx ⇒ không lưu tin (cùng đường C1 cho key không có).
   `answer_run_id`: `answerAccess` ⇒ `not_found` (khác thread / không chờ / phòng khác — `room_run_states` lọc `room_id`) trước
   `not_caller` 403; `runFlowOf` thêm lọc `user_id`. D15 đúng cho `answer` (#4 cho đường khác).
3. **Ngữ cảnh** ✓ — `threadRoot` lọc `room_id + tenant_id + placement='main'` ⇒ flow_id giả / thread phòng khác ⇒ 404 (cả tin
   thường, tin tag, `GET ?flow_id`). `contextRows` lọc `room_id + tenant_id` (+`flow_id`), `LIMIT 20/50`, `seq <` tin gọi; lớp 2
   `roomContext` bỏ dòng lệch phòng/thread; không đọc `hub.messages`; `orchestrator.service`/`direct-driver` dùng `roomHistory`
   thay `flowHistory`. Tin agent trong ngữ cảnh = cột `room_messages.content` (bản công khai; `side_effect` = câu chung).
4. **`side_effect`** ✓ — `room_messages` chỉ giữ câu chung + `ask` null (`agentMessageView`, `ask_ck`); timeline: `AGENT_JOINS`
   lấy bản riêng qua `hub.runs`/`hub.messages` dưới RLS user (chỉ người gọi có hàng) **và** `agentViewFor` kiểm `viewerId ===
   caller.id` (2 lớp); SSE: `agentMessageEvents` tách người gọi / người khác; `room.run_waiting`/`run_finished`/`run_started` và
   `active_runs` không mang nội dung/tham số; `X-Run-Id` chỉ cho người gửi; `/runs/:id*` RLS user.
5. **Vòng đời** ✓ — rời/bớt/xoá ⇒ `cancelRoomRuns` sau COMMIT (system, theo `tenant_id + room_id [+ user_id]`); definer thấy
   không còn thành viên / phòng xoá ⇒ `skipped`; kết quả trễ bị chặn bởi `status <> 'running'` + `room_posted_at`. Lượt chờ: #3.
   `/conversations*`: `live()` có `isNull(c.roomId)` cho list/get/rename/delete/flows/messages; E12 qua `conversations.get` ⇒
   hội thoại nền 404; flow nền không dùng được từ hội thoại C1 (`touchFlow` đòi `conversation_id` khớp). `touchConversation`: #5.
6. **R01/R02/@orchestrator** ✓ — tin agent chỉ ghi qua definer system, không đi qua `routeRoomMessage` ⇒ không tự gọi agent;
   policy insert đòi `sender_type='user'`. Tag giữa câu ⇒ `routeMessage` C1 trả `text` ⇒ `plain`, 0 run. `@orchestrator` tách ở
   `routeRoomMessage`; tag kèm theo vẫn qua `prepareMention` (AU) ⇒ không mở rộng quyền.

## Rubric (phần bảo mật)
1 ✓ · 2 ✓ (#3, #4 Minor) · 3 ✓ (#1, #2, #5, #6 Minor — lưới) · 4 ✓ · 5 — · 6 ✓ (ca DB `db.int` phủ definer/scope/thread phòng khác/RLS tin agent; đề xuất thêm ca cho #1–#2 khi sửa) · 7 — · 8 — (FE chưa xem) · 9 ✓
