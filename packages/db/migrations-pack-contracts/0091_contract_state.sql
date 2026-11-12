-- CR-127 K1a · BR-01/02/06/07/77 · spec §2.1, §3: 4 trạng thái HĐ (draft/processing/reject/done) + cột phụ, hiệu lực dẫn xuất, cổng
-- đổi trạng thái (trigger chặn ghi thẳng), backfill 9 → 4. Một tx (Drizzle). Thứ tự: cột mới → hàm hiệu lực → bỏ CHECK cũ → backfill
-- (tắt trigger người dùng để trigger theo tập cũ không xoá lịch nhắc/không sinh mốc) → CHECK mới → viết lại mọi trigger/hàm còn dùng
-- tập "đã xác nhận" cũ sang `status='done'` → trigger cổng → chỉ mục. `handled`/`action_deadline` giữ tới K6 (MIGC 0096).
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS extract_state text NOT NULL DEFAULT 'ready';
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS effect text;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS effect_outcome text;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS effect_outcome_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS effect_evidence_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS renews_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS submit_round int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS submitted_by uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_extract_state_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_extract_state_ck CHECK (extract_state IN ('reading', 'failed', 'ready'));
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_effect_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_effect_ck CHECK (
  (effect IS NULL OR effect IN ('not_started', 'active', 'expiring', 'expired', 'renewed', 'terminated'))
  AND (effect_outcome IS NULL OR effect_outcome IN ('renewed', 'terminated'))
  AND submit_round >= 0);
--> statement-breakpoint
-- HĐ gia hạn → HĐ cũ (khác `supersedes_id`); khoá theo (id, tenant_id) như `contracts_parent_fk` để không trỏ chéo công ty.
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_renews_fk;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_renews_fk FOREIGN KEY (renews_id, tenant_id)
  REFERENCES contracts.contracts (id, tenant_id) ON DELETE RESTRICT;
--> statement-breakpoint
-- ≡ `HP/domain/effect.rules.ts#effectOf` (bảng ca chung, int test). N = `fields.notice_days` (số nguyên 0…3650), sai/thiếu ⇒ 30.
CREATE OR REPLACE FUNCTION contracts.effect_of(p_status text, p_superseded timestamptz, p_outcome text, p_start date, p_end date,
  p_fields jsonb, p_today date) RETURNS text
  -- Không SET search_path, không truy vấn con: Postgres nội tuyến hàm SQL IMMUTABLE vào câu gọi (refresh_effect theo tập, Luật 4c);
  -- chỉ dùng toán tử/hàm pg_catalog.
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_status <> 'done' OR p_superseded IS NOT NULL THEN NULL
    WHEN p_outcome IS NOT NULL THEN p_outcome
    WHEN p_start > p_today THEN 'not_started'
    WHEN p_end < p_today THEN 'expired'
    WHEN p_end - p_today <= CASE WHEN (p_fields -> 'notice_days' ->> 'value') ~ '^[0-9]{1,4}$'
        THEN CASE WHEN (p_fields -> 'notice_days' ->> 'value')::int <= 3650
          THEN (p_fields -> 'notice_days' ->> 'value')::int ELSE 30 END
        ELSE 30 END THEN 'expiring'
    ELSE 'active' END
