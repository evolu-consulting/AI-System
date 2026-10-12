# Plan · X2b2-room-attachments — phần Backend (Hub TS)

Spec: [`spec.md`](spec.md) (X2b2-R01…R22, AC01…AC16, §9 Q1–Q16). Nền: H2c `plan.md`/`plan-db` (kho, E12 R09–R14, R26–R29), X2b `plan.md` (D1 hội thoại nền, D4 poster tx2, D5 thứ tự khoá, §6 ngữ cảnh). FE: `plan-frontend.md` (frontend-lead). Code đối chiếu 2026-10-12 trên `595ef3ae`.

## 1. Quyết định chính
| # | Quyết định | Lý do (code thật) |
|---|---|---|
| D1 | Migration kế = **`0023_x2b2_room_attachments.sql`** (`_journal` idx 23). Viết tay, idempotent (`ADD COLUMN IF NOT EXISTS`, `DO $$ … pg_constraint/pg_policies`, `CREATE OR REPLACE`) | `0022_pb_runs_grant` là cuối; test `hub-h2c.int` gỡ `attachments CASCADE` rồi áp lại 0007 **+ mọi migration sau** ⇒ 0023 phải chạy lại được |
| D2 | Liên kết = 2 cột mới `attachments.room_id`, `room_message_id` (Q2). **Không** dùng `message_id` cho phòng; khi gắn phòng: `message_id`, `conversation_id`, `flow_id` = NULL | FK `message_id → hub.messages`; tin phòng nằm ở `hub.room_messages` |
| D3 | **"Chưa gắn" = `message_id IS NULL AND room_id IS NULL`** — sửa mọi câu đang dùng `message_id IS NULL` làm nghĩa "chưa gắn" (bảng §5) | Không sửa ⇒ file phòng (message_id NULL) bị gửi lại vào hội thoại riêng (rò R06) **và** bị sweeper R27 xoá sau 24 giờ |
| D4 | FK kép bảo đảm cùng tenant/cùng phòng: `(room_id, tenant_id) → rooms(id, tenant_id)`; `(room_message_id, room_id) → room_messages(id, room_id) ON DELETE SET NULL (room_message_id)` (PG16) + UNIQUE mới `room_messages(id, room_id)` | Lớp 2 cách ly (không tin code); `room_id` giữ khi tin bị xoá cứng ⇒ không thành "chưa gắn" |
| D5 | RLS: (a) **siết** `attachments_hub_rw` (ALTER POLICY) nhánh `user`: thêm `AND (room_id IS NULL OR hub.is_room_member(room_id))`; (b) policy mới `attachments_room_member_select` FOR SELECT: `user` + đúng tenant + `room_id IS NOT NULL AND hub.is_room_member(room_id)`. Ghi vẫn chỉ chủ file | R05: người upload đã rời phòng cũng 404 — mọi đường đọc scope `user` (kể cả `ownsUpload` P-b) tự đúng; definer `is_room_member` sẵn (0011), không đệ quy |
| D6 | Xoá phòng ⇒ hàm definer `hub.attach_claim_deleted_rooms(p_now, p_limit)` (chỉ scope `system`) cho sweeper | RLS `rooms` **không có nhánh system** (0011) ⇒ sweeper không JOIN được `rooms` |
| D7 | Kiểm trước (ngoài tx, scope user, cùng một lượt đọc): trùng `client_msg_id` ⇒ 200 tin cũ **trước** kiểm file; rồi `checkRoomSendable` ⇒ 404 `ATTACHMENT_NOT_FOUND{ids}`. Trong tx: gắn sau INSERT tin, đếm hàng ≠ số id ⇒ 404 + ROLLBACK | R02–R04; gửi lại tin đã thành công phải 200 chứ không 404 |
| D8 | Tin timeline `!…` (engine P-a bật, không `flow_id`, không `answer_run_id`) **kèm** `attachment_ids` ⇒ 400 `VALIDATION_ERROR` (path `attachment_ids`, message `unsupported`) | Q12/R20 "giữ P-a": hôm nay mọi `attachment_ids` ở phòng = 400; P-a nhận file qua input quy trình (P-b), không qua tin |
| D9 | File-set run phòng (R07): id tin trong cửa sổ = tin gọi + `contextRows` timeline (≤ 20) + thread (≤ 50) — **gồm cả tin agent** (file `out/` trước đó). Một câu lọc `room_id` + `m.id = ANY(window)`; chọn bằng `pickRoomRunFiles` | Khớp ngữ cảnh X2b §6; agent làm tiếp trên `out/` cũ |
| D10 | Run phòng **bỏ** `attachFiles` H2c trong `createRunTx` (`p.room ⇒ []`); tập file ghi `runs.attachment_ids` ngay sau gắn (cùng tx gọi), `launch(p, files)` thay `[]` | Ứng viên H2c đọc `hub.messages` của flow nền — có output cũ gắn trước X2b-2 ⇒ lệch R07 |
| D11 | `out/` (R11): `SseWriter.finish` **không** gắn output khi `finishRun` trả `roomId` ≠ NULL; `RoomRunPoster` gắn output vào tin agent (`room_message_id = runs.answer_message_id`) trong **cùng tx2**, chỉ khi `status=finished` ∧ definer trả `posted` | Tin agent phòng có `id = answer_message_id` (0016); gắn ở tx1 sẽ vào tin riêng hội thoại nền (X2b D16) |
| D12 | Q16 **đổi mặc định**: `dify-agent`/`dify-workflow` gọi bằng `@` trong phòng nhận `runs.attachment_ids` như mọi run nhưng runner Dify **không** gửi file (giống hội thoại riêng hôm nay — H2c "Không làm" T11); công cụ MCP Dify (B8) trong job agent CLI vẫn dùng `payload.attachments` | `dify-agent-runner.ts` không đọc file; mở rộng = T11, ngoài phạm vi |
| D13 | Không mã lỗi mới, không env mới, không thư viện mới (⇒ không ADR). `CHAT_ATTACHMENT_ERRORS`, `CHAT_ROOM_ERRORS`, `CHAT_ROOM_AGENT_ERRORS` giữ nguyên | Test khoá X2a R24 |

