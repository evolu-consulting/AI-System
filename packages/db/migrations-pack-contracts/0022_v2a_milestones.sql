-- V2-A · BA v2 §2 (Loại HĐ, Mốc HĐ) · §3.1 HD-01/HD-09/HD-11 · §5.4 · intake C2/C3/C8: HĐ 3 loại + mốc 7 loại + cờ tắt duyệt.
-- Chỉ cộng thêm + backfill rẻ; chạy lại vô hại. Không bảng mới: mốc = hàng `contracts.obligations` mở rộng (giữ /payments, mywork,
-- vòng quá hạn). 7 loại BA ↔ (kind, direction): Thu tiền/Thanh toán = `payment` + hướng tiền; loại khác giữ hướng theo HĐ.
--
-- 1) HĐ: `deal` buy|sell|referral (backfill từ `direction`; Giới thiệu = tiền vào ⇒ direction `sale`) + hoa hồng (% hoặc cố định,
--    chỉ HĐ Giới thiệu) + cột sinh `start_date` (danh sách suy giai đoạn không đọc `fields`). Loại HĐ không đổi sau khi đã lưu
--    (trạng thái đã xác nhận) — HD-09; trước đó `deal` tự theo `direction` (AI đọc lại có thể đổi hướng).
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS deal text;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS commission_pct numeric(5, 2);
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS commission_fixed bigint;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS start_date date
  GENERATED ALWAYS AS (contracts.as_date(fields -> 'start_date' ->> 'value')) STORED;
--> statement-breakpoint
UPDATE contracts.contracts SET deal = CASE direction WHEN 'sale' THEN 'sell' WHEN 'purchase' THEN 'buy' END
  WHERE deal IS NULL AND direction IS NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_deal_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_deal_ck CHECK (deal IS NULL
  OR (deal IN ('buy', 'sell', 'referral') AND direction IS NOT NULL AND (deal = 'buy') = (direction = 'purchase')));
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_commission_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_commission_ck CHECK (
  ((commission_pct IS NULL AND commission_fixed IS NULL) OR deal = 'referral')
  AND NOT (commission_pct IS NOT NULL AND commission_fixed IS NOT NULL)
  AND commission_pct BETWEEN 0 AND 100 AND commission_fixed BETWEEN 0 AND 1000000000000000);
--> statement-breakpoint
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
  IF NEW.deal IS DISTINCT FROM OLD.deal AND OLD.deal IS NOT NULL
     AND OLD.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated') THEN
    RAISE EXCEPTION 'contract type is fixed after save' USING ERRCODE = 'check_violation', CONSTRAINT = 'contracts_deal_fixed';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2a_deal() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2a_deal() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2a_deal ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_v2a_deal BEFORE INSERT ON contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION contracts.v2a_deal();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2a_deal_upd ON contracts.contracts;
--> statement-breakpoint
-- WHEN đánh giá trong C: UPDATE không đụng loại/hướng (vòng nhắc, sửa trường…) không vào plpgsql.
CREATE TRIGGER contracts_v2a_deal_upd BEFORE UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.deal IS DISTINCT FROM NEW.deal OR OLD.direction IS DISTINCT FROM NEW.direction)
  EXECUTE FUNCTION contracts.v2a_deal();
--> statement-breakpoint
-- 2) Mốc: 4 loại mới (`commission` nhận hoa hồng, `serial` cấp serial/kích hoạt, `renewal` nhắc gia hạn, `other`), tên mốc,
--    việc của ai (`owner`), lỗi do ai khi trễ (`fault`, chỉ mốc đã xác nhận), số lượng (chỉ Giao hàng; null = giao hết phần còn lại).
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS title text;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS owner text;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS fault text;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS qty numeric(18, 4);
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_kind_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_kind_ck
  CHECK (kind IN ('payment', 'delivery', 'commission', 'serial', 'renewal', 'other'));
--> statement-breakpoint
-- Việc của ai mặc định (≡ `milestones.rules.ts::defaultOwner`): tiền vào / hoa hồng ⇒ đối tác; trả tiền ⇒ mình; giao + serial theo
-- hướng HĐ (mua ⇒ NCC giao); nhắc gia hạn / khác ⇒ mình. Đường cũ (lịch HD7, CKS, trigger duyệt) không ghi `owner` ⇒ trigger điền.
CREATE OR REPLACE FUNCTION contracts.v2a_owner_of(kind text, direction text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog
  RETURN CASE
    WHEN kind = 'payment' THEN CASE WHEN direction = 'receive' THEN 'partner' ELSE 'ours' END
    WHEN kind IN ('delivery', 'serial') THEN CASE WHEN direction = 'pay' THEN 'partner' ELSE 'ours' END
    WHEN kind = 'commission' THEN 'partner'
    ELSE 'ours'
  END;
--> statement-breakpoint
UPDATE contracts.obligations SET owner = contracts.v2a_owner_of(kind, direction) WHERE owner IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.v2a_obligation_owner() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.owner := contracts.v2a_owner_of(NEW.kind, NEW.direction);
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2a_owner_of(text, text), contracts.v2a_obligation_owner() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2a_owner_of(text, text), contracts.v2a_obligation_owner() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS obligations_v2a_owner ON contracts.obligations;
--> statement-breakpoint
CREATE TRIGGER obligations_v2a_owner BEFORE INSERT ON contracts.obligations
  FOR EACH ROW WHEN (NEW.owner IS NULL) EXECUTE FUNCTION contracts.v2a_obligation_owner();
--> statement-breakpoint
ALTER TABLE contracts.obligations ALTER COLUMN owner SET NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_v2a_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_v2a_ck CHECK (
  owner IN ('ours', 'partner')
  AND (fault IS NULL OR (fault IN ('partner', 'ours', 'unknown') AND status = 'done'))
  AND (qty IS NULL OR (kind = 'delivery' AND qty BETWEEN 0 AND 99999999999999))
  AND char_length(title) BETWEEN 1 AND 200);
--> statement-breakpoint
-- 3) C3 · cờ duyệt theo tenant: hàng cài đặt (null = mặc định) > mặc định theo tenant (tắt cho `nitigroup` + `demo` — tenant dùng
--    BA v2, HĐ lưu là có hiệu lực) > bật. SECURITY DEFINER như `org_default_mode` (0010): bảng admin chỉ ENABLE RLS; không tham số
--    ⇒ chỉ hỏi về tenant của tx.
ALTER TABLE contracts.approval_settings ADD COLUMN IF NOT EXISTS approval_enabled boolean;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.approval_default() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT t.key NOT IN ('nitigroup', 'demo') FROM admin.tenants t
                   WHERE t.id = NULLIF(current_setting('app.tenant_id', true), '')::uuid), true)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.approval_on() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT s.approval_enabled FROM contracts.approval_settings s
                   WHERE s.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid),
                  contracts.approval_default())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.approval_default(), contracts.approval_on() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.approval_default(), contracts.approval_on() TO contracts_rw;
