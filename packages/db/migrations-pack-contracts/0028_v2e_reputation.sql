-- V2-E · BA v2 §5.1 · §6 (Đổi Cài đặt) · DT-02/03/04 · CD-02..05 · HD-06 · intake C1 + §4 Q1 (CR-096 Q1): uy tín v2 THAY engine HD8.
-- Chỉ cộng thêm; chạy lại vô hại. Bảng HD8 (`score_configs`, `score_snapshots`, `score_config_history`) giữ nguyên, chỉ đọc.
-- Số 0023 V2-B, 0024 V2-C, 0026 V2-D, 0027 V2-G. Không FK sang `contracts.contracts` (D9-02: test TRUNCATE không CASCADE).
--
-- 1) Nhóm SP của HĐ (§5.1 "theo nhóm SP"): `product_group` service|goods (null ⇒ goods); HĐ Giới thiệu luôn nhóm `referral`.
--    V2-B/V2-F điền từ danh mục SP khi có. Vai của đối tác theo loại HĐ: Mua ⇒ NCC, Bán ⇒ khách, Giới thiệu ⇒ bên trả HH.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS product_group text;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_product_group_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_product_group_ck
  CHECK (product_group IS NULL OR product_group IN ('service', 'goods'));
--> statement-breakpoint
-- Ô uy tín của HĐ (≡ thứ tự `REP_CELLS` trong `rep-config.rules.ts`): 1 dịch vụ·NCC · 2 dịch vụ·khách · 3 hàng hoá·NCC · 4 hàng hoá·
-- khách · 5 giới thiệu·bên trả HH; HĐ chưa có loại ⇒ null. Không `SET search_path` (CASE trên tham số) ⇒ inline được.
CREATE OR REPLACE FUNCTION contracts.v2e_cell(deal text, product_group text) RETURNS smallint
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  RETURN CASE deal
    WHEN 'buy' THEN CASE WHEN product_group = 'service' THEN 1 ELSE 3 END
    WHEN 'sell' THEN CASE WHEN product_group = 'service' THEN 2 ELSE 4 END
    WHEN 'referral' THEN 5 END;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2e_cell(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2e_cell(text, text) TO contracts_rw;
--> statement-breakpoint
-- Khoá đối tác của HĐ (bên kia: bán / giới thiệu ⇒ bên mua, mua ⇒ bên bán), lưu sẵn: bảng điểm 3.000 HĐ không gọi `party_key()`
-- (fold + regexp) từng hàng (Luật 4c). Tự tính lại khi trường bên / hướng đổi.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS partner_key text GENERATED ALWAYS AS (contracts.party_key(
  fields -> (CASE WHEN direction = 'sale' THEN 'buyer_name' ELSE 'supplier_name' END) ->> 'value',
  fields -> (CASE WHEN direction = 'sale' THEN 'buyer_tax_id' ELSE 'supplier_tax_id' END) ->> 'value')) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_partner_key_idx ON contracts.contracts (tenant_id, partner_key)
  WHERE kind = 'contract' AND partner_key IS NOT NULL;
--> statement-breakpoint
-- Ô lưu sẵn: câu chấm lọc `rep_cell = any(...)` trên cột có thống kê và tra tham số ô bằng chỉ số mảng — không nối bảng cấu hình
-- (ước lượng đúng ⇒ hash join + hash aggregate, Luật 4c).
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS rep_cell smallint
  GENERATED ALWAYS AS (contracts.v2e_cell(deal, product_group)) STORED;
--> statement-breakpoint
-- 2) Việc ghi tay theo danh mục "Loại việc" (HD-06, CD-04): dòng sổ `type = 'job'` + `job_type` (khoá trong danh mục) + nhóm SP.
--    Vai bên trả HH (`commission_payer`) cho sổ. Sổ vẫn chỉ thêm (huỷ = `partner_event_voids`).
ALTER TABLE contracts.partner_events ADD COLUMN IF NOT EXISTS grp text;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD COLUMN IF NOT EXISTS job_type text;
--> statement-breakpoint
ALTER TABLE contracts.partner_events DROP CONSTRAINT IF EXISTS partner_events_role_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD CONSTRAINT partner_events_role_ck
  CHECK (role IN ('customer', 'supplier', 'commission_payer'));
--> statement-breakpoint
ALTER TABLE contracts.partner_events DROP CONSTRAINT IF EXISTS partner_events_type_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD CONSTRAINT partner_events_type_ck CHECK (type IN ('paid', 'received', 'postponed',
  'appointment_kept', 'appointment_missed', 'delivered', 'reminded', 'complaint', 'cks_renewed', 'cks_lapsed', 'manual_adjust',
  'rating', 'overdue', 'job'));
