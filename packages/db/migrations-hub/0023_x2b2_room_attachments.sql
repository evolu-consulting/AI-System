-- HUB-FR-44 · HUB-FR-101 · HUB-BR-22 · X2b2-R05, R06, R13 · plan X2b-2 §1 D2–D6, §4: file đính kèm trong phòng chat.
-- 2 cột liên kết phòng (`room_id`, `room_message_id`), FK kép cùng tenant/cùng phòng, CHECK "một nơi", index, siết
-- `attachments_hub_rw` (chủ đã rời phòng mất quyền), policy đọc cho thành viên phòng, definer cho sweeper phòng xoá.
-- Viết tay, idempotent (IF NOT EXISTS; DO $$ … pg_constraint/pg_policies; ALTER POLICY; CREATE OR REPLACE): test
-- `hub-h2c.int` gỡ `attachments CASCADE` rồi áp lại 0007 + mọi migration sau. Chỉ thêm cột/ràng buộc/index — không mất
-- dữ liệu. Không thêm policy trên rooms/room_members/room_messages (X2a đếm policy).

ALTER TABLE hub.attachments ADD COLUMN IF NOT EXISTS room_id uuid;
--> statement-breakpoint
ALTER TABLE hub.attachments ADD COLUMN IF NOT EXISTS room_message_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_messages_id_room_uq'
                 AND conrelid = 'hub.room_messages'::regclass) THEN
    ALTER TABLE hub.room_messages ADD CONSTRAINT room_messages_id_room_uq UNIQUE (id, room_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_room_fk'
                 AND conrelid = 'hub.attachments'::regclass) THEN
    ALTER TABLE hub.attachments ADD CONSTRAINT attachments_room_fk
      FOREIGN KEY (room_id, tenant_id) REFERENCES hub.rooms (id, tenant_id);
  END IF;
  -- Tin bị xoá cứng ⇒ chỉ room_message_id về NULL; room_id giữ ⇒ file không thành "chưa gắn" (D4, PG15+).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_room_message_fk'
                 AND conrelid = 'hub.attachments'::regclass) THEN
    ALTER TABLE hub.attachments ADD CONSTRAINT attachments_room_message_fk
      FOREIGN KEY (room_message_id, room_id) REFERENCES hub.room_messages (id, room_id)
      ON DELETE SET NULL (room_message_id);
  END IF;
  -- "Một nơi" (R06): file phòng không mang liên kết hội thoại riêng. `position IS NOT NULL` tường minh như 0007.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_room_bound_ck'
                 AND conrelid = 'hub.attachments'::regclass) THEN
    ALTER TABLE hub.attachments ADD CONSTRAINT attachments_room_bound_ck CHECK (room_id IS NULL
      OR (message_id IS NULL AND conversation_id IS NULL AND flow_id IS NULL AND bound_at IS NOT NULL
          AND position IS NOT NULL AND position BETWEEN 0 AND 9));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_room_msg_ck'
                 AND conrelid = 'hub.attachments'::regclass) THEN
    ALTER TABLE hub.attachments ADD CONSTRAINT attachments_room_msg_ck
      CHECK (room_message_id IS NULL OR room_id IS NOT NULL);
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_room_message_idx ON hub.attachments (room_message_id, position)
  WHERE room_message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_room_live_idx ON hub.attachments (room_id)
  WHERE purged_at IS NULL AND room_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rooms_deleted_idx ON hub.rooms (id) WHERE deleted_at IS NOT NULL;
--> statement-breakpoint

-- ── RLS (D5): ghi chỉ chủ; file phòng chỉ khi chủ còn là thành viên. Đọc thêm: thành viên hiện tại của phòng ────────
ALTER POLICY attachments_hub_rw ON hub.attachments
  USING (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND (room_id IS NULL OR hub.is_room_member(room_id))))
  WITH CHECK (current_setting('app.scope', true) = 'system'
         OR (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND (room_id IS NULL OR hub.is_room_member(room_id))));
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'attachments'
                 AND policyname = 'attachments_room_member_select') THEN
    CREATE POLICY attachments_room_member_select ON hub.attachments FOR SELECT TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND room_id IS NOT NULL
             AND hub.is_room_member(room_id));
  END IF;
END
$$;
--> statement-breakpoint

-- ── Definer cho sweeper (D6): RLS `rooms` không có nhánh system ⇒ JOIN rooms chỉ được trong hàm definer ────────────
CREATE OR REPLACE FUNCTION hub.attach_claim_deleted_rooms(p_now timestamptz, p_limit integer)
  RETURNS TABLE (id uuid, storage_key text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
#variable_conflict use_column
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'attach_claim_deleted_rooms: system scope required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH c AS (
    SELECT a.id AS aid FROM hub.rooms r
    JOIN hub.attachments a ON a.room_id = r.id AND a.tenant_id = r.tenant_id
    WHERE r.deleted_at IS NOT NULL AND a.purged_at IS NULL
    LIMIT least(greatest(p_limit, 1), 500)
    FOR UPDATE OF a SKIP LOCKED)
  UPDATE hub.attachments a SET purged_at = p_now FROM c WHERE a.id = c.aid
  RETURNING a.id, a.storage_key;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.attach_claim_deleted_rooms(timestamptz, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.attach_claim_deleted_rooms(timestamptz, integer) TO hub_rw;
