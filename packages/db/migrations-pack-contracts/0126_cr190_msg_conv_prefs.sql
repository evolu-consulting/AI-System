-- CR-190 · «Tin nhắn» ghim + «đánh dấu chưa đọc» LƯU THEO NGƯỜI trên máy chủ (BR-190-6, BR-190-8), cho CẢ hai nguồn hội thoại:
-- `internal` = `contracts.msg_conversations` (1-1 / nhóm) và `partner` = `hub.pmsg_threads` (đối tác; nằm ở schema hub nên KHÔNG FK được ⇒ một bảng đa hình + CHECK).
-- Nguồn duy nhất: ghim = `pinned_at`; «đánh dấu chưa đọc» = CỜ `marked_unread_at` riêng, KHÔNG đụng `last_read_seq` / mốc đọc đối tác (số chưa đọc thật vẫn tính từ tin).
-- Cờ tự xoá khi người dùng mở cuộc (use case xoá lúc «đã đọc»). Hàng không còn gì để nhớ (cả hai cột NULL) bị xoá — không để hàng rỗng.
-- CHỈ THÊM, chạy lại được. RLS: policy tenant (secure_table) + RESTRICTIVE «chỉ chính chủ» (user_id = app.user_id) + chỉ người nội bộ; ghim cuộc `internal` còn phải là thành viên.
CREATE TABLE IF NOT EXISTS contracts.msg_conv_prefs (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conv_kind text NOT NULL,
  conv_id uuid NOT NULL,
  pinned_at timestamptz,
  marked_unread_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_conv_prefs_pkey PRIMARY KEY (tenant_id, user_id, conv_kind, conv_id),
  CONSTRAINT msg_conv_prefs_kind_ck CHECK (conv_kind IN ('internal', 'partner'))
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'msg_conv_prefs');
--> statement-breakpoint
DROP POLICY IF EXISTS msg_conv_prefs_own_sel ON contracts.msg_conv_prefs;
--> statement-breakpoint
CREATE POLICY msg_conv_prefs_own_sel ON contracts.msg_conv_prefs AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS msg_conv_prefs_own_ins ON contracts.msg_conv_prefs;
--> statement-breakpoint
CREATE POLICY msg_conv_prefs_own_ins ON contracts.msg_conv_prefs AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (conv_kind <> 'internal' OR conv_id = ANY ((SELECT contracts.msg_my_conversations())::uuid[])));
--> statement-breakpoint
DROP POLICY IF EXISTS msg_conv_prefs_own_upd ON contracts.msg_conv_prefs;
--> statement-breakpoint
CREATE POLICY msg_conv_prefs_own_upd ON contracts.msg_conv_prefs AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS msg_conv_prefs_own_del ON contracts.msg_conv_prefs;
--> statement-breakpoint
CREATE POLICY msg_conv_prefs_own_del ON contracts.msg_conv_prefs AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- Hàm hub mới (hub 0166) cho cờ «chưa đọc» của cuộc `partner`: migration hub chạy TRƯỚC khi role gói có trên DB dựng sạch ⇒ cấp lại ở đây, không điều kiện (khuôn 0118/0120). Chạy lại vô hại.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.pmsg_inbox_unread(uuid, timestamptz, uuid, integer, uuid[]), hub.pmsg_flagged_idle(uuid[]) TO contracts_rw;