## 2. Contract `@ai/contracts/chat/rooms.ts` — chỉ thêm (không đổi export C1 — snapshot X2a-AC11)
| Schema | Thêm | Ràng buộc |
|---|---|---|
| `SendRoomMessageRequestSchema` | `attachment_ids?: uuid[]` | `.min(1).max(ATTACH_PER_MESSAGE_MAX=10)`, refine không trùng (`"duplicate"`) — **y hệt** E12; vắng = không file. Server chuẩn hoá chữ thường, trùng sau chuẩn hoá ⇒ 400 (`normalizeAttachmentIds` sẵn có) |
| `RoomMessageSchema` | `attachments?: AttachmentRef[]` | `.min(1).max(10)`; vắng khi không file; phần tử = `AttachmentRefSchema` (`id, filename, mime, size, available`) — `available = purged_at IS NULL`; thứ tự `position` tăng |

Kéo theo (không sửa file): `RoomMessageEventDataSchema` (`room.message`), `RoomMessagePageSchema`, tin agent ở `room.message` đều mang `attachments?`. Endpoint upload/đọc **không đổi hình**: `POST /attachments` (201 `Attachment`), `GET /attachments/:id` (`AttachmentDetail`), `GET /attachments/:id/content` (header H2c-R13).

## 3. Endpoint × thứ tự kiểm (Bearer JWT, mọi role; `tenant_admin` không có quyền vượt)
| Endpoint | Thứ tự | Ghi |
|---|---|---|
| `POST /rooms/:id/messages` | 401 → `:id` sai/không thành viên 404 `ROOM_NOT_FOUND` → zod 400 (11 id, trùng, `content` rỗng, khoá lạ) → **D8** 400 → trùng `client_msg_id` ⇒ **200** tin cũ (kèm `attachments`, không gắn lại) → `checkRoomSendable` 404 `ATTACHMENT_NOT_FOUND{ids}` (thứ tự gửi) → đường X2b/P-a như cũ (`PROCESS_THREAD_NO_AGENT` 422, `AGENT_NOT_FOUND` 404, thread `NOT_FOUND`, `NOT_RUN_CALLER` 403, `FLOW_BUSY` 409, `TOO_MANY_RUNS` 429, `CMD_MISSING_ARG` 400) → tx: khoá phòng → … → INSERT tin → **gắn** (thiếu ⇒ 404, ROLLBACK) → (run) file-set → 201 | Lỗi sau bước gắn ⇒ ROLLBACK, file vẫn chưa gắn (R03) |
| `GET /rooms/:id/messages` | như X2a/X2b | mỗi tin có file mang `attachments` (1 câu phụ / trang) |
| `GET /attachments/:id[/content]` | 401 → id không uuid 404 → `findReadableAttachment` không ra hàng ⇒ 404 `NOT_FOUND` → `/content`: `purged_at` ≠ NULL ⇒ 404 | Không 403 (R05) |
| `/conversations*` | không đổi | file phòng có `message_id` NULL ⇒ không bao giờ xuất hiện (R06) |

