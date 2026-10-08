# Test plan · X2a-rooms (qc)

WRITE + LOCK — QC1 (2026-10-07): test đã viết, đỏ đúng lý do (§10), khoá `tests/.lock`.
"Đúng" = spec §2 (X2a-R01…R24), §8 (X2a-AC01…16, AC-H23…25), `spec-isolation.md` §1–§2, BA AC-H23…25, usecases CHAT-AC-37…45; contract + thứ tự kiểm + chữ ký luật thuần `plan.md` §2, §3, §7, §8, §15; DB/luồng/khoá `plan-db.md` §4–§6; nhãn e2e `plan-frontend-e2e.md` §1. Spec ≠ plan ⇒ theo plan (D1–D16), ghi §9. Hộp đen.

## 1. Quy ước
| Mục | Quy ước X2a |
|---|---|
| Tên test | `"<mã> · <ID> · mô tả [X2a-Rxx · X2a-ACyy]"`, mã đầu: phòng/thành viên `HUB-FR-96/97/98` · realtime `HUB-FR-99` · chưa đọc/đã đọc `HUB-FR-100` · danh bạ `HUB-FR-102` · cách ly `HUB-BR-22` · UI `CHAT-AC-xx` |
| Loại | **R** luật thuần + schema contract (`bun test`, nạp động như `X1/_modules.ts`) · **K** contract runner (`test:contract:chat`) · **D** int DB thật, SQL trực tiếp role `hub_api`/`hub_rw` + GUC (RLS thật) · **A** int hub-api thật in-process (`startHub` H1, DB + Redis test; 2 instance = 2 `createApp` cùng DB/Redis — plan §13 Q7) · **E** e2e Playwright, hub-api + admin-api (auth) + chat-web thật + DB test (Q7) |
| Vị trí | R `tests/acceptance/X2a/rules/*.test.ts` · D/A `tests/acceptance/X2a/*.int.test.ts` · K `tests/contract/chat/x2a-additive.contract.test.ts` · E `e2e/chat/x2a-*.x2a.ts` + `e2e/chat/playwright.x2a.config.ts` (`testMatch **/*.x2a.ts`, không lẫn `*.chat.ts`) + `_x2a-stack.ts`/`_x2a-support.ts` |
| Mã lỗi | luôn **status + `code`** (route chưa có trả `NOT_FOUND` ⇒ đỏ trước code). 400 = `VALIDATION_ERROR` (D1) |
| "DB không đổi" | `roomState(id)` (owner): hàng `rooms` + `room_members` + `count/max(seq) room_messages` trước ≡ sau |
| "Không sự kiện" | **sentinel**: sau thao tác, A gửi 1 tin vào DM A–X; X nhận nó ⇒ khẳng định 0 sự kiện `room_id` G trước đó. Không `sleep` |
| Frame SSE | mọi frame phải qua `parseMeStreamEvent` (≠ null) |
| Chờ | `waitFor(cond, ms)`; cấm `skip/only/todo`; id cố định; xoá `ustream:*` fixture ở `beforeAll` |

## 2. Hạ tầng, fixture (`tests/acceptance/X2a/_x2a.ts`, id dải `a2a0…`)
`prepareDb()` + `insertFixture()` H1 (DB test riêng qc: `bun run db:test:create qc`) **+**:

| Dữ liệu | Vai |
|---|---|
| H1: `lan`=**A** (chủ G), `hoa`=**B** (thành viên), `tam`=**E** (thành viên thứ 3), `tadmin` (tenant_admin acme), `an`=**D** (beta), `padmin` (platform), `khoa` (locked), `nghi` (inactive), `zed` (tenant zeta không hoạt động) | ma trận §4 |
| X2a: `cuc`=**C** (acme member, không thành viên G); `q01…q55` acme (display_name "QC Người 01…55") | C; ROOM_FULL/tranh chấp 50 |
| Phòng tạo **qua API trong `it`** (memo `ensureRooms()`), không ở `beforeAll` (trước B1 lỗi nằm trong ca) | — |
| Hub: `startHubX2a(k, {redis?, logSink?})` = `startHub` H1 + bắt log (mẫu `H1/log.int.test.ts`); `openMeStream(hub, token, lastId?)` → `{events[], ids[], closed: Promise}` đọc bằng `createSseParser` | A, T |
| Redis: `redis://…/15` như H1; `XINFO STREAM` (Redis 7 — `compose.yaml` `redis:7-alpine`) | T10 |

