# X2a · Security review RLS + `/me/stream` — vòng 2 (cuối)

## Kết luận: PASS (APPROVED) · Spec: X2a-rooms · Vòng: 2 · Reviewer: bảo mật (Opus, riêng — plan §12)

Lỗi Major vòng 1 (#1) đã đóng. Kiểm trên DB thật: mọi khai thác của #1/#3/#8 nay bị chặn (42501 / `UPDATE 0`),
đường hợp lệ (chủ quản lý, thành viên rời, đọc, gửi, bỏ ẩn DM) vẫn chạy. Thử lách trigger/hàm definer mới không
thành công. Còn **4 Minor mới** (N1–N4), đều chỉ khai thác được qua SQL trực tiếp, trong phòng mình đang là thành viên,
không lộ dữ liệu tenant khác ⇒ không chặn mốc. Đề xuất đưa vào TECH-DEBT hoặc một migration nhỏ sau.

## Phạm vi
Commit sửa `58ae67a`: `packages/db/migrations-hub/0012_x2a_rooms_rls_tighten.sql` (`room_next_seq`, `room_last_seq`,
`rooms_guard`, `room_members_guard`, `room_fanout`, `is_tenant_user`, 2 `ALTER POLICY`, REVOKE) · `messages.{repo,service}.ts`
(`bumpSeq` → `room_next_seq`, `markRead` khoá) · `members.{repo,service}.ts`, `rooms.repo.ts` · `me-stream.session.ts`
(trần byte) · `plan-decisions.md` RV1 · `spec-isolation.md` §2–§3 · `TECH-DEBT.md` #104 #105 ·
test khoá `tests/acceptance/X2a/rv1-security.int.test.ts` + `test-plan-rv1.md`.

## Lệnh đã chạy
- `bun run db:test:create secrv2` + `runHubMigrations` ⇒ DB nháp `ai_system_secrv2_test` ở HEAD (hub +13). Dữ liệu: tenant
  acme/beta; phòng G (lan chủ, hoa + tam thành viên, cuc đã rời), DM lan–hoa (hoa đã ẩn), phòng O (chỉ tam, 5 tin);
  `lockd` = user acme bị khoá. Mỗi ca `BEGIN; SET LOCAL ROLE hub_api; set_config(app.*) …; ROLLBACK` (trừ 2 ca có commit
  rồi khôi phục bằng owner). Cuối phiên `db:test:drop secrv2`, dọn Redis db 13.
- `bun test` int (DB nháp riêng + Redis db 13): `rv1-security`, `db-rls`, `concurrency`, `messages`, `members` ⇒ **72 pass / 0 fail**;
  `isolation`, `stream-isolation`, `me-stream`, `rooms` ⇒ **51 pass / 0 fail**.
- `bun test apps/hub-api/src/modules/{me-stream,rooms}` (gồm `me-stream.backpressure.test.ts`) ⇒ 24 pass / 0 fail.
- `bun run test:lock:verify` ⇒ `test:lock OK (474 file)` (test QC không bị sửa).
- Chạy lại `0011_x2a_rooms.sql` trên DB HEAD (kiểm D18) — xem N4.

### Khai thác vòng 1 — chạy lại (vai `hub_api`)
| Ca | Vòng 1 | Vòng 2 |
|---|---|---|
| hoa (thành viên) đổi tên G / đặt `deleted_at` | `UPDATE 1` | `rooms: owner only` (42501) ✓ |
| hoa / lan (chủ) `UPDATE rooms SET last_seq = 0` | `UPDATE 1` | `permission denied` (REVOKE cột) ✓ |
| hoa hạ `role` của lan · sửa `last_read_seq`/`hidden_at` của lan · đặt `left_at` cho lan | `UPDATE 1` ×3 | `UPDATE 0` (USING mới) ✓ |
| hoa thêm lại cuc bằng `UPDATE left_at = NULL` | `UPDATE 1` | `UPDATE 0` ✓ |
| hoa INSERT tin `seq = 9999` / `seq = last_seq + 1` (không qua `room_next_seq`) | `INSERT 1` | RLS 42501 ✓ |
| `room_fanout(G)` gọi thẳng bởi hoa | `total` người khác lộ (35) | `total` người khác = NULL, của mình có ✓ |
| `is_tenant_user` / chủ INSERT thành viên `lockd` (bị khoá) | true / ok | RLS 42501 ✓ |

### Thử lách cơ chế mới
| Ca | Kết quả |
|---|---|
| `room_next_seq(G)` bởi khoa (ngoài phòng) · cuc (đã rời) · hoa với `app.tenant_id` = beta · `app.scope = system` · phòng đã xoá mềm | cả 5 ⇒ `42501 not a room member`; `room_last_seq(G)` của khoa = NULL ✓ |
| `INSERT … ON CONFLICT (room_id,user_id) DO UPDATE`: hoa thêm lại cuc · hoa tự nâng `role='owner'` · hoa rời rồi upsert `left_at = NULL` · hoa upsert hàng lan đặt `left_at` | cả 4 ⇒ RLS 42501 (đường UPDATE vẫn qua USING + trigger) ✓ |
| UPDATE nhiều cột một câu: hoa `left_at = now(), role = 'owner'` hàng mình · chủ `left_at = NULL, role = 'owner'` / `left_at = NULL, last_read_seq = 99` hàng cuc · chủ sửa `last_read_seq` của hoa | `role change is owner only` · `re-add is owner only` ×2 · `own state only` ✓ |
| hoa `UPDATE room_members SET left_at = now() WHERE room_id = G` (cả phòng) | `UPDATE 1` — chỉ hàng của mình ✓ |
| hoa đổi `joined_at`, giảm `last_read_seq`, đặt `last_read_seq = 99` | 42501 ×3 ✓ |
| hoa INSERT tin vào phòng O (không là thành viên) với `seq` = last_seq của O | RLS 42501 ✓ |
| lan sửa thẳng `hidden_at` của hoa trong DM | `UPDATE 0`; gửi (`room_next_seq`) ⇒ bỏ ẩn cả hai ✓ |
| Đường hợp lệ: hoa `SELECT … FOR UPDATE` G (lockFor) · lan đổi tên, bớt tam, thêm lại cuc, chuyển chủ cho hoa bằng một câu `CASE` (commit, 1 chủ, ràng buộc EXCLUDE qua) · lan xoá phòng (`left_at` của cuc giữ giá trị cũ) · gửi đủ chuỗi `room_next_seq → advanceRead → INSERT → room_fanout` | đều chạy ✓ |
| GUC/role: `SET session_replication_role = replica` · `SET row_security = off` · `ALTER TABLE … DISABLE TRIGGER` | `permission denied` · `query would be affected by row-level security` · `must be owner` ✓ |
| `search_path` hàm mới: tạo `pg_temp.is_room_owner` giả | không tác dụng — 9 hàm (`room_next_seq`, `room_last_seq`, `room_fanout`, `is_tenant_user`, 2 trigger, …) đều `search_path=pg_catalog, pg_temp`, tên đủ schema, chủ `ai`, EXECUTE chỉ `hub_rw` (2 hàm trigger không cấp EXECUTE), không PUBLIC ✓ |

### Nhận xét: owner-only bằng trigger thay vì USING của policy UPDATE
**Đồng ý.** Postgres đòi hàng `SELECT … FOR UPDATE` thoả **cả** USING của policy UPDATE ⇒ nếu siết USING
`rooms_member_update` thành chủ thì `lockFor` của thành viên thường lấy 0 hàng, không khoá, phá thứ tự khoá P07 (đã xác nhận:
hoa `FOR UPDATE` G trả 1 hàng ở HEAD). Trigger `BEFORE UPDATE` chỉ chạy khi có UPDATE thật nên không ảnh hưởng khoá; điều
kiện `row_security_active(TG_RELID)` đúng: chỉ role chịu RLS bị kiểm, hàm definer (chủ `ai`) đi qua. Hàng `rooms` vẫn
"UPDATE được" ở mức policy với thành viên nhưng mọi cột có GRANT (`name`, `deleted_at`) đều bị trigger giữ cho chủ;
`UPDATE … SET name = name` (no-op) vẫn qua — vô hại (chỉ giữ khoá như `FOR UPDATE` vốn được phép). Điểm cần biết: xem N4b.

## Trạng thái lỗi vòng 1
| # | Mức v1 | Trạng thái | Ghi chú |
|---|---|---|---|
| 1 | Major | **Đóng** | Policy + trigger + REVOKE cột; 7 khai thác v1 thất bại; RV1-S01…S12, S14, S15 xanh |
| 2 | Minor | **Chấp nhận** | Ghi ở `spec-isolation.md` §2 "Rủi ro chấp nhận" |
| 3 | Minor | **Đóng một phần** | `seq` đã ràng (`= room_last_seq`); `created_at` (và cột agent) vẫn tuỳ ý — xem N2 |
| 4 | Minor | **Đóng một phần, rủi ro còn chấp nhận** | Gọi thẳng ⇒ NULL ✓; nhưng lý do chấp nhận "cần ghi tin thật" không đúng — xem N3 |
| 5 | Minor | **Đóng** | `markRead` gọi `lockFor(…, "read")` (`messages.service.ts:81`) rồi đọc trạng thái; bị bớt ⇒ 404 (RV1-H01). Khoá `FOR UPDATE` (thay vì `FOR SHARE` đề xuất) tuần tự hoá đọc với gửi cùng phòng — đúng thứ tự khoá, chỉ là chi phí tranh chấp |
| 6 | Minor | **Đóng (TECH-DEBT #104)** | |
| 7 | Minor | **Đóng (TECH-DEBT #105)** | |
| 8 | Minor | **Đóng** | `is_tenant_user` đòi `active AND NOT locked_by_tenant` (`0012:12-19`); dùng cho INSERT, thêm lại (trigger) và `create_room` |

`/me/stream` trần byte (`me-stream.session.ts:184-187`, `highWaterMark` 1 MiB theo `byteLength`): client chậm ⇒ đóng, phần
đã xếp vẫn giao, nối lại bằng `Last-Event-ID` vẫn tiến (replay > 1 MiB bị cắt rồi nối tiếp từ id đã nhận) — không tạo kênh
lộ mới, không vòng lặp vô hạn. Đạt.

## Lỗi mới
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| N1 | Minor | 3 (lưới) / 2 | `packages/db/migrations-hub/0012_x2a_rooms_rls_tighten.sql:32-57` (`room_next_seq`), `apps/chat-web/src/features/rooms/lib/room-logic.ts:57-60` | `room_next_seq` gọi riêng được, **không cần chèn tin**: thành viên (qua SQL) commit N lần ⇒ `last_seq` tăng N mà không có tin ("seq ma"). Đo: 3 lần gọi ⇒ `last_seq` 3→6, 0 tin. Hệ quả cho **mọi** thành viên: `unread` +N; client đánh dấu đọc bằng seq lớn nhất của tin đã tải (`lastSeqOf`) ⇒ badge kẹt ≥ N tới khi có tin thật kế tiếp; `last_activity_at` bị đẩy (phòng nhảy lên đầu danh sách); DM ⇒ bỏ ẩn cho peer không kèm tin. Cùng lớp với v1 #3 (chỉ qua SQL, trong phòng mình, tự lành khi có tin thật) | Gắn cấp seq với chèn tin: (a) constraint trigger `AFTER UPDATE OF last_seq ON hub.rooms DEFERRABLE INITIALLY DEFERRED` đòi `EXISTS room_messages (room_id, seq = NEW.last_seq)` lúc COMMIT; hoặc (b) gộp thành definer `hub.room_send(room, content, client_msg_id)` (khoá, cấp seq, chèn, trả hàng) rồi bỏ policy INSERT `room_messages` cho `hub_rw` | backend-lead |
| N2 | Minor | 3 (lưới) | `0012_x2a_rooms_rls_tighten.sql:186-192` (`room_messages_insert`) | Policy INSERT tin chỉ ràng `seq`; `created_at` vẫn do người gọi đặt (đo: tin `created_at = 2001-01-01` chèn được) ⇒ phá bất biến P07 (`created_at` tin ≤ `left_at`/`hidden_at`, kiểm ở RV1-H02/H03) và thứ tự thời gian hiển thị. Ngoài ra tin `sender_type='user'` chèn được `run_id`/`flow_id`/`trigger_message_id` tuỳ ý (contract ghi "chỗ cho agent trong phòng; X2a không gửi") — rủi ro cho consumer X2b sau này nếu tin vào các cột này | Thêm vào WITH CHECK: `created_at = (last_activity_at của phòng)` qua definer (tương tự `room_last_seq`) **hoặc** trigger `BEFORE INSERT` (khi `row_security_active`) gán `NEW.created_at := rooms.last_activity_at`; và `run_id IS NULL AND flow_id IS NULL AND trigger_message_id IS NULL` cho `sender_type = 'user'` (CHECK constraint được). Nếu chọn N1(b) thì cả hai tự hết | backend-lead |
| N3 | Minor | 3 / 9 Truy vết | `0012_x2a_rooms_rls_tighten.sql:68-72` (`sending`), `docs/specs/X2a-rooms/plan-decisions.md` dòng RV1 #4 | Điều kiện "người gọi vừa chèn tin cuối trong transaction này" lách được **không để lại dấu vết**: `room_next_seq` → INSERT tin → `room_fanout` → `ROLLBACK` ⇒ thấy `total` mọi phòng của từng thành viên (đo: tam `total = 7` gồm 5 chưa đọc ở phòng O hoa không ở), không tin nào được lưu. Lý do chấp nhận ghi "cần ghi tin thật" không đúng. Ngoài ra `xmin = pg_current_xact_id_if_assigned()` sai khi INSERT nằm trong SAVEPOINT (đo: `total` người khác = NULL ⇒ app gửi 0) — hiện app không dùng savepoint, nhưng là bẫy khi refactor | Chấp nhận được (chỉ số đếm, SQL-only) nhưng sửa câu chữ rủi ro chấp nhận ở `plan-decisions.md`/`plan-db §4.2` cho đúng ("lách được bằng gửi rồi rollback"). Muốn đóng hẳn: tính `total` người khác bên trong definer gửi (N1b), không xuất qua hàm gọi được. Thêm comment cảnh báo savepoint cạnh `fanout()` (`messages.repo.ts`) | backend-lead |
| N4 | Minor | 6 Test / 4 | `tests/acceptance/X2a/db-rls.int.test.ts:379-389` (D18), `0012_x2a_rooms_rls_tighten.sql:88-99` | (a) D18 chạy lại `0011` trên DB đã ở HEAD là **hạ cấp**: đo lại sau khi chạy — `is_tenant_user` mất kiểm `active` (mở lại v1 #8), `room_fanout` về bản lộ `total` (mở lại v1 #4), GRANT UPDATE `last_seq, last_activity_at` quay lại (trigger `rooms_guard` vẫn chặn); policy giữ bản 0012 (khối `IF NOT EXISTS`). **Hiện không che lỗi**: D18 là ca cuối của file và `prepareDb` `DROP SCHEMA hub CASCADE` + migrate lại mỗi file (`resetTestDb`), đã xác nhận 72+51 ca xanh trên DB HEAD. Nhưng ca nào thêm sau D18 trong `db-rls` sẽ chạy trên lưới yếu. (b) `room_members_guard` suy "người gọi là chủ" từ việc hàng người khác lọt USING (`v_owner := NOT v_self …`): đúng khi chỉ có **một** policy UPDATE permissive; policy UPDATE permissive thứ hai sau này (vd. X2b cho agent/system) sẽ OR vào và trigger coi người qua policy đó là chủ | (a) qc: D18 chạy `0011` rồi `0012` (đúng ghi chú qc trong plan-decisions) và khẳng định trạng thái sau (vd. `is_tenant_user(lockd) = false`); hoặc ghi rõ "D18 phải là ca cuối". (b) Thêm ca `db-rls`/`rv1` khẳng định `room_members` có đúng 1 policy UPDATE (và `rooms` 1), + comment ở `0012:88` "thêm policy UPDATE ⇒ phải sửa trigger" | qc (a), backend-lead (b) |

Ghi chú không thành lỗi: chủ tự đặt `left_at`/hạ `role` hàng mình mà không chuyển chủ ⇒ phòng mất chủ vĩnh viễn ở mức DB
(đo: sau đó không ai đổi tên được). Đây là quyền trên hàng của chính chủ, không leo quyền; app chặn bằng `lockFor` + P06.
TOCTOU chuyển chủ song song với thao tác chủ khác ở mức SQL thuần là giới hạn chung của RLS (snapshot đầu câu); app tuần tự
hoá bằng khoá hàng `rooms`.

## Rubric (phần bảo mật)
1 ✓ · 2 ✓ · 3 ✓ (N1–N3 Minor) · 4 ✓ · 5 — · 6 ✓ (N4 Minor; `test:lock:verify` xanh, 123 ca int X2a xanh) · 7 — · 8 — · 9 ✓ (N3 câu chữ)
