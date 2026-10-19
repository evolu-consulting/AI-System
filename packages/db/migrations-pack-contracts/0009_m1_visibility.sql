-- M1D-FR-01 · M1D-FR-04 · M1D-NFR-01 · docs/specs/M1-departments: luật thấy của mgmt-app (orgs.Ctx.sees + access.py) bằng RLS.
-- Policy RESTRICTIVE FOR SELECT (AND với policy tenant; UPDATE/DELETE/RETURNING đọc hàng nên cũng bị lọc). `sees_all()` một lần mỗi
-- câu (InitPlan): việc nền (`app.user_id` rỗng) · chế độ tenant `tenant` (mặc định — hành vi HD1–HD9) · owner gói. Còn lại: hàng
-- của mình/cấp dưới mọi tầng/thành viên phòng mình làm trưởng (`org_owner_ids()` — MỘT mảng mỗi câu, lọc `= any`) hoặc chưa giao
-- mà mình tải lên. Hàng con theo HĐ qua EXISTS trên `contracts.contracts` (RLS của HĐ áp bên trong). Chỉ cộng thêm.
CREATE TABLE IF NOT EXISTS contracts.visibility_settings (
  tenant_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'tenant',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT visibility_settings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT visibility_settings_mode_ck CHECK (mode IN ('tenant', 'org'))
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'visibility_settings');
--> statement-breakpoint
REVOKE DELETE ON contracts.visibility_settings FROM contracts_rw;
--> statement-breakpoint
-- SECURITY DEFINER (chủ migration; bảng admin chỉ ENABLE RLS): chỉ đọc admin theo đúng `app.tenant_id`/`app.user_id` của tx,
-- không tham số ⇒ role gói không hỏi được về người khác. Mình ∪ cấp dưới (closure) ∪ thành viên phòng mình làm trưởng.
CREATE OR REPLACE FUNCTION contracts.org_owner_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH me AS (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid AS t,
                     NULLIF(current_setting('app.user_id', true), '')::uuid AS u)
  SELECT coalesce(array_agg(DISTINCT x.id), '{}'::uuid[]) FROM me CROSS JOIN LATERAL (
    SELECT me.u AS id WHERE me.u IS NOT NULL AND me.t IS NOT NULL
    UNION ALL
    SELECT r.user_id FROM admin.user_reports r WHERE r.tenant_id = me.t AND r.manager_id = me.u
    UNION ALL
    SELECT gm.user_id FROM admin.departments d
      JOIN admin.group_members gm ON gm.group_id = d.group_id AND gm.tenant_id = d.tenant_id
      WHERE d.tenant_id = me.t AND d.head_user_id = me.u) x
$$;
--> statement-breakpoint
-- Owner gói ≡ thành viên Group được cấp `contracts-admin` của tenant (như packGuard: vai owner = read+write+admin).
CREATE OR REPLACE FUNCTION contracts.org_is_owner() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM admin.group_members gm
    JOIN admin.feature_grants fg ON fg.tenant_id = gm.tenant_id AND fg.group_id = gm.group_id
    JOIN admin.features f ON f.id = fg.feature_id AND f.key = 'contracts-admin'
    WHERE gm.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND gm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
$$;
--> statement-breakpoint
-- INVOKER: đọc `visibility_settings` dưới RLS của role gói.
CREATE OR REPLACE FUNCTION contracts.sees_all() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR coalesce((SELECT v.mode FROM contracts.visibility_settings v
                 WHERE v.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid), 'tenant') = 'tenant'
    OR contracts.org_is_owner()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.org_owner_ids(), contracts.org_is_owner(), contracts.sees_all() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.org_owner_ids(), contracts.org_is_owner(), contracts.sees_all() TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS contracts_visible ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_visible ON contracts.contracts AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR owner_user_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])
    OR (owner_user_id IS NULL AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
DROP POLICY IF EXISTS contract_items_visible ON contracts.contract_items;
--> statement-breakpoint
CREATE POLICY contract_items_visible ON contracts.contract_items AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all()) OR EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = contract_items.contract_id AND c.tenant_id = contract_items.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS contract_events_visible ON contracts.contract_events;
--> statement-breakpoint
CREATE POLICY contract_events_visible ON contracts.contract_events AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all()) OR EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = contract_events.contract_id AND c.tenant_id = contract_events.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS obligations_visible ON contracts.obligations;
--> statement-breakpoint
CREATE POLICY obligations_visible ON contracts.obligations AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all()) OR EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = obligations.contract_id AND c.tenant_id = obligations.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS cks_lots_visible ON contracts.cks_lots;
--> statement-breakpoint
CREATE POLICY cks_lots_visible ON contracts.cks_lots AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = cks_lots.purchase_contract_id AND c.tenant_id = cks_lots.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS cks_certificates_visible ON contracts.cks_certificates;
--> statement-breakpoint
CREATE POLICY cks_certificates_visible ON contracts.cks_certificates AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = cks_certificates.sale_contract_id AND c.tenant_id = cks_certificates.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS cks_renewals_visible ON contracts.cks_renewals;
--> statement-breakpoint
CREATE POLICY cks_renewals_visible ON contracts.cks_renewals AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = cks_renewals.sale_contract_id AND c.tenant_id = cks_renewals.tenant_id));
