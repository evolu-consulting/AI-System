-- CR-152 cr152c · Điểm uy tín cho «Nhượng quyền» + «Thỏa thuận hợp tác» (gỡ TECH-DEBT #268). Chỉ cộng thêm / nới ràng buộc; không backfill
-- dữ liệu cũ (chưa có khách). Ô uy tín thêm (≡ `REP_CELLS` ở `rep-config.rules.ts`): 6 nhượng quyền·bên nhận quyền (mình là bên nhượng
-- quyền, `direction = sale`) · 7 nhượng quyền·bên nhượng quyền (mình nhận quyền, `purchase`) · 8 hợp tác·đối tác hợp tác (CHỈ có chia
-- tiền: `kind_terms.split_basis` ∈ profit|revenue; «không chia» ⇒ null ⇒ không tính, như HĐ nguyên tắc).
CREATE OR REPLACE FUNCTION contracts.rep_cell_of(deal text, product_group text, direction text, kind_terms jsonb) RETURNS smallint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE deal
    WHEN 'franchise' THEN CASE direction WHEN 'sale' THEN 6 WHEN 'purchase' THEN 7 END
    WHEN 'cooperation' THEN CASE WHEN kind_terms ->> 'split_basis' IN ('profit', 'revenue') THEN 8 END
    ELSE contracts.v2e_cell(deal, product_group) END;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.rep_cell_of(text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.rep_cell_of(text, text, text, jsonb) TO contracts_rw;
--> statement-breakpoint
-- PG16 chưa có `SET EXPRESSION` ⇒ dựng lại cột sinh sẵn (bảng nhỏ, chưa có khách). Trigger phụ thuộc cột gỡ trước, dựng lại sau.
DROP TRIGGER IF EXISTS contracts_v2e_cell ON contracts.contracts;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP COLUMN IF EXISTS rep_cell;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN rep_cell smallint
  GENERATED ALWAYS AS (contracts.rep_cell_of(deal, product_group, direction, kind_terms)) STORED;
--> statement-breakpoint
CREATE TRIGGER contracts_v2e_cell AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.rep_cell IS DISTINCT FROM NEW.rep_cell) EXECUTE FUNCTION contracts.v2e_contract_cell();
--> statement-breakpoint
-- Mốc đã có của HĐ hai loại mới (hook DONE chép ô lúc sinh mốc; ô đổi sau đó trigger trên đã chép).
UPDATE contracts.obligations o SET rep_cell = c.rep_cell FROM contracts.contracts c
  WHERE c.tenant_id = o.tenant_id AND c.id = o.contract_id AND c.deal IN ('franchise', 'cooperation')
    AND o.rep_cell IS DISTINCT FROM c.rep_cell;
--> statement-breakpoint
-- Vai đối tác: nhượng quyền ⇒ bên NHẬN quyền khi mình nhượng quyền (`sale`, bên mua), bên NHƯỢNG quyền khi mình nhận quyền (`purchase`,
-- bên bán); hợp tác có chia ⇒ đối tác hợp tác (bên mua, `sale`); hợp tác không chia ⇒ không vai (không vào danh sách đối tác).
CREATE OR REPLACE FUNCTION contracts.partner_role_of(c contracts.contracts)
  RETURNS TABLE (party_key text, role text, name text)
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT contracts.party_key(c.fields -> (s.side || '_name') ->> 'value', c.fields -> (s.side || '_tax_id') ->> 'value'),
    s.role, left(nullif(btrim(c.fields -> (s.side || '_name') ->> 'value'), ''), 300)
  FROM (SELECT CASE d WHEN 'buy' THEN 'supplier' WHEN 'sell' THEN 'customer' WHEN 'referral' THEN 'commission_payer'
          WHEN 'franchise' THEN CASE c.direction WHEN 'sale' THEN 'franchisee' WHEN 'purchase' THEN 'franchisor' END
          WHEN 'cooperation' THEN CASE WHEN c.kind_terms ->> 'split_basis' IN ('profit', 'revenue') THEN 'cooperator' END END AS role,
          CASE WHEN c.direction = 'sale' THEN 'buyer' ELSE 'supplier' END AS side
        FROM (SELECT coalesce(c.deal, CASE c.direction WHEN 'purchase' THEN 'buy' WHEN 'sale' THEN 'sell' END) AS d) x) s
  WHERE s.role IS NOT NULL
$$;
--> statement-breakpoint
ALTER TABLE contracts.partner_roles DROP CONSTRAINT IF EXISTS partner_roles_role_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_roles ADD CONSTRAINT partner_roles_role_ck
  CHECK (role IN ('supplier', 'customer', 'commission_payer', 'franchisee', 'franchisor', 'cooperator'));
--> statement-breakpoint
ALTER TABLE contracts.partner_events DROP CONSTRAINT IF EXISTS partner_events_role_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD CONSTRAINT partner_events_role_ck
  CHECK (role IN ('customer', 'supplier', 'commission_payer', 'franchisee', 'franchisor', 'cooperator'));
--> statement-breakpoint
ALTER TABLE contracts.partner_events DROP CONSTRAINT IF EXISTS partner_events_v2e_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD CONSTRAINT partner_events_v2e_ck CHECK (
  (grp IS NULL OR grp IN ('service', 'goods', 'referral', 'franchise', 'cooperation'))
  AND (job_type IS NULL OR job_type ~ '^[a-z0-9_:-]{1,60}$')
  AND ((type = 'job') = (job_type IS NOT NULL AND grp IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE contracts.score_ratings DROP CONSTRAINT IF EXISTS score_ratings_cell_ck;
--> statement-breakpoint
ALTER TABLE contracts.score_ratings ADD CONSTRAINT score_ratings_cell_ck CHECK ((grp, role) IN (('service', 'supplier'),
  ('service', 'customer'), ('goods', 'supplier'), ('goods', 'customer'), ('referral', 'commission_payer'),
  ('franchise', 'franchisee'), ('franchise', 'franchisor'), ('cooperation', 'cooperator')));
--> statement-breakpoint
ALTER TABLE contracts.score_locks DROP CONSTRAINT IF EXISTS score_locks_role_ck;
--> statement-breakpoint
ALTER TABLE contracts.score_locks ADD CONSTRAINT score_locks_role_ck
  CHECK (role IN ('supplier', 'customer', 'commission_payer', 'franchisee', 'franchisor', 'cooperator'));
--> statement-breakpoint
ALTER TABLE contracts.score_locks DROP CONSTRAINT IF EXISTS score_locks_grp_ck;
--> statement-breakpoint
ALTER TABLE contracts.score_locks ADD CONSTRAINT score_locks_grp_ck
  CHECK (grp IN ('service', 'goods', 'referral', 'franchise', 'cooperation', 'all'));
--> statement-breakpoint
ALTER TABLE contracts.score_configs_v2 DROP CONSTRAINT IF EXISTS score_configs_v2_scope_ck;
--> statement-breakpoint
ALTER TABLE contracts.score_configs_v2 ADD CONSTRAINT score_configs_v2_scope_ck CHECK (scope IN ('settings', 'job_types',
  'service:supplier', 'service:customer', 'goods:supplier', 'goods:customer', 'referral:commission_payer',
  'franchise:franchisee', 'franchise:franchisor', 'cooperation:cooperator', 'business'));
