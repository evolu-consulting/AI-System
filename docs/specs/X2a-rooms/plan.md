# Plan · X2a-rooms — phần Backend (Hub TS)

Spec: [`spec.md`](spec.md) (luật X2a-R01…R24, AC) · [`spec-isolation.md`](spec-isolation.md) (realtime, ma trận cách ly). Mẫu code: `modules/conversations` (scope user + 404), `runs/sse/sse-reader.ts` (XREAD multiplex), `migrations-hub/0001` (RLS), `0003` (SECURITY DEFINER), `0009/0010` (GRANT tối thiểu, idempotent). Phụ lục DB/luồng/khoá: [`plan-db.md`](plan-db.md). Task: [`tasks.md`](tasks.md) B1–B8.

## 1. Quyết định chính (đã ghi spec §10 "Trong lúc làm")
| # | Quyết định | Lý do |
|---|---|---|
| D1 | 400 dùng mã **`VALIDATION_ERROR`** có sẵn (`CHAT_API_ERRORS`), không phải `VALIDATION_FAILED` như spec §2/§3 | Hub chỉ có `VALIDATION_ERROR`; thêm mã 400 thứ hai = đổi hành vi client C1. Code hiện có thắng (Luật 2) |
| D2 | Chủ phòng chỉ lưu ở `room_members.role` (bỏ `rooms.owner_id` gợi ý ở spec §4); `RoomDetail.owner_id` suy ra | Một nguồn sự thật, không lệch giữa 2 bảng |
| D3 | Tạo phòng qua hàm `SECURITY DEFINER hub.create_room` (đọc tenant/user từ GUC); `hub.rooms` **không có policy INSERT** cho `hub_rw` | Giải bài "phòng chưa có thành viên" mà không mở policy rộng (`plan-db` §4.3) |
| D4 | Xoá phòng = `rooms.deleted_at` **và** `left_at = now()` cho mọi thành viên còn lại, cùng transaction ⇒ RLS chỉ cần `is_room_member` (không cần `deleted_at` trong policy) | Tránh bẫy WITH CHECK khi UPDATE `deleted_at`; phòng xoá tự 0 hàng với mọi người |
| D5 | Chưa đọc = `rooms.last_seq − room_members.last_read_seq` (O(1)). Bất biến: gửi tin đẩy mốc đọc người gửi lên `seq` của tin đó trong cùng transaction ⇒ mọi tin của chính mình ≤ mốc ⇒ đúng R17 không cần `count(*)` | Đếm hiệu quả, không cột đếm phải fan-out UPDATE |
| D6 | Vào phòng (tạo, được thêm, thêm lại) ⇒ `last_read_seq = rooms.last_seq` lúc vào | R14 vẫn thấy toàn bộ lịch sử, nhưng không bị "999 tin chưa đọc" |
| D7 | DM chưa có tin (`last_seq = 0`) **không** hiện trong `GET /rooms` của người **không** tạo; tạo DM không phát sự kiện. Tin đầu → `room.message` → client thấy `room_id` lạ thì tải lại `/rooms` | Không làm phiền khi người kia chỉ mở DM rồi thôi |
| D8 | `member_ids`/`user_ids` zod 0–200 / 1–200 (giới hạn mảng), vượt 50 ⇒ **409 `ROOM_FULL`** (không phải 400) | AC-H24/X2a-AC13 "người thứ 51 → `ROOM_FULL`" bất kể gửi bao nhiêu id |
| D9 | Đúng 1 owner: `EXCLUDE … WHERE role='owner' AND left_at IS NULL DEFERRABLE INITIALLY DEFERRED`; chuyển chủ = một câu UPDATE `CASE` | Unique index partial không deferrable ⇒ đổi 2 hàng trong 1 câu có thể vỡ theo thứ tự hàng |
| D10 | `RoomMessage` thêm `client_msg_id` (uuid, client đối chiếu tin lạc quan); trường X2b (`run_id`, `flow_id`, `trigger_message_id`) `optional`, X2a **không** gửi | Chỉ thêm; X2b chỉ việc điền |
| D11 | Stream user: `XADD ustream:<uid> MAXLEN ~ 1000` + `EXPIRE 604800` (7 ngày, cùng pipeline). `stream.reset` khi id sai định dạng / key không còn / id > `last-generated-id` / id < `max-deleted-entry-id` (`XINFO STREAM`, Redis 7) | Q8; Redis 7 cho biết chính xác đã cắt tới đâu |
| D12 | Reader mới `UserStreamReader` theo mẫu `SseReader` (một `XREAD BLOCK 1000`/instance, không `CLIENT UNBLOCK`), dùng lại `xreadPairs` + `compareStreamId`. **Không** sửa `RunStreamReader` (gắn `RunEvent`, ngoài phạm vi) | Sub mới chờ ≤ 1 s, không mất tin (đọc từ id cuối) — trong ngân sách AC-H25 2 s |
| D13 | Tổng chưa đọc cho **người nhận** tính bằng hàm definer `hub.room_fanout(room)` (sender không thấy phòng khác của người nhận qua RLS) | Payload `room.unread.total` đúng spec mà không mở RLS |
| D14 | `AuthUser.exp?` (giây, optional — test cũ không vỡ); stream đóng lúc `exp`; mỗi ping 15 s kiểm `config.accountUsable` (bị khoá → đóng) | X2a-AC12 |
| D15 | Ẩn DM phát `room.unread` cho chính mình (tổng đổi, đồng bộ tab); tạo nhóm phát `room.member_added` (kèm `room`) cho mọi thành viên | Spec không nói; đơn giản nhất cho client |
| D16 | Danh bạ `limit` mặc định 20, tối đa 50, sắp `lower(display_name), id`; không phân trang cursor | Picker; tìm thu hẹp thay vì cuộn |

