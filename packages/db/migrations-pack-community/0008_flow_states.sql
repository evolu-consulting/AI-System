-- CR-120 · cr120-community-flows · spec §3 (community 0008) + §6: trạng thái 3 khe Community chạy theo flow tại gói.
-- (1) `posts.moderation` (`none|pending|approved|rejected`, mặc định `none` ⇒ bài cũ không đổi) + kết quả agent `screen` + quyết định
--     duyệt. RLS RESTRICTIVE `posts_moderation`: bài `pending/rejected` chỉ chủ quản (người duyệt) + CHÍNH người đăng thấy; đối tác
--     khác/đồng nghiệp đối tác không thấy. Trigger chặn người xem đối tác tự đổi cột duyệt.
-- (2) `join_requests` (đối tác xin tham gia: form → tenant admin duyệt → liên kết `partner_companies`), một yêu cầu đang chờ mỗi
--     công ty (unique partial ⇒ 409).
-- (3) `reports` (báo cáo vi phạm: agent `triage` → điều phối viên → ẩn/cảnh báo/bỏ qua), trùng (người × bài) ⇒ 409.
-- Chỉ THÊM cột/bảng; ADD COLUMN có DEFAULT hằng không viết lại bảng.
ALTER TABLE community.posts
  ADD COLUMN IF NOT EXISTS moderation text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS mod_screen text,
  ADD COLUMN IF NOT EXISTS mod_reason text,
  ADD COLUMN IF NOT EXISTS mod_task_id uuid,
  ADD COLUMN IF NOT EXISTS mod_at timestamptz,
  ADD COLUMN IF NOT EXISTS mod_screened_at timestamptz,
  ADD COLUMN IF NOT EXISTS mod_decided_by uuid,
  ADD COLUMN IF NOT EXISTS mod_decided_name text,
  ADD COLUMN IF NOT EXISTS mod_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS mod_feedback text;
--> statement-breakpoint
ALTER TABLE community.posts DROP CONSTRAINT IF EXISTS posts_moderation_ck;
--> statement-breakpoint
ALTER TABLE community.posts ADD CONSTRAINT posts_moderation_ck CHECK (
  moderation IN ('none', 'pending', 'approved', 'rejected')
  AND (mod_screen IS NULL OR mod_screen IN ('running', 'clean', 'flagged', 'error'))
  AND (mod_reason IS NULL OR char_length(mod_reason) <= 1000)
  AND (mod_feedback IS NULL OR char_length(mod_feedback) <= 4000)
  AND (mod_decided_name IS NULL OR char_length(mod_decided_name) <= 200));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS posts_mod_queue_idx ON community.posts (tenant_id, mod_at) WHERE moderation = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS posts_mod_mine_idx ON community.posts (tenant_id, author_user_id, created_at DESC) WHERE moderation <> 'none';
--> statement-breakpoint
DROP POLICY IF EXISTS posts_moderation ON community.posts;
--> statement-breakpoint
CREATE POLICY posts_moderation ON community.posts AS RESTRICTIVE FOR SELECT TO community_rw
  USING (moderation IN ('none', 'approved')
    OR (SELECT packs.viewer_ext_org()) IS NULL
    OR author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- Người xem đối tác không đổi trạng thái duyệt (kể cả bài của mình) trừ MỞ/MỞ LẠI lượt (đăng, sửa nội dung); chủ quản/việc nền: được.
CREATE OR REPLACE FUNCTION community.posts_moderation_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.moderation, NEW.mod_screen, NEW.mod_decided_by, NEW.mod_task_id)
     IS DISTINCT FROM (OLD.moderation, OLD.mod_screen, OLD.mod_decided_by, OLD.mod_task_id)
     AND (SELECT packs.viewer_ext_org()) IS NOT NULL
     -- ngoại lệ DUY NHẤT: MỞ/MỞ LẠI lượt duyệt (none|approved|rejected → pending/running, chưa ai quyết) trong tx đăng/sửa bài của chính người đăng
     AND NOT (OLD.moderation IN ('none', 'approved', 'rejected') AND NEW.moderation = 'pending' AND NEW.mod_screen = 'running'
       AND NEW.mod_decided_by IS NULL) THEN
    RAISE EXCEPTION 'moderation is host-only' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS posts_moderation_guard ON community.posts;