## 3. Ma trận AC → test
| AC | Given / When / Then (qc) | Loại · file | Ca |
|---|---|---|---|
| AC-H23 | C, `tadmin`, D (+`padmin`) không thành viên: `GET /rooms/G`, `/messages` ⇒ 404 `ROOM_NOT_FOUND`; stream của họ không có sự kiện G | A `isolation`, `stream-isolation` | I03–I06, S01 |
| AC-H24 | DM 2 lần cùng id (201→200); `DM_IMMUTABLE`; B thấy toàn bộ lịch sử; chỉ A thêm/bớt; B rời; thứ 51 ⇒ `ROOM_FULL`; user tenant khác không có trong danh bạ, không thêm được | A `rooms`, `messages`, `directory` | O01–O05, O13, O14, O18, O20–O23, M06, Y01 |
| AC-H25 | B nhận `room.message` + `room.unread` (+1) ≤ 2 s, A/B ở **2 instance**; nối lại `Last-Event-ID` không mất/lặp; đọc ⇒ 0; tin của A không tạo chưa đọc cho A | A `me-stream` | T03–T05, M10, M11 |
| X2a-AC01 | Ma trận ở mức DB: GUC C/D/`tadmin`/B-đã-rời ⇒ 0 hàng 3 bảng của G; `room_messages` không UPDATE/DELETE | D `db-rls` | D01–D18 |
| X2a-AC02 | Người ngoài **ghi** (POST messages/read/members/leave/hide/transfer, PATCH, DELETE) ⇒ 404 trước 400/403, DB không đổi | A `isolation` | I03–I11 |
| X2a-AC03 | Rời/bị bớt ⇒ 404 + đúng 1 `member_removed` rồi hết; thêm lại ⇒ toàn bộ lịch sử | A `stream-isolation`, `isolation` | S02–S04, I07, I08 |
| X2a-AC04 | Chủ rời còn người ⇒ `OWNER_MUST_TRANSFER`; chuyển rồi rời; chủ duy nhất rời = xoá | A `rooms` | O24–O27 |
| X2a-AC05 | Xoá: mọi thành viên `room.deleted`, sau 404; không phải chủ ⇒ 403 | A `rooms`, `stream-isolation` | O28, O29, S05, I09 |
| X2a-AC06 | DM ẩn: mất khỏi `/rooms` người ẩn, người kia còn; tin mới ⇒ hiện lại + chưa đọc | A `rooms` · E | O31–O34, S06 · E09 |
| X2a-AC07 | `client_msg_id` lặp ⇒ 1 tin, 200; `seq` liền, không trùng khi song song | A `messages`, `concurrency` | M04, M05, P03, P04 |
| X2a-AC08 | `Last-Event-ID` sai/quá cũ ⇒ `stream.reset` | A `me-stream` · R | T07–T10 · R21 |
| X2a-AC09 | B đọc ⇒ A nhận `room.read`; mốc không lùi, kẹp về tin cuối | A `messages`, `me-stream` · E | M12–M14, T14 · E03 |
| X2a-AC10 | Danh bạ 4 cột strict, chỉ cùng tenant/dùng được/không phải mình; tìm theo tên | A `directory` · R | Y01–Y08 · R26 |
| X2a-AC11 | Contract chỉ thêm: export cũ giữ tên + hình; contract C1 xanh | R `contracts-x2a` · K | R33, K01, K02 |
| X2a-AC12 | Không token ⇒ 401; token trên URL không được nhận; JWT hết hạn ⇒ đóng, nối lại không mất | A `me-stream` | T01, T02, T11 |
| X2a-AC13 | Tên rỗng/81 ⇒ 400; 50 gồm chủ được, 51 ⇒ `ROOM_FULL` không ghi dở | A `rooms` | O10–O13 |
| X2a-AC14 | `@agent` trong tin phòng là chữ, không tạo run | A `messages` | M08 |
| X2a-AC15 | Sidebar 2 mục, badge realtime, pill, banner, không panel/chip agent, composer không menu `@`/`/` | E | E01, E03, E08, E10 |
| X2a-AC16 | Không log nội dung tin | A `log` | L01, L02 |
| CHAT-AC-37…45 | UC-09/10 | E | E02–E07, E12 (bảng §6) |

## 4. Cách ly — ma trận (rủi ro cao nhất; mỗi ô là một `it` lặp mọi endpoint)
Endpoint `/rooms/:id*` (14): GET, PATCH, DELETE `/rooms/:id` · POST `/members` · DELETE `/members/:uid` · POST `/leave` `/transfer` `/hide` · GET/POST `/messages` · POST `/read`. Ghi gửi **body hợp lệ** và một lượt **body sai** (phải vẫn 404, không 400). Mỗi file có ca chứng thực dương (A/B 200).

| Người gọi \ Đối tượng | Nhóm G (A chủ, B, E) | DM A–B | `GET /rooms` | `/me/stream` | DB (GUC) |
|---|---|---|---|---|---|
| id không uuid / `UNKNOWN` | I01, I02: 404 `ROOM_NOT_FOUND`, thân trả lời **giống hệt** ca C (I10) | — | — | — | — |
| C cùng tenant | I03 404 ×14, 0 ghi (I11) | I12 404 ×14 | I13 không có G, DM | S01 0 sự kiện G/DM | D02 0 hàng |
| `tadmin` acme | I04 | I12 | I13 | S01 | D03 |
| D (`an`, beta) · `padmin` | I05, I06 | I12 | I13 | S01 | D04 (GUC beta), D05 (GUC acme + user `an` giả mạo) |
| B sau khi **rời** | I07 404 ×14 | — | không có G | S03 đúng 1 `member_removed` | D06 |
| B sau khi **bị bớt** | I08 404 ×14; thêm lại ⇒ 200 + lịch sử từ seq 1 | — | — | S02, S04 | D06 |
| A, B, E sau khi G **bị xoá** | I09 404 ×14 (kể cả A) | — | không có G | S05 `room.deleted` rồi hết | D07 |
| A **ẩn** DM | (không áp) | I14: A vẫn là thành viên ⇒ `GET /rooms/:id` 200, `/messages` 200; **không** có trong `/rooms` | O31 | S06 vẫn nhận tin peer | D08 hàng vẫn thấy |
| B gọi C1 của A | I15 `GET /conversations/:id` 404 (AC-H07 giữ) + `hub.messages` không có cột `room_id` (R23) | | | | |
| Thứ tự kiểm (plan §3) | I10: người ngoài + body sai ⇒ 404 (không 400); người ngoài gọi việc chủ ⇒ 404 (không 403); thành viên thường gọi việc chủ ⇒ 403 `NOT_ROOM_OWNER`; thành viên DM gọi đổi tên ⇒ 409 trước 403 | | | | |