$$;
--> statement-breakpoint
-- Nguồn ghi DUY NHẤT của `effect` (cổng khi vào done, vòng nhắc hằng ngày, outcome Sắp hết hạn): MỘT UPDATE theo tập, chỉ hàng đổi;
-- tính hiệu lực một lần mỗi hàng. INVOKER ⇒ RLS của người gọi lọc tenant. Trả số hàng đổi.
CREATE OR REPLACE FUNCTION contracts.refresh_effect(ids uuid[], today date) RETURNS int
  LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  WITH x AS (
    SELECT c.id, contracts.effect_of(c.status, c.superseded_at, c.effect_outcome, c.start_date, c.end_date, c.fields, today) AS e,
      c.effect AS cur
    FROM contracts.contracts c WHERE c.id = ANY (ids)),
  u AS (
    UPDATE contracts.contracts c SET effect = x.e
    FROM x WHERE c.id = x.id AND x.cur IS DISTINCT FROM x.e
    RETURNING 1)
  SELECT count(*)::int FROM u
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.effect_of(text, timestamptz, text, date, date, jsonb, date),
  contracts.refresh_effect(uuid[], date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.effect_of(text, timestamptz, text, date, date, jsonb, date),
  contracts.refresh_effect(uuid[], date) TO contracts_rw;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_status_ck;
--> statement-breakpoint
-- >>> K1A BACKFILL (int test chạy lại đúng đoạn này trên dữ liệu cũ dựng trong tx)
ALTER TABLE contracts.contracts DISABLE TRIGGER USER;
--> statement-breakpoint
DO $$
DECLARE
  r record;
  old5 bigint;
  done0 bigint;
  done1 bigint;
  left_old bigint;
BEGIN
  FOR r IN SELECT status, count(*) AS n FROM contracts.contracts GROUP BY status ORDER BY status LOOP
    RAISE NOTICE 'K1A backfill trước: % = %', r.status, r.n;
  END LOOP;
  SELECT count(*) FILTER (WHERE status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')),
    count(*) FILTER (WHERE status = 'done')
  INTO old5, done0 FROM contracts.contracts;
  -- needs_review: có lượt `approvals` đang mở VÀ HĐ trỏ đúng lượt đó (R#9) ⇒ processing; còn lại ⇒ draft.
  WITH ap AS (
    SELECT a.contract_id, count(*)::int AS n,
      (array_agg(a.started_by ORDER BY a.created_at DESC, a.id DESC))[1] AS last_by
    FROM contracts.approvals a GROUP BY a.contract_id)
  UPDATE contracts.contracts c SET
    status = CASE
      WHEN c.status IN ('extracting', 'extract_failed') THEN 'draft'
      WHEN c.status = 'needs_review' THEN CASE WHEN EXISTS (SELECT 1 FROM contracts.approvals a
          WHERE a.id = c.run_id AND a.contract_id = c.id AND a.tenant_id = c.tenant_id
            AND a.status IN ('extracting', 'level1', 'level2')) THEN 'processing' ELSE 'draft' END
      WHEN c.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated') THEN 'done'
      WHEN c.status = 'rejected' THEN 'reject'
      ELSE c.status END,
    extract_state = CASE c.status WHEN 'extracting' THEN 'reading' WHEN 'extract_failed' THEN 'failed' ELSE 'ready' END,
    effect_outcome = CASE
      WHEN c.status = 'renewed' THEN 'renewed'
      WHEN c.status = 'terminated' THEN 'terminated'
      WHEN c.status IN ('active', 'expiring', 'expired') THEN CASE c.handled ->> 'outcome'
          WHEN 'renewed' THEN 'renewed' WHEN 'replaced' THEN 'terminated' END
      ELSE c.effect_outcome END,
    submit_round = coalesce(src.n, c.submit_round),
    submitted_by = coalesce(src.last_by, c.submitted_by)
  FROM (SELECT x.id, ap.n, ap.last_by FROM contracts.contracts x LEFT JOIN ap ON ap.contract_id = x.id
    WHERE x.status IN ('extracting', 'extract_failed', 'needs_review', 'active', 'expiring', 'expired', 'renewed',
      'terminated', 'rejected')) src
  WHERE c.id = src.id;
  SELECT count(*) FILTER (WHERE status NOT IN ('draft', 'processing', 'reject', 'done')),
    count(*) FILTER (WHERE status = 'done')
  INTO left_old, done1 FROM contracts.contracts;
  IF left_old > 0 THEN
    RAISE EXCEPTION 'K1A backfill: còn % HĐ trạng thái cũ', left_old;
  END IF;
  IF done1 <> done0 + old5 THEN
    RAISE EXCEPTION 'K1A backfill: số done % <> % + %', done1, done0, old5;
  END IF;
  PERFORM contracts.refresh_effect(
    (SELECT coalesce(array_agg(id), '{}'::uuid[]) FROM contracts.contracts WHERE status = 'done' OR effect IS NOT NULL),
    current_date);
  FOR r IN SELECT status, extract_state, count(*) AS n FROM contracts.contracts GROUP BY 1, 2 ORDER BY 1, 2 LOOP
    RAISE NOTICE 'K1A backfill sau: % / % = %', r.status, r.extract_state, r.n;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE contracts.contracts ENABLE TRIGGER USER;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_status_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_status_ck CHECK (status IN ('draft', 'processing', 'reject', 'done'));
--> statement-breakpoint
-- <<< K1A BACKFILL
ALTER TABLE contracts.contracts ALTER COLUMN status SET DEFAULT 'draft';
--> statement-breakpoint
-- K1 (0048/0056): khoá khi vào done (giao dịch không khoá).
DROP TRIGGER IF EXISTS contracts_k1_lock ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k1_lock BEFORE INSERT OR UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (NEW.locked_at IS NULL AND NEW.doc_type <> 'deal' AND NEW.status = 'done')
  EXECUTE FUNCTION contracts.k1_lock_on_confirm();
--> statement-breakpoint
-- K2 (0082): thay bản cũ khi v(n+1) vào done mà đã khoá.
DROP TRIGGER IF EXISTS contracts_k2_supersede ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k2_supersede AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL AND NEW.superseded_at IS NULL AND NEW.locked_at IS NOT NULL
    AND NEW.status = 'done' AND (OLD.locked_at IS NULL OR OLD.status <> 'done'))
  EXECUTE FUNCTION contracts.k2_supersede();
--> statement-breakpoint
-- HD7 (0008): lịch thanh toán mặc định khi vào done.
DROP TRIGGER IF EXISTS contracts_hd7_schedule ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd7_schedule AFTER UPDATE OF status ON contracts.contracts
  FOR EACH ROW WHEN (NEW.kind = 'contract' AND NEW.status = 'done' AND OLD.status <> 'done')
  EXECUTE FUNCTION contracts.hd7_default_schedule();
--> statement-breakpoint
-- HD4 (0007): hạn đổi ⇒ bỏ `handled`; trạng thái không còn mang hiệu lực (hiệu lực = `effect`, do `refresh_effect` ghi).
CREATE OR REPLACE FUNCTION contracts.hd4_deadline() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.action_deadline := contracts.deadline_of(NEW.kind, NEW.fields);
  IF TG_OP = 'UPDATE' AND NEW.action_deadline IS DISTINCT FROM OLD.action_deadline
     AND OLD.handled IS NOT NULL AND NEW.handled IS NOT DISTINCT FROM OLD.handled THEN
    NEW.handled := NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.hd4_schedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.kind <> 'contract' OR NEW.status <> 'done' THEN
    IF TG_OP = 'UPDATE' THEN DELETE FROM contracts.contract_schedule WHERE contract_id = NEW.id; END IF;
  ELSIF TG_OP = 'INSERT' OR OLD.status <> 'done' OR OLD.kind <> 'contract'
     OR NEW.action_deadline IS DISTINCT FROM OLD.action_deadline OR NEW.handled IS DISTINCT FROM OLD.handled
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR (NEW.fields -> 'end_date' ->> 'value') IS DISTINCT FROM (OLD.fields -> 'end_date' ->> 'value') THEN
    INSERT INTO contracts.contract_schedule (contract_id, tenant_id, remind_at) VALUES (NEW.id, NEW.tenant_id, '-infinity')
      ON CONFLICT (contract_id) DO UPDATE SET remind_at = '-infinity';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_schedule_upd ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_schedule_upd AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.fields IS DISTINCT FROM NEW.fields OR OLD.handled IS DISTINCT FROM NEW.handled
    OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id OR OLD.kind IS DISTINCT FROM NEW.kind
    OR (OLD.status IS DISTINCT FROM NEW.status AND (OLD.status = 'done' OR NEW.status = 'done')))
  EXECUTE FUNCTION contracts.hd4_schedule();
--> statement-breakpoint
-- V2-A (0022): loại HĐ cố định sau khi lưu (done).
CREATE OR REPLACE FUNCTION contracts.v2a_deal() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.deal := coalesce(NEW.deal, CASE NEW.direction WHEN 'sale' THEN 'sell' WHEN 'purchase' THEN 'buy' END);
    RETURN NEW;
  END IF;
  IF NEW.direction IS DISTINCT FROM OLD.direction AND NEW.deal IS NOT DISTINCT FROM OLD.deal
     AND OLD.deal IS DISTINCT FROM 'referral' THEN
    NEW.deal := CASE NEW.direction WHEN 'sale' THEN 'sell' WHEN 'purchase' THEN 'buy' END;
  END IF;
  IF NEW.deal IS DISTINCT FROM OLD.deal AND OLD.deal IS NOT NULL AND OLD.status = 'done' THEN
    RAISE EXCEPTION 'contract type is fixed after save' USING ERRCODE = 'check_violation', CONSTRAINT = 'contracts_deal_fixed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- V2-C (0024): vai đối tác từ HĐ done.
CREATE OR REPLACE FUNCTION contracts.v2c_partner_roles() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  me uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from, contract_id, created_by)
    SELECT n.tenant_id, r.party_key, r.role, r.name, 'contract', n.id, coalesce(me, n.created_by)
    FROM v2c_new n CROSS JOIN LATERAL contracts.partner_role_of(n) r
    WHERE n.kind = 'contract' AND n.status = 'done'
      AND char_length(r.party_key) <= 300
    ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
  ELSE
    INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from, contract_id, created_by)
    SELECT n.tenant_id, r.party_key, r.role, r.name, 'contract', n.id, coalesce(me, n.created_by)
    FROM v2c_new n JOIN v2c_old o ON o.id = n.id
      CROSS JOIN LATERAL contracts.partner_role_of(n) r
    WHERE n.kind = 'contract' AND n.status = 'done'
      AND (o.fields IS DISTINCT FROM n.fields OR o.direction IS DISTINCT FROM n.direction OR o.deal IS DISTINCT FROM n.deal
        OR o.status <> 'done')
      AND char_length(r.party_key) <= 300
    ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- V2-D (0026/0049): khách dịch vụ từ HĐ bán done (giữ SECURITY DEFINER + kiểm tenant như bản cũ).
