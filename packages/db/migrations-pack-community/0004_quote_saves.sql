-- CR-102b · com-c7b-save-quote-ui · R26–R29: dấu "đã lưu báo giá" (CHỈ chủ quản: RLS RESTRICTIVE viewer_ext_org() IS NULL ⇒ đối tác 0 hàng,
-- HT-64) + hai mốc trên bài để chủ quản biết "bài sửa sau khi lưu" / "NCC sửa giá sau khi lưu" (R27). Mốc nằm ở `posts` (bên đăng ghi được
-- dưới RLS của mình, không cần chạm bảng chủ quản) và chỉ chủ quản được trả ra (views.ts).
ALTER TABLE community.posts ADD COLUMN IF NOT EXISTS edited_at timestamptz;
--> statement-breakpoint
ALTER TABLE community.posts ADD COLUMN IF NOT EXISTS price_edited_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS community.quote_saves (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  -- NULL = lưu từ chính bài; uuid = lưu từ bình luận của NCC. Bình luận bị xoá ⇒ `comment_id` về NULL, `comment_ref` giữ id cũ
  -- (dấu của chủ quản còn, hiện "bình luận đã xoá" — review Thấp-9).
  comment_id uuid,
  comment_ref uuid,
  item_idx smallint NOT NULL DEFAULT 0,
  saved_by uuid NOT NULL,
  saved_by_name text NOT NULL DEFAULT '',
  saved_at timestamptz NOT NULL DEFAULT now(),
  price_id uuid,
  product_id uuid,
  supplier_name text NOT NULL DEFAULT '',
  price bigint NOT NULL,
  unit text,
  -- R27: báo chủ quản khi NCC sửa giá (C9 đọc cờ này + posts.price_edited_at).
  notify_price_edit boolean NOT NULL DEFAULT true,
  CONSTRAINT quote_saves_pkey PRIMARY KEY (id),
  CONSTRAINT quote_saves_ck CHECK (item_idx BETWEEN 0 AND 49 AND price >= 1),
  CONSTRAINT quote_saves_comment_ref_ck CHECK (comment_id IS NULL OR comment_id = comment_ref),
  CONSTRAINT quote_saves_post_fk FOREIGN KEY (post_id, tenant_id)
    REFERENCES community.posts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT quote_saves_comment_fk FOREIGN KEY (comment_id) REFERENCES community.comments (id) ON DELETE SET NULL (comment_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS quote_saves_item_uq ON community.quote_saves
  (post_id, item_idx, coalesce(comment_ref, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
SELECT packs.secure_table('community', 'quote_saves');
--> statement-breakpoint
CREATE POLICY quote_saves_host_only ON community.quote_saves AS RESTRICTIVE FOR ALL TO community_rw
  USING ((SELECT packs.viewer_ext_org()) IS NULL) WITH CHECK ((SELECT packs.viewer_ext_org()) IS NULL);