## 2. Contract `@ai/contracts/chat` — chỉ thêm
File mới `chat/{rooms,directory,me-stream}.ts`, thêm 3 dòng `export *` vào `chat/index.ts`; `chat/errors.ts` thêm khối cuối file. Không đổi export/schema cũ (X2a-AC11). Mọi object `z.strictObject`. Thời gian `IsoDateTime`, id `UuidSchema` (`../common`).

### 2.1 Lỗi (`chat/errors.ts`, khối mới)
```ts
export const CHAT_ROOM_ERRORS = { ROOM_NOT_FOUND: 404, USER_NOT_FOUND: 404, NOT_ROOM_OWNER: 403,
  DM_IMMUTABLE: 409, ROOM_FULL: 409, OWNER_MUST_TRANSFER: 409, GROUP_NOT_HIDEABLE: 409, DM_SELF: 400 } as const;
export type ChatRoomErrorCode = keyof typeof CHAT_ROOM_ERRORS;
export const CHAT_ROOM_ERROR_CODES: ChatRoomErrorCode[];
export const UserNotFoundDetailsSchema = z.strictObject({ user_ids: z.array(UuidSchema).min(1).max(200) });
export const RoomFullDetailsSchema = z.strictObject({ max: z.literal(50), requested: CountSchema }); // tổng sau khi thêm, gồm chủ
```
`apps/hub-api/src/lib/errors.ts`: thêm `ChatRoomErrorCode` vào `HubErrorCode`, `...CHAT_ROOM_ERRORS` vào `HUB_ERRORS`, message EN: "Room not found", "User not found", "Only the room owner can do this", "Direct messages cannot be changed", "Room is full", "Transfer ownership before leaving", "Groups cannot be hidden", "Cannot message yourself". 400 khác: `VALIDATION_ERROR` (D1).

### 2.2 `chat/directory.ts`
| Tên | Định nghĩa |
|---|---|
| `DIRECTORY_LIMIT_DEFAULT` / `_MAX` | 20 / 50 |
| `DirectoryQuerySchema` | `{ q?: string.trim().min(1).max(LIST_Q_MAX), limit?: coerce int 1–50 = 20 }` (query: khoá lạ bỏ qua như C1 `withoutScopeKeys`) |
| `DirectoryUserSchema` | `{ id: Uuid, display_name: string 1–DISPLAY_NAME_MAX, username: string, active: boolean }` — **đúng 4 trường** (R22) |
| `DirectoryResponseSchema` | `{ items: DirectoryUser[] (≤ 50) }` |

