-- HD-FR-37 · review HD3 M1: nhật ký đổi luật duyệt theo tenant (ngưỡng, Group cấp 1/2) — trước/sau, người đổi, lúc đổi.
-- Bảng mới, chỉ thêm (append-only với role gói: không UPDATE/DELETE). Ghi cùng tx với `approval_settings` (CTE).
CREATE TABLE IF NOT EXISTS contracts.approval_settings_audit (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  CONSTRAINT approval_settings_audit_pkey PRIMARY KEY (id),
  CONSTRAINT approval_settings_audit_json_ck CHECK (jsonb_typeof(before) = 'object' AND jsonb_typeof(after) = 'object'
    AND octet_length(before::text) <= 4096 AND octet_length(after::text) <= 4096)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_settings_audit_tenant_idx ON contracts.approval_settings_audit (tenant_id, id DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'approval_settings_audit');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.approval_settings_audit FROM contracts_rw;