## 4. DB — `0023_x2b2_room_attachments.sql`
### 4.1 Cột · ràng buộc · index
| Đối tượng | Định nghĩa | Ghi |
|---|---|---|
| `attachments.room_id` | `uuid NULL` | NOT NULL ⇔ đã gắn tin phòng (không bao giờ xoá về NULL bởi app) |
| `attachments.room_message_id` | `uuid NULL` | |
| `room_messages_id_room_uq` | `UNIQUE (id, room_id)` trên `hub.room_messages` | đích FK kép; không thêm policy `room_messages` (test X2a đếm 7 policy) |
| `attachments_room_fk` | `FOREIGN KEY (room_id, tenant_id) REFERENCES hub.rooms (id, tenant_id)` (NO ACTION) | phòng chỉ xoá mềm |
| `attachments_room_message_fk` | `FOREIGN KEY (room_message_id, room_id) REFERENCES hub.room_messages (id, room_id) ON DELETE SET NULL (room_message_id)` | FK bỏ qua RLS (kiểm ở cả scope system) |
| `attachments_room_bound_ck` | `CHECK (room_id IS NULL OR (message_id IS NULL AND conversation_id IS NULL AND flow_id IS NULL AND bound_at IS NOT NULL AND position IS NOT NULL AND position BETWEEN 0 AND 9))` | "một nơi" (R06); `position IS NOT NULL` tường minh như 0007 |
| `attachments_room_msg_ck` | `CHECK (room_message_id IS NULL OR room_id IS NOT NULL)` | |
| `attachments_room_message_idx` | `(room_message_id, position) WHERE room_message_id IS NOT NULL` | refs theo tin + file-set |
| `attachments_room_live_idx` | `(room_id) WHERE purged_at IS NULL AND room_id IS NOT NULL` | sweeper phòng xoá |
| `rooms_deleted_idx` | `hub.rooms (id) WHERE deleted_at IS NOT NULL` | như `conversations_deleted_idx` |

`attachments_bound_ck`, `attachments_unbound_idx` (0007) **giữ nguyên tên/định nghĩa** (test A133/A134). Không sửa migration cũ. Drizzle `packages/db/src/schema/hub.ts`: `roomId: uuid("room_id")`, `roomMessageId: uuid("room_message_id")` (chỉ kiểu) + dòng chú thích DDL thêm `0023`.

