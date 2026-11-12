-- CR-127 K3 · BR-02/03/04/36a · spec §2.1, §3 (#3, #4, #7b, #8): (1) `contract_submissions` — hồ sơ mỗi lần Gửi / Gửi lại (chỉ thêm);
-- (2) hàm dùng chung `contracts.transition_set` — chuyển trạng thái THEO TẬP qua cổng (GUC `bulk:<txid>` đặt ngay trước câu UPDATE và
-- HẠ ngay sau, trong cùng hàm; trước đây sweep K1b tự chép); (3) quyền tối thiểu cho role quét chéo tenant `contracts_job` để
-- `OutcomeHandler.failedBatch` (lượt hết hạn của engine) đưa HĐ processing → draft (#79, #80); (4) role gói gọi được 4 hàm hub của E1.
-- Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.contract_submissions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  round int NOT NULL,
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_sha256 text,
  source_text text,
  return_note text,
  unchanged_reason text,
  CONSTRAINT contract_submissions_pkey PRIMARY KEY (id),
  CONSTRAINT contract_submissions_round_uq UNIQUE (contract_id, round),
  CONSTRAINT contract_submissions_ck CHECK (round >= 1
    AND octet_length(fields::text) <= 262144
    AND (text_sha256 IS NULL OR text_sha256 ~ '^[0-9a-f]{64}$')
    AND (return_note IS NULL OR char_length(return_note) <= 4000)
    AND (unchanged_reason IS NULL OR char_length(unchanged_reason) BETWEEN 1 AND 4000))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_submissions_contract_idx ON contracts.contract_submissions (tenant_id, contract_id, round);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_submissions');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.contract_submissions FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS contract_submissions_visible ON contracts.contract_submissions;
--> statement-breakpoint
CREATE POLICY contract_submissions_visible ON contracts.contract_submissions AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = contract_submissions.contract_id AND c.tenant_id = contract_submissions.tenant_id));
--> statement-breakpoint
-- Chuyển theo tập qua cổng (INVOKER: RLS + quyền của role gọi — `contracts_rw` (sweep) hoặc `contracts_job` (failedBatch)). Chỉ đích
-- draft/reject (vào DONE cần `refresh_effect` + hook ⇒ đi `applyTransition` từng HĐ). CAS `(tenant_id, id)` + `status = from` +
-- `run_id` (khi có). Mỗi hàng đổi ⇒ một `contract_events(status_changed)`. Trả các hàng đã đổi.
CREATE OR REPLACE FUNCTION contracts.transition_set(p_items jsonb)
  RETURNS TABLE (r_tenant_id uuid, r_id uuid, r_run_id uuid)
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
      WHERE coalesce(x->>'to', '') NOT IN ('draft', 'reject')) THEN
    RAISE EXCEPTION 'TRANSITION_SET_TARGET' USING DETAIL = 'transition_set chỉ đưa về draft/reject';
  END IF;
  PERFORM set_config('contracts.state_gate', 'bulk:' || txid_current()::text, true);
  RETURN QUERY
  WITH v AS (
    SELECT * FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      AS v(tenant_id uuid, id uuid, run_id uuid, "from" text, "to" text, ev text, reason text, actor uuid)
  ), u AS (
    UPDATE contracts.contracts c SET status = v."to", version = c.version + 1, updated_at = now()
    FROM v
    WHERE c.tenant_id = v.tenant_id AND c.id = v.id AND c.status = v."from"
      AND (v.run_id IS NULL OR c.run_id = v.run_id)
    RETURNING c.tenant_id, c.id, c.run_id, v."from" AS f, v."to" AS t, v.ev, v.reason, v.actor
  ), e AS (
    INSERT INTO contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
    SELECT u.tenant_id, u.id, 'status_changed', u.actor,
      jsonb_build_object('from', u.f, 'to', u.t, 'ev', u.ev, 'reason', u.reason, 'evidence_id', NULL)
    FROM u
  )
  SELECT u.tenant_id, u.id, u.run_id FROM u;
  PERFORM set_config('contracts.state_gate', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.transition_set(jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.transition_set(jsonb) TO contracts_rw, contracts_job;
--> statement-breakpoint
-- #79/#80 · `contracts_job` (NOBYPASSRLS) — chỉ đủ cho failedBatch: đọc cột khoá + đổi status/version/updated_at của HĐ đang duyệt.
-- SELECT policy phủ cả trạng thái đích (draft/reject): UPDATE có WHERE/RETURNING kiểm SELECT policy trên CẢ hàng mới.
GRANT SELECT (id, tenant_id, status, run_id, version) ON contracts.contracts TO contracts_job;
--> statement-breakpoint
GRANT UPDATE (status, version, updated_at) ON contracts.contracts TO contracts_job;
--> statement-breakpoint
DROP POLICY IF EXISTS contracts_job_fail ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_job_fail ON contracts.contracts FOR UPDATE TO contracts_job
  USING (status = 'processing') WITH CHECK (status IN ('draft', 'reject'));
--> statement-breakpoint
DROP POLICY IF EXISTS contracts_job_fail_read ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_job_fail_read ON contracts.contracts FOR SELECT TO contracts_job
  USING (status IN ('processing', 'draft', 'reject'));
--> statement-breakpoint
GRANT INSERT ON contracts.contract_events TO contracts_job;
--> statement-breakpoint
DROP POLICY IF EXISTS contract_events_job_ins ON contracts.contract_events;
--> statement-breakpoint
CREATE POLICY contract_events_job_ins ON contracts.contract_events FOR INSERT TO contracts_job
  WITH CHECK (type = 'status_changed');
--> statement-breakpoint
-- Lượt duyệt của HĐ (`contracts.run_id` → `approvals.id`, lượt engine ở `engine_run_id`) phải đóng cùng lúc (`approvals_live_uq`:
-- còn lượt sống thì lần Gửi lại không mở được lượt mới) ⇒ thêm đọc/ghi tối thiểu trên `approvals` (lệch spec §2.1 — ghi §12).
GRANT SELECT (id, tenant_id, contract_id, status, mode, engine_run_id) ON contracts.approvals TO contracts_job;
--> statement-breakpoint
GRANT UPDATE (status, feedback, decided_at, updated_at) ON contracts.approvals TO contracts_job;
--> statement-breakpoint
DROP POLICY IF EXISTS approvals_job_fail ON contracts.approvals;
--> statement-breakpoint
CREATE POLICY approvals_job_fail ON contracts.approvals FOR UPDATE TO contracts_job
  USING (status IN ('level1', 'level2') AND mode = 'engine') WITH CHECK (status = 'failed');
--> statement-breakpoint
DROP POLICY IF EXISTS approvals_job_fail_read ON contracts.approvals;
--> statement-breakpoint
CREATE POLICY approvals_job_fail_read ON contracts.approvals FOR SELECT TO contracts_job
  USING (mode = 'engine' AND status IN ('level1', 'level2', 'failed'));
--> statement-breakpoint
-- #80 · grep trigger UPDATE trên `contracts.contracts` (K3): mọi trigger hàng có `WHEN` không bắn khi chỉ đổi status processing → draft/reject;
-- riêng `contracts_v2c_roles_upd` (trigger CÂU, không WHEN được) ghi `partner_roles` ⇒ thoát sớm khi lô không có HĐ done (giữ nguyên kết
-- quả; role job không cần quyền `partner_roles`). Cột sinh (STORED) tính lại mỗi UPDATE ⇒ role job cần EXECUTE các hàm thuần của cột sinh.
CREATE OR REPLACE FUNCTION contracts.v2c_partner_roles()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
DECLARE
  me uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM v2c_new n WHERE n.kind = 'contract' AND n.status = 'done') THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from, contract_id, created_by)
    SELECT n.tenant_id, r.party_key, r.role, r.name, 'contract', n.id, coalesce(me, n.created_by)
    FROM v2c_new n CROSS JOIN LATERAL contracts.partner_role_of(n) r
    WHERE n.kind = 'contract' AND n.status = 'done'
      AND char_length(r.party_key) <= 300
    ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
  ELSE
    INSERT INTO contracts.partner_roles (tenant_id, party_key, role, name, created_from, contract_id, created_by)
    SELECT n.tenant_id, r.party_key, r.role, r.name, 'contract', n.id, coalesce(me, n.created_by)
    FROM v2c_new n JOIN v2c_old o ON o.id = n.id
      CROSS JOIN LATERAL contracts.partner_role_of(n) r
    WHERE n.kind = 'contract' AND n.status = 'done'
      AND (o.fields IS DISTINCT FROM n.fields OR o.direction IS DISTINCT FROM n.direction OR o.deal IS DISTINCT FROM n.deal
        OR o.status <> 'done')
      AND char_length(r.party_key) <= 300
    ON CONFLICT (tenant_id, party_key, role) DO NOTHING;
  END IF;
  RETURN NULL;
END $function$;
--> statement-breakpoint
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'contracts' AND p.provolatile = 'i'
      AND p.proname IN ('as_bigint', 'as_date', 'fold', 'person_key', 'party_key', 'v2e_cell')
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO contracts_job', f);
  END LOOP;
END
$$;
--> statement-breakpoint
-- E1 chỉ GRANT có điều kiện (role gói có thể cài sau hub) ⇒ cấp lại ở đây.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.record_evidence(text, uuid, text, uuid, uuid[], uuid) TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.evidence_get(uuid[]) TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.task_signal(text, text, text) TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.task_holder(text, text) TO contracts_rw;
