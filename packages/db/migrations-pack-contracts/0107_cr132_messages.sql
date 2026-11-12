-- CR-132 M1 · Tin nhắn giữa nhân viên trong Sổ Hợp Tác (1-1 + nhóm). Nguồn duy nhất: tin = msg_messages; đã đọc = msg_members.last_read_seq;
-- số chưa đọc KHÔNG lưu (luôn tính). `last_seq/last_at` là bộ đếm cấp seq (ghi trong CÙNG câu chèn tin), không phải bản sao.
-- Không FK sang admin.* (luật pack-sql). Mỗi bảng: policy tenant (packs.secure_table) + policy RESTRICTIVE «thành viên hội thoại» + chỉ người nội bộ.
CREATE TABLE IF NOT EXISTS contracts.msg_conversations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text,
  dm_key text,
  created_by uuid NOT NULL DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seq bigint NOT NULL DEFAULT 0,
  last_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_conversations_pkey PRIMARY KEY (tenant_id, id),
  CONSTRAINT msg_conversations_kind_ck CHECK (kind IN ('direct', 'group')),
  CONSTRAINT msg_conversations_shape_ck CHECK (
    (kind = 'direct' AND dm_key IS NOT NULL AND title IS NULL)
    OR (kind = 'group' AND dm_key IS NULL AND title IS NOT NULL AND char_length(title) BETWEEN 1 AND 80)),
  CONSTRAINT msg_conversations_seq_ck CHECK (last_seq >= 0),
  CONSTRAINT msg_conversations_dm_uq UNIQUE (tenant_id, dm_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS msg_conversations_recent_idx ON contracts.msg_conversations (tenant_id, last_at DESC, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.msg_members (
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_read_seq bigint NOT NULL DEFAULT 0,
  CONSTRAINT msg_members_pkey PRIMARY KEY (tenant_id, conversation_id, user_id),
  CONSTRAINT msg_members_role_ck CHECK (role IN ('owner', 'member')),
  CONSTRAINT msg_members_read_ck CHECK (last_read_seq >= 0),
  CONSTRAINT msg_members_conv_fk FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES contracts.msg_conversations (tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS msg_members_user_idx ON contracts.msg_members (tenant_id, user_id, conversation_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.msg_messages (
  tenant_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  seq bigint NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  client_id uuid NOT NULL,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT msg_messages_pkey PRIMARY KEY (tenant_id, conversation_id, seq),
  CONSTRAINT msg_messages_client_uq UNIQUE (tenant_id, conversation_id, sender_id, client_id),
  CONSTRAINT msg_messages_id_uq UNIQUE (tenant_id, id),
  CONSTRAINT msg_messages_seq_ck CHECK (seq >= 1),
  CONSTRAINT msg_messages_body_ck CHECK (char_length(body) <= 4000),
  CONSTRAINT msg_messages_conv_fk FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES contracts.msg_conversations (tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- Tệp đính kèm tin: byte ở `contracts.files` (FileBox). seq NULL = đã tải lên, chưa gửi. Thu hồi tin KHÔNG xoá hàng này (tệp vẫn thuộc hội thoại
-- để policy `contracts.files` (0108) còn chặn người ngoài; tệp đã đánh dấu `files.deleted_at`).
CREATE TABLE IF NOT EXISTS contracts.msg_files (
  tenant_id uuid NOT NULL,
  file_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  seq bigint,
  uploaded_by uuid NOT NULL,
  CONSTRAINT msg_files_pkey PRIMARY KEY (tenant_id, file_id),
  CONSTRAINT msg_files_file_fk FOREIGN KEY (file_id, tenant_id) REFERENCES contracts.files (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT msg_files_conv_fk FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES contracts.msg_conversations (tenant_id, id) ON DELETE CASCADE,
  -- seq NULL ⇒ FK không kiểm (MATCH SIMPLE); đã gửi ⇒ phải trỏ đúng tin của đúng hội thoại.
  CONSTRAINT msg_files_msg_fk FOREIGN KEY (tenant_id, conversation_id, seq)
    REFERENCES contracts.msg_messages (tenant_id, conversation_id, seq) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS msg_files_conv_idx ON contracts.msg_files (tenant_id, conversation_id, seq);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'msg_conversations');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'msg_members');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'msg_messages');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'msg_files');
--> statement-breakpoint
GRANT USAGE ON SCHEMA packs TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.viewer_ext_org() TO contracts_rw;
--> statement-breakpoint
-- Hàm cho policy (SECURITY DEFINER = chủ migration, không chịu FORCE RLS ⇒ không đệ quy qua policy của chính msg_members; cùng khuôn
-- `community_partners` 0103). Tenant lấy từ GUC (KHÔNG từ tham số) + lọc tường minh ⇒ không đọc chéo tenant; không user (việc nền) ⇒ rỗng.
CREATE OR REPLACE FUNCTION contracts.msg_my_conversations() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(m.conversation_id), '{}'::uuid[]) FROM contracts.msg_members m
  WHERE m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
-- «Tôi vừa tạo hội thoại này và nó còn TRỐNG thành viên» ⇒ cho phép chèn lô thành viên đầu tiên (người tạo chưa là thành viên nên không qua
-- được luật thành viên). Chặt hơn «created_by = tôi» đơn thuần: người tạo đã bị bớt/đã rời không tự chèn lại mình được.
CREATE OR REPLACE FUNCTION contracts.msg_created_by_me(cid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM contracts.msg_conversations c
      WHERE c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND c.id = cid
        AND c.created_by = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND NOT EXISTS (SELECT 1 FROM contracts.msg_members m
      WHERE m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND m.conversation_id = cid)
$$;
--> statement-breakpoint
-- Người cuối rời nhóm ⇒ xoá hội thoại (CASCADE: thành viên/tin/liên kết tệp) và đánh dấu xoá tệp của nó (`files.deleted_at`; byte ở FileBox do
-- use case gỡ). CHỈ khi hội thoại không còn thành viên nào (thành viên không gọi để xoá hội thoại đang dùng); người gọi phải là nhân viên nội bộ.
-- Trả true nếu đã xoá. Bảng `msg_conversations` không cấp DELETE cho role gói — đây là đường xoá duy nhất.
CREATE OR REPLACE FUNCTION contracts.msg_drop_if_empty(cid uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  t uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  n int;
BEGIN
  IF t IS NULL OR NULLIF(current_setting('app.user_id', true), '') IS NULL OR packs.viewer_ext_org() IS NOT NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM contracts.msg_members m WHERE m.tenant_id = t AND m.conversation_id = cid) THEN
    RETURN false;
  END IF;
  UPDATE contracts.files f SET deleted_at = now()
    FROM contracts.msg_files mf
    WHERE mf.tenant_id = t AND mf.conversation_id = cid AND f.tenant_id = t AND f.id = mf.file_id AND f.deleted_at IS NULL;
  DELETE FROM contracts.msg_conversations c WHERE c.tenant_id = t AND c.id = cid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.msg_my_conversations(), contracts.msg_created_by_me(uuid), contracts.msg_drop_if_empty(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.msg_my_conversations(), contracts.msg_created_by_me(uuid), contracts.msg_drop_if_empty(uuid) TO contracts_rw;
--> statement-breakpoint
-- ===== Policy RESTRICTIVE (AND với policy tenant). Mọi policy: chỉ người nội bộ (`viewer_ext_org() IS NULL`). Quyền chi tiết (chủ nhóm,
-- thu hồi) ở use case; RLS là lưới chặn cuối = tenant + thành viên. DELETE `USING (false)` = không cấp (CASCADE của FK bỏ qua RLS). =====
-- msg_conversations
DROP POLICY IF EXISTS msg_conversations_sel ON contracts.msg_conversations;
--> statement-breakpoint
CREATE POLICY msg_conversations_sel ON contracts.msg_conversations AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_conversations_ins ON contracts.msg_conversations;
--> statement-breakpoint
CREATE POLICY msg_conversations_ins ON contracts.msg_conversations AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS msg_conversations_upd ON contracts.msg_conversations;
--> statement-breakpoint
CREATE POLICY msg_conversations_upd ON contracts.msg_conversations AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND id = ANY ((SELECT contracts.msg_my_conversations())))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_conversations_del ON contracts.msg_conversations;
--> statement-breakpoint
CREATE POLICY msg_conversations_del ON contracts.msg_conversations AS RESTRICTIVE FOR DELETE TO contracts_rw USING (false);
--> statement-breakpoint
-- msg_members
DROP POLICY IF EXISTS msg_members_sel ON contracts.msg_members;
--> statement-breakpoint
CREATE POLICY msg_members_sel ON contracts.msg_members AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_members_ins ON contracts.msg_members;
--> statement-breakpoint
CREATE POLICY msg_members_ins ON contracts.msg_members AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL
    AND (conversation_id = ANY ((SELECT contracts.msg_my_conversations())) OR contracts.msg_created_by_me(conversation_id)));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_members_upd ON contracts.msg_members;
--> statement-breakpoint
CREATE POLICY msg_members_upd ON contracts.msg_members AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_members_del ON contracts.msg_members;
--> statement-breakpoint
CREATE POLICY msg_members_del ON contracts.msg_members AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
-- msg_messages: ghi chỉ khi là thành viên VÀ là người gửi (thu hồi = UPDATE của người gửi); không DELETE.
DROP POLICY IF EXISTS msg_messages_sel ON contracts.msg_messages;
--> statement-breakpoint
CREATE POLICY msg_messages_sel ON contracts.msg_messages AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_messages_ins ON contracts.msg_messages;
--> statement-breakpoint
CREATE POLICY msg_messages_ins ON contracts.msg_messages AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations()))
    AND sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS msg_messages_upd ON contracts.msg_messages;
--> statement-breakpoint
CREATE POLICY msg_messages_upd ON contracts.msg_messages AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations()))
    AND sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations()))
    AND sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS msg_messages_del ON contracts.msg_messages;
--> statement-breakpoint
CREATE POLICY msg_messages_del ON contracts.msg_messages AS RESTRICTIVE FOR DELETE TO contracts_rw USING (false);
--> statement-breakpoint
-- msg_files
DROP POLICY IF EXISTS msg_files_sel ON contracts.msg_files;
--> statement-breakpoint
CREATE POLICY msg_files_sel ON contracts.msg_files AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_files_ins ON contracts.msg_files;
--> statement-breakpoint
CREATE POLICY msg_files_ins ON contracts.msg_files AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations()))
    AND uploaded_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS msg_files_upd ON contracts.msg_files;
--> statement-breakpoint
CREATE POLICY msg_files_upd ON contracts.msg_files AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND conversation_id = ANY ((SELECT contracts.msg_my_conversations())));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_files_del ON contracts.msg_files;
--> statement-breakpoint
CREATE POLICY msg_files_del ON contracts.msg_files AS RESTRICTIVE FOR DELETE TO contracts_rw USING (false);