--> statement-breakpoint
CREATE TRIGGER posts_moderation_guard BEFORE UPDATE ON community.posts
  FOR EACH ROW EXECUTE FUNCTION community.posts_moderation_guard();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS community.join_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  requester_user_id uuid NOT NULL,
  requester_org uuid NOT NULL,
  company text NOT NULL,
  contact text NOT NULL,
  email text NOT NULL,
  reason text NOT NULL DEFAULT '',
  labels text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  task_id uuid NOT NULL DEFAULT gen_random_uuid(),
  decided_by uuid,
  decided_name text,
  decided_at timestamptz,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT join_requests_pkey PRIMARY KEY (id),
  CONSTRAINT join_requests_status_ck CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT join_requests_labels_ck CHECK (labels <@ ARRAY['supplier', 'buyer']::text[]),
  CONSTRAINT join_requests_text_ck CHECK (char_length(company) BETWEEN 1 AND 200 AND char_length(contact) BETWEEN 1 AND 200
    AND char_length(email) BETWEEN 3 AND 200 AND char_length(reason) <= 2000
    AND (feedback IS NULL OR char_length(feedback) <= 4000) AND (decided_name IS NULL OR char_length(decided_name) <= 200))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS join_requests_pending_uq ON community.join_requests (tenant_id, requester_org)
  WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS join_requests_list_idx ON community.join_requests (tenant_id, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS community.reports (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  reporter_user_id uuid NOT NULL,
  reporter_org uuid,
  reason text NOT NULL,
  triage text NOT NULL DEFAULT 'running',
  triage_kind text,
  triage_level text,
  status text NOT NULL DEFAULT 'pending',
  action text,
  task_id uuid NOT NULL DEFAULT gen_random_uuid(),
  decided_by uuid,
  decided_name text,
  decided_at timestamptz,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_once_uq UNIQUE (tenant_id, reporter_user_id, post_id),
  CONSTRAINT reports_post_fk FOREIGN KEY (post_id, tenant_id) REFERENCES community.posts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT reports_state_ck CHECK (triage IN ('running', 'done', 'error') AND status IN ('pending', 'resolved')
    AND (action IS NULL OR action IN ('hide', 'warn', 'dismiss')) AND ((status = 'resolved') = (action IS NOT NULL))
    AND (triage_kind IS NULL OR triage_kind IN ('spam', 'abuse', 'contact', 'fraud', 'other'))
    AND (triage_level IS NULL OR triage_level IN ('low', 'medium', 'high'))),
  CONSTRAINT reports_text_ck CHECK (char_length(reason) BETWEEN 1 AND 1000
    AND (feedback IS NULL OR char_length(feedback) <= 4000) AND (decided_name IS NULL OR char_length(decided_name) <= 200))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reports_list_idx ON community.reports (tenant_id, status, created_at DESC);
--> statement-breakpoint
SELECT packs.secure_table('community', 'join_requests');
--> statement-breakpoint
SELECT packs.secure_table('community', 'reports');
--> statement-breakpoint
REVOKE DELETE ON community.join_requests, community.reports FROM community_rw;
--> statement-breakpoint
-- ---- join_requests: chủ quản thấy + quyết; đối tác: chỉ yêu cầu của công ty mình, chỉ tạo dưới tên mình, không sửa.
CREATE POLICY join_requests_visible ON community.join_requests AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR requester_org = (SELECT packs.viewer_ext_org()));
--> statement-breakpoint
CREATE POLICY join_requests_insert ON community.join_requests AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR (requester_org = (SELECT packs.viewer_ext_org())
      AND requester_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND status = 'pending'));
--> statement-breakpoint
CREATE POLICY join_requests_update ON community.join_requests AS RESTRICTIVE FOR UPDATE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL) WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL);
--> statement-breakpoint
-- ---- reports: chủ quản thấy + quyết; người báo cáo thấy báo cáo của CHÍNH mình; tạo chỉ trên bài mình thấy.
CREATE POLICY reports_visible ON community.reports AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL
    OR (reporter_org = (SELECT packs.viewer_ext_org())
      AND reporter_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY reports_insert ON community.reports AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR (reporter_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())
      AND reporter_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND status = 'pending'
      AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = reports.post_id AND p.tenant_id = reports.tenant_id)));
--> statement-breakpoint
CREATE POLICY reports_update ON community.reports AS RESTRICTIVE FOR UPDATE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL) WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL);
