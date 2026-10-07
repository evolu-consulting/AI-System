# Plan · X2a-rooms — phụ lục DB, luồng, khoá (backend)

Phụ lục của [`plan.md`](plan.md) (tách để giữ plan ≤ 30 KB). Mã D1–D16: `plan.md` §1.

## 4. DB — `packages/db/migrations-hub/0011_x2a_rooms.sql` (+ `meta/_journal.json` idx 11, tag `0011_x2a_rooms`)
Viết tay, idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$ … pg_policies/pg_constraint`), `--> statement-breakpoint` như 0009/0010. Không FK sang `admin.*` (P3 H1). Drizzle: file mới `packages/db/src/schema/hub-rooms.ts` (`hub.ts` đã 351 dòng) + export `"./schema/hub-rooms"` trong `packages/db/package.json`. Timestamp ghi cắt ms (`date_trunc('milliseconds', now())`) như conversations.

### 4.1 Bảng
| Bảng | Cột (kiểu · null · default) | Ràng buộc / index |
|---|---|---|
| `hub.rooms` | `id uuid` PK (app sinh) · `tenant_id uuid NN` · `kind text NN` · `name text` · `dm_key text` · `last_seq bigint NN 0` · `last_activity_at timestamptz NN` · `created_by uuid NN` · `created_at timestamptz NN` · `deleted_at timestamptz` | `rooms_kind_ck` kind ∈ (dm, group) · `rooms_shape_ck`: `(kind='dm' AND name IS NULL AND dm_key IS NOT NULL) OR (kind='group' AND dm_key IS NULL AND name IS NOT NULL AND char_length(name) BETWEEN 1 AND 80)` · `rooms_last_seq_ck` ≥ 0 · `rooms_id_tenant_uq UNIQUE (id, tenant_id)` (đích FK kép) · `rooms_dm_key_uq UNIQUE (tenant_id, dm_key) WHERE kind='dm'` |
| `hub.room_members` | `room_id uuid NN` · `tenant_id uuid NN` · `user_id uuid NN` · `role text NN 'member'` · `joined_at timestamptz NN` · `left_at timestamptz` · `hidden_at timestamptz` · `last_read_seq bigint NN 0` | PK `(room_id, user_id)` · FK `(room_id, tenant_id) → rooms(id, tenant_id)` (khoá tenant ở DB) · `room_members_role_ck` · `last_read_seq ≥ 0` · `room_members_one_owner_ex EXCLUDE USING btree (room_id WITH =) WHERE (role='owner' AND left_at IS NULL) DEFERRABLE INITIALLY DEFERRED` (D9) · `room_members_user_active_idx (user_id) INCLUDE (room_id, last_read_seq, hidden_at) WHERE left_at IS NULL` |
| `hub.room_messages` | `id uuid` PK default `gen_random_uuid()` · `room_id uuid NN` · `tenant_id uuid NN` · `seq bigint NN` · `sender_type text NN` · `sender_id uuid` · `content text NN` · `client_msg_id uuid` · `run_id uuid` · `flow_id uuid` · `trigger_message_id uuid` · `created_at timestamptz NN` | FK `(room_id, tenant_id) → rooms(id, tenant_id)` · `seq ≥ 1` · `sender_type ∈ (user, agent)` · `sender_type <> 'user' OR sender_id IS NOT NULL` · `char_length(content) BETWEEN 1 AND 16000` · `room_messages_seq_uq UNIQUE (room_id, seq)` (lịch sử + tin cuối) · `room_messages_client_uq UNIQUE (room_id, sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL` · 3 cột X2b không FK (Q4) |

Không cột đính kèm (Q3). FK kép = thành viên/tin luôn cùng tenant với phòng, kể cả khi app sai.

### 4.2 Hàm `SECURITY DEFINER` (chủ = role chạy migration; bảng không `FORCE RLS` ⇒ hàm bỏ qua RLS ⇒ **không đệ quy**)
Mọi hàm: `SET search_path = pg_catalog, pg_temp`, tên bảng đủ schema, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO hub_rw`. GUC đọc `NULLIF(current_setting('app.x', true), '')::uuid`; thiếu `app.scope='user'` ⇒ false/rỗng/lỗi `42501`.

| Hàm | Kiểu | Thân |
|---|---|---|
| `hub.is_room_member(p_room uuid) → boolean` | sql STABLE | `scope='user' AND EXISTS (room_members m WHERE m.room_id=p_room AND m.user_id=app.user_id AND m.tenant_id=app.tenant_id AND m.left_at IS NULL)` (PK) |
| `hub.is_room_owner(p_room uuid) → boolean` | sql STABLE | như trên + `m.role='owner'` |
| `hub.is_tenant_user(p_user uuid) → boolean` | sql STABLE | `EXISTS (admin.users u WHERE u.id=p_user AND u.tenant_id=app.tenant_id)` — lưới DB cho R01 (dùng được kiểm ở app) |
| `hub.create_room(p_id uuid, p_kind text, p_name text, p_peer uuid) → TABLE(room_id uuid, created boolean)` | plpgsql VOLATILE | scope/tenant/user bắt buộc (42501); `NOT hub.is_tenant_user(current_setting('app.user_id')::uuid)` ⇒ `RAISE 42501` (người gọi phải thuộc tenant; test D12 giữ). **dm:** `p_peer` khác `app.user_id` (22023), peer ∈ `admin.users` cùng tenant ∧ `active` ∧ `NOT locked_by_tenant` (không ⇒ `P0002`); `dm_key = least||':'||greatest` (tự tính, không nhận từ app); `INSERT rooms … ON CONFLICT (tenant_id, dm_key) WHERE kind='dm' DO NOTHING`; chèn được ⇒ INSERT 2 thành viên `member` ⇒ `(p_id, true)`; xung đột ⇒ `SELECT id … WHERE tenant_id=app.tenant_id AND dm_key=…` ⇒ `(id, false)` (READ COMMITTED: câu sau thấy hàng vừa commit của bên thắng). **group:** INSERT phòng + người gọi `owner` ⇒ `(p_id, true)`. Không nhận tenant/user qua tham số |
| `hub.room_fanout(p_room uuid) → TABLE(user_id uuid, unread bigint, total bigint)` | sql STABLE | rỗng nếu `NOT is_room_member(p_room)`; với mỗi thành viên hiện tại của `p_room`: `unread = r.last_seq − m.last_read_seq`, `total = Σ (last_seq − last_read_seq)` trên các membership `left_at IS NULL AND hidden_at IS NULL` của user đó (index `room_members_user_active_idx`) |

### 4.3 RLS (`ENABLE ROW LEVEL SECURITY` 3 bảng; policy chỉ `TO hub_rw`; **không** nhánh `scope='system'`)
Viết tắt: `U` = `current_setting('app.scope', true)='user' AND tenant_id = app.tenant_id`.

| Bảng | Policy | USING | WITH CHECK |
|---|---|---|---|
| rooms | `rooms_member_select` FOR SELECT | `U AND hub.is_room_member(id)` | — |
| rooms | `rooms_member_update` FOR UPDATE | `U AND hub.is_room_member(id)` | `U` |
| rooms | (không INSERT/DELETE) | — | tạo chỉ qua `hub.create_room` (D3) |
| room_members | `room_members_select` FOR SELECT | `U AND hub.is_room_member(room_id)` (thấy mọi hàng của phòng mình, kể cả hàng đã rời) | — |
| room_members | `room_members_insert` FOR INSERT | — | `U AND role='member' AND hub.is_room_owner(room_id) AND hub.is_tenant_user(user_id)` |
| room_members | `room_members_update` FOR UPDATE | `U AND hub.is_room_member(room_id)` (không thêm điều kiện owner: gửi tin DM phải bỏ ẩn hàng của **peer**, DM không có owner) | `U AND (role='member' OR hub.is_room_owner(room_id))` — thành viên thường không tự nâng mình thành owner |
| room_messages | `room_messages_select` FOR SELECT | `U AND hub.is_room_member(room_id)` | — |
| room_messages | `room_messages_insert` FOR INSERT | — | `U AND sender_type='user' AND sender_id = app.user_id AND hub.is_room_member(room_id)` |

Ghi chú: hàm STABLE dùng snapshot đầu câu ⇒ trong 1 câu (xoá phòng: đặt `left_at` mọi hàng; chuyển chủ `CASE`) điều kiện owner/member tính trước khi đổi. Câu sau trong cùng transaction thấy thay đổi câu trước (membership người tạo vừa chèn ⇒ được thêm người). Việc của **chủ** vẫn kiểm ở app (403 trước DB); RLS là lưới thứ hai. `admin_rw`/`agent_runtime`: không quyền gì (X2a-AC01).

### 4.4 GRANT (cho `hub_rw`; `hub_api` thừa hưởng qua `GRANT hub_rw TO hub_api` ở 0000)
`GRANT SELECT, UPDATE (name, last_seq, last_activity_at, deleted_at) ON hub.rooms` · `GRANT SELECT, INSERT, UPDATE (role, joined_at, left_at, hidden_at, last_read_seq) ON hub.room_members` · `GRANT SELECT, INSERT ON hub.room_messages` · `GRANT EXECUTE` 5 hàm. Không DELETE/TRUNCATE ⇒ `room_messages` không UPDATE/DELETE được (42501, X2a-AC01). `FOR UPDATE` trên `rooms` đủ quyền nhờ UPDATE cột (mẫu 0009).

### 4.5 Danh bạ — Q1 xác nhận
`migrations/0002_admin_rls.sql` dòng 48–55: policy `users_hub_ro USING (true)` + `GRANT SELECT (id, tenant_id, username, display_name, email, role, locale, active, locked_by_tenant, …) ON admin.users TO hub_ro`; `hub_api` ∈ `hub_ro` (0000 dòng 462). ⇒ **Không migration Admin**. Lọc ở truy vấn: `WHERE u.tenant_id = $tid AND u.active AND NOT u.locked_by_tenant AND u.id <> $uid [AND (u.display_name ILIKE $p OR u.username ILIKE $p)] ORDER BY lower(u.display_name), u.id LIMIT $n`, chọn **đúng** `id, display_name, username, active`; `$p = %q%` thoát `\ % _`. Tenant đang hoạt động: đã bảo đảm bởi `accountUsable` của người gọi. Index `users_tenant_username_uq (tenant_id, username)`. TECH-DEBT (D1 docs): thu hẹp cột `hub_ro` trên `admin.users` (gần #34).

### 4.6 Seed dev
`tools/hub-dev/src/fixture-rooms.ts` (gọi từ fixture, owner, idempotent theo id cố định): DM `lan`–`hoa` (3 tin) + nhóm "Nhóm dự án" (`lan` chủ, `hoa`) 2 tin, `last_seq` khớp.

## 5. Luồng (service; mọi việc DB trong `withHubScope({kind:"user"})`)
Mẫu outbox: `fn(tx)` trả `{ out, events: UserEvent[] }`; **sau** khi `withHubScope` resolve mới `publishUserEvents(redis, events)` (R21, TECH-DEBT #13 — retry 40P01 không phát đôi). `UserEvent = { userIds: string[]; event; data }`. Lỗi Redis: log `warn ustream-publish-failed {room_id, n}` (không nội dung, R24), không ném.

| Việc | Câu SQL theo thứ tự (trong 1 transaction) | Sự kiện (người nhận tính trong tx) |
|---|---|---|
| Tạo DM | tra peer dùng được (`admin.users`) → `create_room('dm')` → `detail` | không (D7); 201/200 |
| Tạo nhóm | `planCreateGroup` (≤ 50 else `ROOM_FULL`) → tra `member_ids` dùng được (thiếu ⇒ `USER_NOT_FOUND`) → `create_room('group')` → INSERT thành viên (`last_read_seq 0`) → `detail` | `member_added {user_id: X, room: summary(X)}` cho từng X |
| Đổi tên | `SELECT rooms FOR UPDATE` → `UPDATE name` | `updated {name}` mọi thành viên |
| Xoá phòng | `FOR UPDATE` → đọc thành viên → `UPDATE rooms SET deleted_at` → `UPDATE room_members SET left_at` (D4) | `deleted` mọi thành viên lúc xoá |
| Thêm | `FOR UPDATE` → đếm thành viên hiện tại → `planAddMembers` (full ⇒ `ROOM_FULL`, không ghi) → tra dùng được → `INSERT … ON CONFLICT (room_id,user_id) DO UPDATE SET left_at=NULL, role='member', joined_at, hidden_at=NULL, last_read_seq=EXCLUDED WHERE room_members.left_at IS NOT NULL` | `member_added` cho mọi thành viên (mới: kèm `room`) |
| Bớt / rời | `FOR UPDATE` → đọc thành viên → `leaveOutcome` → `UPDATE … SET left_at` (hoặc nhánh xoá) | `member_removed {user_id}` cho thành viên còn lại **và** người bị bớt (đúng 1, R20) |
| Chuyển chủ | `FOR UPDATE` → kiểm đích là thành viên → `UPDATE room_members SET role = CASE user_id WHEN $new THEN 'owner' ELSE 'member' END WHERE room_id=$r AND user_id IN ($me,$new)` | `updated {owner_id}` |
| Ẩn DM | `UPDATE room_members SET hidden_at = now WHERE room_id AND user_id=me AND hidden_at IS NULL` | `unread` cho mình (D15) |
| Gửi tin | (1) `SELECT id, kind FROM rooms WHERE id=$r FOR UPDATE` (0 hàng ⇒ 404) (2) tìm `(room, me, client_msg_id)` ⇒ có: trả 200, **không** sự kiện (3) `UPDATE rooms SET last_seq=last_seq+1, last_activity_at=$now RETURNING last_seq` (4) `INSERT room_messages RETURNING` (5) `UPDATE room_members SET last_read_seq=greatest(last_read_seq,$seq) WHERE me` (6) dm: `UPDATE … SET hidden_at=NULL WHERE room_id AND hidden_at IS NOT NULL` (R07) (7) `SELECT * FROM hub.room_fanout($r)` | `message` mọi thành viên (gồm người gửi); `unread {unread,total}` mỗi thành viên từ (7) |
| Đánh dấu đọc | `SELECT last_seq FROM rooms` (không khoá) → `clampReadSeq` → null ⇒ trả số hiện tại, không sự kiện; khác ⇒ `UPDATE room_members SET last_read_seq=greatest(…)` → `unread_total` (RLS) | `read {user_id, seq}` thành viên khác; `unread` cho mình |
| Lịch sử | `access` → `SELECT … WHERE room_id AND seq < $before ORDER BY seq DESC LIMIT n+1` (`room_messages_seq_uq`) → đảo tăng; `sender` join `admin.users` (left join, fallback `username`) | — |
| `GET /rooms` | membership của mình (`left_at IS NULL AND hidden_at IS NULL`, D7) join `rooms` (`deleted_at IS NULL`), keyset `(last_activity_at, id) DESC`, LATERAL tin cuối (`seq = last_seq`, unique), peer/`member_count` một câu gộp; `unread_total` một câu tổng | — |

Gửi trùng song song: bên sau chờ khoá `rooms` ở (1), câu (2) chạy sau khi bên trước commit nên thấy tin ⇒ 200; lưới cuối: 23505 trên `room_messages_client_uq` ⇒ chạy lại transaction một lần ⇒ nhánh (2).

## 6. Thứ tự khoá & đồng thời
- **Mọi** thay đổi thành viên/tên/xoá/gửi tin: khoá hàng `hub.rooms` (FOR UPDATE hoặc UPDATE `last_seq`) **đầu tiên** → `room_members` → `room_messages`. Mỗi transaction chỉ một phòng ⇒ không chu trình giữa phòng.
- Đánh dấu đọc / ẩn chỉ khoá **hàng mình** trong `room_members`, không xin khoá `rooms` ⇒ không chu trình với gửi tin (gửi giữ `rooms` rồi xin hàng thành viên; đọc giữ hàng thành viên và không xin gì thêm).
- Giới hạn 50: đếm + INSERT dưới khoá `rooms` ⇒ hai lần thêm song song tuần tự hoá, không vượt (test song song).
- `seq`: liền, không trùng (khoá hàng + `room_messages_seq_uq`; X2a-AC07). Rollback sau `UPDATE last_seq` ⇒ `last_seq` cũng rollback, không lỗ hổng.
- DM song song: `ON CONFLICT … DO NOTHING` trong `create_room` ⇒ đúng 1 phòng, hai bên nhận cùng `id`.
- Danh sách người nhận sự kiện đọc **sau** khi đã giữ khoá phòng ⇒ nhất quán với thay đổi thành viên (R20).
- `withHubScope` retry 40P01/40001: `fn` chỉ làm DB (outbox), phát Redis sau commit.