### 4.2 RLS · definer · GRANT
| Mục | SQL (ý) |
|---|---|
| `ALTER POLICY attachments_hub_rw` | USING / WITH CHECK = `scope='system' OR (scope='user' AND tenant_id=GUC AND user_id=GUC AND (room_id IS NULL OR hub.is_room_member(room_id)))` |
| `CREATE POLICY attachments_room_member_select ON hub.attachments FOR SELECT TO hub_rw` | `USING (current_setting('app.scope', true)='user' AND tenant_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid AND room_id IS NOT NULL AND hub.is_room_member(room_id))` (DO … IF NOT EXISTS) |
| `hub.attach_claim_deleted_rooms(p_now timestamptz, p_limit integer) RETURNS TABLE (id uuid, storage_key text)` | plpgsql `VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp`, `#variable_conflict use_column`; scope ≠ `system` ⇒ `RAISE … ERRCODE '42501'`; `WITH c AS (SELECT a.id FROM hub.rooms r JOIN hub.attachments a ON a.room_id = r.id AND a.tenant_id = r.tenant_id WHERE r.deleted_at IS NOT NULL AND a.purged_at IS NULL LIMIT least(greatest(p_limit,1),500) FOR UPDATE OF a SKIP LOCKED) UPDATE hub.attachments a SET purged_at = p_now FROM c WHERE a.id = c.id RETURNING a.id, a.storage_key` |
| GRANT | `REVOKE ALL ON FUNCTION … FROM PUBLIC; GRANT EXECUTE … TO hub_rw`. Bảng: không đổi (hub_rw đã có S/I/U/D trên `attachments`); `agent_runtime` không quyền |

Ma trận đọc sau 0023 (scope user, cùng tenant): chủ + `room_id NULL` ⇒ thấy · `room_id` ≠ NULL ⇒ thấy ⇔ thành viên hiện tại (chủ đã rời = không) · khác tenant / scope lạ ⇒ không. Ghi (UPDATE/DELETE) chỉ chủ, và nếu hàng mới có `room_id` thì chủ phải là thành viên.

## 5. "Chưa gắn" — câu phải sửa (D3) · rủi ro cao
| File · hàm | Hiện tại | Sau |
|---|---|---|
| `attachments.repo.ts` `sendableFiles`, `bindAttachments` | `message_id is null` | `+ and room_id is null` (file phòng không vào E12) |
| `attachments.repo.ts` `deleteAttachment`, `supersedeJobOutput`, `bindOutputs` | `message_id is null` | `+ and room_id is null` |
| `attachments.repo.ts` `findOwnedAttachment` | chủ + hội thoại chưa xoá | thay bằng `findReadableAttachment` (§6.4) |
| `sweeper.ts` `sweepUnbound` (claim + DELETE) | `message_id IS NULL` | `message_id IS NULL AND room_id IS NULL` |
| `processes/runs/start-inputs.ts` `ownsUpload` | chủ + chưa xoá | **thêm `and room_id is null`** (S8, B3): RLS D5 lo "đã rời phòng", nhưng file phòng còn của thành viên không được làm input quy trình |

## 6. Luồng
### 6.1 Tin thường / tin thread có file (`MessagesService`)
`send` (trước `#processRoute`): `ids` có ⇒ `roomFilesAllowed` sai ⇒ 400 (D8) → `rooms.read`: `findByClientId` có ⇒ trả 200 (+ refs) · không ⇒ `checkRoomSendable(tx, me, ids)` (404). `sendOnce` (tx user): `lockFor` → dup → thread → `bumpSeq` → `advanceRead` → `insertMessage` → **`bindRoomMessageFiles(tx, me, {roomId, messageId, ids})`** → `roomFileRefs` → `toRoomMessage({...row, attachments})` → fanout/sự kiện. Không file ⇒ không thêm câu nào.

