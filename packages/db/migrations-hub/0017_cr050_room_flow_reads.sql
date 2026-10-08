-- HUB-FR-100 · HUB-FR-101 · CR-050: mốc đã đọc theo từng thread của phòng (highlight comment chưa xem trên khối agent).
-- Một hàng / (phòng, thread, người). Chỉ tăng (app dùng greatest). RLS: chỉ hub_rw, scope user, đúng tenant, CHỈ hàng của
-- chính mình, còn là thành viên; ghi thêm điều kiện thread thuộc phòng (`hub.is_room_thread`). Không DELETE/TRUNCATE.
-- Không đụng `room_members` (giả định 1 policy UPDATE của `room_members_guard`, 0013 N4b giữ nguyên).
-- Backfill: thành viên hiện tại × thread hiện có ⇒ mốc = seq lớn nhất của thread (comment cũ không bị coi là mới).
CREATE TABLE IF NOT EXISTS hub.room_flow_reads (
  room_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_seq bigint NOT NULL DEFAULT 0,
  CONSTRAINT room_flow_reads_pkey PRIMARY KEY (room_id, flow_id, user_id),
  CONSTRAINT room_flow_reads_room_fk FOREIGN KEY (room_id, tenant_id) REFERENCES hub.rooms (id, tenant_id),
  CONSTRAINT room_flow_reads_flow_fk FOREIGN KEY (flow_id) REFERENCES hub.flows (id),
  CONSTRAINT room_flow_reads_seq_ck CHECK (last_read_seq >= 0)
);
--> statement-breakpoint
ALTER TABLE hub.room_flow_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_flow_reads'
                 AND policyname = 'room_flow_reads_select') THEN
    CREATE POLICY room_flow_reads_select ON hub.room_flow_reads FOR SELECT TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND hub.is_room_member(room_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_flow_reads'
                 AND policyname = 'room_flow_reads_insert') THEN
    CREATE POLICY room_flow_reads_insert ON hub.room_flow_reads FOR INSERT TO hub_rw
      WITH CHECK (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND hub.is_room_thread(room_id, flow_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'room_flow_reads'
                 AND policyname = 'room_flow_reads_update') THEN
    CREATE POLICY room_flow_reads_update ON hub.room_flow_reads FOR UPDATE TO hub_rw
      USING (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND hub.is_room_member(room_id))
      WITH CHECK (current_setting('app.scope', true) = 'user'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
             AND hub.is_room_thread(room_id, flow_id));
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE (last_read_seq) ON hub.room_flow_reads TO hub_rw;
--> statement-breakpoint
INSERT INTO hub.room_flow_reads (room_id, tenant_id, flow_id, user_id, last_read_seq)
SELECT t.room_id, t.tenant_id, t.flow_id, mb.user_id, t.max_seq
FROM (
  SELECT m.room_id, m.tenant_id, m.flow_id, max(m.seq) AS max_seq
  FROM hub.room_messages m
  WHERE m.flow_id IS NOT NULL
  GROUP BY m.room_id, m.tenant_id, m.flow_id
) t
JOIN hub.room_members mb ON mb.room_id = t.room_id AND mb.tenant_id = t.tenant_id AND mb.left_at IS NULL
ON CONFLICT (room_id, flow_id, user_id) DO NOTHING;