### 2.3 `chat/rooms.ts`
| Tên | Định nghĩa |
|---|---|
| Hằng | `ROOM_NAME_MAX = 80` · `ROOM_MEMBERS_MAX = 50` (gồm chủ) · `ROOM_IDS_MAX = 200` (giới hạn mảng, D8) · `ROOM_PREVIEW_MAX = 120` · `ROOM_KINDS = ["dm","group"]` · `ROOM_ROLES = ["owner","member"]` · `ROOM_SENDER_TYPES = ["user","agent"]` · `ROOM_MESSAGES_LIMIT_DEFAULT = 50` |
| `SeqSchema` | `z.number().int().min(0)` (bigint DB, < 2^53) |
| `RoomUserRefSchema` | `{ id, display_name, username }` |
| `RoomLastMessageSchema` | `{ seq: int ≥1, sender_type, sender: {id, display_name}, preview: string 0–120, created_at }` |
| `RoomSummarySchema` | `{ id, kind, name: string 1–80 \| null (dm → null), peer: RoomUserRef \| null (group → null), member_count: int 1–50, my_role: "owner"\|"member"\|null (dm → null), last_message: RoomLastMessage \| null, last_seq: Seq, unread: Count, last_activity_at }` |
| `RoomMemberSchema` | `{ id, display_name, username, role, last_read_seq: Seq, joined_at }` |
| `RoomDetailSchema` | `RoomSummary` + `{ owner_id: Uuid \| null, created_at, members: RoomMember[] (1–50, chỉ thành viên hiện tại) }` |
| `RoomMessageSchema` | `{ id, room_id, seq: int ≥1, sender_type, sender: {id, display_name}, content: string 1–CHAT_CONTENT_MAX, client_msg_id: Uuid \| null, created_at, run_id?: Uuid, flow_id?: Uuid, trigger_message_id?: Uuid }` (X2a không gửi 3 trường cuối) |
| `CreateRoomRequestSchema` | `discriminatedUnion("kind", [ {kind:"dm", user_id: Uuid}, {kind:"group", name: string.trim 1–80, member_ids: Uuid[] 0–200 = []} ])` strict; trùng/chính mình trong `member_ids` bỏ qua |
| `RenameRoomRequestSchema` | `{ name: string.trim 1–80 }` |
| `AddRoomMembersRequestSchema` | `{ user_ids: Uuid[] 1–200 }` |
| `TransferRoomRequestSchema` | `{ user_id: Uuid }` |
| `RoomListQuerySchema` | `{ cursor?: ChatCursor, limit?: coerce 1–200 = 50 }` |
| `RoomListResponseSchema` | `{ items: RoomSummary[], next_cursor: string \| null, unread_total: Count }` |
| `RoomMessageListQuerySchema` | `{ before_seq?: coerce int ≥1, limit?: coerce 1–200 = 50 }` |
| `RoomMessagePageSchema` | `{ items: RoomMessage[] (seq tăng), has_more: boolean }` |
| `SendRoomMessageRequestSchema` | `{ content: string.trim 1–16000, client_msg_id: Uuid }` |
| `MarkRoomReadRequestSchema` / `ResponseSchema` | `{ seq: Seq }` / `{ unread: Count, unread_total: Count }` |

`tenant_id`/`user_id` lạ trong body → 400 (strict), như C1.

### 2.4 `chat/me-stream.ts`
| Tên | Định nghĩa |
|---|---|
| `ME_STREAM_EVENTS` | `room.message, room.unread, room.read, room.member_added, room.member_removed, room.updated, room.deleted, stream.reset` |
| `STREAM_EVENT_ID_RE` | `/^\d{1,20}-\d{1,20}$/` (id Redis Stream; dùng cho `Last-Event-ID`) |
| `USER_STREAM_MAXLEN` / `USER_STREAM_CONN_MAX` | 1000 / 5 |
| Data | `RoomMessageEventData {room_id, message: RoomMessage}` · `RoomUnreadEventData {room_id, unread, total}` · `RoomReadEventData {room_id, user_id, seq}` · `RoomMemberAddedEventData {room_id, user_id, room?: RoomSummary}` · `RoomMemberRemovedEventData {room_id, user_id}` · `RoomUpdatedEventData {room_id, name?, owner_id?}` · `RoomDeletedEventData {room_id}` · `StreamResetEventData {}` |
| `MeStreamEventSchema` | `discriminatedUnion("event", …)` `{event, data}` (mẫu `ChatEventSchema`) + `parseMeStreamEvent(event: string, data: string): MeStreamEvent \| null` (FE driver, server reader); frame SSE: `id: <redis id>\nevent: <event>\ndata: <json>\n\n`; `stream.reset` **không** có `id:`; ping `SSE_PING_FRAME` có sẵn |

