-- HUB-FR-96 · HUB-FR-97 · HUB-FR-98 · HUB-FR-100 · HUB-BR-22 · X2a RV1 (review-security-1 #1, #3, #4, #8; plan-decisions RV1):
-- siết lưới RLS phòng. Không sửa 0011; viết tay, idempotent (CREATE OR REPLACE / ALTER POLICY / DROP TRIGGER IF EXISTS).
-- (1) `rooms`: đổi name/deleted_at chỉ chủ hiện tại (trigger `rooms_guard`; policy UPDATE giữ mức thành viên vì
--     `SELECT … FOR UPDATE` cũng phải qua USING của policy UPDATE — thành viên thường vẫn phải khoá được hàng phòng khi
--     gửi/rời/đọc, thứ tự khoá plan-db §6); `last_seq`/`last_activity_at` bỏ GRANT, chỉ qua definer `room_next_seq`.
-- (2) `room_members`: USING = hàng của mình hoặc người gọi là chủ; trigger `room_members_guard` giới hạn cột theo vai
--     (chỉ khi RLS đang áp cho current_user ⇒ hàm definer/owner không bị chặn). Thêm lại (xoá `left_at`) chỉ chủ, như INSERT.
-- (3) `room_messages` INSERT: `seq` phải đúng `rooms.last_seq` (vừa cấp bằng `room_next_seq` trong cùng transaction).
-- (4) `room_fanout`: tổng chưa đọc của người KHÁC chỉ trả khi người gọi vừa gửi tin cuối của phòng trong transaction này.
-- (5) `is_tenant_user`: thêm active + không bị tenant khoá.
-- Thứ tự khoá giữ nguyên: rooms → room_members → room_messages.
CREATE OR REPLACE FUNCTION hub.is_tenant_user(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM admin.users u
    WHERE u.id = p_user AND u.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND u.active AND NOT u.locked_by_tenant)
$$;
--> statement-breakpoint
-- `last_seq` của phòng nếu người gọi là thành viên hiện tại (khác ⇒ NULL). Dùng ở policy INSERT tin + trigger mốc đọc.
CREATE OR REPLACE FUNCTION hub.room_last_seq(p_room uuid) RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT r.last_seq FROM hub.rooms r
  WHERE r.id = p_room AND r.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND hub.is_room_member(p_room)
$$;
--> statement-breakpoint
-- Cấp `seq` kế: khoá hàng `rooms` (UPDATE), kiểm lại thành viên SAU khi giữ khoá (snapshot mới), tăng `last_seq`, đặt
-- `last_activity_at = clock_timestamp()` (ms, P07). DM ⇒ bỏ ẩn cho mọi thành viên (R07) dưới cùng khoá. Trả `seq` mới.
CREATE OR REPLACE FUNCTION hub.room_next_seq(p_room uuid) RETURNS bigint
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_seq bigint;
  v_kind text;
BEGIN
  IF v_tid IS NULL OR NOT hub.is_room_member(p_room) THEN
    RAISE EXCEPTION 'room_next_seq: not a room member' USING ERRCODE = '42501';
  END IF;
  UPDATE hub.rooms r SET last_seq = r.last_seq + 1,
      last_activity_at = date_trunc('milliseconds', clock_timestamp())
    WHERE r.id = p_room AND r.tenant_id = v_tid AND r.deleted_at IS NULL
    RETURNING r.last_seq, r.kind INTO v_seq, v_kind;
  IF v_seq IS NULL OR NOT hub.is_room_member(p_room) THEN
    RAISE EXCEPTION 'room_next_seq: not a room member' USING ERRCODE = '42501';
  END IF;
  IF v_kind = 'dm' THEN
    UPDATE hub.room_members m SET hidden_at = NULL
      WHERE m.room_id = p_room AND m.tenant_id = v_tid AND m.left_at IS NULL AND m.hidden_at IS NOT NULL;
  END IF;
  RETURN v_seq;
END $$;
--> statement-breakpoint
-- D13 (siết #4): chưa đọc của phòng cho từng thành viên hiện tại; `total` (mọi phòng) chỉ cho chính người gọi, hoặc cho
-- mọi người khi người gọi vừa chèn tin `seq = last_seq` của phòng trong transaction hiện tại (đường gửi). Khác ⇒ NULL.
CREATE OR REPLACE FUNCTION hub.room_fanout(p_room uuid)
  RETURNS TABLE (user_id uuid, unread bigint, total bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  WITH me AS (SELECT NULLIF(current_setting('app.user_id', true), '')::uuid AS uid),
  room AS (
    SELECT r.id, r.last_seq FROM hub.rooms r
    WHERE r.id = p_room AND r.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND hub.is_room_member(p_room)),
  sending AS (
    SELECT EXISTS (
      SELECT 1 FROM hub.room_messages x, room, me
      WHERE x.room_id = room.id AND x.seq = room.last_seq AND x.sender_id = me.uid
        AND x.xmin = pg_current_xact_id_if_assigned()::xid) AS ok)
  SELECT m.user_id,
    greatest(room.last_seq - m.last_read_seq, 0)::bigint,
    CASE WHEN m.user_id = me.uid OR sending.ok THEN
      (SELECT coalesce(sum(greatest(r2.last_seq - m2.last_read_seq, 0)), 0)
         FROM hub.room_members m2 JOIN hub.rooms r2 ON r2.id = m2.room_id
         WHERE m2.user_id = m.user_id AND m2.left_at IS NULL AND m2.hidden_at IS NULL)::bigint
    END
  FROM room JOIN hub.room_members m ON m.room_id = room.id, me, sending
  WHERE m.left_at IS NULL
$$;
--> statement-breakpoint
-- Trigger giới hạn cột UPDATE `room_members` (policy không lọc được cột). Chỉ chạy khi RLS áp cho current_user (hub_rw/
-- hub_api); trong hàm definer / role chủ ⇒ bỏ qua. "Người gọi là chủ" suy từ policy USING (đã chạy với snapshot đầu câu):
-- hàng người khác lọt USING chỉ khi người gọi là chủ; hàng của mình ⇒ chủ khi OLD.role = 'owner'. Không truy vấn lại
-- `is_room_owner` ở đây (trigger thấy hàng câu hiện tại vừa sửa ⇒ chuyển chủ một câu CASE sẽ phụ thuộc thứ tự hàng).
CREATE OR REPLACE FUNCTION hub.room_members_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_self boolean := OLD.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_owner boolean;
BEGIN
  IF NOT row_security_active(TG_RELID) THEN
    RETURN NEW;
  END IF;
  v_self := coalesce(v_self, false);
  v_owner := NOT v_self OR OLD.role = 'owner';
  IF NEW.room_id IS DISTINCT FROM OLD.room_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'room_members: key change' USING ERRCODE = '42501';
  END IF;
  IF OLD.left_at IS NOT NULL THEN
    -- hàng đã rời: chỉ chủ thêm lại (cùng điều kiện INSERT: vai member, user tenant dùng được; mốc đọc ≤ last_seq)
    IF NEW.left_at IS NULL AND v_owner AND NOT v_self AND NEW.role = 'member'
       AND hub.is_tenant_user(NEW.user_id)
       AND NEW.last_read_seq <= coalesce(hub.room_last_seq(NEW.room_id), -1) THEN
      RETURN NEW;
    END IF;
    -- chủ "đặt left_at" lại cho hàng đã rời (vd. xoá phòng bằng một câu): không đổi gì, `left_at` cũ giữ nguyên
    IF NEW.left_at IS NOT NULL AND v_owner AND NEW.role = OLD.role AND NEW.joined_at = OLD.joined_at
       AND NEW.last_read_seq = OLD.last_read_seq AND NEW.hidden_at IS NOT DISTINCT FROM OLD.hidden_at THEN
      NEW.left_at := OLD.left_at;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'room_members: re-add is owner only' USING ERRCODE = '42501';
  END IF;
  IF NEW.joined_at IS DISTINCT FROM OLD.joined_at THEN
    RAISE EXCEPTION 'room_members: joined_at is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT v_owner THEN
    RAISE EXCEPTION 'room_members: role change is owner only' USING ERRCODE = '42501';
  END IF;
  IF NEW.left_at IS NOT NULL AND NOT v_self AND NOT v_owner THEN
    RAISE EXCEPTION 'room_members: remove is owner only' USING ERRCODE = '42501';
  END IF;
  IF (NEW.hidden_at IS DISTINCT FROM OLD.hidden_at OR NEW.last_read_seq IS DISTINCT FROM OLD.last_read_seq)
     AND NOT v_self THEN
    RAISE EXCEPTION 'room_members: own state only' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_read_seq IS DISTINCT FROM OLD.last_read_seq AND (NEW.last_read_seq < OLD.last_read_seq
     OR NEW.last_read_seq > coalesce(hub.room_last_seq(NEW.room_id), -1)) THEN
    RAISE EXCEPTION 'room_members: last_read_seq must be monotonic and <= last_seq' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- name/deleted_at chỉ chủ hiện tại (cùng điều kiện bật như room_members_guard). Câu UPDATE rooms không sửa room_members
-- nên đọc `is_room_owner` ở đây không phụ thuộc thứ tự hàng.
CREATE OR REPLACE FUNCTION hub.rooms_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NOT row_security_active(TG_RELID) THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.last_seq IS DISTINCT FROM OLD.last_seq OR NEW.last_activity_at IS DISTINCT FROM OLD.last_activity_at THEN
    RAISE EXCEPTION 'rooms: seq/activity only via room_next_seq' USING ERRCODE = '42501';
  END IF;
  IF (NEW.name IS DISTINCT FROM OLD.name OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     AND NOT hub.is_room_owner(OLD.id) THEN
    RAISE EXCEPTION 'rooms: owner only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS rooms_guard_tg ON hub.rooms;
--> statement-breakpoint
CREATE TRIGGER rooms_guard_tg BEFORE UPDATE ON hub.rooms
  FOR EACH ROW EXECUTE FUNCTION hub.rooms_guard();
--> statement-breakpoint
DROP TRIGGER IF EXISTS room_members_guard_tg ON hub.room_members;
--> statement-breakpoint
CREATE TRIGGER room_members_guard_tg BEFORE UPDATE ON hub.room_members
  FOR EACH ROW EXECUTE FUNCTION hub.room_members_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.room_last_seq(uuid), hub.room_next_seq(uuid), hub.room_members_guard(), hub.rooms_guard()
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.room_last_seq(uuid), hub.room_next_seq(uuid) TO hub_rw;
--> statement-breakpoint
-- `last_seq`/`last_activity_at` không còn sửa trực tiếp được (chỉ `room_next_seq`).
REVOKE UPDATE (last_seq, last_activity_at) ON hub.rooms FROM hub_rw;
--> statement-breakpoint
ALTER POLICY room_members_update ON hub.room_members
  USING (current_setting('app.scope', true) = 'user'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         AND hub.is_room_member(room_id)
         AND (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR hub.is_room_owner(room_id)))
  WITH CHECK (current_setting('app.scope', true) = 'user'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         AND (role = 'member' OR hub.is_room_owner(room_id)));
--> statement-breakpoint
ALTER POLICY room_messages_insert ON hub.room_messages
  WITH CHECK (current_setting('app.scope', true) = 'user'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         AND sender_type = 'user'
         AND sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND hub.is_room_member(room_id)
         AND seq = hub.room_last_seq(room_id));
