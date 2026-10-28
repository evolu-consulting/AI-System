-- CR-102 · com-c3-community-base · docs/current/community/nghiep-vu.md §2–7, hien-thi.md: gói `community` (bảng tin chủ quản ↔
-- đối tác, mạng hình sao). Người xem = `packs.viewer_ext_org()` (kit 0006): NULL = chủ quản/việc nền (thấy cả tenant), uuid = công
-- ty đối tác, nil = bị từ chối. Mỗi bảng: policy tenant của `packs.secure_table` + policy RESTRICTIVE theo người xem (D2, D3).
-- Nội dung đối tác lưu raw + masked + hits (D4, che lúc ghi); route chọn cột theo người xem. Xoá bài = xoá cứng (cascade).
SELECT packs.install('community');
--> statement-breakpoint
GRANT USAGE ON SCHEMA packs TO community_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.viewer_ext_org() TO community_rw;
--> statement-breakpoint
-- Nhãn + nhóm hàng + liên kết đối tác SHT của công ty đối tác (Community › Đối tác, chỉ Admin chủ quản). Không xoá (Câu 9).
CREATE TABLE IF NOT EXISTS community.partner_companies (
  tenant_id uuid NOT NULL,
  ext_org_id uuid NOT NULL,
  labels text[] NOT NULL DEFAULT '{}',
  cats text[] NOT NULL DEFAULT '{}',
  area text NOT NULL DEFAULT '',
  party_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT partner_companies_pkey PRIMARY KEY (tenant_id, ext_org_id),
  CONSTRAINT partner_companies_labels_ck CHECK (labels <@ ARRAY['supplier', 'buyer']::text[]),
  CONSTRAINT partner_companies_cats_ck CHECK (cardinality(cats) <= 50),
  CONSTRAINT partner_companies_area_ck CHECK (char_length(area) <= 100),
  CONSTRAINT partner_companies_party_ck CHECK (party_key IS NULL OR char_length(party_key) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS community.posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  type text NOT NULL,
  author_user_id uuid NOT NULL,
  author_name text NOT NULL DEFAULT '',
  -- NULL = chủ quản đăng; uuid = công ty đối tác (admin.external_orgs.id).
  author_org uuid,
  status text NOT NULL DEFAULT 'active',
  hidden boolean NOT NULL DEFAULT false,
  edited boolean NOT NULL DEFAULT false,
  title_raw text NOT NULL DEFAULT '',
  title_masked text NOT NULL DEFAULT '',
  body_raw text NOT NULL DEFAULT '',
  body_masked text NOT NULL DEFAULT '',
  fields_raw jsonb NOT NULL DEFAULT '{}',
  fields_masked jsonb NOT NULL DEFAULT '{}',
  hits jsonb NOT NULL DEFAULT '[]',
  cats text[] NOT NULL DEFAULT '{}',
  -- D2: người xem bài chủ quản (bài đối tác: NULL — chỉ chủ quản thấy).
  aud_mode text,
  aud_cats text[] NOT NULL DEFAULT '{}',
  aud_orgs uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT posts_type_ck CHECK (type IN ('sell', 'buy', 'note')),
  CONSTRAINT posts_status_ck CHECK (status IN ('active', 'archived', 'done')),
  CONSTRAINT posts_aud_ck CHECK ((author_org IS NULL) = (aud_mode IS NOT NULL)
    AND (aud_mode IS NULL OR aud_mode IN ('all', 'suppliers', 'buyers', 'cats', 'companies'))),
  CONSTRAINT posts_partner_note_ck CHECK (author_org IS NULL OR type <> 'note'),
  CONSTRAINT posts_text_ck CHECK (char_length(title_raw) <= 400 AND char_length(title_masked) <= 2000
    AND char_length(body_raw) <= 10000 AND char_length(body_masked) <= 40000 AND char_length(author_name) <= 200),
  CONSTRAINT posts_cats_ck CHECK (cardinality(cats) <= 10 AND cardinality(aud_cats) <= 50 AND cardinality(aud_orgs) <= 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS posts_feed_idx ON community.posts (tenant_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS posts_author_org_idx ON community.posts (tenant_id, author_org, created_at DESC);
--> statement-breakpoint
-- Mặt hàng của bài (R26; `origin_ref` = bài + mặt hàng ở C7). GĐ1: một mặt hàng lấy từ `fields`.
CREATE TABLE IF NOT EXISTS community.post_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  position smallint NOT NULL DEFAULT 0,
  product text NOT NULL,
  qty text NOT NULL DEFAULT '',
  price text,
  CONSTRAINT post_items_pkey PRIMARY KEY (id),
  CONSTRAINT post_items_ck CHECK (char_length(product) BETWEEN 1 AND 400 AND char_length(qty) <= 200
    AND (price IS NULL OR char_length(price) <= 200) AND position BETWEEN 0 AND 49),
  CONSTRAINT post_items_post_fk FOREIGN KEY (post_id, tenant_id)
    REFERENCES community.posts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS post_items_post_idx ON community.post_items (post_id, position);
--> statement-breakpoint
-- Tham chiếu ảnh/video của bài (tải lên Filebox: lát sau; GĐ này chỉ nhãn + url).
CREATE TABLE IF NOT EXISTS community.media (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  position smallint NOT NULL DEFAULT 0,
  kind text NOT NULL,
  label text NOT NULL DEFAULT '',
  url text,
  file_id uuid,
  CONSTRAINT media_pkey PRIMARY KEY (id),
  CONSTRAINT media_ck CHECK (kind IN ('image', 'video') AND char_length(label) <= 200
    AND (url IS NULL OR char_length(url) <= 2000) AND position BETWEEN 0 AND 11),
  CONSTRAINT media_post_fk FOREIGN KEY (post_id, tenant_id)
    REFERENCES community.posts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS media_post_idx ON community.media (post_id, position);
--> statement-breakpoint
-- D3: một luồng riêng mỗi (bài × công ty đối tác).
CREATE TABLE IF NOT EXISTS community.threads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  ext_org_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT threads_pkey PRIMARY KEY (id),
  CONSTRAINT threads_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT threads_post_org_uq UNIQUE (post_id, ext_org_id),
  CONSTRAINT threads_post_fk FOREIGN KEY (post_id, tenant_id)
    REFERENCES community.posts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS community.comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  -- = threads.ext_org_id (chép để policy không cần join luồng).
  thread_org uuid NOT NULL,
  author_user_id uuid NOT NULL,
  author_name text NOT NULL DEFAULT '',
  author_org uuid,
  text_raw text NOT NULL,
  text_masked text NOT NULL,
  hits jsonb NOT NULL DEFAULT '[]',
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_pkey PRIMARY KEY (id),
  CONSTRAINT comments_text_ck CHECK (char_length(text_raw) BETWEEN 1 AND 4000 AND char_length(text_masked) <= 16000
    AND char_length(author_name) <= 200),
  CONSTRAINT comments_author_ck CHECK (author_org IS NULL OR author_org = thread_org),
  CONSTRAINT comments_thread_fk FOREIGN KEY (thread_id, tenant_id)
    REFERENCES community.threads (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT comments_post_fk FOREIGN KEY (post_id, tenant_id)
    REFERENCES community.posts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS comments_post_idx ON community.comments (post_id, thread_org, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS comments_thread_idx ON community.comments (thread_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS community.settings (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  accent text NOT NULL DEFAULT 'indigo',
  notify jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settings_pkey PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT settings_accent_ck CHECK (accent IN ('indigo', 'blue', 'teal', 'green', 'orange'))
);
--> statement-breakpoint
SELECT packs.secure_table('community', 'partner_companies');
--> statement-breakpoint
SELECT packs.secure_table('community', 'posts');
--> statement-breakpoint
SELECT packs.secure_table('community', 'post_items');
--> statement-breakpoint
SELECT packs.secure_table('community', 'media');
--> statement-breakpoint
SELECT packs.secure_table('community', 'threads');
--> statement-breakpoint
SELECT packs.secure_table('community', 'comments');
--> statement-breakpoint
SELECT packs.secure_table('community', 'settings');
--> statement-breakpoint
REVOKE DELETE ON community.partner_companies FROM community_rw;
--> statement-breakpoint
-- Nhãn + nhóm hàng của CHÍNH công ty người xem (đối tác); chủ quản/không có hàng ⇒ rỗng. INVOKER: đọc dưới RLS.
CREATE OR REPLACE FUNCTION community.viewer_labels() RETURNS text[]
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT pc.labels FROM community.partner_companies pc
    WHERE pc.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND pc.ext_org_id = packs.viewer_ext_org()), '{}'::text[])
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION community.viewer_cats() RETURNS text[]
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT pc.cats FROM community.partner_companies pc
    WHERE pc.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND pc.ext_org_id = packs.viewer_ext_org()), '{}'::text[])
$$;
--> statement-breakpoint
-- D2 (trùng `domain/audience.rules.ts`): cats rỗng ⇒ nhóm hàng của bài; Cần bán ⇒ cần nhãn buyer, Cần mua ⇒ supplier.
CREATE OR REPLACE FUNCTION community.audience_ok(
  p_mode text, p_cats text[], p_orgs uuid[], p_type text, p_post_cats text[],
  v_org uuid, v_labels text[], v_cats text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p_mode
    WHEN 'all' THEN true
    WHEN 'suppliers' THEN 'supplier' = ANY (v_labels)
    WHEN 'buyers' THEN 'buyer' = ANY (v_labels)
    WHEN 'companies' THEN v_org = ANY (p_orgs)
    WHEN 'cats' THEN (CASE WHEN cardinality(p_cats) > 0 THEN p_cats ELSE p_post_cats END) && v_cats
      AND CASE p_type WHEN 'sell' THEN 'buyer' = ANY (v_labels)
                      WHEN 'buy' THEN 'supplier' = ANY (v_labels) ELSE true END
    ELSE false
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION community.viewer_labels(), community.viewer_cats(),
  community.audience_ok(text, text[], uuid[], text, text[], uuid, text[], text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION community.viewer_labels(), community.viewer_cats(),
  community.audience_ok(text, text[], uuid[], text, text[], uuid, text[], text[]) TO community_rw;
--> statement-breakpoint
-- ---- partner_companies: chủ quản thấy hết + ghi; đối tác chỉ thấy hàng của công ty mình, không ghi.
CREATE POLICY partner_companies_viewer ON community.partner_companies AS RESTRICTIVE FOR ALL TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR ext_org_id = (SELECT packs.viewer_ext_org()))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL);
--> statement-breakpoint
-- ---- posts: chủ quản thấy hết (mọi trạng thái); đối tác: bài của công ty mình (kể cả bị ẩn — Chưa rõ #1) + bài chủ quản
-- đang hiệu lực (active, chưa hết hạn, không ẩn) có audience gồm mình (D2). Bài đối tác khác: không bao giờ.
CREATE POLICY posts_visible ON community.posts AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL
    OR author_org = (SELECT packs.viewer_ext_org())
    OR (author_org IS NULL AND status = 'active' AND NOT hidden AND expires_at > now()
      AND (SELECT packs.viewer_ext_org()) <> '00000000-0000-0000-0000-000000000000'::uuid
      AND community.audience_ok(aud_mode, aud_cats, aud_orgs, type, cats, (SELECT packs.viewer_ext_org()),
        (SELECT community.viewer_labels()), (SELECT community.viewer_cats()))));
--> statement-breakpoint
-- Ghi: người dùng chỉ đăng dưới tên bên mình (chủ quản ⇒ author_org NULL; đối tác ⇒ công ty mình); việc nền không user: tự do.
CREATE POLICY posts_insert ON community.posts AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org()));
--> statement-breakpoint
CREATE POLICY posts_update ON community.posts AS RESTRICTIVE FOR UPDATE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR author_org = (SELECT packs.viewer_ext_org()))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL OR author_org = (SELECT packs.viewer_ext_org()));
--> statement-breakpoint
CREATE POLICY posts_delete ON community.posts AS RESTRICTIVE FOR DELETE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR author_org = (SELECT packs.viewer_ext_org()));
--> statement-breakpoint
-- ---- post_items / media: đọc theo bài (RLS của posts áp bên trong EXISTS); ghi chỉ trên bài của bên mình.
CREATE POLICY post_items_visible ON community.post_items AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = post_items.post_id AND p.tenant_id = post_items.tenant_id));
--> statement-breakpoint
CREATE POLICY post_items_insert ON community.post_items AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = post_items.post_id AND p.tenant_id = post_items.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));
--> statement-breakpoint
CREATE POLICY post_items_update ON community.post_items AS RESTRICTIVE FOR UPDATE TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = post_items.post_id AND p.tenant_id = post_items.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));
--> statement-breakpoint
CREATE POLICY post_items_delete ON community.post_items AS RESTRICTIVE FOR DELETE TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = post_items.post_id AND p.tenant_id = post_items.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));
--> statement-breakpoint
CREATE POLICY media_visible ON community.media AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = media.post_id AND p.tenant_id = media.tenant_id));
--> statement-breakpoint
CREATE POLICY media_insert ON community.media AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = media.post_id AND p.tenant_id = media.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));
--> statement-breakpoint
CREATE POLICY media_update ON community.media AS RESTRICTIVE FOR UPDATE TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = media.post_id AND p.tenant_id = media.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));
--> statement-breakpoint
CREATE POLICY media_delete ON community.media AS RESTRICTIVE FOR DELETE TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = '' OR EXISTS (SELECT 1 FROM community.posts p
    WHERE p.id = media.post_id AND p.tenant_id = media.tenant_id
      AND p.author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())));
