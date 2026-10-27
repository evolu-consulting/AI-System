-- engine-flag-tenant · docs/specs/engine-flag-tenant/tasks.md: duyệt HĐ chạy bằng engine theo CÔNG TY (entitlement), không chỉ env.
-- Feature `contracts-approval-engine`: tenant có entitlement còn hiệu lực ⇒ HĐ mới của tenant đó duyệt trên engine (khi env
-- CONTRACTS_APPROVAL_ENGINE=on; env=off là công tắc khẩn tắt hết). Thiếu feature / entitlement ⇒ máy 2 bước cũ (fail-closed).
-- Giữ hành vi hiện tại: cấp cho tenant `demo` và mọi tenant đã có lượt duyệt chạy engine. Chỉ tạo feature khi đã có tenant (DB thật).
INSERT INTO admin.features (key, name, description, icon, status)
SELECT 'contracts-approval-engine', '{"vi": "Duyệt hợp đồng bằng quy trình", "en": "Contract approval on workflow engine"}'::jsonb,
       '{"vi": "Duyệt hợp đồng chạy trên engine quy trình (theo công ty)", "en": "Contract approval runs on the workflow engine (per company)"}'::jsonb,
       'workflow', 'on'
WHERE EXISTS (SELECT 1 FROM admin.tenants)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO admin.feature_entitlements (feature_id, tenant_id)
SELECT f.id, t.id FROM admin.features f CROSS JOIN admin.tenants t
WHERE f.key = 'contracts-approval-engine' AND t.key = 'demo'
ON CONFLICT (feature_id, tenant_id) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('contracts.approvals') IS NOT NULL THEN
    EXECUTE $q$
      INSERT INTO admin.feature_entitlements (feature_id, tenant_id)
      SELECT DISTINCT f.id, a.tenant_id FROM admin.features f, contracts.approvals a
      WHERE f.key = 'contracts-approval-engine' AND a.mode = 'engine'
      ON CONFLICT (feature_id, tenant_id) DO NOTHING
    $q$;
  END IF;
END $$;