--> statement-breakpoint
ALTER TABLE contracts.partner_events DROP CONSTRAINT IF EXISTS partner_events_v2e_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD CONSTRAINT partner_events_v2e_ck CHECK (
  (grp IS NULL OR grp IN ('service', 'goods', 'referral'))
  AND (job_type IS NULL OR job_type ~ '^[a-z0-9_:-]{1,60}$')
  AND ((type = 'job') = (job_type IS NOT NULL AND grp IS NOT NULL)));
--> statement-breakpoint
-- Luật 4c: chấm điểm đọc việc ghi tay theo (tenant, ngày) — index riêng phần `job`, cột chấm đi kèm (không đọc heap để lọc).
CREATE INDEX IF NOT EXISTS partner_events_job_idx ON contracts.partner_events (tenant_id, at)
  INCLUDE (party_key, role, grp, job_type) WHERE type = 'job';
--> statement-breakpoint
-- Ô của mốc = ô của HĐ, chép sẵn (Luật 4c: câu chấm quét mốc MỘT lần + nối bảng 5 ô, không nối 3.000 HĐ — đo: 23 ms dò HĐ ⇒ 0).
-- Giữ đúng bằng trigger: chèn mốc / đổi HĐ của mốc ⇒ lấy ô của HĐ; ô của HĐ đổi (nhóm SP sửa) ⇒ chép sang mốc. SECURITY INVOKER:
-- người ghi mốc đã thấy HĐ (khoá HĐ trước khi ghi mốc); vòng nền không user thấy hết.
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS rep_cell smallint;
--> statement-breakpoint
UPDATE contracts.obligations o SET rep_cell = c.rep_cell FROM contracts.contracts c
  WHERE c.tenant_id = o.tenant_id AND c.id = o.contract_id AND o.rep_cell IS DISTINCT FROM c.rep_cell;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.v2e_obligation_cell() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.rep_cell := (SELECT c.rep_cell FROM contracts.contracts c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.contract_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.v2e_contract_cell() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE contracts.obligations o SET rep_cell = NEW.rep_cell
    WHERE o.tenant_id = NEW.tenant_id AND o.contract_id = NEW.id AND o.rep_cell IS DISTINCT FROM NEW.rep_cell;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2e_obligation_cell(), contracts.v2e_contract_cell() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2e_obligation_cell(), contracts.v2e_contract_cell() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS obligations_v2e_cell ON contracts.obligations;
--> statement-breakpoint
CREATE TRIGGER obligations_v2e_cell BEFORE INSERT OR UPDATE OF contract_id ON contracts.obligations
  FOR EACH ROW EXECUTE FUNCTION contracts.v2e_obligation_cell();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2e_cell ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_v2e_cell AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.rep_cell IS DISTINCT FROM NEW.rep_cell) EXECUTE FUNCTION contracts.v2e_contract_cell();
--> statement-breakpoint
-- Mốc đã xác nhận theo ngày xác nhận (khoảng tính) — cột chấm đi kèm.
CREATE INDEX IF NOT EXISTS obligations_v2e_idx ON contracts.obligations (tenant_id, done_at)
  INCLUDE (rep_cell, party_key, kind, owner, fault, due_date) WHERE status = 'done' AND party_key IS NOT NULL;