**DB thật** (`db-rls.int.test.ts`, `HUB_API_URL` như H1 A6; mỗi ca chạy `hub_api` và `SET LOCAL ROLE hub_rw`; GUC `set_config(…, true)`):
| ID | Kỳ vọng |
|---|---|
| D01 | Không GUC / `scope='system'` ⇒ 0 hàng ở `rooms`, `room_members`, `room_messages` (không nhánh system) |
| D02–D07 | Như ma trận: 0 hàng cả 3 bảng của G/DM; **chứng thực**: GUC A ⇒ thấy G, mọi hàng thành viên (gồm hàng đã rời), mọi tin |
| D08 | GUC A khi DM ẩn ⇒ vẫn thấy DM (ẩn là của app, không phải RLS) |
| D09 | Thành viên `UPDATE`/`DELETE`/`TRUNCATE room_messages` ⇒ `42501`; `DELETE rooms`/`room_members` ⇒ `42501` |
| D10 | `INSERT hub.rooms` trực tiếp (kể cả GUC hợp lệ) ⇒ lỗi (không policy/GRANT INSERT, D3) |
| D11 | `hub.create_room`: thiếu `scope=user` ⇒ `42501`; dm peer = mình ⇒ `22023`; peer beta / `khoa` / `nghi` / không tồn tại ⇒ `P0002`; gọi lại đảo vai (GUC B, peer A) ⇒ cùng `room_id`, `created=false`; phòng tạo ra có `tenant_id` = GUC (owner đọc); hàm **không có tham số tenant** (kiểm `pg_proc.proargnames`) |
| D12 | `create_room` với GUC `tenant=beta` + `user=lan` (user không thuộc tenant) ⇒ bị từ chối (`42501`) — xem G5 §9 |
| D13 | FK kép: owner chèn thành viên/tin `tenant_id` ≠ phòng ⇒ `23503`; chủ (GUC A) chèn `an` ⇒ RLS từ chối |
| D14 | Thành viên thường chèn `room_members` ⇒ RLS từ chối; tự `UPDATE role='owner'` ⇒ WITH CHECK từ chối |
| D15 | `INSERT room_messages` với `sender_id` ≠ GUC user, hoặc `sender_type='agent'` ⇒ RLS từ chối; GUC C chèn vào G ⇒ từ chối |
| D16 | Ràng buộc: 2 owner đang hoạt động ⇒ lỗi lúc COMMIT (`23P01`); dm có `name` / nhóm tên 81 / content 16001 / `seq` 0 ⇒ `23514`; `(room_id, seq)` trùng ⇒ `23505` |
| D17 | `room_fanout(G)` với GUC C ⇒ 0 hàng; `is_room_member` với scope system ⇒ false; `admin_rw`/`agent_runtime` `SELECT` 3 bảng ⇒ `42501`; mọi hàm definer có `search_path` cố định + không `EXECUTE` cho PUBLIC (`pg_proc.proconfig`, `has_function_privilege`) |
| D18 | Chạy lại `0011_x2a_rooms.sql` lần 2 không lỗi (idempotent); H1 `isolation`/`db` A48 vẫn xanh |

## 5. Luật → ca (mỗi luật ≥ 1 ca)
| Luật | Ca |
|---|---|
| R01 cùng tenant | D11, D12, D13, O04, O14, Y07 |
| R02 dùng được ⇒ khác ⇒ `USER_NOT_FOUND` | O04, O14, O19, Y01 |
| R03 404 mọi endpoint, kể cả admin | I01–I11 |
| R04 403 `NOT_ROOM_OWNER` | O16, O22, O29, I10 · R04r |
| R05 DM 2 thành viên, `dm_key`, 200/201, `DM_SELF` | O01–O03, P01 · R01r |
| R06 `DM_IMMUTABLE` ×6 | O05 · R02r, R06r |
| R07 DM ẩn/hiện lại | O31–O34, S06, E09 |
| R08 tên 1–80, ≤ 50 gồm chủ, `ROOM_FULL` không ghi dở | O10–O13, O20, P02 · R07r, R08r |
| R09 chỉ chủ; thêm trùng idempotent | O15–O18, O21 · R08r |
| R10 rời / chủ phải chuyển / chủ duy nhất = xoá | O23–O27 · R09r |
| R11 chuyển chủ, đúng 1 owner | O25, O26, D16, P06 |
| R12 xoá mềm + `room.deleted` | O28, S05, I09 |
| R13 bớt/rời mất toàn bộ, thêm lại thấy hết | I07, I08, S02–S04 |
| R14 thành viên mới thấy toàn bộ lịch sử | M06, S04 |
| R15 content 1…16000, `seq` DB, `client_msg_id` | M01–M05, P03, P04 |
| R16 `@xxx` là chữ | M08 |
| R17 chưa đọc, tổng không gồm DM ẩn | M09–M11, O33 · R11r |
| R18 mốc chỉ tăng, kẹp, gửi = đã đọc | M10, M12, M13 · R10r |
| R19 `room.read` | M14, T14 |
| R20 sự kiện cho thành viên lúc xảy ra | S01–S05, T03, P07 · R15r–R19r |
| R21 XADD sau commit, Redis lỗi không hỏng DB | T16, P05 |
| R22 danh bạ 4 cột | Y01–Y06, R26 |
| R23 C1 giữ nguyên | I15, K01, E13 |
| R24 không log nội dung | L01, L02 |

