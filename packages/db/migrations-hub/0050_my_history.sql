-- my-activity-rag · tool lõi `my-chat-history` + `my-activity` (CHỈ dữ liệu của chính người gọi).
-- (1) Tìm toàn văn tin chat của chính mình: cấu hình FTS `hub.vi` = unaccent + simple (như `knowledge.vi`: tiếng Việt đơn lập,
--     không stem, bỏ dấu để "hạn mức" ≡ "han muc"); cột sinh `search_tsv` (STORED — lọc `@@` không tính lại tsvector mỗi hàng);
--     GIN `(user_id, search_tsv)` (btree_gin) cho từ khoá hiếm + btree `(tenant_id, user_id, created_at DESC)` cho tin mới nhất /
--     từ khoá phổ biến. Thêm cột STORED = ghi lại bảng `hub.messages` một lần (khoá ACCESS EXCLUSIVE ngắn — bảng nhỏ).
-- (2) `hub.my_admin_audit`: hub không có quyền đọc `admin.audit_log` (0007 REVOKE hub_ro) ⇒ hàm SECURITY DEFINER chỉ trả hàng
--     do CHÍNH người của tx làm (`app.scope = 'user'`, `actor_id = app.user_id`, `tenant_id = app.tenant_id` — đúng biến RLS
--     `withHubScope` đặt), chỉ cột tóm tắt (không before/after). Chạy lại vô hại.
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;
--> statement-breakpoint
DO $$
DECLARE s text;
BEGIN
  SELECT n.nspname INTO s FROM pg_ts_dict t JOIN pg_namespace n ON n.oid = t.dictnamespace
    WHERE t.dictname = 'unaccent' LIMIT 1;
  EXECUTE format('CREATE OR REPLACE FUNCTION hub.fold(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT '
    'PARALLEL SAFE AS $f$ SELECT lower(%1$I.unaccent(%2$L::regdictionary, t)) $f$', s, s || '.unaccent');
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config c JOIN pg_namespace n ON n.oid = c.cfgnamespace
                 WHERE n.nspname = 'hub' AND c.cfgname = 'vi') THEN
    CREATE TEXT SEARCH CONFIGURATION hub.vi (COPY = pg_catalog.simple);
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.fold(text) TO hub_rw;
--> statement-breakpoint
ALTER TABLE hub.messages ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('hub.vi'::regconfig, hub.fold(left(content, 20000)))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_user_recent_idx ON hub.messages (tenant_id, user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_user_search_idx ON hub.messages USING gin (user_id, search_tsv);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.my_admin_audit(p_lo timestamptz, p_hi timestamptz, p_action text, p_limit integer)
  RETURNS TABLE (at timestamptz, action text, entity text, entity_name text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  t uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  u uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'user' OR t IS NULL OR u IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.at, a.action, a.entity, a.entity_name FROM admin.audit_log a
    WHERE a.actor_id = u AND a.tenant_id = t AND a.at >= p_lo AND a.at < p_hi
      AND a.action LIKE coalesce(p_action, '%')
    ORDER BY a.seq DESC LIMIT least(greatest(coalesce(p_limit, 20), 1), 100);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.my_admin_audit(timestamptz, timestamptz, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.my_admin_audit(timestamptz, timestamptz, text, integer) TO hub_rw;
