-- contract-flow S2 · mẫu luồng duyệt HĐ theo tenant (`approval_flows`, một hàng/tenant, `steps` = mảng bước đã kiểm ở gói) +
-- cột chạy duyệt trên engine quy trình cho `approvals` (`mode`, `engine_run_id`, `flow_version`, `pending_links`). Hàng cũ giữ
-- `mode = 'machine'` (máy 2 bước cũ chạy nốt). Chỉ cộng thêm; CHECK cũ giữ nguyên; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.approval_flows (
  tenant_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  steps jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_flows_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT approval_flows_version_ck CHECK (version >= 1),
  CONSTRAINT approval_flows_steps_ck CHECK (jsonb_typeof(steps) = 'array'
    AND jsonb_array_length(steps) BETWEEN 1 AND 8)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'approval_flows');
--> statement-breakpoint
REVOKE DELETE ON contracts.approval_flows FROM contracts_rw;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'machine';
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS engine_run_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS flow_version integer;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS pending_links jsonb;
--> statement-breakpoint
ALTER TABLE contracts.approvals DROP CONSTRAINT IF EXISTS approvals_mode_ck;
--> statement-breakpoint
ALTER TABLE contracts.approvals ADD CONSTRAINT approvals_mode_ck CHECK (mode IN ('machine', 'engine')
  AND (flow_version IS NULL OR flow_version >= 1)
  AND (pending_links IS NULL OR jsonb_typeof(pending_links) = 'array'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS approvals_engine_run_uq ON contracts.approvals (engine_run_id)
  WHERE engine_run_id IS NOT NULL;