### 5.1 R — luật thuần + schema (`rules/rooms-rules`, `room-events`, `me-stream-rules`, `contracts-x2a`)
| ID | Hàm (plan §8, §2) | Dữ liệu → kỳ vọng |
|---|---|---|
| R01r | `dmKey` | (b,a) = (a,b) = `min:max` chữ thường |
| R02r–R06r | `roomActionError` (bảng 2 kind × {owner, member, null} × 10 action) | DM: view/send/read/hide ⇒ null, còn lại `DM_IMMUTABLE`; nhóm: hide ⇒ `GROUP_NOT_HIDEABLE`; member × rename/delete/add/remove/transfer ⇒ `NOT_ROOM_OWNER`; thứ tự DM → hide → owner |
| R07r | `planCreateGroup` | bỏ trùng + self; 49 người khác ⇒ `full=false`, 50 ⇒ `true` |
| R08r | `planAddMembers` | bỏ đã là thành viên; `requestedTotal`; biên 50/51 |
| R09r | `leaveOutcome` | member ⇒ leave; owner+1 ⇒ delete; owner+n>1 ⇒ `OWNER_MUST_TRANSFER` |
| R10r | `clampReadSeq` | thấp hơn/bằng ⇒ null; > lastSeq ⇒ lastSeq |
| R11r | `unreadOf`, `joinReadSeq` | max(0, hiệu); D6 = lastSeq |
| R12r | `previewOf` | gộp khoảng trắng; 120 code point (emoji không vỡ) |
| R13r | `encode/decodeRoomCursor` | khứ hồi; rác ⇒ null |
| R15r–R19r | `room-events.ts` (6 hàm) | `room.message` gồm người gửi; `room.read` trừ mình; bị bớt có trong `member_removed`; người mới nhận `room` |
| R20 | `parseStreamId` | `1-0` hợp lệ; `abc`, `1-`, 21 chữ số, null ⇒ null |
| R21 | `resumeDecision` | null ⇒ tail; info null ⇒ reset; > lastGenerated ⇒ reset; < maxDeleted ⇒ reset; = maxDeleted / giữa ⇒ replay |
| R22 | `evictOldest` | 6 kết nối, max 5 ⇒ bỏ cũ nhất |
| R23 | `likePattern` | thoát `\ % _` |
| R24 | `CHAT_ROOM_ERRORS` | đúng 8 mã + HTTP (plan §2.1); `CHAT_ROOM_ERROR_CODES` đủ |
| R25 | khối lỗi | không trùng khoá với `CHAT_API_ERRORS` |
| R26 | `DirectoryUserSchema` | đúng 4 khoá; thêm `email`/`role`/`tenant_id` ⇒ fail (strict) |
| R27 | `RoomSummarySchema` | có `last_activity_at`, `last_seq`, `last_message.preview` (≤ 120); `last_message.content` ⇒ fail; dm `name` null, group `peer` null |
| R28 | `RoomMessageSchema` | `client_msg_id` nullable; `run_id/flow_id/trigger_message_id` optional; `sender_type` ∈ user/agent |
| R29 | `CreateRoomRequestSchema` | dm/group; tên trim 1–80; `member_ids` ≤ 200, mặc định []; `tenant_id` thừa ⇒ fail |
| R30 | `SendRoomMessageRequestSchema`, `MarkRoomRead*`, `AddRoomMembers` (1–200) | biên |
| R31 | `MeStreamEventSchema` + **`parseMeStreamEvent`** | 8 sự kiện `ME_STREAM_EVENTS` parse; JSON hỏng / event lạ / khoá thừa ⇒ null |
| R32 | hằng | `STREAM_EVENT_ID_RE`, `USER_STREAM_MAXLEN=1000`, `USER_STREAM_CONN_MAX=5`, `ROOM_MEMBERS_MAX=50`, `ROOM_NAME_MAX=80`, `ROOM_PREVIEW_MAX=120`, `DIRECTORY_LIMIT_DEFAULT/MAX=20/50` |
| R33 | X2a-AC11 snapshot | mọi export trước X2a của `@ai/contracts/chat` (tên + `JSON.stringify(zodToShape)`) ≡ `rules/__fixtures__/chat-exports-c1.json` (tạo ở QC1 từ commit trước B2) |