## 3. Endpoint × thứ tự kiểm (mọi route Bearer JWT, mọi role)
Chung `/rooms/:id*`: 401 (middleware gốc) → `:id` không uuid → 404 `ROOM_NOT_FOUND` → **không phải thành viên hiện tại → 404** (trước parse body, R03) → DM-check 409 (`DM_IMMUTABLE`/`GROUP_NOT_HIDEABLE`) → owner-check 403 → body/query 400 → luật nghiệp vụ. Route gọi `svc.access(user, id, action)` trước khi parse.

| Endpoint | Service | Status thành công | Lỗi nghiệp vụ |
|---|---|---|---|
| `GET /directory` | `DirectoryService.search` | 200 | 400 |
| `GET /rooms` | `RoomsService.list` | 200 | 400 cursor |
| `POST /rooms` | `RoomsService.create` | dm: 201 mới / 200 cũ · group: 201 | `DM_SELF` · `USER_NOT_FOUND {user_ids}` · `ROOM_FULL` |
| `GET /rooms/:id` | `get` | 200 `RoomDetail` | 404 |
| `PATCH /rooms/:id` | `rename` | 200 | 404 · 409 DM · 403 · 400 |
| `DELETE /rooms/:id` | `remove` | 204 | 404 · 409 DM · 403 |
| `POST /rooms/:id/members` | `MembersService.add` | 200 `RoomDetail` | 404 · 409 DM · 403 · 400 · `USER_NOT_FOUND` · `ROOM_FULL` |
| `DELETE /rooms/:id/members/:user_id` | `removeMember` | 204 | 404 · 409 DM · 403 · `:user_id` = mình → 400 · không phải thành viên hiện tại → 404 `USER_NOT_FOUND` |
| `POST /rooms/:id/leave` | `leave` | 204 | 404 · 409 DM · `OWNER_MUST_TRANSFER` |
| `POST /rooms/:id/transfer` | `transfer` | 200 | 404 · 409 DM · 403 · `user_id` không phải thành viên hiện tại / là mình → 404 `USER_NOT_FOUND` |
| `POST /rooms/:id/hide` | `hide` | 204 (đã ẩn → 204) | 404 · `GROUP_NOT_HIDEABLE` |
| `GET /rooms/:id/messages` | `MessagesService.page` | 200 | 404 · 400 |
| `POST /rooms/:id/messages` | `send` | 201 mới / 200 trùng `client_msg_id` | 404 · 400 |
| `POST /rooms/:id/read` | `markRead` | 200 | 404 · 400 |
| `GET /me/stream` | `MeStreamService.open` | 200 `text/event-stream` | 401 (JSON, trước khi mở stream) |

`DM_SELF`: `POST /rooms {kind:"dm", user_id: chính mình}` (kiểm trước tra user). `USER_NOT_FOUND`: user không tồn tại / khác tenant / không dùng được (R02) — cùng một mã, `details.user_ids` = các id bị loại (chỉ id người gọi đã gửi, không lộ gì thêm).

## 4–6. DB, luồng, thứ tự khoá → [`plan-db.md`](plan-db.md)
§4 migration `0011_x2a_rooms` (bảng, CHECK, index, 5 hàm `SECURITY DEFINER`, RLS, GRANT, danh bạ Q1, seed) · §5 luồng từng việc (thứ tự câu SQL + sự kiện) · §6 thứ tự khoá & đồng thời.

## 7. Realtime `/me/stream`
| Thành phần | File | Nội dung |
|---|---|---|
| Khoá + phát | `lib/user-stream.ts` | `userStreamKey(uid) = "ustream:" + uid`, field `e` = JSON `{event,data}`; `publishUserEvents(redis, events, log)`: một `pipeline()` gồm mỗi người nhận `XADD key MAXLEN ~ 1000 * e <json>` + `EXPIRE key 604800`; dùng chung rooms (ghi) + me-stream (đọc) |
| Reader | `modules/me-stream/user-stream-reader.ts` | D12: `subscribe(uid, fromId, push) → unsubscribe`; nhiều sub cùng key (nhiều tab); `redis.duplicate({connectionName:"hub-api-user-reader"})`; entry sai contract → bỏ + log `warn user-event-invalid` |
| Phiên | `modules/me-stream/me-stream.session.ts` | `ReadableStream`: quyết định nối lại (bảng dưới) → replay `XRANGE key (id +` → `subscribe` từ id cuối đã phát → ping mỗi `pingMs` (deps `startHub`, mặc định 15000, test truyền 500; kèm `accountUsable`) → đóng lúc `exp` (D14) / client huỷ / bị đẩy ra (giới hạn 5/user/instance: map `uid → phiên[]`, phiên thứ 6 đóng phiên cũ nhất) |
| Route | `modules/me-stream/me-stream.routes.ts` | `GET /me/stream`, header SSE như `runs.routes` (`Cache-Control: no-cache`, `X-Accel-Buffering: no`); `Last-Event-ID` chỉ nhận từ header (không query, không token trên URL) |

