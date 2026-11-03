-- CR-112 S6 · ADM-FR-83 · ADM-BR-17: hai hàm cho backfill/chuẩn hoá vai (CLI `admin:roles-backfill`) và vai tuỳ biến.
-- (1) `admin.app_roles_backfill(p_tenant)`: như `admin.app_roles_backfill()` (0030) nhưng lọc một tenant (NULL = mọi tenant) và trả
--     id vai vừa tạo (báo cáo/audit từng dòng). Chỉ chèn hàng vai, KHÔNG đổi grant. Idempotent. Chỉ chủ migration gọi (CLI).
-- (2) `admin.app_roles_grant_agents(p_tenant, p_roles, p_actor)`: Group của vai TUỲ BIẾN nhận đúng các grant agent trợ lý gói
--     (`packs.pack_agents`) mà Group vai MẶC ĐỊNH cùng gói + cùng mức đang có trong tenant (không có ⇒ không cấp). `p_roles` NULL ⇒
--     mọi vai tuỳ biến của tenant. Có chèn ⇒ khoá + tăng `hub.config_meta` (người gọi NOTIFY `hub_config_changed` trong tx).
--     Trả jsonb `{v: version|null, added: [{g: group_id, a: agent_id}]}`. Số câu cố định (Luật 4c). plpgsql: bảng hub/packs được
--     tạo SAU migration admin — tên chỉ phân giải lúc chạy. SECURITY DEFINER như `packs.grant_agents` (admin_api không ghi hub).
CREATE OR REPLACE FUNCTION admin.app_roles_backfill(p_tenant uuid) RETURNS SETOF uuid
  LANGUAGE sql VOLATILE SET search_path = pg_catalog, pg_temp AS $$
  WITH cand AS (
    SELECT g.id, g.tenant_id, g.name, regexp_match(g.key, '^([a-z][a-z0-9-]*)-(viewer|editor|owner)$') AS m
    FROM admin.groups g
    WHERE p_tenant IS NULL OR g.tenant_id = p_tenant
  )
  INSERT INTO admin.app_roles (tenant_id, pack, key, name, level, group_id, is_default)
  SELECT c.tenant_id, replace(c.m[1], '-', '_'), c.m[2], c.name,
    CASE c.m[2] WHEN 'viewer' THEN 'read' WHEN 'editor' THEN 'write' ELSE 'admin' END, c.id, true
  FROM cand c
  WHERE c.m IS NOT NULL
    AND (SELECT count(*) FROM admin.features f
         WHERE f.key IN (c.m[1] || '-read', c.m[1] || '-write', c.m[1] || '-admin')) = 3
  ON CONFLICT DO NOTHING
  RETURNING id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.app_roles_backfill(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION admin.app_roles_grant_agents(p_tenant uuid, p_roles uuid[], p_actor uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  added jsonb;
  v bigint;
BEGIN
  IF to_regclass('hub.agent_grants') IS NULL OR to_regclass('packs.pack_agents') IS NULL THEN
    RETURN jsonb_build_object('v', NULL, 'added', '[]'::jsonb);
  END IF;
  -- Khoá config Hub TRƯỚC mọi ghi bảng hub (cùng chiều packs.grant_agents ⇒ không deadlock).
  PERFORM 1 FROM hub.config_meta WHERE id = 1 FOR UPDATE;
  WITH ins AS (
    INSERT INTO hub.agent_grants (agent_id, tenant_id, subject_type, subject_id, granted_by)
    SELECT DISTINCT ag.agent_id, c.tenant_id, 'group', c.group_id, p_actor
    FROM admin.app_roles c
    JOIN admin.app_roles d ON d.tenant_id = c.tenant_id AND d.pack = c.pack AND d.level = c.level AND d.is_default
    JOIN hub.agent_grants ag ON ag.tenant_id = d.tenant_id AND ag.subject_type = 'group' AND ag.subject_id = d.group_id
    JOIN hub.agents a ON a.id = ag.agent_id
    JOIN packs.pack_agents pa ON pa.pack_key = c.pack AND pa.agent_key = a.key
    WHERE c.tenant_id = p_tenant AND NOT c.is_default AND (p_roles IS NULL OR c.id = ANY (p_roles))
    ON CONFLICT (agent_id, tenant_id, subject_type, subject_id) DO NOTHING
    RETURNING subject_id AS g, agent_id AS a
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('g', g, 'a', a) ORDER BY g, a), '[]'::jsonb) INTO added FROM ins;
  IF jsonb_array_length(added) > 0 THEN
    UPDATE hub.config_meta SET hub_config_version = hub_config_version + 1 WHERE id = 1
      RETURNING hub_config_version INTO v;
  END IF;
  RETURN jsonb_build_object('v', v, 'added', added);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.app_roles_grant_agents(uuid, uuid[], uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin.app_roles_grant_agents(uuid, uuid[], uuid) TO admin_api;