### 5.2 A — phòng, tin, danh bạ (`rooms.int`, `messages.int`, `directory.int`, `log.int`, `seed.int`)
| ID | Kỳ vọng |
|---|---|
| O01–O03 | A mở DM B ⇒ 201; lần 2 ⇒ 200 cùng id; B mở DM A ⇒ 200 cùng id; `DM_SELF` 400 |
| O04 | DM với `an`/`khoa`/`nghi`/`UNKNOWN` ⇒ 404 `USER_NOT_FOUND` `details.user_ids=[id]`, 0 phòng |
| O05 | DM: PATCH/DELETE/add/remove/leave/transfer ⇒ 409 `DM_IMMUTABLE`, DB không đổi |
| O06 | D7: DM chưa có tin không có trong `/rooms` của B, có của A; tin đầu ⇒ B thấy |
| O10–O13 | tên "" / "   " / 81 ⇒ 400; 80 + trim ⇒ 201; 49 người khác ⇒ 201 `member_count=50`, `my_role=owner`; 50 người khác ⇒ 409 `ROOM_FULL {max:50, requested:51}`, 0 phòng, 0 thành viên |
| O14 | `member_ids` có `an`/`khoa` ⇒ 404 `USER_NOT_FOUND`, không ghi phần nào; trùng/self ⇒ bỏ qua |
| O15–O19 | đổi tên chủ ⇒ 200 + `room.updated`; thêm ⇒ 200 `RoomDetail`; thêm người đã có ⇒ 200 không đổi; thêm user tenant khác ⇒ `USER_NOT_FOUND`; body `tenant_id` thừa ⇒ 400 |
| O16, O22 | B (thành viên) đổi tên/thêm/bớt/xoá/chuyển ⇒ 403 `NOT_ROOM_OWNER` |
| O20 | nhóm 50 + thêm 1 ⇒ `ROOM_FULL`, 0 ghi |
| O21 | bớt B ⇒ 204; bớt chính mình ⇒ 400; bớt người ngoài ⇒ 404 `USER_NOT_FOUND` |
| O23 | B rời ⇒ 204; G mất khỏi `/rooms` của B |
| O24–O27 | chủ rời còn người ⇒ 409 `OWNER_MUST_TRANSFER`; chuyển sang C (không thành viên)/mình ⇒ 404 `USER_NOT_FOUND`; chuyển sang B ⇒ 200 `owner_id=B`, A `member`; A rời ⇒ 204; chủ duy nhất rời ⇒ phòng xoá (404, `deleted_at` có) |
| O28, O29 | chủ xoá ⇒ 204 + `room.deleted` cho mọi thành viên; B xoá ⇒ 403 |
| O30 | `GET /rooms`: sắp `last_activity_at` giảm; `limit=1` + `next_cursor` đủ trang, không lặp; DM có `peer`, `name` null; `member_count`; `unread_total` |
| O31–O34 | A ẩn DM ⇒ 204 (lần 2 ⇒ 204), mất khỏi `/rooms` A, B vẫn thấy; ẩn nhóm ⇒ 409 `GROUP_NOT_HIDEABLE`; B gửi tin ⇒ DM hiện lại ở A + `unread=1`, tổng tính lại; A mở lại DM qua `POST /rooms` ⇒ hết ẩn |
| M01–M03 | gửi ⇒ 201 `RoomMessage` `seq` 1,2,3; lịch sử tăng dần; `before_seq` + `has_more`; `limit` mặc định 50 (seed 55 tin) |
| M02b | content ""/"  "/16001 ⇒ 400; 16000 ⇒ 201; content được trim |
| M04, M05 | cùng `client_msg_id` lần 2 ⇒ 200, cùng `id`, 1 hàng, **không** sự kiện mới; khác người gửi cùng `client_msg_id` ⇒ 2 tin |
| M06 | người thêm sau 10 tin ⇒ `GET /messages` từ seq 1 (R14); `unread=0` lúc vào (D6) |
| M08 | tin "Nhờ @assistant tóm tắt" (tag giữa câu, sửa 2026-10-08 sau X2b-R02) ⇒ 201, content nguyên văn, `hub.runs` không tăng |
| M09–M11 | A gửi 3 ⇒ B `unread=3`, A `unread=0`; `unread_total` = tổng phòng thấy, không gồm DM ẩn |
| M12, M13 | `read {seq:2}` sau `{seq:3}` ⇒ không lùi; `{seq:999}` ⇒ `last_read_seq = last_seq`; trả `{unread, unread_total}` |
| M14 | B đọc ⇒ A, E nhận `room.read {room_id, user_id:B, seq}`; B nhận `room.unread`, không nhận `room.read` của mình |
| Y01 | `lan` thấy acme dùng được trừ mình; không `khoa`, `nghi`, `an`, `zed`, user tenant khác |
| Y02 | mỗi item đúng `{id, display_name, username, active}`; thân trả lời không chứa email/role của fixture |
| Y03–Y06 | `q` không phân biệt hoa thường theo tên/username; `q="%"`/`"_"` không khớp tất cả; `limit` mặc định 20, 50 ok, 51 ⇒ 400; `q` > `LIST_Q_MAX` ⇒ 400; sắp `lower(display_name), id` |
| Y07, Y08 | `an` chỉ thấy beta; `padmin` không thấy acme; không token ⇒ 401 |
| L01, L02 | tin có dấu `QC-X2A-NOLOG-7f3a` ⇒ log không chứa (cả nhánh Redis lỗi `ustream-publish-failed`); có `room_id` |
| Z01 | seed dev `fixture-rooms` chạy 2 lần ⇒ cùng số hàng, `last_seq` = max `seq` (B8) |

