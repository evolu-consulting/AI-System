-- cf-esign-docusign · ký số HĐ, TRUNG LẬP nhà cung cấp (`provider`: docusign | selfsign = ký thử demo | fake = test; CA Việt Nam
-- thêm sau làm adapter mới): mỗi lần "Gửi ký" một hàng `esign_envelopes` (envelope/giao dịch ký của nhà cung cấp, người ký tuần tự, trạng thái, lý do từ chối/huỷ, tệp "Bản đã ký" ở `contracts.files`). RLS FORCE theo tenant
-- (`packs.secure_table`). Webhook Connect không có user/tenant: role `contracts_job` chỉ đọc (tenant_id, envelope_id) chéo tenant để
-- map envelope → tenant, rồi việc chạy trong tx `system(tenant)`. Một envelope đang chờ mỗi HĐ (index một phần). Cờ bật theo tenant ở
-- `approval_settings.esign_enabled` (mặc định TẮT). Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.esign_envelopes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  provider text NOT NULL,
  envelope_id text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  signers jsonb NOT NULL,
  reason text,
  signed_file_id uuid,
  completed_at timestamptz,
  sent_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esign_envelopes_pkey PRIMARY KEY (id),
  CONSTRAINT esign_envelopes_envelope_uq UNIQUE (provider, envelope_id),
  CONSTRAINT esign_envelopes_status_ck CHECK (status IN ('sent', 'delivered', 'completed', 'declined', 'voided')),
  CONSTRAINT esign_envelopes_text_ck CHECK (provider ~ '^[a-z][a-z0-9-]{1,30}$' AND char_length(envelope_id) BETWEEN 1 AND 100
    AND char_length(reason) <= 500 AND jsonb_typeof(signers) = 'array' AND jsonb_array_length(signers) BETWEEN 1 AND 4)
  -- Không FK tới `contracts`/`files` (như obligations, 0008): giữ TRUNCATE của bộ test + luồng xoá HĐ V2-M; app chỉ chèn sau khi đọc
  -- được HĐ trong cùng tenant (RLS).
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS esign_envelopes_contract_idx ON contracts.esign_envelopes (tenant_id, contract_id, created_at DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS esign_envelopes_open_uq ON contracts.esign_envelopes (tenant_id, contract_id)
  WHERE status IN ('sent', 'delivered');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'esign_envelopes');
--> statement-breakpoint
REVOKE DELETE ON contracts.esign_envelopes FROM contracts_rw;
--> statement-breakpoint
GRANT SELECT (tenant_id, provider, envelope_id) ON contracts.esign_envelopes TO contracts_job;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'contracts' AND tablename = 'esign_envelopes'
      AND policyname = 'esign_envelopes_job') THEN
    CREATE POLICY esign_envelopes_job ON contracts.esign_envelopes FOR SELECT TO contracts_job USING (true);
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE contracts.approval_settings ADD COLUMN IF NOT EXISTS esign_enabled boolean NOT NULL DEFAULT false;
