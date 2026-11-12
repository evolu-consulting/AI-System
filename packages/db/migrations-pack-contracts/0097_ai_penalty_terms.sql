-- CR-127 · K7 · BR-43/55/56 · spec §2.2: điều khoản phạt dạng số (AI trích, người phụ trách sửa được) + điều khoản gốc của mốc.
-- `penalty_terms` = nguồn duy nhất cho X4 (phạt ước tính theo tập); RLS gói theo tenant (`packs.secure_table`). Chỉ cộng thêm.
CREATE TABLE IF NOT EXISTS contracts.penalty_terms (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  party text NOT NULL,
  trigger text NOT NULL,
  rate_pct numeric(7, 4),
  basis text NOT NULL,
  cap_pct numeric(7, 4),
  cap_amount bigint,
  clause_ref text,
  page int,
  quote text,
  source text NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penalty_terms_pkey PRIMARY KEY (id),
  CONSTRAINT penalty_terms_contract_fk FOREIGN KEY (contract_id) REFERENCES contracts.contracts (id) ON DELETE CASCADE,
  CONSTRAINT penalty_terms_party_ck CHECK (party IN ('ours', 'partner')),
  CONSTRAINT penalty_terms_trigger_ck CHECK (trigger IN ('late_delivery', 'late_payment', 'other')),
  CONSTRAINT penalty_terms_basis_ck CHECK (basis IN ('per_day_of_value', 'per_day_of_milestone', 'fixed')),
  CONSTRAINT penalty_terms_source_ck CHECK (source IN ('ai', 'manual')),
  CONSTRAINT penalty_terms_rate_ck CHECK (rate_pct IS NULL OR rate_pct BETWEEN 0 AND 100),
  CONSTRAINT penalty_terms_cap_ck CHECK ((cap_pct IS NULL OR cap_pct BETWEEN 0 AND 100) AND (cap_amount IS NULL OR cap_amount >= 0))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS penalty_terms_contract_idx ON contracts.penalty_terms (tenant_id, contract_id, created_at, id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'penalty_terms');
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS clause_ref text;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS page int;