### 5.3 A — tranh chấp (`concurrency.int.test.ts`; đếm deadlock bằng `pgDeadlocks` H1 trước/sau)
| ID | Kịch bản | Kỳ vọng |
|---|---|---|
| P01 | 10 vòng: A→B và B→A mở DM **cùng lúc** (`Promise.all`) | mỗi vòng cùng `id`, status {201, 200}; DB đúng 1 phòng/cặp |
| P02 | phòng chỉ có chủ; **51** `POST /members` song song, mỗi lệnh 1 người (q01…q51) | đúng 49 × 200 + 2 × 409 `ROOM_FULL`; `member_count=50`; thêm 2 lệnh 2 người ở phòng 48 ⇒ 1 thành công, 1 `ROOM_FULL` |
| P03 | 30 tin song song từ A, B, E | `seq` = {1…30} liền, không trùng; `last_seq=30`; không 5xx |
| P04 | 5 lệnh cùng `client_msg_id` song song | 1 hàng; 1 × 201 + 4 × 200 cùng `id` |
| P05 | 60 thao tác xen kẽ: gửi (A, B) + `read` (B, E) + ẩn/hiện DM | mọi trả lời 2xx; deadlock +0; không 40P01/500 |
| P06 | chuyển chủ A→B song song B rời + E rời | không 5xx; đúng 1 owner đang hoạt động (owner đọc) |
| P07 | bớt B song song B gửi tin | hoặc 201 (tin có `seq` trước khi bớt, B nhận `room.message` rồi `member_removed`) hoặc 404; không có tin nào của B sau `left_at` |

### 5.4 A — realtime (`me-stream.int`, `stream-isolation.int`)
| ID | Kỳ vọng |
|---|---|
| T01 | `/me/stream` không token / token hết hạn / chữ ký khác ⇒ 401 JSON (trước khi mở stream) |
| T02 | `?token=<jwt hợp lệ>` không header ⇒ 401 (không nhận token trên URL); `Last-Event-ID` qua query bị bỏ qua |
| T03 | G {A,B,E}: A gửi ⇒ A, B, E nhận `room.message` (cùng `message.id`); B, E `room.unread {unread:1, total}` đúng; A `unread=0` |
| T04 | **2 instance**: B nối hub1, A gửi qua hub2 ⇒ B nhận ≤ 2 s (đo, AC-H25) |
| T05 | B ngắt; A gửi 3 tin; B nối **hub2** với `Last-Event-ID` cuối ⇒ đúng 3 `room.message` theo `seq`, không lặp id, không thiếu |
| T06 | không `Last-Event-ID` ⇒ không phát lại sự kiện cũ |
| T07 | `Last-Event-ID: abc` ⇒ frame đầu `stream.reset` (không có `id:`), sau đó vẫn nhận sự kiện mới |
| T08 | id > `last-generated-id` ⇒ `stream.reset` |
| T09 | id hợp lệ nhưng key không tồn tại (user chưa có sự kiện) ⇒ `stream.reset` |
| T10 | **cắt thật**: > 1 100 sự kiện cho B (XADD trực tiếp định dạng plan §7 + 3 tin qua API); tiền đề `XINFO` `max-deleted-entry-id` ≥ id cũ (thiếu trường ⇒ vẫn đòi reset, plan §14); id cũ ⇒ `stream.reset`; id sau điểm cắt ⇒ replay |
| T11 | JWT `exp` 3 s ⇒ server đóng stream ≤ exp + 2 s; A gửi 2 tin lúc đứt; nối lại token mới + `Last-Event-ID` ⇒ nhận đủ 2, không lặp |
| T12 | B bị khoá khi đang nối (`pingMs: 500`) ⇒ stream đóng ≤ 2 s sau khi cache thấy khoá; nối lại ⇒ 401/403 (`accountUsable`) |
| T13 | 6 kết nối B cùng instance ⇒ kết nối cũ nhất bị đóng, 5 cái còn lại vẫn nhận tin |
| T14 | B có 2 tab; đọc ở tab 1 ⇒ cả 2 tab nhận `room.unread {unread:0}`; A nhận `room.read` |
| T15 | stream có `: ping` (gộp T12, không chờ riêng); header `text/event-stream`, `Cache-Control: no-cache` |
| T16 | hub3 có Redis bị ngắt sau khởi động: `POST /messages` ⇒ 201, DB có tin, log `warn ustream-publish-failed` (không nội dung); `GET /rooms` của B ⇒ `unread` đúng từ DB |
| S01 | C, `tadmin`, `an`, `padmin` nối stream; A gửi/đổi tên/thêm/bớt/đọc/xoá trong G và gửi DM A–B ⇒ sentinel tới, **0** sự kiện G/DM |
| S02 | A bớt B ⇒ B nhận **đúng 1** `room.member_removed {user_id:B}`; A gửi tiếp + sentinel ⇒ B không nhận thêm gì của G |
| S03 | B tự rời ⇒ như S02 |
| S04 | thêm lại B ⇒ B nhận `room.member_added` kèm `room` (RoomSummary); `GET /messages` từ seq 1 |
| S05 | xoá G ⇒ A, B, E mỗi người đúng 1 `room.deleted`; sau đó không sự kiện G; mọi endpoint 404 |
| S06 | A ẩn DM; B gửi ⇒ A vẫn nhận `room.message` + `room.unread` |
| S07 | C nối với `Last-Event-ID` = id thuộc stream của B ⇒ không nhận sự kiện nào của B (chỉ reset/tail khoá của C) |

