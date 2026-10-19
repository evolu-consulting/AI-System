-- M1D-FR-01 · M1D-FR-04 · docs/specs/M1b-visibility: hoàn tất luật thấy mgmt-app (orgs.Ctx.sees + access.py) ở chế độ `org`.
-- (1) Phụ lục chưa giao theo HĐ cha: cột khử chuẩn `visibility_owner_id` (= người phụ trách HĐ cha) do trigger giữ — policy chỉ đọc
--     cột của chính hàng, không đọc HĐ cha ⇒ không đệ quy policy. (2) `cks_customers`/`partner_events` lọc theo người: đối tác thấy
--     khi là một bên của HĐ mình thấy (khoá bên `party_key`), hoặc do mình tạo/ghi. (3) Chế độ mặc định của tenant MỚI: `org`
--     (admin.tenants.settings.visibility do admin-api ghi khi tạo tenant); tenant không có cài đặt (fixture test, seed dev) vẫn
--     `tenant`. Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS visibility_owner_id uuid;
--> statement-breakpoint
-- Backfill (role chủ migration; dữ liệu cũ chỉ có ở dev — xem HD1 review m-05 về FORCE RLS).
UPDATE contracts.contracts c SET visibility_owner_id = p.owner_user_id
  FROM contracts.contracts p
  WHERE c.parent_id IS NOT NULL AND p.id = c.parent_id AND p.tenant_id = c.tenant_id
    AND c.visibility_owner_id IS DISTINCT FROM p.owner_user_id;
--> statement-breakpoint
-- BEFORE: tính lại từ HĐ cha dưới RLS của người ghi (không thấy HĐ cha ⇒ null — không lộ người phụ trách của HĐ mình không thấy).
-- App không tự đặt được cột: mọi INSERT có parent/đặt cột và mọi UPDATE đổi parent/cột đều qua đây.
CREATE OR REPLACE FUNCTION contracts.m1b_visibility_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.visibility_owner_id := NULL;
  ELSE
    NEW.visibility_owner_id := (SELECT p.owner_user_id FROM contracts.contracts p
      WHERE p.id = NEW.parent_id AND p.tenant_id = NEW.tenant_id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- AFTER đổi người phụ trách HĐ: lan xuống phụ lục (một câu theo tập). Phụ lục có thể ẩn với người đổi ⇒ chạy như việc nền
-- (`app.user_id` rỗng ⇒ `sees_all()`; policy tenant vẫn áp) rồi trả lại; chỉ ghi cột khử chuẩn, không trả hàng cho bên gọi.
CREATE OR REPLACE FUNCTION contracts.m1b_visibility_cascade() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  u text := coalesce(current_setting('app.user_id', true), '');
BEGIN
  PERFORM set_config('app.user_id', '', true);
  UPDATE contracts.contracts c SET visibility_owner_id = NEW.owner_user_id
    WHERE c.tenant_id = NEW.tenant_id AND c.parent_id = NEW.id
      AND c.visibility_owner_id IS DISTINCT FROM NEW.owner_user_id;
  PERFORM set_config('app.user_id', u, true);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.m1b_visibility_owner(), contracts.m1b_visibility_cascade() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_m1b_vis_ins ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_m1b_vis_ins BEFORE INSERT ON contracts.contracts
  FOR EACH ROW WHEN (NEW.parent_id IS NOT NULL OR NEW.visibility_owner_id IS NOT NULL)
  EXECUTE FUNCTION contracts.m1b_visibility_owner();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_m1b_vis_upd ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_m1b_vis_upd BEFORE UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id
    OR OLD.visibility_owner_id IS DISTINCT FROM NEW.visibility_owner_id)
  EXECUTE FUNCTION contracts.m1b_visibility_owner();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_m1b_vis_cascade ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_m1b_vis_cascade AFTER UPDATE OF owner_user_id ON contracts.contracts
  FOR EACH ROW WHEN (OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id AND NEW.kind = 'contract')
  EXECUTE FUNCTION contracts.m1b_visibility_cascade();