--> statement-breakpoint
-- 3) Cấu hình v2 (CD-02..05): một hàng mỗi ô nhóm × vai (`goods:supplier`…), `settings` (mức, đánh giá, chốt) và `job_types`
--    (danh mục Loại việc). Chỉ lưu khi đã chỉnh (vắng ⇒ mặc định BA trong code). Ghi chỉ quản lý (route).
CREATE TABLE IF NOT EXISTS contracts.score_configs_v2 (
  tenant_id uuid NOT NULL,
  scope text NOT NULL,
  version int NOT NULL DEFAULT 1,
  config jsonb NOT NULL,
  updated_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_configs_v2_pkey PRIMARY KEY (tenant_id, scope),
  CONSTRAINT score_configs_v2_scope_ck CHECK (scope IN ('settings', 'job_types', 'service:supplier', 'service:customer',
    'goods:supplier', 'goods:customer', 'referral:commission_payer')),
  CONSTRAINT score_configs_v2_config_ck CHECK (jsonb_typeof(config) IN ('object', 'array') AND octet_length(config::text) <= 32768)
);
--> statement-breakpoint
-- 4) Đánh giá thủ công 1–5 sao từng tiêu chí (DT-04, §5.1i): chỉ thêm; lượt mới nhất của mỗi người được tính.
CREATE TABLE IF NOT EXISTS contracts.score_ratings (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  party_key text NOT NULL,
  role text NOT NULL,
  grp text NOT NULL,
  criterion text NOT NULL,
  stars smallint NOT NULL,
  reason text,
  by_user uuid NOT NULL DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_ratings_pkey PRIMARY KEY (id),
  CONSTRAINT score_ratings_cell_ck CHECK ((grp, role) IN (('service', 'supplier'), ('service', 'customer'), ('goods', 'supplier'),
    ('goods', 'customer'), ('referral', 'commission_payer'))),
  CONSTRAINT score_ratings_stars_ck CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT score_ratings_text_ck CHECK (char_length(party_key) BETWEEN 1 AND 300 AND criterion ~ '^[a-z0-9_:-]{1,60}$'
    AND char_length(reason) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS score_ratings_party_idx
  ON contracts.score_ratings (tenant_id, party_key, role, grp, criterion, by_user, at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS score_ratings_at_idx ON contracts.score_ratings (tenant_id, at);
--> statement-breakpoint
-- 5) Chốt điểm hằng tháng (§5.1j, §6): ảnh điểm cuối tháng theo (đối tác, vai, nhóm; `all` = điểm vai). Chỉ thêm; kỳ đã chốt không
--    bao giờ tính lại (đổi cài đặt / xoá HĐ chỉ đổi điểm hiện tại). Chỉ vòng nền (không người dùng) ghi.
CREATE TABLE IF NOT EXISTS contracts.score_locks (
  tenant_id uuid NOT NULL,
  period date NOT NULL,
  party_key text NOT NULL,
  role text NOT NULL,
  grp text NOT NULL,
  score smallint,
  data_score smallint,
  level text NOT NULL,
  jobs int NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_locks_pkey PRIMARY KEY (tenant_id, party_key, role, period, grp),
  CONSTRAINT score_locks_period_ck CHECK (extract(day FROM period) = 1),
  CONSTRAINT score_locks_role_ck CHECK (role IN ('supplier', 'customer', 'commission_payer')),
  CONSTRAINT score_locks_grp_ck CHECK (grp IN ('service', 'goods', 'referral', 'all')),
  CONSTRAINT score_locks_score_ck CHECK (score BETWEEN 0 AND 100 AND data_score BETWEEN 0 AND 100 AND jobs >= 0),
  CONSTRAINT score_locks_level_ck CHECK (level IN ('good', 'fair', 'watch', 'new')),
  CONSTRAINT score_locks_detail_ck CHECK (jsonb_typeof(detail) = 'object' AND octet_length(detail::text) <= 8192)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS score_locks_period_idx ON contracts.score_locks (tenant_id, period);
--> statement-breakpoint
-- Lượt chốt mỗi kỳ (kể cả kỳ không có đối tác nào) ⇒ vòng nền không tính lại kỳ đã chốt.
CREATE TABLE IF NOT EXISTS contracts.score_lock_runs (
  tenant_id uuid NOT NULL,
  period date NOT NULL,
  rows int NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_lock_runs_pkey PRIMARY KEY (tenant_id, period),
  CONSTRAINT score_lock_runs_ck CHECK (extract(day FROM period) = 1 AND rows >= 0)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'score_lock_runs');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.score_lock_runs FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS score_lock_runs_system_ins ON contracts.score_lock_runs;
--> statement-breakpoint
CREATE POLICY score_lock_runs_system_ins ON contracts.score_lock_runs AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (NULLIF(current_setting('app.user_id', true), '') IS NULL);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'score_configs_v2');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'score_ratings');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'score_locks');
--> statement-breakpoint
REVOKE DELETE ON contracts.score_configs_v2 FROM contracts_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.score_ratings, contracts.score_locks FROM contracts_rw;
--> statement-breakpoint
-- M1 (như `partner_notes` 0024): chế độ org chỉ thấy đánh giá/điểm chốt của đối tác mình thấy hoặc do mình chấm.
DROP POLICY IF EXISTS score_ratings_visible ON contracts.score_ratings;
--> statement-breakpoint
CREATE POLICY score_ratings_visible ON contracts.score_ratings AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR by_user = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
-- Chấm: người chấm = người phiên (không giả), đối tác mình thấy.
DROP POLICY IF EXISTS score_ratings_own_ins ON contracts.score_ratings;
--> statement-breakpoint
CREATE POLICY score_ratings_own_ins ON contracts.score_ratings AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (by_user = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND ((SELECT contracts.sees_all()) OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[])));
--> statement-breakpoint
DROP POLICY IF EXISTS score_locks_visible ON contracts.score_locks;
--> statement-breakpoint
CREATE POLICY score_locks_visible ON contracts.score_locks AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all()) OR party_key = ANY ((SELECT contracts.visible_party_keys())::text[]));
--> statement-breakpoint
DROP POLICY IF EXISTS score_locks_system_ins ON contracts.score_locks;
--> statement-breakpoint
CREATE POLICY score_locks_system_ins ON contracts.score_locks AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (NULLIF(current_setting('app.user_id', true), '') IS NULL);