## 6. E2E (`e2e/chat/x2a-*.x2a.ts`, 2 context A=`lan`, B=`hoa`; seed DB riêng; `page.route` chỉ cho ca lỗi)
Locator nguyên văn `plan-frontend-e2e.md` §1.
| ID | Luồng | AC |
|---|---|---|
| E01 | `region "Tin nhắn & Nhóm"` + `region "Hỏi AI"`; không panel/chip agent; gõ `@`, `/` trong `textbox "Tin nhắn cho nhóm"` ⇒ không `listbox`; không `button "Đính kèm"` | AC15 |
| E02 | A tìm "Hoa" ở `searchbox "Tìm hội thoại, người, nhóm"` ⇒ `button "Nhắn tin với …"` ⇒ `/rooms/:id`; lần 2 cùng id; DM có `button "Ẩn hội thoại"`, không đổi tên/thêm/xoá/rời | CHAT-AC-37, 38 |
| E03 | A gửi, B (context khác) thấy `article` ≤ 2 s + `unread-badge`=1, `unread-total`; B mở ⇒ 0; A thấy `status "Đã xem"` | CHAT-AC-39, AC09 |
| E04 | `button "Nhóm mới"` ⇒ `dialog "Tạo nhóm"`, "Tạo nhóm" `disabled` khi tên rỗng; tên + 2 người ⇒ vào phòng, "chủ nhóm"; seed nhóm 49 + thêm 2 ⇒ "Nhóm đã đủ 50 người" | CHAT-AC-41 |
| E05 | chủ thêm/bớt/đổi tên/xoá; B không thấy `button "Thêm người"`, không `menuitem "Đổi tên nhóm"`/`"Xoá nhóm"`; người mới thêm thấy tin đầu | CHAT-AC-42, 44 |
| E06 | B `menuitem "Rời nhóm"` ⇒ `alertdialog "Rời nhóm?"` ⇒ phòng mất khỏi sidebar; chủ rời ⇒ `alertdialog "Chuyển quyền chủ nhóm trước khi rời"`; chuyển ⇒ rời được | CHAT-AC-43 |
| E07 | gõ `/rooms/<uuid lạ>` và phòng của người khác ⇒ `heading "Không tìm thấy cuộc trò chuyện"` (giống nhau) | CHAT-AC-45 |
| E08 | chặn `/me/stream` ⇒ `status "Đang kết nối lại…"`; bỏ chặn ⇒ banner ẩn; tin gửi lúc đứt hiện đúng 1 lần (`data-seq` không lặp) | CHAT-AC-40 |
| E09 | A ẩn DM ⇒ mất khỏi sidebar; B gửi ⇒ DM hiện lại + badge | AC06 |
| E10 | cuộn lên + tin đến ⇒ `button "1 tin mới"`; bấm ⇒ xuống đáy | AC15 |
| E11 | 390×844: Sheet danh sách, phòng toàn màn, không chip | Mobile |
| E12 | user beta (`an`) không xuất hiện khi A tìm; xoá nhóm ⇒ B (đang mở) về `/c/new` + toast | CHAT-AC-37, AC05 |
| E13 | Hồi quy: `bun run e2e:chat` (C1 + X1, mock Hub) xanh nguyên — xem G1 | R23 |

## 7. "Đỏ đúng lý do" mong đợi khi khoá (QC1, code hiện tại trước B1)
| Nhóm | Đỏ đúng | Xanh trước code (chấp nhận, khoá hồi quy) |
|---|---|---|
| R rules | `Cannot find module …/rooms.rules`, `room-events`, `me-stream.rules`, `directory.rules` (nạp động) | — |
| R contracts | export X2a `undefined` (nạp động `@ai/contracts/chat`) ⇒ `expect` fail | R33 snapshot, R25 |
| D | `relation "hub.rooms" does not exist` / `function hub.create_room does not exist` **trong `it`** (bảng chưa có; `beforeAll` chỉ seed H1 — không lỗi dựng) | D18 phần H1 |
| A | route chưa mount ⇒ 404 `NOT_FOUND` ≠ `ROOM_NOT_FOUND`/200/201; `/directory`, `/me/stream` chưa trong `PROTECTED_PREFIXES` ⇒ 404 ≠ 401; `ensureRooms()` fail ở `expect(201)` | I15 (AC-H07 + không cột `room_id`) |
| K | K01 C1 xanh | K01, K02 |
| E | `region "Tin nhắn & Nhóm"` không thấy (timeout `expect`); stack lên được (hub/admin/web đã có) | E13 |
Tiêu chí: **0 ca đỏ do dựng dữ liệu**; số thật ghi §10.