### 6.2 Tin gọi agent (`RoomRunService`, X2b D5)
Thứ tự khoá giữ: `rooms` → (createRunTx: advisory user → conversations → flows → runs → messages) → `room_members` → `room_messages` → **`attachments`** (hàng, UPDATE) → `runs` (UPDATE `attachment_ids`, hàng đã khoá bởi chính tx). `writeTrigger`: INSERT tin gọi → gắn file (404 ⇒ ROLLBACK cả run) → `loadHistory` (rows có `id`) → `roomFileWindow` → `roomRunFileRows` → `pickRoomRunFiles` → `setRunAttachmentIds` (khi ≠ ∅) → trả `files` trong `Committed` → `launch(p, files, …)`. Người tag rời giữa chừng ⇒ X2b-R17 huỷ run (không đổi).

### 6.3 `out/` (D11)
`SseWriter.finish`: `#insertAnswer(…, finished: status==='finished' && !t.roomId)`. `room-post.ts postTx`: sau `postAgentMessage` ⇒ `shouldBindRoomOutputs({status, reason})` ⇒ `bindRoomOutputs(tx, {runId, tenantId, roomId, roomMessageId: answerMessageId})` (scope system; câu như `bindOutputs` H2c: lần claim hiện hành, bản mới nhất mỗi `(job, safe_name)`, ≤ 10, `+ room_id is null`, đặt `room_id`, `room_message_id`, `conversation_id/flow_id = NULL`, `bound_at`, `position`) → refs vào **cả hai** bản tin (công khai + người gọi). `runOutcome` thêm `tenant_id`. Run lỗi/huỷ/`skipped`/`already` ⇒ không gắn ⇒ R27 dọn sau 24 giờ.

### 6.4 Đọc (`AttachmentService.#owned` → `#readable`, scope user)
```sql
select a.id, a.filename, a.mime, a.size, a.created_at, a.purged_at, a.storage_key
from hub.attachments a left join hub.conversations c on c.id = a.conversation_id
where a.id = $id and a.tenant_id = $tenant
  and ((a.room_id is null and a.user_id = $me and c.deleted_at is null)
    or (a.room_id is not null and hub.is_room_member(a.room_id)))
```
Phòng xoá ⇒ mọi `left_at` đặt (rooms.repo D4) ⇒ `is_room_member` false ⇒ 404 ngay (R13). Thêm lại thành viên ⇒ thấy lịch sử.

### 6.5 Sweeper (R13, R14)
`sweepOnce`: (a) `sweepUnbound` (D3) → (b) `sweepDeletedConversations` → **(b2) `sweepDeletedRooms`**: `select * from hub.attach_claim_deleted_rooms(${now}, ${SWEEP_BATCH})` → `tryRemove` từng hàng (hàng giữ, `purged_at` đặt) → (c) mồ côi. Kết quả (b2) **cộng vào `purged`** (giữ hình `SweepResult` — test H2c `toEqual`). Chu kỳ hiện có ≤ 10 phút (H2c) ⇒ "≤ 10 phút" giữ.

## 7. Câu SQL mới (`attachments/room-files.repo.ts`, mọi câu lọc `tenant_id` tường minh)
| Hàm (scope) | Câu (ý) | Index |
|---|---|---|
| `roomSendableFiles(tx, o, ids)` (user) | như `sendableFiles` + `room_id is null and origin = 'upload'` | PK |
| `bindRoomFiles(tx, o, {roomId, messageId, ids})` (user) | `update … set room_id, room_message_id, bound_at = now(), position = array_position(ids, id) - 1 where id = any(ids) and tenant_id and user_id = me and origin='upload' and message_id is null and room_id is null and purged_at is null and created_at > now() - 24h returning id` | PK |
| `roomFileRefs(tx, o, {roomId, messageIds})` (user) | `select room_message_id, id, filename, mime, size, purged_at … where room_message_id = any(ids) and room_id = $room and tenant_id order by room_message_id, position` (≤ 100 tin × 10) | `attachments_room_message_idx` |
| `roomRunFileRows(tx, o, {roomId, triggerId, windowIds})` (user) | `from room_messages m join attachments a on a.room_message_id = m.id and a.room_id = m.room_id where m.room_id = $room and m.tenant_id and a.tenant_id and m.id = any(window) and a.purged_at is null order by (m.id = trigger) desc, m.seq desc, a.position limit 11` | `room_messages_pkey` + `attachments_room_message_idx` |
| `setRunAttachmentIds(tx, o, runId, ids)` (user) | `update hub.runs set attachment_ids = $ids where id and tenant_id and user_id = me` | PK |
| `bindRoomOutputs(tx, p)` (system) | §6.3 | `attachments_job_idx` |

