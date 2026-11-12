-- CR-127 · X1 · spec §2.1 (`exec_hold_*`), §2.2 (mốc / thực hiện), §6 (`recordFulfillment`). BR-41, BR-46, BR-50…54.
-- (1) `obligations`: hàng con phần còn lại (`parent_obligation_id`), bằng chứng, quyết định phạt; kind + `penalty`, source + `fulfill`.
-- (2) `contracts.exec_hold_*`: tạm khoá thực hiện (một nguồn; NULL = không khoá) — khác `locked_at` (khoá nội dung K1).
-- (3) `contracts.exec_requests`: MỘT khái niệm "Yêu cầu chờ duyệt" (giao dịch chờ duyệt X2, thay đổi thực hiện X3); một yêu cầu mở mỗi
--     mốc / một yêu cầu khoá-mở khoá mở mỗi HĐ (partial unique). RLS tenant (`packs.secure_table`) + thấy theo HĐ thấy được (M1).
-- (4) GRANT hàm hub (bằng chứng/tín hiệu task — E1 0131 chỉ cấp khi role gói đã có) cho `contracts_rw`; GRANT lặp vô hại (K3 có thể cấp trùng).
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS parent_obligation_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS evidence_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS penalty_decision text;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS penalty_obligation_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_parent_fk;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_parent_fk FOREIGN KEY (parent_obligation_id, tenant_id)
  REFERENCES contracts.obligations (id, tenant_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_penalty_fk;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_penalty_fk FOREIGN KEY (penalty_obligation_id, tenant_id)
  REFERENCES contracts.obligations (id, tenant_id) ON DELETE SET NULL (penalty_obligation_id);
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_penalty_decision_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_penalty_decision_ck
  CHECK (penalty_decision IS NULL OR penalty_decision IN ('booked', 'waived'));
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_kind_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_kind_ck
  CHECK (kind IN ('payment', 'delivery', 'commission', 'serial', 'renewal', 'other', 'penalty'));
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_source_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_source_ck
  CHECK (source IN ('manual', 'ai', 'default', 'cks', 'fulfill'));
--> statement-breakpoint
-- Con của một mốc (lịch sử làm thiếu); thưa ⇒ partial.
CREATE INDEX IF NOT EXISTS obligations_parent_idx ON contracts.obligations (tenant_id, parent_obligation_id)
  WHERE parent_obligation_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS exec_hold_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS exec_hold_by uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS exec_hold_reason text;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS exec_hold_evidence_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_exec_hold_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_exec_hold_ck CHECK (
  (exec_hold_at IS NULL) = (exec_hold_by IS NULL) AND (exec_hold_at IS NOT NULL OR exec_hold_reason IS NULL)
  AND char_length(exec_hold_reason) <= 2000);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.exec_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  obligation_id uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_id uuid,
  status text NOT NULL DEFAULT 'pending',
  decided_note text,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  flow_event_id uuid,
  CONSTRAINT exec_requests_pkey PRIMARY KEY (id),
  CONSTRAINT exec_requests_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT exec_requests_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE,
  -- `obligation_id` không FK (như `milestone_items.milestone_id`): mốc chỉ đổi trạng thái, không xoá; giữ TRUNCATE sổ của bộ test.
  CONSTRAINT exec_requests_kind_ck CHECK (kind IN ('transaction', 'postpone', 'split', 'waive_penalty', 'hold', 'release')),
  CONSTRAINT exec_requests_status_ck CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  CONSTRAINT exec_requests_text_ck CHECK (char_length(decided_note) <= 4000 AND pg_column_size(payload) <= 65536)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS exec_requests_ob_pending_uq ON contracts.exec_requests (obligation_id)
  WHERE status = 'pending' AND obligation_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS exec_requests_hold_pending_uq ON contracts.exec_requests (contract_id)
  WHERE status = 'pending' AND kind IN ('hold', 'release');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS exec_requests_contract_idx ON contracts.exec_requests (tenant_id, contract_id, requested_at);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'exec_requests');
--> statement-breakpoint
-- Không xoá (lịch sử yêu cầu); đổi trạng thái pending → approved/rejected/applied qua use case.
REVOKE DELETE ON contracts.exec_requests FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS exec_requests_visible ON contracts.exec_requests;
--> statement-breakpoint
CREATE POLICY exec_requests_visible ON contracts.exec_requests AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = exec_requests.contract_id AND c.tenant_id = exec_requests.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS exec_requests_visible_ins ON contracts.exec_requests;
--> statement-breakpoint
CREATE POLICY exec_requests_visible_ins ON contracts.exec_requests AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = exec_requests.contract_id AND c.tenant_id = exec_requests.tenant_id));
--> statement-breakpoint
DO $$
BEGIN
  IF to_regprocedure('hub.record_evidence(text, uuid, text, uuid, uuid[], uuid)') IS NOT NULL THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.record_evidence(text, uuid, text, uuid, uuid[], uuid) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.evidence_get(uuid[]) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.task_signal(text, text, text) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.task_holder(text, text) TO contracts_rw;
  END IF;
END $$;
