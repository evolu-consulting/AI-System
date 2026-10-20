-- M1D-FR-01 · docs/specs/M1c-fixes (review CR-095 đợt A: A-1, A-2, A-8, A-9). Chỉ cộng thêm; chạy lại vô hại.
-- A-2: khoá bên giả được — `visible_party_keys()` chỉ lấy từ HĐ ĐÃ DUYỆT (trạng thái sau duyệt, ≡ `approvals.done` của 0011:
--      active/expiring/expired/renewed/terminated). HĐ nháp (kể cả do chính mình tạo và tự phụ trách) không mở đối tác.
CREATE OR REPLACE FUNCTION contracts.visible_party_keys() RETURNS text[]
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT k.k) FILTER (WHERE k.k IS NOT NULL), '{}'::text[])
  FROM contracts.contracts c CROSS JOIN LATERAL (VALUES
    (contracts.party_key(c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value')),
    (contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'))) k(k)
  WHERE c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND c.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
$$;
--> statement-breakpoint
-- A-8: lan phụ lục không xoá `app.user_id` nữa (trigger khác trong lệnh lồng vẫn thấy đúng người ghi); dùng cờ riêng
-- `app.vis_cascade` chỉ policy `contracts_visible` nhận.
CREATE OR REPLACE FUNCTION contracts.m1b_visibility_cascade() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  f text := coalesce(current_setting('app.vis_cascade', true), '');
BEGIN
  PERFORM set_config('app.vis_cascade', '1', true);
  UPDATE contracts.contracts c SET visibility_owner_id = NEW.owner_user_id
    WHERE c.tenant_id = NEW.tenant_id AND c.parent_id = NEW.id
      AND c.visibility_owner_id IS DISTINCT FROM NEW.owner_user_id;
  PERFORM set_config('app.vis_cascade', f, true);
  RETURN NULL;
END $$;
--> statement-breakpoint
-- BEFORE của phụ lục chạy trong lệnh lan: đọc HĐ cha dưới cùng cờ (người đổi owner đã thấy HĐ cha).
DROP POLICY IF EXISTS contracts_visible ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_visible ON contracts.contracts AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all() OR coalesce(current_setting('app.vis_cascade', true), '') = '1')
    OR owner_user_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])
    OR (owner_user_id IS NULL
        AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
             OR visibility_owner_id = ANY ((SELECT contracts.org_owner_ids())::uuid[]))));
--> statement-breakpoint
-- A-1: văn bản đã ký theo khách / chữ ký số (RLS của chúng áp bên trong) hoặc do mình tải lên.
DROP POLICY IF EXISTS cks_signed_docs_visible ON contracts.cks_signed_docs;
--> statement-breakpoint
CREATE POLICY cks_signed_docs_visible ON contracts.cks_signed_docs AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.cks_customers cu
      WHERE cu.id = cks_signed_docs.customer_id AND cu.tenant_id = cks_signed_docs.tenant_id))
    OR (certificate_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.cks_certificates ce
      WHERE ce.id = cks_signed_docs.certificate_id AND ce.tenant_id = cks_signed_docs.tenant_id)));
--> statement-breakpoint
-- A-1 (rà bảng con): hẹn gọi CKS của mình, hoặc theo khách / lượt gia hạn mình thấy.
DROP POLICY IF EXISTS cks_followups_visible ON contracts.cks_followups;
--> statement-breakpoint
CREATE POLICY cks_followups_visible ON contracts.cks_followups AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.cks_customers cu
      WHERE cu.id = cks_followups.customer_id AND cu.tenant_id = cks_followups.tenant_id))
    OR (renewal_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.cks_renewals rn
      WHERE rn.id = cks_followups.renewal_id AND rn.tenant_id = cks_followups.tenant_id)));
--> statement-breakpoint
-- A-1 (rà bảng con): huỷ sự kiện theo sự kiện mình thấy.
DROP POLICY IF EXISTS partner_event_voids_visible ON contracts.partner_event_voids;
--> statement-breakpoint
CREATE POLICY partner_event_voids_visible ON contracts.partner_event_voids AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR by_user = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM contracts.partner_events e
      WHERE e.id = partner_event_voids.event_id AND e.tenant_id = partner_event_voids.tenant_id));
--> statement-breakpoint
-- A-9: chỉ owner gói (hoặc việc nền: `app.user_id` rỗng — importer) ghi được chế độ thấy ở tầng DB, không chỉ ở route.
DROP POLICY IF EXISTS visibility_settings_owner_ins ON contracts.visibility_settings;
--> statement-breakpoint
CREATE POLICY visibility_settings_owner_ins ON contracts.visibility_settings AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (NULLIF(current_setting('app.user_id', true), '') IS NULL OR contracts.org_is_owner());
--> statement-breakpoint
DROP POLICY IF EXISTS visibility_settings_owner_upd ON contracts.visibility_settings;
--> statement-breakpoint
CREATE POLICY visibility_settings_owner_upd ON contracts.visibility_settings AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING (NULLIF(current_setting('app.user_id', true), '') IS NULL OR contracts.org_is_owner())
  WITH CHECK (NULLIF(current_setting('app.user_id', true), '') IS NULL OR contracts.org_is_owner());
