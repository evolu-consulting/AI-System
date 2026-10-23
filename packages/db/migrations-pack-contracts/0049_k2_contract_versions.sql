-- CR-097 K2 · HD-FR-101 "Tải bản cập nhật" = phiên bản mới cùng chuỗi · HD-FR-102 xác nhận v(n+1) ⇒ bản trước bị thay (v1 giữ ngày
-- của nó, decision 5) · HD-FR-103 cutover nghĩa vụ · R18 danh sách chỉ bản hiện hành. Chỉ cộng thêm; chạy lại vô hại.
-- Chuỗi: `root_id` (= id của v1), `version_no` (1, 2, …), `supersedes_id` (bản mà nháp này sẽ thay), `superseded_at/by` (bị thay lúc /
-- bởi bản nào). Bản hiện hành = bản chưa bị thay có `version_no` nhỏ nhất; bản chưa bị thay lớn hơn = nháp mở (tối đa 1 / chuỗi).
-- Phiên bản ≠ phụ lục (`parent_id`) ≠ gia hạn (HĐ mới, V2-H) — decision 9: không đụng `parent_id`.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS root_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS version_no int NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS supersedes_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS superseded_by uuid;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS cancel_reason text;
--> statement-breakpoint
-- Backfill: mọi HĐ hiện có = v1 của chuỗi riêng. Một câu theo tập; trigger hàng của `contracts` đều có WHEN theo cột khác ⇒ không chạy.
UPDATE contracts.contracts SET root_id = id WHERE root_id IS NULL;
--> statement-breakpoint
-- Đường ghi khác (CKS, import, nhập tay cũ, fixture) không biết chuỗi ⇒ BEFORE INSERT lấp `root_id = id`.
CREATE OR REPLACE FUNCTION contracts.k2_root_default() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.root_id := NEW.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.k2_root_default() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_k2_root ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k2_root BEFORE INSERT ON contracts.contracts
  FOR EACH ROW WHEN (NEW.root_id IS NULL) EXECUTE FUNCTION contracts.k2_root_default();
--> statement-breakpoint
ALTER TABLE contracts.contracts ALTER COLUMN root_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_version_no_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_version_no_ck CHECK (version_no BETWEEN 1 AND 999
  AND (version_no = 1) = (supersedes_id IS NULL) AND (version_no = 1) = (root_id = id)
  AND (superseded_at IS NULL) = (superseded_by IS NULL));
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_root_fk;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_root_fk FOREIGN KEY (root_id, tenant_id)
  REFERENCES contracts.contracts (id, tenant_id);
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_supersedes_fk;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_supersedes_fk FOREIGN KEY (supersedes_id, tenant_id)
  REFERENCES contracts.contracts (id, tenant_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS contracts_chain_no_uq ON contracts.contracts (tenant_id, root_id, version_no);
--> statement-breakpoint
-- Một nháp mở mỗi chuỗi (lưới đua cho kiểm ở câu tải lên): bản v≥2 chưa khoá, chưa bị thay.
CREATE UNIQUE INDEX IF NOT EXISTS contracts_open_draft_uq ON contracts.contracts (tenant_id, root_id)
  WHERE supersedes_id IS NOT NULL AND locked_at IS NULL AND superseded_at IS NULL;
--> statement-breakpoint
-- R18 · danh sách bản hiện hành (cùng thứ tự mặc định `updated_at desc, id desc` của HD1) — partial, bản bị thay ra khỏi index.
CREATE INDEX IF NOT EXISTS contracts_current_list_idx ON contracts.contracts (tenant_id, updated_at DESC, id DESC)
  WHERE superseded_at IS NULL;
--> statement-breakpoint
-- HD-FR-102 · bản bị thay CHỈ ĐỌC ở mức hàng: đổi nội dung/người phụ trách/khoá/xử lý ⇒ lỗi `EK409` (Hub ⇒ 409 CONTRACT_SUPERSEDED).
-- Trạng thái (vòng quét hạn) và cột kỹ thuật không chặn để vòng nền theo tập không vỡ.
CREATE OR REPLACE FUNCTION contracts.k2_superseded_ro() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'CONTRACT_SUPERSEDED' USING ERRCODE = 'EK409';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.k2_superseded_ro() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_k2_ro ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k2_ro BEFORE UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.superseded_at IS NOT NULL AND (
    (NEW.fields, NEW.owner_user_id, NEW.locked_at, NEW.commission_pct, NEW.commission_fixed, NEW.deal, NEW.direction,
      NEW.parent_id, NEW.handled, NEW.title, NEW.file_id, NEW.superseded_at, NEW.superseded_by, NEW.root_id, NEW.version_no)
    IS DISTINCT FROM
    (OLD.fields, OLD.owner_user_id, OLD.locked_at, OLD.commission_pct, OLD.commission_fixed, OLD.deal, OLD.direction,
      OLD.parent_id, OLD.handled, OLD.title, OLD.file_id, OLD.superseded_at, OLD.superseded_by, OLD.root_id, OLD.version_no)))
  EXECUTE FUNCTION contracts.k2_superseded_ro();