--> statement-breakpoint
-- ---- threads (D3): đối tác chỉ luồng của công ty mình trên bài mình thấy; chủ quản mọi luồng.
CREATE POLICY threads_visible ON community.threads AS RESTRICTIVE FOR ALL TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (ext_org_id = (SELECT packs.viewer_ext_org())
    AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = threads.post_id AND p.tenant_id = threads.tenant_id)))
  WITH CHECK (((SELECT packs.viewer_ext_org()) IS NULL OR ext_org_id = (SELECT packs.viewer_ext_org()))
    AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = threads.post_id AND p.tenant_id = threads.tenant_id));
--> statement-breakpoint
-- ---- comments: đối tác thấy bình luận của luồng công ty mình, không bị ẩn (Chưa rõ #2), trên bài mình thấy.
CREATE POLICY comments_visible ON community.comments AS RESTRICTIVE FOR SELECT TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (thread_org = (SELECT packs.viewer_ext_org()) AND NOT hidden
    AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id)));
--> statement-breakpoint
CREATE POLICY comments_insert ON community.comments AS RESTRICTIVE FOR INSERT TO community_rw
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR (author_org IS NOT DISTINCT FROM (SELECT packs.viewer_ext_org())
      AND ((SELECT packs.viewer_ext_org()) IS NULL OR thread_org = (SELECT packs.viewer_ext_org()))
      AND EXISTS (SELECT 1 FROM community.posts p WHERE p.id = comments.post_id AND p.tenant_id = comments.tenant_id)));
--> statement-breakpoint
-- Sửa/xoá: chủ quản (ẩn) hoặc chính người viết (đối tác).
CREATE POLICY comments_update ON community.comments AS RESTRICTIVE FOR UPDATE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (author_org = (SELECT packs.viewer_ext_org())
    AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL OR author_org = (SELECT packs.viewer_ext_org()));
--> statement-breakpoint
CREATE POLICY comments_delete ON community.comments AS RESTRICTIVE FOR DELETE TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL OR (author_org = (SELECT packs.viewer_ext_org())
    AND author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
-- ---- settings: mỗi người chỉ hàng của mình (việc nền: cả tenant).
CREATE POLICY settings_own ON community.settings AS RESTRICTIVE FOR ALL TO community_rw
  USING (coalesce(current_setting('app.user_id', true), '') = ''
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (coalesce(current_setting('app.user_id', true), '') = ''
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