| `Last-Event-ID` | Điều kiện (`XINFO STREAM`) | Hành vi |
|---|---|---|
| vắng | — | từ id cuối hiện có (`XREVRANGE + - COUNT 1`, rỗng ⇒ `0-0`), không replay |
| sai định dạng | không khớp `STREAM_EVENT_ID_RE` | `stream.reset` rồi như "vắng" |
| hợp lệ | key không tồn tại; hoặc id > `last-generated-id`; hoặc id < `max-deleted-entry-id` | `stream.reset` rồi như "vắng" |
| hợp lệ | còn lại | replay `> id` rồi theo dõi — không mất, không lặp (reader lọc `id ≤ last`) |

Nhiều instance: mọi instance đọc cùng key Redis; người gửi ở instance A XADD, B đang giữ stream của người nhận đọc được (không pub/sub bộ nhớ). Không giữ transaction DB trong stream.

## 8. Luật thuần — chữ ký (QC viết test trước: `tests/acceptance/X2a/rules/`)
`modules/rooms/rooms.rules.ts` (không import I/O):
```ts
export type RoomKind = "dm" | "group"; export type RoomRole = "owner" | "member";
export type RoomAction = "view" | "send" | "read" | "rename" | "delete" | "add" | "remove" | "transfer" | "leave" | "hide";
export function dmKey(a: string, b: string): string;                       // uuid thường, tăng dần, nối ":"
export function roomActionError(kind: RoomKind, myRole: RoomRole | null, action: RoomAction):
  "DM_IMMUTABLE" | "GROUP_NOT_HIDEABLE" | "NOT_ROOM_OWNER" | null;          // thứ tự: DM → hide nhóm → owner
export function planCreateGroup(selfId: string, memberIds: readonly string[]):
  { members: string[]; full: boolean };                                     // bỏ trùng + self; full ⇔ members.length + 1 > 50
export function planAddMembers(currentIds: readonly string[], requested: readonly string[]):
  { toAdd: string[]; full: boolean; requestedTotal: number };              // bỏ trùng + đã là thành viên (R09)
export function leaveOutcome(myRole: RoomRole, activeCount: number): "leave" | "delete" | "OWNER_MUST_TRANSFER";
export function clampReadSeq(requested: number, current: number, lastSeq: number): number | null; // null = không đổi
export function unreadOf(lastSeq: number, lastReadSeq: number): number;    // max(0, hiệu)
export function previewOf(content: string): string;                        // gộp khoảng trắng, ≤ 120 ký tự (code point)
export function joinReadSeq(lastSeq: number): number;                      // D6 = lastSeq
export function encodeRoomCursor(k: { at: Date; id: string }): string; export function decodeRoomCursor(s: string): { at: Date; id: string } | null;
```
`modules/rooms/room-events.ts` (thuần): `messageEvents(roomId, msg, fanout[]) · readEvents(roomId, userId, seq, memberIds, self) · memberAddedEvents(…) · memberRemovedEvents(roomId, removedId, remainingIds) · updatedEvents · deletedEvents → UserEvent[]`.
`modules/me-stream/me-stream.rules.ts`: `parseStreamId(raw: string | null | undefined): string | null` · `resumeDecision(lastId: string | null, info: StreamInfo | null): "tail" | "replay" | "reset"` (`StreamInfo = {lastGenerated: string; maxDeleted: string}`; `info` null = key không tồn tại) · `evictOldest<T>(conns: readonly T[], max: number): T[]`.
`modules/directory/directory.rules.ts`: `likePattern(q: string): string`.

