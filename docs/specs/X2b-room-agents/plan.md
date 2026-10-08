# Plan · X2b-room-agents — phần Backend (Hub TS)

Spec: [`spec.md`](spec.md) (X2b-R01…R20, AC01…AC16, §9 Q1–Q12 **dùng mặc định** trừ **Q7 đã chốt 2026-10-08** (mọi thành viên có quyền agent trả lời tiếp; quyền/quota/xác nhận theo người gửi từng lượt); hàng phụ thuộc ghi `[Qn]`). FE: [`plan-frontend.md`](plan-frontend.md) §10 (trả lời ở §12). Nền: X2a `plan.md`/`plan-db.md` (khoá, definer), H2b `create-run.ts` (advisory → `FLOW_BUSY` → `TOO_MANY_RUNS`), H1 `sse-writer.ts` (kết thúc run). Đã đối chiếu code: migrations-hub 0000/0001/0007/0011–0013, `runs/*`, `mention/*`, `rooms/messages/*`, contracts chat, test khoá X2a `contracts-x2a`, `rv2-security`.

## 1. Quyết định chính
| # | Quyết định | Lý do |
|---|---|---|
| D1 | **Hội thoại nền ẩn** (shim): mỗi cặp (phòng, người gửi) có đúng 1 `hub.conversations` với `room_id` ≠ NULL (tạo lười trong tx gọi). Mỗi **lượt** (tin `@` hoặc trả lời flow) = run C1 bình thường của **người gửi lượt đó** trên hội thoại nền của họ (`runs/flows/messages/tool_confirmations` giữ `NOT NULL`, không đổi kiểu) + `runs.room_id` | `runs.conversation_id/flow_id/user_message_id/answer_message_id` NOT NULL, 64 chỗ dùng trong 26 file; nới null = sửa Router/runtime (spec §1 cấm). Shim ⇒ Orchestrator, `direct`, `pending_ask`, `side_effect`, huỷ, lease, sweeper, trace, usage **dùng lại nguyên** |
| D2 | Hội thoại nền **không lộ** qua C1: mọi E5–E15 của `modules/conversations` lọc `room_id IS NULL` ⇒ 404 (`POST /conversations/:id/messages` trên shim = 404, không vòng qua kiểm thành viên) | Chặn đường song song bỏ qua R01/R08 |
| D3 | Phân tách công khai/riêng tư bằng RLS sẵn có: `room_messages` = bản **công khai** (tin gọi, tin agent); `hub.messages` của shim = bản **riêng người gọi** (nội dung đầy đủ, `ask` xác nhận). Đọc tin phòng `LEFT JOIN runs → messages` dưới scope user: RLS `runs_hub_rw` chỉ trả cho người gọi ⇒ người khác không bao giờ nhận tham số `side_effect` | R12/Q5 không dựa vào UI, không thêm nhánh lọc thủ công |
| D4 | Tin agent vào phòng ở **transaction thứ hai** (`RoomRunPoster`, scope `system`, definer `hub.room_post_agent_message`) sau khi `SseWriter.finish`/huỷ đã COMMIT; idempotent bằng `runs.room_posted_at` + unique `(run_id)` tin agent; vòng `reconcile` 5 s bù khi instance chết giữa hai tx | Gộp vào tx kết thúc ⇒ thứ tự khoá `flows→runs→…→rooms` ngược đường gọi `rooms→…→flows` ⇒ deadlock. Tách tx giữ nguyên thứ tự C1 và X2a (§5) |
| D5 | Tin gọi + run + tin user ở hội thoại nền trong **một** tx scope user (Q12): `rooms` (khoá) → `createRunTx` C1 (advisory user → conversations → flows → `FLOW_BUSY` → `TOO_MANY_RUNS` → runs → messages → tool_confirmations) → `room_next_seq` → `room_members` → `room_messages` | 429/409 ⇒ ROLLBACK, tin không vào phòng (Q4); một nguồn luật giới hạn run |
| D6 | `RunService.start` tách 3 bước: `prepare` (ảnh, locale, `directOnSnapshot`, `pickOrchestrator`) → `createRunTx` (trong tx **của người gọi**) → `launch` (writer, `run.started`, driver). C1 `start` = prepare + tx riêng + launch, hành vi không đổi | Tái dùng, không sao chép `start` |
| D7 | Ngữ cảnh phòng tiêm qua `RunContext.roomHistory?: HistoryItem[]` (chụp trong tx gọi, cắt tại tin gọi). `orchestrator.service` + `direct-driver` dùng `roomHistory` **thay** `flowHistory` khi có (flow phòng nhiều người: lịch sử công khai, không lấy bản riêng); vắng = C1 | Seam 2 file, không đổi prompt/loop |
| D8 | Phân giải tag dùng lại `routeMessage` + `MentionService.prepare` (AU, `AGENT_NOT_FOUND{suggestions}`, `CMD_MISSING_ARG`). Thêm tag dành riêng **`@orchestrator`** chỉ trong phòng (C1 không có vì tin không tag = Orchestrator). `/…` trong phòng = chữ thường (Q10) | R02/R03, FR-91 |
| D9 | Mã mới `NOT_RUN_CALLER` 403 (giữ tên spec) ở khối **riêng** `CHAT_ROOM_AGENT_ERRORS` — **không** thêm vào `CHAT_ROOM_ERRORS` | Test khoá X2a R24 đòi `CHAT_ROOM_ERRORS` đúng 8 mã |
| D10 | 3 sự kiện run ở hằng **riêng** `ME_STREAM_RUN_EVENTS` + `MeStreamRunEventSchema` + `parseMeStreamRunEvent`; `ME_STREAM_EVENTS`/`MeStreamEventSchema` giữ 8 | Test khoá X2a R31 đòi đúng 8 |
| D11 | `POST /rooms/:id/messages` giữ body = `RoomMessage` (201/200); run trả qua header có sẵn `X-Run-Id`, `X-Flow-Id` (như E12) + `room.run_started` | Đổi body thành `{message, run}` vỡ X2a (FE §10 #1 → chỉnh ở FE) |
| D12 | Flow phòng = id **logic** `room_messages.flow_id` (không FK); mỗi người tham gia có 1 `hub.flows` riêng trong hội thoại nền với `flows.room_flow_id` = id đó (unique `(room_flow_id, user_id)`) ⇒ `pending_ask`/`tool_confirmations` C1 tự tách theo người. `placement` `main`\|`flow`. Tin gọi + tin agent đầu của flow = `main` (timeline), trả lời tiếp và tin agent sau = `flow`. Mọi tin có `seq` (bất biến X2a) | Q4 X2a, R13, timeline/flow cùng index |
| D13 | [Q7 chốt 2026-10-08] Tin trong flow **không cần tag**, luôn tạo run của **người gửi**: có `pending_ask`/xác nhận chờ trên flow riêng của họ → C1 (agent đang chờ); khác → agent của flow (tin agent gốc; Orchestrator nếu gốc là Orchestrator) hoặc `@tag`. Mọi thành viên gửi được nếu agent của flow ∈ AU của họ, khác `AGENT_NOT_FOUND` 404 (mã quyền agent hiện có — Hub không có 403 cho agent). Trả lời ask của một lượt: `answer_run_id` — run của người khác ⇒ 403 `NOT_RUN_CALLER` | UC-11, R11, BR-21 |
| D14 | R19 với bộ đếm `last_seq − last_read_seq`: khi đăng tin agent, mốc đọc người gọi lên `seq` **chỉ khi** đang bằng `seq−1` (đã đọc hết); khác ⇒ tin agent vẫn tính chưa đọc cho người gọi (biên, chấp nhận) | Không thể loại một tin giữa bộ đếm O(1) mà không đếm lại |
| D15 | Thu hồi quyền giữa chừng [Q2]: run đang chạy chạy nốt (C1). Trả lời flow đang chờ `side_effect` mà agent chờ ∉ AU người gọi (ảnh hiện hành) ⇒ vẫn lưu tin + tạo run rồi **kết thúc ngay** `cancelled` (driver `cancelNow`, `tool_confirmations` → `declined`) ⇒ tin agent "đã huỷ" | Một đường đăng tin duy nhất (D4) |
| D16 | **Q9 tách X2b-2** (§14): X2b không nhận file trong phòng; `attachment_ids` không có trong `SendRoomMessageRequest` (strict ⇒ 400); run phòng `files = []`; file `out/` của agent gắn vào tin riêng ở hội thoại nền (chỉ người gọi, không hiện trong phòng) [Q14 mới] | Đính kèm ≈ 40% khối lượng mốc |

## 2. Contract `@ai/contracts/chat` — chỉ thêm
### 2.1 `errors.ts` (khối mới)
| Hằng | Nội dung |
|---|---|
| `CHAT_ROOM_AGENT_ERRORS` | `{ NOT_RUN_CALLER: 403 }` + `ChatRoomAgentErrorCode`, `CHAT_ROOM_AGENT_ERROR_CODES`. Không `details` |
| Dùng lại | `AGENT_NOT_FOUND` 404 `{suggestions ≤ 3}` (AU **người gửi**), `TOO_MANY_RUNS` 429 + `Retry-After: 5`, `CMD_MISSING_ARG` 422, `FLOW_BUSY` 409, `NOT_FOUND` 404 (flow không thuộc phòng), `ROOM_NOT_FOUND` 404, `VALIDATION_ERROR` 400 |
`apps/hub-api/src/lib/errors.ts`: gộp mã + message "Only the person who asked the agent can reply" (vi do FE dịch).

### 2.2 `rooms.ts`
| Tên | Định nghĩa |
|---|---|
| Hằng | `ROOM_ORCHESTRATOR_TAG = "orchestrator"`, `ROOM_CONTEXT_MAX = 20`, `ROOM_ACTIVE_RUNS_MAX = 50`, `ROOM_PLACEMENTS = ["main","flow"]`, `ROOM_RUN_STATUSES = ["finished","failed","cancelled"]`, `ROOM_WAIT_KINDS = ["need_input","side_effect"]` |
| `RoomAgentRefSchema` | strict `{ key: ChatAgentKeySchema, name: { vi: 1–100, en: 1–100 } }` (Orchestrator: key/tên của agent Orchestrator trong ảnh) |
| `RoomAskSchema` | strict `{ kind: enum ROOM_WAIT_KINDS, question?: 1–CHAT_ASK_QUESTION_MAX, choices?: string[] ≤ CHAT_ASK_CHOICES_MAX }` — `question/choices` của `side_effect` **chỉ** có khi người xem = người gọi (D3) |
| `RoomMessageSchema` + (optional, vắng ≡ mặc định) | `placement?` (vắng = `main`) · `agent?: RoomAgentRef` (tin agent) · `caller?: {id, display_name}` (tin agent: người gọi) · `run_status?: enum ROOM_RUN_STATUSES` · `ask?: RoomAsk` · `steps?: {count ≥ 0, ms ≥ 0}` · `flow?: {message_count ≥ 0, last_active_at: IsoDateTime, can_reply: boolean}` (chỉ tin agent `main` gốc flow; `can_reply` **theo người xem** = agent của flow ∈ AU người xem). Không `superRefine` (test X2a R28: `sender_type:"agent"` thiếu trường phụ vẫn hợp lệ). Tin agent luôn có `run_id`, `flow_id`, `trigger_message_id`, `agent`, `caller`, `run_status`; `sender = {id: agent_id, display_name: name.vi}` |
| `SendRoomMessageRequestSchema` + | `flow_id?: Uuid` (trả lời tiếp) · `answer_run_id?: Uuid` (trả lời `ask`/xác nhận của lượt đó; cần `flow_id`) |
| `RoomMessageListQuerySchema` + | `flow_id?: Uuid` — có ⇒ mọi tin của flow (`main`+`flow`, seq tăng); vắng ⇒ timeline (`placement='main'`) |
| `RoomActiveRunSchema` | strict `{ run_id, flow_id, trigger_message_id, agent: RoomAgentRef.nullable() (null = Orchestrator), caller: {id, display_name}, status: "running"\|"waiting", wait_kind?: enum ROOM_WAIT_KINDS (⇔ waiting), started_at }` |
| `RoomDetailSchema` + | `active_runs?: RoomActiveRun[] ≤ 50` (X2b luôn trả, sắp `started_at`) |

### 2.3 `me-stream.ts` (khối mới, D10)
| Sự kiện | `data` (strict) | Người nhận |
|---|---|---|
| `room.run_started` | `{room_id, run_id, flow_id, trigger_message_id, agent: RoomAgentRef\|null, caller: {id, display_name}}` | thành viên hiện tại (đọc dưới khoá tx gọi) |
| `room.run_waiting` | `{room_id, run_id, flow_id, caller_id, kind: wait}` | thành viên hiện tại lúc đăng |
| `room.run_finished` | `{room_id, run_id, flow_id, status: ROOM_RUN_STATUSES, message_id: Uuid\|null}` (null = không đăng, R17) | thành viên hiện tại lúc đăng (rỗng nếu phòng xoá) |
`ME_STREAM_RUN_EVENTS` (3), `MeStreamRunEventSchema` (discriminatedUnion), `parseMeStreamRunEvent(event, data) → MeStreamRunEvent | null` (như `parseMeStreamEvent`). Tin agent vẫn đi `room.message` (+ `room.unread`); `room.message` cho người gọi chứa `ask.question/choices` của `side_effect`, người khác chỉ `{kind}` (payload theo người nhận). Không phát `delta` cho cả phòng [Q1].

## 3. Endpoint × thứ tự kiểm (Bearer JWT, mọi role)
| Endpoint | Thứ tự kiểm → mã | Trả |
|---|---|---|
| `POST /rooms/:id/messages` (sửa) | (1) `access send` → 404 `ROOM_NOT_FOUND` · (2) zod → 400 · (3) trùng `client_msg_id` (đọc) → 200 tin cũ, không run · (4) `flow_id` không có trong phòng → 404 `NOT_FOUND`; `answer_run_id` không phải run chờ của flow → 404 `NOT_FOUND`, của người khác → 403 `NOT_RUN_CALLER` · (5) `routeRoomMessage` (R01–R03): `plain` → đường X2a nguyên vẹn · (6) `prepare` tag / agent của flow ∉ AU → 404 `AGENT_NOT_FOUND`/422 `CMD_MISSING_ARG` (không ghi) · (7) tx gọi (D5) → 409 `FLOW_BUSY`, 429 `TOO_MANY_RUNS` (ROLLBACK) | 201 `RoomMessage` (tin gọi, `flow_id` = flow) + `X-Run-Id`, `X-Flow-Id`; 200 trùng (không header) |
| `GET /rooms/:id/messages` (+`flow_id`) | `access view` 404 → zod 400 → `flow_id` không thuộc phòng → 404 `NOT_FOUND` | `RoomMessagePage` (D3: nội dung riêng chỉ cho người gọi) |
| `GET /rooms/:id` (+`active_runs`) | như X2a | `RoomDetail` + `active_runs` (definer `room_run_states`) |
| `GET /runs/:id/events`, `POST /runs/:id/cancel`, `GET /runs/:id/trace` | không đổi: RLS `runs` ⇒ chỉ người gọi; người khác 404 | như C1 |
| `/conversations*` (C1) | hội thoại nền ⇒ 404 (D2) | như C1 |
| `GET /agents` | không đổi (R14) | |
| Rời/bớt/xoá phòng (X2a) | sau COMMIT: `CancelService.cancelRoomRuns` (R17) | như X2a |

## 4. DB — migration `0014_x2b_room_agents.sql` (viết tay, idempotent, `_journal` idx 14)
Đối chiếu thật: `room_messages` (0011) đã có `sender_type ('user','agent')`, `sender_id` (NULL được với agent), `run_id`, `flow_id`, `trigger_message_id` — **chưa FK, chưa index**; **không có cột đính kèm**. 0013 thêm CHECK `room_messages_user_no_agent_ck` (tin user không mang 3 cột) + trigger `room_messages_stamp`, `rooms_seq_integrity_tg`. `runs` chưa có `room_id`.

### 4.1 Cột / ràng buộc / index
| Bảng | Thay đổi |
|---|---|
| `flows` | `room_flow_id uuid NULL`; `UNIQUE (room_flow_id, user_id) WHERE room_flow_id IS NOT NULL` |
| `conversations` | `room_id uuid NULL`; FK `(room_id, tenant_id) → rooms(id, tenant_id)`; `UNIQUE (room_id, user_id) WHERE room_id IS NOT NULL` (`conversations_room_user_uq`) |
| `runs` | `room_id uuid NULL`, FK `(room_id, tenant_id) → rooms`; `room_posted_at timestamptz NULL`; CHECK `runs_room_posted_ck`: `room_posted_at IS NULL OR (room_id IS NOT NULL AND status <> 'running')`; index `runs_room_running_idx (room_id) WHERE room_id IS NOT NULL AND status='running'`; `runs_room_unposted_idx (finished_at) WHERE room_id IS NOT NULL AND room_posted_at IS NULL AND status <> 'running'` |
| `room_messages` | + `placement text NOT NULL DEFAULT 'main'` CHECK `IN ('main','flow')` · `run_status text NULL` CHECK ∈ 3 · `wait_kind text NULL` CHECK ∈ 2 · `ask jsonb NULL` (chỉ `need_input`: `{question, choices}`) · `step_count int NULL ≥ 0` · `run_ms int NULL ≥ 0`. FK: `run_id → runs(id)`, `trigger_message_id → room_messages(id)` (dữ liệu X2a đều NULL ⇒ hợp lệ) |
| `room_messages` CHECK | DROP `room_messages_user_no_agent_ck`; ADD `room_messages_user_ck`: user ⇒ `run_id, trigger_message_id, run_status, wait_kind, ask, step_count, run_ms` NULL (cho phép `flow_id`) · `room_messages_agent_ck`: agent ⇒ `sender_id, run_id, flow_id, trigger_message_id, run_status` NOT NULL · `room_messages_flow_ck`: `placement='main' OR flow_id IS NOT NULL` · `room_messages_ask_ck`: `ask IS NULL OR wait_kind='need_input'` |
| `room_messages` index | `room_messages_run_uq UNIQUE (run_id) WHERE sender_type='agent'`; `room_messages_main_idx (room_id, seq) WHERE placement='main'` (timeline + ngữ cảnh); `room_messages_flow_idx (room_id, flow_id, seq) WHERE flow_id IS NOT NULL` |
| `conversations_user_list_idx` | giữ; truy vấn list thêm `room_id IS NULL` (shim ≤ 1/phòng/user, lọc sau index) |

### 4.2 RLS + hàm `SECURITY DEFINER` (search_path cố định, tên đủ schema)
| Hàm / policy | Hợp đồng |
|---|---|
| `ALTER POLICY room_messages_insert` | WITH CHECK hiện có (0012) **AND** `(flow_id IS NULL OR hub.is_my_room_flow(room_id, flow_id))` |
| `hub.is_my_room_flow(p_room, p_flow) → boolean` | scope `user`; người gửi có `hub.flows` `room_flow_id = p_flow` trong hội thoại nền của `p_room` (tạo trước trong cùng tx), cùng tenant, là thành viên. Flow có trong phòng hay không do route kiểm qua `room_messages` (RLS thành viên) |
| `hub.room_post_agent_message(p_run, p_sender, p_content, p_meta jsonb) → TABLE(posted bool, seq bigint, created_at timestamptz, placement text)` | **chỉ scope `system`** (khác ⇒ 42501). Đọc run (không khoá) lấy `room_id` → khoá `rooms` → khoá `runs` FOR UPDATE: `room_posted_at` có/`running` ⇒ `posted=false` (idempotent). Phòng xoá hoặc `runs.user_id` không còn thành viên ⇒ đặt `room_posted_at`, `posted=false` (R17). Khác: `last_seq+1`, `last_activity_at` (ms, như `room_next_seq`), DM bỏ ẩn, INSERT tin agent (`id = runs.answer_message_id`, `flow_id = flows.room_flow_id` của run, `trigger_message_id = runs.user_message_id`, `created_at = last_activity_at`, `placement = main` nếu flow chưa có tin agent, khác `flow`, meta → cột), mốc đọc người gọi theo D14, `room_posted_at = now()` |
| `hub.room_fanout_sys(p_room) → TABLE(user_id, unread, total)` | chỉ scope `system`; như `room_fanout` cho thành viên hiện tại |
| `hub.room_run_states(p_room) → TABLE(run_id, flow_id, trigger_message_id, caller_id, agent_id, status, wait_kind, started_at)` | scope `user` + thành viên; (a) `runs` `room_id=p_room AND status='running'`; (b) lượt chờ: tin agent có `wait_kind` mà flow riêng của người gửi lượt chưa có run mới hơn; chỉ người gửi còn là thành viên; `LIMIT 50` |
| GRANT | `EXECUTE` 5 hàm → `hub_rw`; `REVOKE ALL … FROM PUBLIC`. Không GRANT/policy mới trên bảng (`runs`, `conversations` đã đủ cho `hub_rw`) |
| Bất biến giữ | `room_members_guard` (không thêm policy UPDATE), `rooms_seq_integrity_tg` (definer tăng seq + chèn tin cùng tx), test khoá X2a `RV2-N2c` (flow_id ngẫu nhiên ⇒ FK/policy từ chối) |

Drizzle: `schema/hub.ts` (`conversations.roomId`, `runs.roomId/roomPostedAt`), `schema/hub-rooms.ts` (6 cột mới). Seed: không đổi dữ liệu có sẵn.

## 5. Luồng và thứ tự khoá
| Luồng | Transaction (scope) | Thứ tự |
|---|---|---|
| Gọi agent (tin `@` hoặc trả lời flow) | 1 tx `user` (`RoomsService.commit`) | `lockFor(rooms)` → trùng `client_msg_id` (lại, dưới khoá) → shim `INSERT … ON CONFLICT DO NOTHING` → `createRunTx` (advisory user → conversations → flows → runs → messages → tool_confirmations) → `room_next_seq` → `advanceRead` → INSERT tin gọi (`id = runs.user_message_id`, `flow_id`; tin gọi đầu flow `main`, trả lời `flow`) → chụp ngữ cảnh (§6) → `room_fanout` + `activeMemberIds`. Sau COMMIT: phát `room.message`, `room.unread`, `room.run_started` → `launch` |
| Kết thúc run | tx1 `system` = `SseWriter.finish` C1 **không đổi** (flows → runs → messages → jobs) | Sau tx1: hook `onClosed(runId)` → `RoomRunPoster.post` |
| Đăng tin agent | tx2 `system` | đọc run + `messages` trả lời + `flows.pending_ask` + `tool_confirmations` pending (không khoá) → `agentMessageView` → definer (rooms → runs → room_members → room_messages) → `room_fanout_sys`. Sau COMMIT: `room.message` (payload theo người nhận), `room.unread`, `room.run_waiting?`, `room.run_finished` |
| Huỷ (E15, lease, sweeper) | như C1 | `CancelService` gọi `onClosed` sau commit; sweeper/lease để `reconcile` |
| Reconcile | `system`, 5 s, `startRunLoops` | `runs_room_unposted_idx` `LIMIT 20` → `post` từng run |
| Rời/bớt/xoá phòng | tx X2a nguyên vẹn | Sau COMMIT: `cancelRoomRuns({tenantId, roomId, userId?})` (system; mỗi run một `cancelRun` như E15) → `onClosed` → definer thấy không còn thành viên ⇒ không đăng (R17, [Q8]) |
Không chu trình: đường gọi khoá `rooms` trước mọi bảng hub; tx1 không chạm bảng phòng; tx2 khoá `rooms` trước `runs` (run đã kết thúc ⇒ không tranh với huỷ/kết thúc). FK `room_messages.flow_id` lấy KEY SHARE trên `flows` ⇒ tx2 có thể chờ tx1 khác cùng flow (tx1 không cần `rooms`) — không deadlock.

## 6. Ngữ cảnh run (R07, R08, Q6)
| Trường hợp | `roomHistory` | `flowHistory` (C1) |
|---|---|---|
| Tin `@` ở timeline | ≤ 20 tin `placement='main'`, `seq` < tin gọi, cũ→mới (`room_messages_main_idx`) | rỗng (flow mới) |
| Trả lời trong flow [Q6, Q7] | ≤ 20 tin `main` có `seq` < tin gọi gốc + ≤ 20 tin gần nhất của flow (mọi lượt, mọi người, bản công khai) có `seq` < tin gọi | không dùng (D7) |
Mỗi mục: `role = user|assistant`, `content = "<display_name>: <content>"` (user) / nội dung công khai (agent), cắt `HISTORY_CONTENT_MAX`. Truy vấn trong tx gọi, scope user + RLS thành viên + `room_id` + `tenant_id` ⇒ không lấy phòng khác/hội thoại riêng (AC09/AC10). Tin gọi = `content` của run (phần sau tag), không lặp trong history. Không lấy file (D16).

## 7. Realtime
Ghi `ustream:<uid>` qua `UserStreamWriter` X2a sau COMMIT (không trong tx). Người nhận = thành viên đọc dưới khoá `rooms` trong cùng tx. `room.message` tin agent dựng **theo người nhận**: người gọi nhận `content`/`ask` riêng (từ `messages` hội thoại nền), người khác bản công khai. Người gọi xem stream token qua `GET /runs/:id/events` (C1). `stream.reset` → FE tải lại `GET /rooms/:id` (`active_runs`) + trang tin.

## 8. Luật thuần — chữ ký (`apps/hub-api/src/modules/rooms/agents/room-agent.rules.ts`; QC viết test trước ở `tests/acceptance/X2b/rules/`)
```ts
export type RoomRoute =
  | { kind: "plain" }                                                     // R02: không @ đầu tin, `@@`, `/…`, tag giữa câu
  | { kind: "agents"; routed: MentionRouted }                             // ≥ 1 tag agent (đã bỏ `orchestrator`)
  | { kind: "orchestrator"; content: string; onlyKeys?: ReadonlySet<string> } // `@orchestrator` (+ tag khác ⇒ thu hẹp)
  | { kind: "flow_reply"; routed: Routed };                               // D13: tin trong flow (mọi thành viên có quyền)
export function routeRoomMessage(content: string, inFlow: boolean): RoomRoute;          // R01–R03, D8
export function canTriggerRun(m: { senderType: "user" | "agent"; activeMember: boolean }): boolean; // R01, AC12
export function replyAccess(p: { flowExists: boolean; flowAgentKey: string | null; au: ReadonlySet<string>;
  answerRun?: { exists: boolean; callerId: string; waiting: boolean }; userId: string }):
  "ok" | "not_found" | "agent_not_found" | "not_caller"; // R11/R13 sửa 2026-10-08 (null key = Orchestrator ⇒ ok)
export function canReply(flowAgentKey: string | null, au: ReadonlySet<string>): boolean; // flow.can_reply theo người xem
export type RoomCtxRow = { seq: number; senderType: "user" | "agent"; senderName: string; content: string; placement: "main" | "flow" };
export function roomContext(rows: readonly RoomCtxRow[], beforeSeq: number, max?: number): HistoryItem[]; // R07/R08, max=20
export type AgentOutcome = { status: "finished" | "failed" | "cancelled"; content: string; ask: Ask | null;
  pendingConfirm: boolean; locale: "vi" | "en" };
export function agentMessageView(o: AgentOutcome): { content: string; runStatus: AgentOutcome["status"];
  waitKind: "need_input" | "side_effect" | null; ask: Ask | null };                  // R10/R12/R16: side_effect ⇒ câu chung, ask=null; lỗi ⇒ câu chung
export function askForViewer(m: { waitKind: string | null; ask: Ask | null; privateAsk: Ask | null; isCaller: boolean }): RoomAsk | undefined; // R12
export function callerReadAfterPost(lastReadSeq: number, seq: number): number | null; // D14
export function shouldPost(p: { running: boolean; posted: boolean; roomDeleted: boolean; callerActive: boolean }): boolean; // R17
export function confirmStillAllowed(agentId: string, au: ReadonlySet<string>): boolean; // D15 [Q2]
```
Câu chung (locale run; FE dịch theo `run_status`/`ask.kind`): `side_effect` "<agent> cần <người gọi> xác nhận một thao tác." · lỗi "Agent không hoàn thành được yêu cầu." · huỷ "Đã huỷ.".

## 9. File mới / sửa → cột `File` của [`tasks.md`](tasks.md) B1–B7 (≤ 400 dòng/file, ≤ 50 dòng/hàm, route ≤ 30). Thư mục mới `modules/rooms/agents/` (rules, service, tx, context repo, poster + reconcile, events, README).

## 10. Hiệu năng (CONVENTIONS §6, ưu tiên thấp)
| Truy vấn | Index |
|---|---|
| Ngữ cảnh 20 tin / timeline | `room_messages_main_idx (room_id, seq) WHERE placement='main'` (spec §6 đổi `created_at` → `seq`: cùng thứ tự, có sẵn unique) |
| Tin flow | `room_messages_flow_idx` |
| `active_runs` | `runs_room_running_idx` + `room_messages_flow_idx` |
| `flow.*` (≤ 50 gốc/trang) | 1 `GROUP BY flow_id` (`room_messages_flow_idx`) |
| Reconcile | `runs_room_unposted_idx`, `LIMIT 20` |
| Đếm run người gọi | `runs_user_running_idx` (H2b) |
Tx gọi ≈ 12 câu; mục tiêu p95 `POST` có `@` < 300 ms (không tính LLM).

## 11. Security review (RV1, riêng, hard-stop spec §9)
| Kiểm | Nơi |
|---|---|
| Quyền theo người gọi: `runs.user_id` = người gửi, AU người gửi, `max_concurrent_runs`/usage người gửi | `room-run.service`, `createRunTx` (AC01, 07, 08) |
| Không đường vòng: hội thoại nền 404 qua `/conversations*`; lượt trong flow chạy quyền/quota **người gửi lượt**; `answer_run_id` của người khác 403; flow phòng khác 404 | D2, D13, `replyAccess` (AC05, 10) |
| Ngữ cảnh: chỉ phòng này, ≤ 20, cắt tại tin gọi, scope user + RLS | `room-context.repo` (AC09, 10) |
| R12: tham số `side_effect` không có trong `room_messages`, không trong `room.message` người khác, không trong list người khác | D3, `askForViewer` (AC06) |
| Chặn vòng lặp: chỉ `sender_type='user'` + thành viên gọi được; tin agent chỉ ghi qua definer scope `system` | R01, policy insert (AC12) |
| Definer: kiểm scope, không nhận `room_id`/`user_id` từ tham số (suy từ run), idempotent | §4.2 |
| Rời/xoá: huỷ run + không đăng; người cũ không nhận sự kiện | §5 (AC10, R17) |

## 12. Trả lời `plan-frontend.md` §10
| # FE | Chốt BE |
|---|---|
| 1 | Body giữ `RoomMessage`; run qua `X-Run-Id`/`X-Flow-Id` + `room.run_started` (D11). `AGENT_NOT_FOUND.details` chỉ `{suggestions}` (schema H2b strict, không thêm `tag`; FE lấy tag từ ô nhập) |
| 2 | Có: `placement`, `agent`, `caller`, `flow{message_count,last_active_at}`, `ask`, `steps{count,ms}`. Trạng thái tên **`run_status`** `finished\|failed\|cancelled` (không `status: ok`) |
| 3 | Có (D3 + §7): người khác `ask: {kind}` |
| 4 | Có: `GET /rooms/:id` `active_runs` (§2.2), `status running\|waiting` + `wait_kind` |
| 5 | Có, hằng riêng `ME_STREAM_RUN_EVENTS` + `parseMeStreamRunEvent` (D10); `run_finished` thêm `flow_id`, `message_id` |
| 6 | Có; flow lạ 404 `NOT_FOUND`. **Đổi theo Q7 chốt**: mọi thành viên có quyền agent gửi được (`flow.can_reply` theo người xem); trả lời ask dùng `answer_run_id`, của người khác 403 `NOT_RUN_CALLER` |
| 7 | Sang X2b-2 (D16) |
| 8 | `NOT_RUN_CALLER` ở `CHAT_ROOM_AGENT_ERRORS` (không `CHAT_ROOM_ERRORS`, D9); huỷ chỉ người gọi (RLS `runs`) |

## 13. Câu hỏi
### 13.1 Mặc định spec §9 mà plan dựa vào
Q1 → §2.3, §7 · Q2 → D15 · Q3 → không limit mới · Q4 → D5, §3 bước 6–7 · Q5 → D3, `agentMessageView`, `askForViewer` · Q6 → §6 · **Q7 chốt 2026-10-08** → D12, D13, §6, `replyAccess`, `canReply` · Q8 → §5, `shouldPost` · Q9 → D16, §14 · Q10 → D8 · Q11 → list `flow_id` mọi thành viên, trace chỉ người gọi · Q12 → D4, D5.
### 13.2 Câu hỏi mới (mức Thường, có mặc định — không chặn Gate)
| Q | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q13 | Tin trong flow (`placement=flow`) có tính chưa đọc? | **Có** (mọi tin phòng có `seq`; bộ đếm X2a O(1)). FE hiện "n tin trong luồng" để giải thích |
| Q14 | File `out/` agent tạo trong run phòng? | X2b: không hiện trong phòng (gắn tin riêng ở hội thoại nền, sweeper dọn như C1); hiện cho cả phòng ở X2b-2 |
| Q15 | `@orchestrator` là tag dành riêng chỉ trong phòng? | **Có** (D8). Agent có key `orchestrator` (nếu có) bị che trong phòng → TECH-DEBT: Studio cấm key này |

## 14. Q9 — đánh giá cỡ đính kèm phòng → đề xuất **tách X2b-2**
| Hạng mục | Ước lượng |
|---|---|
| Migration: `attachments.room_message_id/room_id`, FK, CHECK `attachments_bound_ck` (đòi `conversation_id`), RLS đọc cho **thành viên** (hiện chỉ chủ file) qua definer | ~120 dòng SQL, rủi ro cao |
| `POST /rooms/:id/messages` nhận `attachment_ids` (bind, hạn mức, 404 `ATTACHMENT_NOT_FOUND`), `GET /attachments/:id/content` cho thành viên, sweeper (rời/xoá phòng), `RoomMessage.attachments`, file vào run (R09) + `out/` lên phòng (Q14) | ~450 dòng TS, 2 task cao |
| FE F5 + e2e + test cách ly file (AC11) | ~300 dòng + test |
Tổng ≈ 40% BE + 1 task FE + bề mặt rò file mới ⇒ > 1/3 mốc. **Đề xuất:** X2b-2 = đính kèm phòng (FR-44 trong phòng, R09 đầy đủ, AC11, Q14). Ở X2b: AC11 rút còn "gửi `attachment_ids` vào tin phòng → 400; run phòng `runs.attachment_ids = {}`" (qc chỉnh test-plan). Cần điều phối báo người dùng (Luật 2b).

## 15. Rủi ro còn mở
| Rủi ro | Giảm |
|---|---|
| Tách `RunService.start` hỏng C1 | B3 chạy test C1/H2b/H2c + AC-H07 |
| Quên lọc shim ở một endpoint `/conversations*` | Lọc ở repo (một chỗ `ownedConversation`), test 404 cho từng E5–E15 |
| Tin agent đến chậm khi instance chết giữa tx1/tx2 | reconcile 5 s; idempotent |
| Hai người chạy song song trong cùng flow phòng (flow riêng mỗi người ⇒ `FLOW_BUSY` không chặn) | Chấp nhận; thứ tự theo `seq` |
| Bản phòng/bản riêng lệch | Dựng một lần qua `agentMessageView` lúc đăng |

## 16. Lệnh xong
Mỗi task: `bun run typecheck && bun test <phạm vi> 2>&1 | tail -40 && bun run check:size && bun run test:lock:verify`. Mốc: `bun run typecheck && bun test && bunx playwright test X2b` + test khoá X2a/C1/H2b xanh.