## 8. Lệnh · `done:x2a` (I1, mẫu `done-x1.ts`)
Script do I1 thêm: `"e2e:chat:x2a": "bunx playwright test -c e2e/chat/playwright.x2a.config.ts"`, `"done:x2a": "bun --env-file=.env.local tools/scripts/src/done-x2a.ts"`. Chạy tay:
```
bun test tests/acceptance/X2a/rules 2>&1 | tail -40
bun --env-file=.env.local --config=bunfig.int.toml test --timeout 40000 tests/acceptance/X2a/ 2>&1 | tail -40
bunx playwright test -c e2e/chat/playwright.x2a.config.ts --reporter=line 2>&1 | tail -40
```
`done-x2a.ts` (dừng ở bước đỏ đầu): typecheck → `bun test` → `test:int` (gồm X2a D/A + H1 `isolation`, `db`, `concurrency` + A37 `lock-order`) → `test:contract:chat` (C1 + K02) → `e2e:chat` (C1, E13) → `e2e:chat:x2a` → `depcruise --all` → `check:fn` → `check:size` → `test:lock:verify` → `trace --check`.

**Thực tế QC1: 159 ca** (R 33 · D 18 · A 93 · K 3 · E 12) + C1 giữ xanh; số theo file ở §10.

## 9. Lệch tài liệu / chỗ hở (mặc định qc dùng) · Cần bổ sung
| # | Lệch / hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1–G8, G10 | **Đã đóng** ở readiness R2/R3 + spec §10 (stub mock B3; `parseMeStreamEvent`; `last_activity_at`/`preview`/`owner_id`; `VALIDATION_ERROR`; `create_room` kiểm `is_tenant_user` (D12); DM ẩn 200 (I14); `pingMs` (T12); hành vi plan D2/D4/D8; khoá chỉ `tests/acceptance/X2a/**` + `e2e/chat/x2a-*`) | — | — |
| G13 | Z01: chữ ký seed chưa có ở plan | seam `tools/hub-dev/src/fixture-rooms.ts` export `ensureFixtureRooms(ownerUrl)` | backend-lead B8 |
| G14 | `likePattern` trả mẫu đã bọc `%…%` (plan-db §4.5 `$p = %q%`) | R23 | backend-lead B3 |
| G15 | `room-events`: `fanout[]` = hàng `room_fanout` `{user_id, unread, total}`; `readEvents(…, self)` `self = {unread, total}`; 3 hàm còn lại chưa có chữ ký ⇒ chỉ phủ ở int (S04, S05, O15) | R15r–R19r | backend-lead B3 |
| G16 | e2e dùng fixture M1 (`e2e/support/prepare-db`): B = `thu` "Thu Ha", người tenant khác = `khang` (globex); + 48 user `qe01…` (nhóm 49); DB `ai_system_test`, Redis 14, cổng 3031/4050/3130 | E01–E12 | — |
| G12 | T10 ghi thẳng Redis theo định dạng plan §7 (field `e`) để tạo > 1 100 sự kiện nhanh | đổi định dạng ⇒ sửa fixture T10 | backend-lead giữ định dạng |

## 10. Đỏ đúng lý do · nhật ký
QC1 2026-10-07, DB qc riêng `ai_system_x2a_qc_test` (`HUB_TEST_DATABASE_URL`), code trước B1. **0 ca đỏ do dựng dữ liệu.**
| Nhóm · file | Tổng | Đỏ đúng lý do | Xanh (khoá hồi quy) |
|---|---|---|---|
| R `rules/*` (4 file) | 33 | 31: `Cannot find module` rules/events/me-stream/directory; export X2a `undefined` | R25, R33 |
| D `db-rls` | 18 | 18: `relation "hub.rooms" does not exist` / `create_room` không có (42883) / thiếu `0011…sql` — trong `it` | — |
| A `isolation, rooms, members, messages, directory, log, seed, concurrency, me-stream, stream-isolation` | 93 | 92: 404 `NOT_FOUND` (route chưa mount, ≠ 201/200/401/`ROOM_NOT_FOUND`); seed: `Cannot find module fixture-rooms` | I15 |
| K `x2a-additive.contract` | 3 | 3: mock chưa có `/rooms`, `/directory`, `/me/stream` (B3) | C1 65/65 xanh |
| E `x2a-*.x2a.ts` | 12 | 12: Hub 404 khi dựng phòng trong ca (10); nhãn UI chưa có — searchbox/`Nhóm mới` (2). Stack thật lên được, đăng nhập 200 | E13: `e2e:chat` 71/71 |
Hồi quy: `bun test` (ngoài X2a) xanh; H1 `isolation`+`db` 15/15; C1 `contrast` 5/5 (bảng CR-049). Tranh chấp UI-1 (CR-049): `e2e/chat/i18n.chat.ts` nền dark `rgb(20, 17, 28)` → `rgb(15, 16, 32)` (#0F1020, bảng đã duyệt) — test sai sau thay đổi được duyệt, sửa + khoá lại.

Tranh chấp M08 (2026-10-08, X2b B4): X2b-R02 (CR-048, chốt U4) cho tag `@key` **đầu tin** phòng gọi agent (thiếu quyền ⇒ 404, tin không lưu) — thay hành vi X2a-R16 cho tag đầu tin. Ý định M08 ("@ là chữ, không run") còn đúng cho tag giữa câu ⇒ test sai sau thay đổi được duyệt: đổi tin thành "Nhờ @assistant tóm tắt giúp", khoá lại. Tag đầu tin / `@@` thuộc X2b-AC01/AC03.