Wrapper không-repo (rooms gọi qua đây — depcruise `no-cross-module-repo`): `attachments/room-files.ts` — `checkRoomSendable`, `bindRoomMessageFiles` (đếm ⇒ 404 `ATTACHMENT_NOT_FOUND{ids}`), `roomFileRefs`, `roomRunFiles` (rows → `pickRoomRunFiles` → `RunFile[]` → `setRunAttachmentIds`), `bindRoomOutputs`. `attachments` **không** import `rooms` (no-circular).

## 8. Luật thuần — chữ ký (QC viết test trước ở `tests/acceptance/X2b2/rules/`)
`apps/hub-api/src/modules/attachments/room-files.rules.ts` (chỉ import type `@ai/contracts/chat` + `run-files.rules`):
```ts
export type RoomFileRow = { id: string; roomMessageId: string; seq: number; position: number;
  safeName: string; mime: AttachMime; size: number; sha256: string };
/** R07 · tin gọi trước; rồi seq giảm; trong tin position tăng; dừng ở file thứ 11 hoặc khi tổng > 100 MiB (RUN_FILES_MAX/_BYTES). */
export function pickRoomRunFiles(rows: readonly RoomFileRow[], o: { triggerMessageId: string }): RoomFileRow[];
/** R07 · id tin cửa sổ: [trigger, ...main, ...thread], bỏ trùng, giữ thứ tự xuất hiện đầu tiên. */
export function roomFileWindow(p: { triggerId: string; main: readonly { id: string }[];
  thread?: readonly { id: string }[] }): string[];
/** R05/R06 · gương của câu §6.4. room ≠ null ⇒ roomMember ∧ ¬roomDeleted; room = null ⇒ owner ∧ ¬conversationDeleted. */
export function canReadAttachment(a: { roomId: string | null; ownerId: string; conversationDeleted: boolean },
  v: { userId: string; roomMember: boolean; roomDeleted: boolean }): boolean;
/** D3 · "chưa gắn" = messageId null ∧ roomId null. */
export function isUnbound(a: { messageId: string | null; roomId: string | null }): boolean;
/** Hàng → AttachmentRef[] (available = purgedAt null); rỗng ⇒ undefined (khoá vắng). */
export function attachmentRefs(rows: readonly { id: string; filename: string; mime: AttachMime; size: number;
  purgedAt: Date | null }[]): AttachmentRef[] | undefined;
```
`apps/hub-api/src/modules/rooms/rooms.rules.ts`:
```ts
/** D8 · false ⇔ processEngine ∧ answerRunId vắng ∧ flowId vắng ∧ classifyBang(content).kind ∈ {process, invalid}. */
export function roomFilesAllowed(p: { content: string; flowId?: string; answerRunId?: string; processEngine: boolean }): boolean;
```
`apps/hub-api/src/modules/rooms/agents/room-agent.rules.ts`:
```ts
/** R11 · gắn out/ ⇔ status = finished ∧ reason = posted. */
export function shouldBindRoomOutputs(p: { status: "running" | "finished" | "failed" | "cancelled";
  reason: "posted" | "skipped" | "already" }): boolean;
```

