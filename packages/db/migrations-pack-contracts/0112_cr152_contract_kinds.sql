-- CR-152 · Hai loại HĐ mới: `deal` = franchise (Nhượng quyền) | cooperation (Thỏa thuận hợp tác) — CHỈ HĐ kinh tế (`doc_type = contract`).
-- Chỉ cộng thêm / nới ràng buộc; không backfill (chưa có khách). Một nguồn: trường riêng của hai loại ở MỘT cột `contracts.kind_terms`
-- (jsonb, RLS như HĐ); kỳ doanh thu / đối soát nằm trên mốc (`obligations.period_key` + `period_figure`), không bảng riêng.
-- Hướng tiền (`direction`): bên nhận quyền ⇒ `purchase`; bên nhượng quyền và Hợp tác ⇒ `sale` (code chọn theo vai, CHECK chỉ nới).
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_deal_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_deal_ck CHECK (deal IS NULL OR (direction IS NOT NULL AND (
  (deal IN ('buy', 'sell', 'referral') AND (deal = 'buy') = (direction = 'purchase'))
  OR (deal = 'franchise' AND direction IN ('sale', 'purchase') AND doc_type = 'contract')
  OR (deal = 'cooperation' AND direction = 'sale' AND doc_type = 'contract'))));
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS kind_terms jsonb;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_kind_terms_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_kind_terms_ck CHECK (kind_terms IS NULL
  OR (jsonb_typeof(kind_terms) = 'object' AND deal IN ('franchise', 'cooperation')));
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS period_key text;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS period_figure bigint;
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_period_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_period_ck CHECK (
  (period_key IS NULL OR period_key ~ '^[0-9]{4}(-([0-9]{2}|Q[1-4]))?$')
  AND (period_figure IS NULL OR (period_key IS NOT NULL AND period_figure BETWEEN 0 AND 1000000000000000)));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS obligations_period_idx ON contracts.obligations (tenant_id, contract_id, period_key)
  WHERE period_key IS NOT NULL AND status <> 'replaced';
--> statement-breakpoint
-- Loại HĐ giữ nguyên khi đổi hướng (như Giới thiệu, 0091): `deal` của hai loại mới không suy lại từ `direction`.
CREATE OR REPLACE FUNCTION contracts.v2a_deal() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.deal := coalesce(NEW.deal, CASE NEW.direction WHEN 'sale' THEN 'sell' WHEN 'purchase' THEN 'buy' END);
    RETURN NEW;
  END IF;
  IF NEW.direction IS DISTINCT FROM OLD.direction AND NEW.deal IS NOT DISTINCT FROM OLD.deal
     AND coalesce(OLD.deal, '') NOT IN ('referral', 'franchise', 'cooperation') THEN
    NEW.deal := CASE NEW.direction WHEN 'sale' THEN 'sell' WHEN 'purchase' THEN 'buy' END;
  END IF;
  IF NEW.deal IS DISTINCT FROM OLD.deal AND OLD.deal IS NOT NULL AND OLD.status = 'done' THEN
    RAISE EXCEPTION 'contract type is fixed after save' USING ERRCODE = 'check_violation', CONSTRAINT = 'contracts_deal_fixed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- HD7 (0008): lịch mặc định "một đợt toàn giá trị" KHÔNG áp cho hai loại mới — bộ mốc của chúng do hook DONE sinh
-- (`kind-schedule.hook`, luật thuần `kind-schedule.rules.ts`), nên ở đây bỏ qua để khỏi sinh mốc thanh toán thừa.
CREATE OR REPLACE FUNCTION contracts.hd7_default_schedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  side text := CASE WHEN NEW.direction = 'sale' THEN 'buyer' ELSE 'supplier' END;
  due date;
BEGIN
  IF NEW.direction IS NULL OR NEW.direction NOT IN ('sale', 'purchase') THEN RETURN NULL; END IF;
  IF NEW.deal IN ('franchise', 'cooperation') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM contracts.obligations o
             WHERE o.tenant_id = NEW.tenant_id AND o.contract_id = NEW.id AND o.status <> 'replaced') THEN
    RETURN NULL;
  END IF;
  due := coalesce(NEW.end_date, contracts.as_date(NEW.fields -> 'start_date' ->> 'value'),
    contracts.as_date(NEW.fields -> 'signed_date' ->> 'value'));
  IF due IS NULL THEN RETURN NULL; END IF;
  INSERT INTO contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
  VALUES (NEW.tenant_id, NEW.id,
    contracts.party_key(NEW.fields -> (side || '_name') ->> 'value', NEW.fields -> (side || '_tax_id') ->> 'value'),
    CASE WHEN NEW.direction = 'sale' THEN 'receive' ELSE 'pay' END, 'payment', 1, due,
    CASE WHEN NEW.value BETWEEN 0 AND 1000000000000000 THEN NEW.value END, 'default');
  RETURN NULL;
END $$;