## 9. File mới / sửa (feature-first, ≤ 400 dòng/file, ≤ 50 dòng/hàm, route ≤ 30 dòng, ≤ 10 file/thư mục)
| Đường dẫn | Vai trò |
|---|---|
| `packages/db/migrations-hub/0011_x2a_rooms.sql`, `meta/_journal.json` | `plan-db` §4 |
| `packages/db/src/schema/hub-rooms.ts`, `package.json` (export) | Drizzle 3 bảng (bigint `mode:"number"`) |
| `packages/contracts/src/chat/{rooms,directory,me-stream}.ts`, `errors.ts`, `index.ts` (+ `*.test.ts` cạnh file) | §2 |
| `apps/hub-api/src/lib/errors.ts` | gộp `CHAT_ROOM_ERRORS` |
| `apps/hub-api/src/lib/auth.middleware.ts`, `lib/jwt.ts` | `AuthUser.exp?` (D14) |
| `apps/hub-api/src/lib/user-stream.ts` | §7 khoá + phát |
| `apps/hub-api/src/app.x2a.ts`; `app.ts` | `mountX2a(app, deps)` (cần `db`; `/me/stream` cần thêm `redis` + config); `PROTECTED_PREFIXES` thêm `/directory`, `/rooms`, `/me` |
| `apps/hub-api/src/modules/directory/{directory.routes,directory.service,directory.repo,directory.rules}.ts`, `README.md` | HUB-FR-102 |
| `apps/hub-api/src/modules/rooms/{README.md, rooms.rules.ts, room-events.ts, rooms.map.ts, rooms.routes.ts, room-messages.routes.ts}` | gốc module |
| `apps/hub-api/src/modules/rooms/manage/{rooms.service,members.service,rooms.repo,members.repo}.ts` | tạo/list/get/đổi tên/xoá; thêm/bớt/rời/chuyển/ẩn |
| `apps/hub-api/src/modules/rooms/messages/{messages.service,messages.repo}.ts` | lịch sử, gửi, đọc |
| `apps/hub-api/src/modules/me-stream/{me-stream.routes,me-stream.session,user-stream-reader,me-stream.rules}.ts`, `README.md` | HUB-FR-99 |
| `tools/hub-dev/src/fixture-rooms.ts` | seed dev `plan-db` §4.6 |

Chiều phụ thuộc: routes → service → repo; `messages.service` dùng `access`/khoá phòng qua hàm export của `manage/rooms.repo` (cùng module `rooms`, depcruise cho phép); `me-stream` không import `rooms` (chỉ `lib/user-stream` + contract).

## 10. Hiệu năng (CONVENTIONS §6; đo ở `test:perf`, không chặn mốc — TECH-DEBT #27)
| Truy vấn | Index |
|---|---|
| `is_room_member`/`is_room_owner` (mỗi hàng RLS) | PK `room_members (room_id, user_id)` |
| `GET /rooms`, `unread_total`, `room_fanout.total` | `room_members_user_active_idx` + PK `rooms` |
| tin cuối, lịch sử, `client_msg_id` | `room_messages_seq_uq`, `room_messages_client_uq` |
| DM | `rooms_dm_key_uq` |
| danh bạ | `users_tenant_username_uq` (admin) |
Gửi tin ≤ 7 câu + 1 pipeline Redis (≤ 100 lệnh). `GET /rooms` ≤ 3 câu. p95 < 300 ms với 5 000 tin/phòng, 200 phòng/user. AC-H25 ≤ 2 s (int 2 instance).

## 11. Lệnh xong mỗi task + `done:x2a`
Mỗi task B*: `bun run typecheck && bun test <thư mục task> 2>&1 | tail -40 && bun run test:int 2>&1 | tail -40 && bun run depcruise --all | tail -30 && bun run check:fn && bun run check:size && bun run test:lock:verify`. Task chạm khoá/transaction (B4–B6) chạy lại H1 `concurrency`, A37 `lock-order` và int song song X2a.
`done:x2a` (qc chốt ở `test-plan.md`, I1; mẫu `done-x1.ts`, **bước chặn**): `typecheck` → `bun test` → `test:int` (gồm `packages/db` RLS X2a + H1 isolation + hub-api X2a) → int **2 instance Hub** (AC-H25) → `test:contract:chat` (contract C1 + X2a) → `e2e:chat` → `depcruise --all` → `check:fn` → `check:size` → `test:lock:verify` → `trace --check`.

