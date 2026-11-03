-- CR-112 S1 · ADM-FR-80/81/82 · ADM-BR-15/16 (intake 2026-11-03 Q2/Q4/Q5/Q16): vai theo app là NGUỒN, Group vẫn là đơn vị
-- thực thi. Bảng mỏng: một vai ↔ đúng một Group (cùng tenant, FK kép), một app (`pack`), một mức read|write|admin. Vai mặc
-- định (`is_default`) = 3 Group `<k'>-viewer|editor|owner` do bật gói tạo. RLS như bảng tenant khác của admin (0028):
-- scope platform thấy mọi tenant, scope tenant chỉ tenant mình; hub_ro chỉ đọc.
CREATE TABLE IF NOT EXISTS admin.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  pack text NOT NULL,
  key text NOT NULL,
  name jsonb NOT NULL,
  level text NOT NULL,
  group_id uuid NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_roles_tenant_fk FOREIGN KEY (tenant_id) REFERENCES admin.tenants (id) ON DELETE CASCADE,
  CONSTRAINT app_roles_group_fk FOREIGN KEY (tenant_id, group_id) REFERENCES admin.groups (tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT app_roles_group_uq UNIQUE (group_id),
  CONSTRAINT app_roles_tenant_pack_key_uq UNIQUE (tenant_id, pack, key),
  CONSTRAINT app_roles_level_check CHECK (level IN ('read', 'write', 'admin')),
  CONSTRAINT app_roles_pack_check CHECK (pack ~ '^[a-z][a-z0-9_]{1,20}$'),
  CONSTRAINT app_roles_key_check CHECK (key ~ '^[a-z][a-z0-9-]{1,19}$'),
  CONSTRAINT app_roles_name_check CHECK (jsonb_typeof(name) = 'object' AND name ? 'vi'),
  CONSTRAINT app_roles_version_check CHECK (version >= 1),
  CONSTRAINT app_roles_default_key_check CHECK (NOT is_default OR key IN ('viewer', 'editor', 'owner'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_roles_tenant_pack_idx ON admin.app_roles (tenant_id, pack);
--> statement-breakpoint
ALTER TABLE admin.app_roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY app_roles_admin_rw ON admin.app_roles FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY app_roles_hub_ro ON admin.app_roles FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON admin.app_roles FROM hub_ro;
--> statement-breakpoint
REVOKE TRUNCATE ON admin.app_roles FROM admin_rw;
--> statement-breakpoint
-- Backfill vai mặc định từ Group vai đã có (`<k'>-viewer|editor|owner` của gói đã cài: đủ 3 feature `<k'>-read|write|admin`).
-- Chỉ chèn hàng vai — KHÔNG đổi grant (chuẩn hoá grant là việc của S6, có dry-run). Idempotent (ON CONFLICT DO NOTHING):
-- gọi lại trả 0. Một câu tập hợp, không lặp theo hàng. Trả số vai vừa tạo.
CREATE OR REPLACE FUNCTION admin.app_roles_backfill() RETURNS integer
  LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  WITH cand AS (
    SELECT g.id, g.tenant_id, g.name, regexp_match(g.key, '^([a-z][a-z0-9-]*)-(viewer|editor|owner)$') AS m
    FROM admin.groups g
  ), ins AS (
    INSERT INTO admin.app_roles (tenant_id, pack, key, name, level, group_id, is_default)
    SELECT c.tenant_id, replace(c.m[1], '-', '_'), c.m[2], c.name,
      CASE c.m[2] WHEN 'viewer' THEN 'read' WHEN 'editor' THEN 'write' ELSE 'admin' END, c.id, true
    FROM cand c
    WHERE c.m IS NOT NULL
      AND (SELECT count(*) FROM admin.features f
           WHERE f.key IN (c.m[1] || '-read', c.m[1] || '-write', c.m[1] || '-admin')) = 3
    ON CONFLICT DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM ins
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.app_roles_backfill() FROM PUBLIC;
--> statement-breakpoint
SELECT admin.app_roles_backfill();
