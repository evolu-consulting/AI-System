-- HUB-FR-96 · HUB-FR-100 · HUB-BR-22 · X2a RV2 (review-security-2 N1, N2, N4b; plan-decisions RV2): toàn vẹn seq + ràng tin.
-- Không sửa 0011/0012; viết tay, idempotent (CREATE OR REPLACE / DROP TRIGGER IF EXISTS / kiểm pg_constraint).
-- (1) N1 "seq ma": transaction nào đã tăng `rooms.last_seq` thì lúc COMMIT phải có `room_messages (room_id, seq = last_seq
--     mới)` — constraint trigger DEFERRABLE INITIALLY DEFERRED trên `rooms`. Không đổi luồng app (lockFor → room_next_seq →
--     INSERT tin → room_fanout, cùng transaction), không thêm khoá (chỉ SELECT theo `room_messages_seq_uq`).
--     Miễn kiểm chỉ khi PHIÊN là role đặc quyền (chủ bảng / superuser / BYPASSRLS — migration, seed, fixture owner). Không dùng
--     `row_security_active`: thành viên `SET CONSTRAINTS … IMMEDIATE` sẽ khiến trigger chạy ngay trong `room_next_seq` (definer,
--     current_user = chủ) ⇒ sẽ bị bỏ qua; kiểm theo `session_user` thì khi đó tin chưa có ⇒ lỗi, không lách được.
-- (2) N2: tin do role chịu RLS chèn thẳng ⇒ `created_at` do server gán = `rooms.last_activity_at` (vừa đặt bởi room_next_seq,
--     P07 so với left_at/hidden_at); CHECK: tin `sender_type='user'` không mang `run_id`/`flow_id`/`trigger_message_id`.
--     Đường X2b (tin agent) đi qua definer riêng (current_user = chủ ⇒ trigger bỏ qua) hoặc `sender_type='agent'` (CHECK không áp).
-- (3) N4b: `room_members_guard` (0012) suy "người gọi là chủ" từ USING của policy UPDATE ⇒ giả định `room_members` có ĐÚNG MỘT
--     policy UPDATE permissive (`room_members_update`). Thêm policy UPDATE permissive khác (vd. X2b agent/system) sẽ OR vào USING
--     và trigger coi người qua policy đó là chủ ⇒ PHẢI sửa trigger (truyền vai tường minh) cùng lúc. Tương tự `rooms` (1 policy).
-- Thứ tự khoá giữ nguyên: rooms → room_members → room_messages.
CREATE OR REPLACE FUNCTION hub.room_seq_integrity() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  -- phiên đặc quyền (không chịu RLS) ⇒ miễn (fixture/seed đặt last_seq tay). Phiên hub_api/hub_rw ⇒ luôn kiểm.
  IF EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls))
     OR session_user = (SELECT c.relowner::regrole::name FROM pg_class c WHERE c.oid = TG_RELID) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM hub.room_messages m WHERE m.room_id = NEW.id AND m.seq = NEW.last_seq) THEN
    RAISE EXCEPTION 'rooms: last_seq % advanced without a message', NEW.last_seq USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS rooms_seq_integrity_tg ON hub.rooms;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER rooms_seq_integrity_tg AFTER UPDATE OF last_seq ON hub.rooms
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.last_seq IS DISTINCT FROM OLD.last_seq)
  EXECUTE FUNCTION hub.room_seq_integrity();
--> statement-breakpoint
-- N2: `created_at` của tin = `last_activity_at` của phòng (server gán, ghi đè giá trị người gọi). Chỉ khi RLS áp cho
-- current_user (chèn thẳng bởi hub_rw/hub_api); hàm definer / role chủ ⇒ bỏ qua. Không definer: đọc `rooms` qua RLS của
-- người gọi (không là thành viên ⇒ không thấy ⇒ giữ giá trị, policy INSERT sẽ từ chối 42501).
CREATE OR REPLACE FUNCTION hub.room_messages_stamp() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_at timestamptz;
BEGIN
  IF NOT row_security_active(TG_RELID) THEN
    RETURN NEW;
  END IF;
  SELECT r.last_activity_at INTO v_at FROM hub.rooms r WHERE r.id = NEW.room_id AND r.tenant_id = NEW.tenant_id;
  NEW.created_at := coalesce(v_at, NEW.created_at);
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS room_messages_stamp_tg ON hub.room_messages;
--> statement-breakpoint
CREATE TRIGGER room_messages_stamp_tg BEFORE INSERT ON hub.room_messages
  FOR EACH ROW EXECUTE FUNCTION hub.room_messages_stamp();
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.room_seq_integrity(), hub.room_messages_stamp() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_messages_user_no_agent_ck'
                 AND conrelid = 'hub.room_messages'::regclass) THEN
    ALTER TABLE hub.room_messages ADD CONSTRAINT room_messages_user_no_agent_ck
      CHECK (sender_type <> 'user' OR (run_id IS NULL AND flow_id IS NULL AND trigger_message_id IS NULL));
  END IF;
END $$;
--> statement-breakpoint
COMMENT ON FUNCTION hub.room_members_guard() IS
  'X2a RV2 N4b: giả định room_members có đúng 1 policy UPDATE permissive (room_members_update); thêm policy UPDATE ⇒ sửa trigger.';