## 12. Security review (RV, Opus, riêng)
1. 5 hàm definer: `search_path` cố định, tên đủ schema, không SQL động, `REVOKE PUBLIC`, không nhận tenant/user qua tham số (trừ id phòng/peer), `create_room` tự tính `dm_key`, kiểm peer cùng tenant + dùng được.
2. Policy 3 bảng khớp §4.3; không nhánh `system`; `hub_api` không GUC ⇒ 0 hàng; GUC C/D/`tenant_admin` ⇒ 0 hàng phòng G (X2a-AC01); `room_messages` không UPDATE/DELETE.
3. FK kép `(room_id, tenant_id)` + `is_tenant_user` chặn thành viên khác tenant ngay cả khi app sai.
4. Mọi `/rooms/:id*` trả 404 trước 400/403 cho người ngoài (X2a-AC02); không phân biệt "không có" và "không phải thành viên".
5. Fan-out: người nhận tính dưới khoá phòng trong tx; người bị bớt nhận đúng 1 `member_removed`; XADD sau commit; Redis chỉ chứa sự kiện của đúng user; `/me/stream` chỉ đọc key của `claims.sub`.
6. Danh bạ: đúng 4 cột, lọc tenant + dùng được ở SQL, schema strict.
7. Không log nội dung tin (R24); `Last-Event-ID` validate regex trước khi đưa vào Redis.
8. `room_fanout` chỉ trả số đếm cho thành viên cùng phòng, chỉ gọi trong tx của thành viên.
9. RLS cho phép **mọi thành viên** UPDATE `rooms` và `left_at` của hàng `room_members` người khác (`plan-db.md:33,36`); quyền chủ chỉ ở app (rules + thứ tự kiểm). Reviewer đánh giá: chấp nhận (tenant/phòng vẫn cách ly bởi RLS) hay siết bằng hàm definer/policy cột.

## 13. Câu hỏi mở Q1–Q9 (phần BE)
| Q | Trả lời |
|---|---|
| Q1 | **Mặc định — xác nhận bằng code** (`plan-db` §4.5): không migration Admin; TECH-DEBT thu hẹp cột |
| Q2 | Mặc định: bảng riêng `hub.room_messages` |
| Q3 | Mặc định: hoãn; không cột/endpoint đính kèm phòng |
| Q4 | Mặc định: chỉ chừa `run_id`, `flow_id`, `trigger_message_id` (null, không FK); `sender_type='agent'` có trong CHECK nhưng policy INSERT chỉ cho `user` (X2b đổi bằng migration mới) |
| Q5 | FE; BE cấp `members[].last_read_seq` + `room.read` |
| Q6 | Mặc định: ILIKE không bỏ dấu |
| Q7 | qc/FE; BE: int 2 instance chạy 2 `createApp` cùng DB + Redis |
| Q8 | Mặc định `MAXLEN ~ 1000` + EXPIRE 7 ngày (D11) |
| Q9 | FE `/rooms/:id`; API cùng tiền tố `/rooms` |
Không có câu hỏi mới cần người dùng (không thư viện mới, không ADR).

## 14. Rủi ro còn mở
| Rủi ro | Giảm thiểu |
|---|---|
| `max-deleted-entry-id` không phản ánh cắt `MAXLEN ~` trên phiên bản Redis cụ thể | B7 int test cắt thật (XADD > 1000); nếu thiếu trường → dự phòng `id < first-entry` ⇒ reset |
| Chi phí hàm RLS mỗi hàng khi danh sách lớn | Lọc theo `user_id` trước (index); đo `test:perf` |
| `EXCLUDE DEFERRABLE` báo lỗi lúc COMMIT (khó map) | Chỉ xảy ra khi app sai; luồng chuyển chủ là 1 câu; test |
| X2b cần scope `system` ghi tin agent | Migration X2b thêm policy riêng; X2a không mở trước |