CREATE OR REPLACE FUNCTION contracts.v2d_sync_service_customers(p_contract uuid, p_tenant uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope text := NULLIF(current_setting('app.tenant_id', true), '');
  done text := coalesce(current_setting('contracts.v2d_sc', true), '');
  chain uuid;
BEGIN
  IF p_tenant IS NULL OR p_contract IS NULL THEN
    RETURN;
  END IF;
  IF scope IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls)) THEN
      RAISE EXCEPTION 'v2d_sync_service_customers: tx chưa đặt app.tenant_id' USING ERRCODE = '42501';
    END IF;
  ELSIF scope <> p_tenant::text THEN
    RAISE EXCEPTION 'v2d_sync_service_customers: tenant khác phạm vi tx' USING ERRCODE = '42501';
  END IF;
  IF strpos(done, p_contract::text) > 0 THEN
    RETURN;
  END IF;
  PERFORM set_config('contracts.v2d_sc', done || p_contract::text || ',', true);
  SELECT c.root_id INTO chain FROM contracts.contracts c WHERE c.tenant_id = p_tenant AND c.id = p_contract;
  INSERT INTO contracts.service_customers AS s (tenant_id, product_id, party_key, customer_name, contract_id, started_on,
    expires_on)
  SELECT DISTINCT ON (i.product_id) c.tenant_id, i.product_id, k.key, left(c.buyer, 300), c.id, c.start_date, c.end_date
  FROM contracts.contracts c
  CROSS JOIN LATERAL (SELECT contracts.party_key(c.fields -> 'buyer_name' ->> 'value',
    c.fields -> 'buyer_tax_id' ->> 'value') AS key) k
  JOIN contracts.contract_items i ON i.tenant_id = c.tenant_id AND i.contract_id = c.id AND i.product_id IS NOT NULL
  JOIN contracts.products p ON p.tenant_id = c.tenant_id AND p.id = i.product_id AND p.grp = 'service'
  WHERE c.tenant_id = p_tenant AND c.id = p_contract AND c.kind = 'contract' AND c.deal = 'sell'
    AND c.status = 'done' AND k.key IS NOT NULL
    AND char_length(k.key) <= 300
  ORDER BY i.product_id
  ON CONFLICT (tenant_id, product_id, party_key) DO UPDATE SET
    renewals = s.renewals + CASE WHEN s.contract_id <> EXCLUDED.contract_id AND NOT EXISTS (SELECT 1
      FROM contracts.contracts o WHERE o.tenant_id = s.tenant_id AND o.id = s.contract_id AND o.root_id = chain)
      THEN 1 ELSE 0 END,
    prev_contract_id = CASE WHEN s.contract_id <> EXCLUDED.contract_id AND NOT EXISTS (SELECT 1
      FROM contracts.contracts o WHERE o.tenant_id = s.tenant_id AND o.id = s.contract_id AND o.root_id = chain)
      THEN s.contract_id ELSE s.prev_contract_id END,
    contract_id = EXCLUDED.contract_id, customer_name = EXCLUDED.customer_name, started_on = EXCLUDED.started_on,
    expires_on = EXCLUDED.expires_on, updated_at = now()
  WHERE s.contract_id = EXCLUDED.contract_id OR s.expires_on IS NULL
    OR coalesce(EXCLUDED.expires_on, 'infinity'::date) >= s.expires_on
    OR EXISTS (SELECT 1 FROM contracts.contracts o WHERE o.tenant_id = s.tenant_id AND o.id = s.contract_id
      AND o.root_id = chain);
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2d_sc_ins ON contracts.contracts;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contracts_v2d_sc_ins AFTER INSERT ON contracts.contracts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.deal = 'sell' AND NEW.kind = 'contract' AND NEW.status = 'done')
  EXECUTE FUNCTION contracts.v2d_sc_contract();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2d_sc_upd ON contracts.contracts;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contracts_v2d_sc_upd AFTER UPDATE ON contracts.contracts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.deal = 'sell' AND NEW.kind = 'contract' AND NEW.status = 'done'
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.deal IS DISTINCT FROM NEW.deal OR OLD.end_date IS DISTINCT FROM NEW.end_date
      OR OLD.start_date IS DISTINCT FROM NEW.start_date OR OLD.buyer IS DISTINCT FROM NEW.buyer
      OR (OLD.fields -> 'buyer_tax_id') IS DISTINCT FROM (NEW.fields -> 'buyer_tax_id')))
  EXECUTE FUNCTION contracts.v2d_sc_contract();
