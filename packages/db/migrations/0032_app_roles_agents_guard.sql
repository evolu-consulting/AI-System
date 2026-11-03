-- CR-112 review (Thấp) · `admin.app_roles_grant_agents` (0031) là SECURITY DEFINER, admin_api gọi được với p_tenant bất kỳ ⇒
-- thêm chốt trong hàm: ngoài scope platform, p_tenant PHẢI là tenant của phiên (`app.tenant_id`, do withScope đặt). Phiên không
-- đặt scope (kể cả thiếu biến) ⇒ từ chối (fail-closed). Thân còn lại giữ nguyên 0031 (không sửa 0031).
CREATE OR REPLACE FUNCTION admin.app_roles_grant_agents(p_tenant uuid, p_roles uuid[], p_actor uuid) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  added jsonb;
  v bigint;
BEGIN
  IF coalesce(current_setting('app.scope', true), '') <> 'platform'
     AND (coalesce(current_setting('app.scope', true), '') <> 'tenant'
          OR p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid) THEN
    RAISE EXCEPTION 'app_roles_grant_agents: tenant ngoài phạm vi phiên' USING ERRCODE = '42501';
  END IF;
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