--> statement-breakpoint
-- Chế độ mặc định khi tenant chưa có hàng `visibility_settings`: `admin.tenants.settings->>'visibility'` (SECURITY DEFINER như
-- `org_is_owner`: bảng admin chỉ ENABLE RLS; không tham số ⇒ chỉ hỏi về tenant của tx).
CREATE OR REPLACE FUNCTION contracts.org_default_mode() RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN t.settings ->> 'visibility' IN ('tenant', 'org') THEN t.settings ->> 'visibility' END
  FROM admin.tenants t WHERE t.id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
-- Chế độ hiệu lực: hàng cài đặt (owner gói đổi) > mặc định của tenant > `tenant`.
CREATE OR REPLACE FUNCTION contracts.visibility_mode() RETURNS text
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT v.mode FROM contracts.visibility_settings v
                   WHERE v.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid),
                  contracts.org_default_mode(), 'tenant')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.sees_all() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '') IS NULL
    OR contracts.visibility_mode() = 'tenant'
    OR contracts.org_is_owner()
$$;
--> statement-breakpoint
-- Khoá bên (`party_key`, như `ledger.rules.ts::partyKey`) của bên mua + bên bán mọi HĐ người gọi thấy (RLS của HĐ áp bên trong).
-- MỘT mảng mỗi câu (InitPlan); chỉ chạy khi `sees_all()` sai (OR dừng sớm).
CREATE OR REPLACE FUNCTION contracts.visible_party_keys() RETURNS text[]
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT k.k) FILTER (WHERE k.k IS NOT NULL), '{}'::text[])
  FROM contracts.contracts c CROSS JOIN LATERAL (VALUES
    (contracts.party_key(c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value')),
    (contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'))) k(k)
  WHERE c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.org_default_mode(), contracts.visibility_mode(), contracts.visible_party_keys()
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.org_default_mode(), contracts.visibility_mode(), contracts.visible_party_keys()
  TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS contracts_visible ON contracts.contracts;
--> statement-breakpoint
-- Như 0009 + phụ lục chưa giao thấy khi HĐ cha thấy theo người phụ trách (orgs.sees: "an unassigned addendum follows its contract").
CREATE POLICY contracts_visible ON contracts.contracts AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR owner_user_id = ANY ((SELECT contracts.org_owner_ids())::uuid[])
    OR (owner_user_id IS NULL
        AND (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
             OR visibility_owner_id = ANY ((SELECT contracts.org_owner_ids())::uuid[]))));
--> statement-breakpoint
-- Khách CKS do người tạo luôn thấy (câu chèn CKS chèn khách + chữ ký cùng câu, RETURNING phải thấy hàng mới — như D-M1-05).
ALTER TABLE contracts.cks_customers ADD COLUMN IF NOT EXISTS created_by uuid
  DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid;
--> statement-breakpoint
DROP POLICY IF EXISTS cks_customers_visible ON contracts.cks_customers;
--> statement-breakpoint
-- access.View.company: khách thấy khi là một bên của HĐ mình thấy; thêm: do mình tạo, hoặc có chữ ký số mình thấy.
CREATE POLICY cks_customers_visible ON contracts.cks_customers AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR contracts.party_key(name, tax_id) = ANY ((SELECT contracts.visible_party_keys())::text[])
    OR EXISTS (SELECT 1 FROM contracts.cks_certificates ce
      WHERE ce.tenant_id = cks_customers.tenant_id AND ce.customer_id = cks_customers.id));
--> statement-breakpoint
DROP POLICY IF EXISTS partner_events_visible ON contracts.partner_events;
--> statement-breakpoint
-- Sổ đối tác: đối tác thấy (khoá bên của HĐ mình thấy), sự kiện của HĐ mình thấy, hoặc do mình ghi.
CREATE POLICY partner_events_visible ON contracts.partner_events AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR by_user = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[])
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = partner_events.contract_id AND c.tenant_id = partner_events.tenant_id)));