--> statement-breakpoint
-- M1-C (0016/0020): khoá đối tác thấy được từ HĐ done.
CREATE OR REPLACE FUNCTION contracts.visible_party_keys() RETURNS text[]
  LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT k.k) FILTER (WHERE k.k IS NOT NULL), '{}'::text[])
  FROM contracts.contracts c CROSS JOIN LATERAL (VALUES
    (contracts.party_key(c.fields -> 'buyer_name' ->> 'value', c.fields -> 'buyer_tax_id' ->> 'value')),
    (contracts.party_key(c.fields -> 'supplier_name' ->> 'value', c.fields -> 'supplier_tax_id' ->> 'value'))) k(k)
  WHERE c.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    AND c.status = 'done'
    AND c.confirmed_by IS DISTINCT FROM c.created_by
$$;
--> statement-breakpoint
-- R#24/R#46 · chặn ghi thẳng `status` ngoài cổng `applyTransition` (lưới chống sót lập trình, KHÔNG phải ranh giới bảo mật — role gói
-- vẫn đặt được GUC; bảo mật = RLS + quyền route). Cổng đặt `contracts.state_gate` = id HĐ (hoặc `bulk:<txid>` cho UPDATE theo tập).
CREATE OR REPLACE FUNCTION contracts.status_gate() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  g text := coalesce(current_setting('contracts.state_gate', true), '');
BEGIN
  IF g = NEW.id::text OR g = 'bulk:' || txid_current()::text THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'STATUS_GATE_ONLY' USING DETAIL = 'contracts.status chỉ đổi qua cổng applyTransition (CR-127)';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.status_gate() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_status_gate ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_status_gate BEFORE UPDATE OF status ON contracts.contracts
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION contracts.status_gate();
--> statement-breakpoint
DROP INDEX IF EXISTS contracts.contracts_status_idx;
--> statement-breakpoint
-- Spec §2.1 ghi (tenant_id, status, effect): `effect` ra khỏi khoá chỉ mục để `refresh_effect` cập nhật HOT được (đo 10.000 hàng:
-- có `effect` trong khoá 2,3–2,9 s > ngưỡng 2 s; bỏ ⇒ ~1,4 s). Lọc hiệu lực đọc từ heap sau khi chỉ mục lọc (tenant, status).
CREATE INDEX IF NOT EXISTS contracts_status_cur_idx ON contracts.contracts (tenant_id, status)
  WHERE superseded_at IS NULL;
