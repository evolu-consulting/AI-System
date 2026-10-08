# X2a · Security review RLS + `/me/stream` — vòng 1

## Kết luận: FAIL (CHANGES REQUESTED) · Spec: X2a-rooms · Vòng: 1 · Reviewer: bảo mật (Opus, riêng — plan §12)

Cách ly **tenant** đạt: không đường nào (HTTP hay SQL bằng `hub_api`) đọc/ghi được phòng của tenant khác, người ngoài
phòng thấy 0 hàng / 404, thành viên bị bớt mất quyền đọc ngay. Lý do FAIL là **1 Major**: câu hỏi mở plan §12 mục 9 —
RLS UPDATE của `rooms`/`room_members` chỉ đòi "là thành viên", nên lưới DB **không** giữ quyền chủ phòng và mâu thuẫn
với policy INSERT (đã đòi owner). Reviewer chọn **siết**, không chấp nhận như hiện tại (lý do + cách sửa ở #1).
Không lỗ hổng khai thác được từ HTTP: mọi việc của chủ bị chặn ở app (`guard` 404→409→403, `lockFor` kiểm lại dưới khoá).

## Phạm vi
`packages/db/migrations-hub/0011_x2a_rooms.sql` · `packages/db/src/hub-scope.ts` · quyền `hub_rw`/`hub_api`/`hub_ro` ·
`apps/hub-api/src/modules/{rooms,directory,me-stream}/**` · `lib/{user-stream,jwt,auth.middleware}.ts` · `app.x2a.ts`,
`app.ts` (`PROTECTED_PREFIXES`) · `tools/hub-dev/src/fixture-rooms.ts`.

## Lệnh đã chạy
- Đọc spec-isolation §1–§3, plan §1/§3/§7/§12/§16, plan-db §4.2–§4.4.
- Dò quyền/policy trên Postgres docker (`ai_system`, mỗi ca `BEGIN … SET LOCAL ROLE hub_api … ROLLBACK`, không để lại dữ liệu);
  phòng G = "Nhóm dự án" (lan chủ, hoa thành viên), khoa = cùng tenant ngoài phòng, tadmin = tenant khác.

| Ca | Kết quả |
|---|---|
| `hub_api` không GUC: `rooms`/`room_members`/`room_messages` | 0 / 0 / 0 hàng ✓ |
| GUC khoa (ngoài phòng): SELECT 3 bảng G, `room_fanout(G)`, UPDATE `rooms` G | 0 hàng, fanout rỗng, `UPDATE 0` ✓ |
| khoa tự INSERT vào `room_members` G | 42501 RLS ✓ |
| GUC tadmin (tenant khác): `rooms`; `create_room('dm', peer=lan)` | 0 hàng; `P0002 peer not found` ✓ |
| GUC hoa nhưng `app.tenant_id` = tenant khác | 0 hàng ✓ |
| `app.scope='system'` | 0 hàng (không nhánh system) ✓ |
| hoa sau khi `left_at` đặt: SELECT phòng/tin; tự `left_at = NULL` | 0 / 0; `UPDATE 0` ✓ |
| hoa gửi tin với `sender_id` = lan | 42501 RLS ✓ |
| hoa tự nâng `role='owner'` (kể cả sau khi đá chủ ra) | 42501 RLS ✓ |
| khoa `create_room('dm', peer = user tenant khác)`; nhóm tên rỗng; `p_id` trùng phòng có sẵn | `P0002`; `rooms_shape_ck`; `rooms_pkey` (không lộ gì) ✓ |
| **hoa (thành viên thường)**: đổi tên G · `last_seq = 0` · hạ `role` của lan · sửa `last_read_seq`/`hidden_at` của lan · đặt `left_at` cho lan · `deleted_at` của G | **cả 6 `UPDATE 1`** ✗ (#1) |
| **hoa thêm lại khoa (hàng đã rời) bằng `UPDATE left_at = NULL`** | **`UPDATE 1`** — vượt policy INSERT đòi owner ✗ (#1) |
| hoa INSERT tin `seq = 9999` (đúng `sender_id`) | `INSERT 1` ✗ (#3) |
| Hàm definer: `prosecdef`, `proconfig`, ACL | 5 hàm `search_path=pg_catalog, pg_temp`, chủ `ai`, EXECUTE chỉ `hub_rw` (+chủ), không PUBLIC ✓ |
| RLS bảng / GRANT | 3 bảng `relrowsecurity=t` (không FORCE — đúng thiết kế definer); `room_messages` chỉ SELECT/INSERT; UPDATE theo cột như §4.4 ✓ |
| `hub_api` đọc `admin.users` | thấy user của **4 tenant**, cột gồm `email`, `role` (sẵn có từ 0002, xem #6) |

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| 1 | **Major** | 3 Bảo mật (lưới RLS) | `packages/db/migrations-hub/0011_x2a_rooms.sql:191-199` (`rooms_member_update`), `:218-227` (`room_members_update`), `:251`, `:253` (GRANT UPDATE cột) | Plan §12 mục 9 — **không chấp nhận**. Policy UPDATE chỉ đòi `is_room_member` ⇒ ở mức DB mọi thành viên làm được việc của chủ và sửa hàng người khác: đổi tên/xoá mềm phòng, hạ vai chủ, đặt `left_at` cho chủ/người khác (đá ra), xoá dấu đọc/ẩn hộ người khác, **thêm lại người đã bị bớt** bằng `UPDATE left_at = NULL` (lách đúng điều `room_members_insert` cố chặn bằng `is_room_owner`), đặt `rooms.last_seq` lùi ⇒ mọi lần gửi sau đụng `room_messages_seq_uq` (23505, retry 1 lần vẫn đụng) ⇒ phòng hỏng vĩnh viễn. Lớp tấn công: bất kỳ lỗi app/SQL injection/route mới quên `guard` trong tenant là đủ — RLS được tài liệu gọi là "lưới thứ hai" nhưng không bắt được lớp lỗi này. Tenant vẫn cách ly (chỉ trong phòng mình là thành viên) ⇒ Major, không Blocker | Migration `0012_x2a_rv_rls` (idempotent, không sửa 0011): (a) bỏ UPDATE `last_seq`/`last_activity_at` khỏi quyền thành viên — cấp `seq` qua hàm definer `hub.room_next_seq(p_room) RETURNS (seq, at)` (kiểm `is_room_member`, `UPDATE … SET last_seq = last_seq + 1`), `messages.repo.bumpSeq` gọi hàm; (b) `rooms_member_update` USING thêm `hub.is_room_owner(id)` (chỉ còn `name`, `deleted_at`; xoá khi chủ rời một mình vẫn qua vì người gọi là chủ); (c) `room_members_update` USING = `U AND hub.is_room_member(room_id) AND (user_id = app.user_id OR hub.is_room_owner(room_id) OR (kind DM AND chỉ đổi hidden_at → NULL))` — phần "chỉ đổi cột" làm bằng trigger `BEFORE UPDATE` definer: hàng người khác mà người gọi không phải chủ ⇒ chỉ cho `hidden_at: x → NULL`; hàng của mình ⇒ cấm `left_at: NOT NULL → NULL`, cấm `last_read_seq` giảm, cấm `joined_at` đổi. Thêm int test DB (thành viên thường: 6 thao tác trên ⇒ 42501/0 hàng; chủ vẫn bớt/chuyển/xoá được; gửi DM vẫn bỏ ẩn peer) | backend-lead (+qc test) |
| 2 | Minor | 2 Nghiệp vụ / 3 | `apps/hub-api/src/modules/me-stream/me-stream.session.ts:58-68,111`, `lib/user-stream.ts:149-150` | Người đã bị bớt/rời vẫn lấy lại được nội dung `room.message` của phòng cũ trong 7 ngày bằng `Last-Event-ID` cũ (vd. id đầu stream): `ustream:<uid>` giữ ≤ 1000 entry đầy đủ nội dung. Chỉ là tin họ đã nhận khi còn là thành viên (không lộ tin mới) ⇒ Minor, nhưng lệch tinh thần ma trận §2 "B sau khi rời: 404" | Đề xuất chấp nhận và ghi vào spec-isolation §2 ("sự kiện đã giao không thu hồi; replay ≤ 7 ngày/1000 entry"). Không cắt chọn lọc được (stream chung mọi phòng của user); nếu muốn chặt hơn chỉ có cách rút TTL/MAXLEN |
| 3 | Minor | 3 (lưới) | `0011_x2a_rooms.sql:238-246` (`room_messages_insert`) | Policy không ràng `seq`/`created_at`: thành viên chèn được `seq` tuỳ ý (9999) ⇒ khi `last_seq` tới đó thì gửi hỏng (cùng lớp #1, chỉ qua SQL) | Cùng migration #1: `WITH CHECK … AND seq = (SELECT last_seq FROM hub.rooms WHERE id = room_id)` qua hàm definer `hub.room_last_seq(room)` (gửi chèn sau `bumpSeq` trong cùng tx nên khớp) |
| 4 | Minor | 3 | `0011_x2a_rooms.sql:156-167` (`room_fanout`) | Thành viên gọi thẳng hàm (SQL) đọc được **tổng chưa đọc trên mọi phòng** của từng thành viên khác — lộ số đếm phòng mình không ở. App chỉ gửi mỗi người số của chính họ ⇒ chỉ qua SQL | Chấp nhận (ghi plan-db §4.2) hoặc chỉ trả `total` cho `m.user_id = app.user_id`, phần người khác tính trong một hàm chỉ gọi từ hàm gửi definer |
| 5 | Minor | 2 | `apps/hub-api/src/modules/rooms/messages/messages.service.ts:77-89` | `markRead` không khoá `rooms` (đúng plan §6) ⇒ danh sách nhận `room.read` đọc trước khi lần bớt song song commit có thể gửi 1 `room.read {room_id, user_id, seq}` tới người vừa bị bớt, **sau** `member_removed`. Chỉ lộ mốc đọc, không nội dung | Chấp nhận + ghi spec-isolation §3; hoặc đọc `activeMemberIds` với `FOR SHARE OF r` trên `rooms` (khoá chia sẻ, không chu trình với gửi) |
| 6 | Minor | 9 Truy vết / 3 | `docs/TECH-DEBT.md` (thiếu), `packages/db/migrations/0002_admin_rls.sql:48-55` | spec-isolation §3 và plan §13 Q1 hứa "TECH-DEBT thu hẹp cột" cho `hub_ro` trên `admin.users`, nhưng chưa có dòng nào. Xác minh: `hub_api` đọc `email`, `role` của user **mọi tenant** (`users_hub_ro USING (true)`). Directory tự lọc đúng 4 cột + tenant + active/unlocked (`directory.repo.ts:15-17`) ⇒ không lộ qua API | Thêm dòng TECH-DEBT: `REVOKE SELECT (email) …` / view `hub.tenant_directory` definer lọc theo GUC tenant |
| 7 | Minor | 3 (DoS) | `messages.service.ts:46-74`, `lib/user-stream.ts:145-151` | Không giới hạn tần suất gửi tin / tạo phòng: một thành viên phát tin 16 000 ký tự liên tục ⇒ mỗi tin XADD vào ≤ 50 stream (≤ ~16 MB/user giữ 7 ngày). Có trần (MAXLEN 1000) nên không vô hạn | TECH-DEBT: rate limit theo user cho `POST /rooms/:id/messages` và `POST /rooms` (mẫu rate limit đăng nhập) |
| 8 | Minor | 3 (lưới) | `0011_x2a_rooms.sql:98-104,215` | `is_tenant_user` (dùng ở `room_members_insert`) không kiểm `active`/`locked_by_tenant`; app kiểm (`usableUserIds`) nên đúng R02 ở API | Tuỳ chọn: thêm `AND u.active AND NOT u.locked_by_tenant` cho đường thêm thành viên (giữ hàm cũ cho `create_room` kiểm người gọi) |

## Mục plan §12 — đối chiếu
1. Hàm definer ✓ — `search_path` cố định, tên đủ schema, không SQL động, `REVOKE PUBLIC`, tenant/user chỉ từ GUC, `dm_key` tự tính (`:140`), peer cùng tenant + active + không khoá (`:136-139`). DM không chiếm được: `dm_key` luôn chứa uid người gọi ⇒ không tạo/đọc DM của cặp khác; nhánh trùng chỉ trả id phòng có sẵn của chính cặp đó.
2. Policy khớp §4.3 ✓, không nhánh `system` ✓, `hub_api` không GUC ⇒ 0 hàng ✓, `room_messages` không UPDATE/DELETE ✓ — nhưng §4.3 bản thân quá rộng ở UPDATE (#1).
3. FK kép `(room_id, tenant_id)` + `is_tenant_user` ✓ (khoa ⇒ tadmin bị chặn).
4. 404 trước 400/403 ✓ — `roomIdParam` (không uuid ⇒ `ROOM_NOT_FOUND`), mọi route gọi `access`/`guard` trước `parseJson`; "không có" và "không phải thành viên" cùng `findAccess = null` ⇒ cùng 404; `USER_NOT_FOUND` cùng một mã cho "không tồn tại / khác tenant / bị khoá".
5. Fan-out ✓ — người nhận đọc dưới `FOR UPDATE OF r` (`lockFor`, kiểm lại ở câu sau), `room_fanout` chỉ thành viên `left_at IS NULL`, XADD sau commit (outbox), người bị bớt nhận đúng 1 `member_removed`. `/me/stream` chỉ đọc `ustream:<claims.sub>` (`me-stream.routes.ts:180-182`, `user.userId` từ JWT đã verify) — không tham số nào chọn key ⇒ `Last-Event-ID` không đọc được stream người khác. (Ngoại lệ nhỏ: #5.)
6. Danh bạ ✓ — đúng 4 cột, `tenant_id` + `active` + `NOT locked_by_tenant` + loại chính mình ở SQL, map lại 4 trường, `likePattern` thoát `\ % _`, `q` ≤ `LIST_Q_MAX`, `limit` ≤ 50.
7. ✓ — không log nội dung (log chỉ `room_id`, `n`, `id`); `Last-Event-ID` qua `STREAM_EVENT_ID_RE` trước khi vào Redis, id quá lớn ⇒ `reset` (`compareStreamId` BigInt), chỉ đọc từ header.
8. `room_fanout` gated `is_room_member` ✓ (người ngoài ⇒ rỗng); lộ tổng của người khác qua SQL (#4).
9. **Siết** — #1.

## `/me/stream` — các điểm khác đã kiểm (đạt)
- 401 JSON trước khi mở stream (`/me` trong `PROTECTED_PREFIXES`); token chỉ qua `Authorization: Bearer` (regex chặt), không token trên URL.
- `exp` bắt buộc ở `verifyAccessToken` (`jwt.ts:42,48`) ⇒ `AuthUser.exp` luôn có ⇒ phiên đóng đúng lúc hết hạn (`#armExpiry`, kẹp 2^31−1 ms); khoá tài khoản/tenant ⇒ `accountUsable` false ở nhịp ping kế (≤ 15 s + độ trễ cache ≤ 5 s) — đúng D14.
- Giới hạn 5 phiên/user/instance, phiên mới đẩy phiên cũ (không cho một token chiếm vô hạn); một kết nối `XREAD` multiplex/instance; không giữ transaction DB trong stream.
- Entry Redis sai contract bị bỏ (`parseMeStreamEvent`), `stream.reset` không bao giờ lấy từ Redis.

## `tools/hub-dev/src/fixture-rooms.ts` — xác nhận dev-only ✓
Ghi bằng `DATABASE_URL` (owner, bỏ qua RLS) cho thành viên nhóm + tin mẫu; chỉ được import bởi `tools/hub-dev/src/dev.ts`
(`hub:dev`) và `tests/acceptance/X2a/seed.int.test.ts`; không app nào trong `apps/` import; tạo phòng vẫn qua `hub.create_room`.
Không vấn đề.

## Rubric (phần bảo mật)
1 ✓ · 2 ✓ (#2, #5 Minor) · 3 ✗ (#1 Major; #3, #4, #6–#8 Minor) · 4 ✓ · 5 — · 6 ✗ (thiếu int test lưới UPDATE, kèm #1) · 7 — · 8 — · 9 ✗ (#6 Minor)