--> statement-breakpoint
-- HD-FR-102/103 · xác nhận v(n+1) (mọi đường: "Lưu" khi tắt duyệt, finalize máy duyệt, contract-flow) — K1 BEFORE đã lấp `locked_at`
-- ⇒ AFTER này chạy trong CÙNG tx. Ba câu theo tập, số câu cố định (không vòng hàng):
--  ① bản trước chưa bị thay trong chuỗi ⇒ `superseded_at/by` (v1 giữ nguyên ngày/trường — decision 5);
--  ② nghĩa vụ `open` của các bản đó có hạn ≥ ngày hiệu lực v(n+1) ⇒ `cancelled` + lý do "thay bằng phiên bản N"; nghĩa vụ đã có dòng
--     kho (`stock_moves.milestone_id`) GIỮ (không đảo kho) và ghi vào kết quả; đã xong / đã thay không đụng;
--  ③ event `version_cutover` trên v(n+1) {superseded, cancelled, kept_stock, effective_from} + `superseded` trên bản bị thay.
-- Ngày hiệu lực = `start_date` của v(n+1), trống ⇒ hôm nay (theo `current_date` của phiên). Đồng bộ `versions.rules.ts::cutoverPlan`.
CREATE OR REPLACE FUNCTION contracts.k2_supersede() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  sup uuid[];
  eff date := coalesce(NEW.start_date, current_date);
  cancelled uuid[];
  kept uuid[];
BEGIN
  WITH s AS (
    UPDATE contracts.contracts c SET superseded_at = now(), superseded_by = NEW.id
    WHERE c.tenant_id = NEW.tenant_id AND c.root_id = NEW.root_id AND c.version_no < NEW.version_no
      AND c.superseded_at IS NULL
    RETURNING c.id)
  SELECT coalesce(array_agg(s.id), '{}'::uuid[]) INTO sup FROM s;
  IF cardinality(sup) = 0 THEN
    RETURN NULL;
  END IF;
  WITH cand AS (
    SELECT o.id, EXISTS (SELECT 1 FROM contracts.stock_moves m
        WHERE m.tenant_id = o.tenant_id AND m.milestone_id = o.id) AS has_stock
    FROM contracts.obligations o
    WHERE o.tenant_id = NEW.tenant_id AND o.contract_id = ANY (sup) AND o.status = 'open' AND o.due_date >= eff),
  u AS (
    UPDATE contracts.obligations o SET status = 'cancelled', cancel_reason = 'thay bằng phiên bản ' || NEW.version_no,
      updated_at = now()
    FROM cand WHERE o.id = cand.id AND o.tenant_id = NEW.tenant_id AND NOT cand.has_stock
    RETURNING o.id)
  SELECT coalesce((SELECT array_agg(u.id ORDER BY u.id) FROM u), '{}'::uuid[]),
    coalesce((SELECT array_agg(cand.id ORDER BY cand.id) FROM cand WHERE cand.has_stock), '{}'::uuid[])
  INTO cancelled, kept;
  INSERT INTO contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
  SELECT NEW.tenant_id, NEW.id, 'version_cutover', NEW.confirmed_by, jsonb_build_object('superseded', to_jsonb(sup),
      'cancelled', to_jsonb(cancelled), 'kept_stock', to_jsonb(kept), 'effective_from', eff, 'version_no', NEW.version_no)
  UNION ALL
  SELECT NEW.tenant_id, x, 'superseded', NEW.confirmed_by, jsonb_build_object('by', NEW.id, 'version_no', NEW.version_no)
  FROM unnest(sup) x;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.k2_supersede() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_k2_supersede ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k2_supersede AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL AND NEW.superseded_at IS NULL
    AND OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL)
  EXECUTE FUNCTION contracts.k2_supersede();
--> statement-breakpoint
-- V2-H · khách đang dùng dịch vụ: v(n+1) cùng chuỗi tiếp quản dòng của bản trước KHÔNG tính là gia hạn (renewals/prev giữ nguyên) và
-- luôn tiếp quản (kể cả hạn mới sớm hơn). Còn lại y hệt 0029.
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
    AND c.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated') AND k.key IS NOT NULL
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
REVOKE ALL ON FUNCTION contracts.v2d_sync_service_customers(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2d_sync_service_customers(uuid, uuid) TO contracts_rw;
--> statement-breakpoint
ALTER FUNCTION contracts.v2d_sync_service_customers(uuid, uuid) OWNER TO contracts_sc;