## 9. File mới / sửa (≤ 400 dòng/file, ≤ 50 dòng/hàm)
| File | Việc | Dòng hiện → ước |
|---|---|---|
| `packages/db/migrations-hub/0023_x2b2_room_attachments.sql` + `meta/_journal.json` (idx 23, `when` 1793059200000) | mới | ~120 |
| `packages/db/src/schema/hub.ts` | +2 cột | +4 |
| `packages/db/src/hub-x2b2.int.test.ts` | int: CHECK/FK/RLS/definer/idempotent (của BE, cạnh 0023) | ~200 |
| `packages/contracts/src/chat/rooms.ts` (+ test cạnh) | §2 | +12 |
| `attachments/room-files.{rules,repo}.ts`, `room-files.ts` (+ test) | mới | ~80 / ~150 / ~110 |
| `attachments/attachments.repo.ts` | §5 + `findReadableAttachment` | 225 → ~250 |
| `attachments/attachments.service.ts` | `#owned` gọi `findReadableAttachment` (thay thân, không thêm dòng) | 388 → ≤ 392 |
| `attachments/sweeper.ts` | D3 + (b2) | 163 → ~185 |
| `rooms/messages/messages.service.ts` | §6.1 + refs ở `page`/dup | 224 → ~265 |
| `rooms/messages/messages.repo.ts` | không đổi (refs qua `room-files.ts`) | — |
| `rooms/rooms.map.ts` | `RoomMessageRow.attachments?` → `toRoomMessage` | 233 → ~240 |
| `rooms/rooms.rules.ts` | `roomFilesAllowed` | 117 → ~130 |
| `rooms/agents/room-context.repo.ts` + `room-agent.rules.ts` (`RoomCtxRow.id`, `shouldBindRoomOutputs`) | | +10 |
| `rooms/agents/room-run.service.ts` | §6.2 (tách `writeFiles` nếu `writeTrigger` > 50 dòng) | 269 → ~300 |
| `rooms/agents/room-post.ts`, `room-post.repo.ts` (`tenant_id`) | §6.3 | 162 → ~180 |
| `runs/create-run.ts` (`attachFiles`: `p.room ⇒ []`) · `runs/sse/sse-writer.ts` (D11) | 1–3 dòng mỗi file | — |
| `attachments/README.md`, `rooms/agents/README.md` | luồng phòng | — |

## 10. Hiệu năng (CONVENTIONS §6; không chặn mốc)
Gửi có file: + 1 SELECT (kiểm trước) + 1 UPDATE (gắn) + 1 SELECT (refs) [+ run: 1 SELECT file-set + 1 UPDATE runs]. Trang tin: +1 SELECT/trang. Policy `is_room_member` gọi theo hàng (≤ 1000 hàng/trang, PK `room_members`). Mốc đo: `POST /rooms/:id/messages` 2 file p95 ≤ 40 ms (H2c PF2); EXPLAIN của `roomFileRefs`/`roomRunFileRows` phải dùng `attachments_room_message_idx` (ghi ở review).

## 11. Security review (riêng, hard stop) — danh mục kiểm
| # | Kiểm | AC |
|---|---|---|
| S1 | File phòng không vào E12 / hội thoại (D3) và không bị sweeper R27 xoá | AC03, AC11, AC13 |
| S2 | Không thành viên / đã rời / `tenant_admin` / tenant khác ⇒ 404 ở `GET` và `/content`; RLS chặn cả khi bỏ lọc app (test SQL trực tiếp scope user) | AC02 |
| S3 | File-set chỉ `room_id = runs.room_id` + cửa sổ; endpoint nội bộ chỉ id trong payload (H2c-R15 không đổi) | AC07, AC08 |
| S4 | FK kép: không gắn được `room_id` khác tenant / `room_message_id` khác phòng (23503) | int DB |
| S5 | Definer `attach_claim_deleted_rooms` từ chối scope ≠ system (42501); `search_path` cố định | int DB |
| S6 | `out/` chỉ gắn khi definer `posted`; không lên phòng khi `skipped` | AC10 |
| S7 | Log không có `filename` (R22) | AC16 |
| S8 | `processes/runs/start-inputs.ts` `ownsUpload` thêm `and room_id is null`: file phòng KHÔNG làm input quy trình (task B3; int I53 ⇒ 400 `VALIDATION_ERROR` path `inputs`) | I53 |
| S3b | Endpoint nội bộ không kiểm phòng xoá — chấp nhận; ca I54: DELETE phòng khi run chạy ⇒ GET nội bộ token job ⇒ 401 | I54 |

