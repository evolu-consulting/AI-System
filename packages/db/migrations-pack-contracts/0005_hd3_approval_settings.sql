-- HD-FR-37 · HD3 (CR-094 đợt 3): luật duyệt theo tenant — ngưỡng rẽ nhánh cấp 2 + Group duyệt cấp 1/cấp 2 (khoá `admin.groups`).
-- Không có hàng ⇒ mặc định (intake-hd câu 3: 500.000.000 đ; cấp 1 `contracts-editor`, cấp 2 `contracts-owner`). Bảng mới, chỉ
-- cộng thêm, không đụng dữ liệu cũ. Một hàng mỗi tenant (UNIQUE tenant_id); RLS qua `packs.secure_table`.
CREATE TABLE IF NOT EXISTS contracts.approval_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  threshold bigint NOT NULL DEFAULT 500000000,
  level1_group_key text NOT NULL DEFAULT 'contracts-editor',
  level2_group_key text NOT NULL DEFAULT 'contracts-owner',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approval_settings_pkey PRIMARY KEY (id),
  CONSTRAINT approval_settings_tenant_uq UNIQUE (tenant_id),
  CONSTRAINT approval_settings_threshold_ck CHECK (threshold BETWEEN 0 AND 1000000000000000),
  CONSTRAINT approval_settings_groups_ck CHECK (level1_group_key ~ '^[a-z0-9-]{2,64}$'
    AND level2_group_key ~ '^[a-z0-9-]{2,64}$')
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'approval_settings');
--> statement-breakpoint
REVOKE DELETE ON contracts.approval_settings FROM contracts_rw;
