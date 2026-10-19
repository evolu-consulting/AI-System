-- M3-decouple · HD-FR-31…37: flow duyệt HĐ là máy trạng thái TRONG gói (không còn run engine `contracts-approval`).
-- Một hàng mỗi lượt duyệt; HĐ trỏ lượt hiện tại qua cột cũ `contracts.run_id` (giữ tên để API/test HD1–HD3 không đổi; nay là id
-- `contracts.approvals`). Trạng thái: extracting (AI đang đọc) → level1 (phụ trách xác nhận) → level2 (cấp 2 duyệt, người bắt
-- đầu không quyết) → done | rejected | cancelled | failed. Mỗi HĐ tối đa MỘT lượt sống (chỉ mục duy nhất có điều kiện).
-- Chuyển dữ liệu: HĐ có `run_id` ⇒ một hàng cùng id (event cũ `approval_started.run_id` vẫn khớp); bước suy từ trạng thái HĐ
-- và, khi có schema hub, từ run engine (stage `approve` ⇒ level2; run đã huỷ/lỗi ⇒ cancelled/failed; người bắt đầu = run).
CREATE TABLE IF NOT EXISTS contracts.approvals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  status text NOT NULL,
  started_by uuid NOT NULL,
  level1_by uuid,
  level1_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  feedback text,
  migrated boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT approvals_pkey PRIMARY KEY (id),
  CONSTRAINT approvals_status_ck CHECK (status IN ('extracting', 'level1', 'level2', 'done', 'rejected', 'cancelled',
    'failed')),
  CONSTRAINT approvals_feedback_ck CHECK (char_length(feedback) <= 4000),
  CONSTRAINT approvals_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS approvals_live_uq ON contracts.approvals (tenant_id, contract_id)
  WHERE status IN ('extracting', 'level1', 'level2');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approvals_contract_idx ON contracts.approvals (contract_id, created_at DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'approvals');
--> statement-breakpoint
REVOKE DELETE ON contracts.approvals FROM contracts_rw;
--> statement-breakpoint
INSERT INTO contracts.approvals (id, tenant_id, contract_id, status, started_by, migrated, created_at, updated_at)
SELECT DISTINCT ON (c.run_id) c.run_id, c.tenant_id, c.id,
  CASE
    WHEN c.status = 'rejected' THEN 'rejected'
    WHEN c.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated') THEN 'done'
    WHEN c.status = 'extracting' THEN 'extracting'
    WHEN c.status = 'extract_failed' THEN 'failed'
    ELSE 'level1'
  END,
  c.created_by, true, c.updated_at, c.updated_at
FROM contracts.contracts c
WHERE c.run_id IS NOT NULL
ORDER BY c.run_id, c.updated_at DESC
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('hub.process_runs') IS NOT NULL THEN
    UPDATE contracts.approvals a SET
      started_by = r.started_by,
      status = CASE
        WHEN a.status IN ('extracting', 'level1') AND r.status = 'cancelled' THEN 'cancelled'
        WHEN a.status IN ('extracting', 'level1') AND r.status IN ('failed', 'expired') THEN 'failed'
        WHEN a.status = 'level1' AND r.current_stage_idx >= 2 THEN 'level2'
        ELSE a.status
      END
    FROM hub.process_runs r
    WHERE a.migrated AND r.id = a.id AND r.tenant_id = a.tenant_id;
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_column THEN
  RAISE NOTICE 'contracts 0010: hub.process_runs unreadable, kept contract-derived approval steps';
END $$;