## 12. Test khoá cần `qc` thay (Tranh chấp có chủ đích, spec §12)
| Test khoá | Hiện | Thay bằng |
|---|---|---|
| `tests/acceptance/X2b/context.int.test.ts` `X2b-AC11 · attachment_ids vào tin phòng → 400` | 400 + 0 run | X2b2-AC03/AC05 (id sai ⇒ 404; 11 id/trùng ⇒ 400) |
| `tests/acceptance/X2b/rules/contracts-x2b.test.ts` K5 dòng `attachment_ids: [U(11)] ⇒ false` | fail | `true`; 11 id / trùng ⇒ false |
| `X2b-AC11 · run phòng không mang file` | payload không `attachments` khi không file | **giữ** — vẫn xanh (không file ⇒ `files=[]`) |
Không đổi: test H2c A131/A133/A134, idempotent 0007 (tên `attachments_bound_ck`, `attachments_unbound_idx` giữ), X2a đếm 7 policy phòng, snapshot C1.

## 13. Trả lời câu hỏi mở phía backend (spec §9)
| Q | Chốt | Ghi |
|---|---|---|
| Q1 | Giữ: `POST /attachments` chung | Không có lý do tách |
| Q2 | Giữ + chi tiết: D2, D4, CHECK §4.1 | |
| Q4 | Giữ + **siết thêm** policy chủ (D5) | để người upload đã rời cũng 404 đúng R05 |
| Q5 | Giữ; cửa sổ gồm tin agent (D9) | |
| Q6 | Giữ: Không | |
| Q7 | Giữ: Có; cơ chế D11 | |
| Q9, Q10 | Giữ: Không | không có endpoint gỡ/xoá file |
| Q11 | Giữ: tenant (H2c-R16); `out/` tính theo `user_id` = người tag | |
| Q12 | Giữ "không đổi P-a"; cụ thể hoá D8 (`!…` + file ⇒ 400 như hôm nay) | |
| Q13 | Giữ: Có (đường `sendOnce` với `flow_id`, gồm thread quy trình) | |
| Q16 | **Đổi**: D12 | `dify-agent-runner.ts` không dùng file |

Trả lời `plan-frontend.md` §6: C-1 ✓ (thêm `.min(1)` + không trùng như E12 — FE chỉ gửi khi có id, khớp D3 FE); C-2 ✓ (`.min(1).max(10)`, vắng khi rỗng; có ở GET timeline/thread, 201/200, `room.message`; tin agent có thể > 5 khi Orchestrator gọi nhiều job, trần 10); C-3 ✓ (`details.ids` thứ tự gửi); C-4 ✓.

## 14. Rủi ro còn mở
| Rủi ro | Giảm |
|---|---|
| Sót một câu "chưa gắn" ngoài §5 (vd câu mới ở P-b) | reviewer `grep -n "message_id is null"` toàn `apps/hub-api`; test S1 |
| `purged` của sweeper gộp phòng ⇒ test H2c đếm chính xác có thể lệch nếu chạy song song cùng DB | qc cô lập dữ liệu/`sweepOnce` theo tenant thử |
| Policy `is_room_member` theo hàng làm chậm trang tin lớn | đo EXPLAIN (§10); nếu > ngân sách ⇒ TECH-DEBT, không chặn |
| Dify runner bỏ qua file trong phòng (D12) — người dùng có thể kỳ vọng khác | ghi trong câu trả lời Gate; T11 |

## 15. Lệnh xong (BE)
`bun run typecheck && bun test && bun run test:int && bun test tests/acceptance/X2b2 && bun run test:lock:verify` (+ hồi quy `done:h2c`, `done:x2b`, `done:pa` ở R1).
