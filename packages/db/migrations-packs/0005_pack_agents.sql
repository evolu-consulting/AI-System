-- PK-FR-05 · UAT CR-095 B4: trợ lý AI của gói được cấp KHI BẬT GÓI cho tenant, không phụ thuộc `hub:seed`.
-- (1) `packs.pack_agents`: gói khai agent trợ lý của mình (khoá agent Hub; agent có thể chưa tồn tại lúc migrate).
-- (2) `packs.grant_agents(k, tenants, actor)`: entitlement agent cho các tenant + grant cho 3 Group vai `<k'>-owner|editor|viewer`
--     của tenant; `tenants` NULL ⇒ mọi tenant đang bật gói (entitlement `<k'>-read` còn hiệu lực — seed gọi sau khi tạo agent).
--     Có đổi ⇒ khoá `hub.config_meta` + tăng `hub_config_version`, trả version mới (người gọi NOTIFY `hub_config_changed`
--     trong cùng tx); không đổi ⇒ NULL (không bump; gói không có agent/tenant chưa bật ⇒ không chạm hub). Tập hợp: số câu cố định, không lặp theo hàng (Luật 4c).
--     Không bỏ `revoked_at` đã đặt (platform_admin tắt agent cho tenant ⇒ bật gói lại không ghi đè).
-- SECURITY DEFINER (chủ migration): admin_api chỉ EXECUTE, không quyền ghi bảng hub (D-03: không mở ghi chéo app).
CREATE TABLE IF NOT EXISTS packs.pack_agents (
  pack_key text NOT NULL,
  agent_key text NOT NULL,
  CONSTRAINT pack_agents_pkey PRIMARY KEY (pack_key, agent_key),
  CONSTRAINT pack_agents_pack_fk FOREIGN KEY (pack_key) REFERENCES packs.registry (key) ON DELETE CASCADE,
  CONSTRAINT pack_agents_agent_key_ck CHECK (agent_key ~ '^[a-z][a-z0-9-]{1,47}$')
);
--> statement-breakpoint
GRANT SELECT ON packs.pack_agents TO admin_api;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION packs.grant_agents(p_key text, p_tenants uuid[], p_actor uuid) RETURNS bigint
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  fk text := replace(p_key, '_', '-');
  agents uuid[];
  tenants uuid[];
  n_ent int;
  n_grant int;
  v bigint;
BEGIN
  SELECT array_agg(a.id ORDER BY a.id) INTO agents
    FROM packs.pack_agents pa JOIN hub.agents a ON a.key = pa.agent_key
    WHERE pa.pack_key = p_key;
  IF agents IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(e.tenant_id ORDER BY e.tenant_id) INTO tenants
    FROM admin.feature_entitlements e JOIN admin.features f ON f.id = e.feature_id
    WHERE f.key = fk || '-read' AND e.revoked_at IS NULL
      AND (p_tenants IS NULL OR e.tenant_id = ANY (p_tenants));
  IF tenants IS NULL THEN
    RETURN NULL;
  END IF;
  -- Khoá config Hub TRƯỚC mọi ghi bảng hub (cùng chiều agent-grants/seed ⇒ không deadlock).
  PERFORM 1 FROM hub.config_meta WHERE id = 1 FOR UPDATE;
  INSERT INTO hub.agent_entitlements (agent_id, tenant_id, granted_by)
    SELECT a, t, p_actor FROM unnest(agents) AS a CROSS JOIN unnest(tenants) AS t
    ON CONFLICT (agent_id, tenant_id) DO NOTHING;
  GET DIAGNOSTICS n_ent = ROW_COUNT;
  INSERT INTO hub.agent_grants (agent_id, tenant_id, subject_type, subject_id, granted_by)
    SELECT a, g.tenant_id, 'group', g.id, p_actor
    FROM admin.groups g CROSS JOIN unnest(agents) AS a
    WHERE g.tenant_id = ANY (tenants)
      AND g.key = ANY (ARRAY[fk || '-owner', fk || '-editor', fk || '-viewer'])
    ON CONFLICT (agent_id, tenant_id, subject_type, subject_id) DO NOTHING;
  GET DIAGNOSTICS n_grant = ROW_COUNT;
  IF n_ent + n_grant = 0 THEN
    RETURN NULL;
  END IF;
  UPDATE hub.config_meta SET hub_config_version = hub_config_version + 1 WHERE id = 1
    RETURNING hub_config_version INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.grant_agents(text, uuid[], uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.grant_agents(text, uuid[], uuid) TO admin_api;