## 15. Trả lời `plan-frontend.md` §11
| # | Trả lời |
|---|---|
| 1, 2 | Có, tên đúng §2 (`DirectoryUser`, `RoomSummary`, `RoomDetail`, `RoomMessage`, `CreateRoomRequest`, `RoomListResponse`, `RoomMessagePage`, `MeStreamEvent`, `ChatRoomErrorCode`); helper tên **`parseMeStreamEvent`** (không phải `toMeStreamEvent`) |
| 3 | `RoomSummary` có `last_seq` (đã thêm) và `last_activity_at` (không phải `last_message_at`); tin cuối là `last_message.preview` (≤ 120 ký tự, đã gộp khoảng trắng) — **không** có `content` đầy đủ trong list |
| 4 | `RoomDetail.owner_id` + `members[]` (tên chủ lấy từ members) |
| 5, 6 | Có (§5 `plan-db`; 200 trùng trả đúng tin cũ) |
| 7 | Đúng: chuỗi mờ, chỉ lưu và gửi lại header `Last-Event-ID` |
| 8 | Xác nhận: `member_ids` 0–200, nhóm chỉ mình được (D8) |
| Thêm | 400 là `VALIDATION_ERROR` (D1); DM mới tạo chưa có tin không hiện ở peer (D7) — tin đầu tới `room.message` với `room_id` lạ ⇒ `invalidate ['rooms']` |

## 16. BUILD — quyết định trong lúc làm & tranh chấp test (spec.md đã vượt trần 25 KB ⇒ ghi ở đây)
| Task | Loại | Nội dung |
|---|---|---|
| B3 | Quyết định | `me-stream.rules.ts` (thuần) làm sớm ở B3 vì `rules/me-stream-rules.test.ts` khoá chung file với `likePattern`; `compareStreamId` dùng lại từ `runner.rules` (D12) |
| B3 | Quyết định | `readEvents` 5 tham số (chữ ký §8 do test gọi theo vị trí) ⇒ thêm `check-fn.allow.json` có lý do, không đổi chữ ký |
| B3 | Quyết định | `memberAddedEvents(roomId, added: {userId, room?}[], memberIds)`, `updatedEvents(roomId, memberIds, patch)`, `deletedEvents(roomId, memberIds)`; tạo nhóm (D15) gọi `memberIds=[]` ⇒ mỗi người chỉ nhận bản có `room` |
| B3 | Quyết định | `UserEvent` = `{userIds} & MeStreamEvent` (trừ `stream.reset`) đặt ở `lib/user-stream.ts`; lỗi pipeline (kể cả lỗi từng lệnh) ⇒ một `warn ustream-publish-failed {room_id, n}` |
| B3 | **Tranh chấp test** | `directory.int` Y01 đòi `P.tadmin` (display_name/username `tadmin`) có trong kết quả, nhưng không `q` nào của ca (`lan, hoa, tam, khoa, nghi, an, zed, padmin, cuc`) là chuỗi con của `tadmin` ⇒ theo R22 (tìm theo tên/username) không thể khớp. Code đúng plan-db §4.5. Đề xuất qc: thêm `?q=tadmin` (hoặc `?q=adm`) vào danh sách `q` của Y01. Y02–Y08 xanh |
| B3 | Phân xử qc | Y01: **test sai, code đúng** (R22 tìm theo chuỗi con tên/username; không `q` nào khớp `tadmin`) ⇒ đã thêm `?q=tadmin` vào danh sách `q` của Y01, cập nhật lock; không đổi code |
| B4 | Quyết định | `manage/rooms.service` export `guard` (404→409→403), `lockFor` (`FOR UPDATE OF r` rồi kiểm lại quyền dưới khoá), `loadDetail`, `RoomsService.commit` (outbox: tx trả `{out, events}`, phát sau commit) ⇒ B5/B6 dùng lại; `roomIdParam` (`:id` không uuid ⇒ `ROOM_NOT_FOUND`) ở `rooms.routes` |
| B4 | Quyết định | `X2aDeps` = `{db, redis?, log}` (`app.ts` truyền `deps.redis`, `logger`); vắng `redis` ⇒ không phát, DB vẫn ghi |
| B4 | Quyết định | `POST /rooms` DM đã có ⇒ 200 + bỏ ẩn hàng của chính mình (R07, O34); peer bị khoá giữa lúc tra và `create_room` (P0002) ⇒ cùng `USER_NOT_FOUND` |
| B4 | Quyết định | Tạo nhóm: `room.member_added` kèm `room` cho **mọi** thành viên gồm chủ (D15), `my_role` theo từng người, `unread 0` (D6); `members` sắp chủ trước rồi `joined_at` |
| B4 | Quyết định | Mốc thời gian phòng lưu cắt tới ms (`create_room`, xoá) để cursor `(last_activity_at, id)` (ISO ms) so khớp chính xác ⇒ B6 gửi tin phải đặt `last_activity_at = date_trunc('milliseconds', now())` |
