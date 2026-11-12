-- CR-127 · E1 · spec §2.3 · Bằng chứng dùng chung, nhận việc nhóm ("Cần: tất cả"), uỷ quyền, tín hiệu đóng việc, cài đặt giờ tự trả.
-- Viết tay, idempotent (IF NOT EXISTS / DROP+ADD có kiểm). Chỉ THÊM bảng/cột; nới CHECK giữ đủ giá trị cũ ⇒ dữ liệu hiện có luôn thoả.
-- (1) `hub.evidence` BẤT BIẾN (SELECT cho hub_rw, KHÔNG UPDATE/DELETE + trigger chặn cả role chủ); INSERT CHỈ qua `hub.record_evidence`
--     (SECURITY DEFINER: tenant từ `app.tenant_id`, người ghi từ `app.user_id`, tệp phải thuộc tenant, `on_behalf_of` phải có uỷ quyền/giao việc);
--     đọc theo tập qua `hub.evidence_get(ids)` (sai tenant ⇒ rỗng). Lọc người được xem (BR-26) làm ở app.
-- (2) `review_tasks`: need/claimed_*/subject_ref + kind `milestone`; `review_task_votes`; `review_task_assignees.via='delegated'` + `on_behalf_of`.
-- (3) `delegations` (RLS tenant; "ai xem" lọc ở app — R#43); `tenant_flow_settings.claim_release_h`.
-- (4) `task_signals` + `hub.task_signal` (gói CHỈ ghi tín hiệu, không đụng review_tasks — spec §5.9, #54) và `hub.task_holder` (#72, đọc không khoá).
-- (5) `process_notices.kind` += task_released, milestone_task (#53).
-- GRANT cho role gói `contracts_rw` ở khối cuối chỉ khi role đã có; gói cài sau ⇒ migration gói cấp lại (K1a/K3/X1 — xem báo cáo E1).

-- ── (1) evidence ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  subject_kind text NOT NULL,
  subject_id uuid NOT NULL,
  note text NOT NULL,
  signature_attachment_id uuid,
  attachment_ids uuid[] NOT NULL DEFAULT '{}',
  by_user uuid NOT NULL,
  on_behalf_of uuid,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_pkey PRIMARY KEY (id),
  CONSTRAINT evidence_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT evidence_subject_kind_ck CHECK (subject_kind IN ('task_decision', 'milestone', 'hold', 'penalty',
    'exec_request', 'effect_outcome', 'sign_cancel', 'unchanged_resubmit')),
  CONSTRAINT evidence_note_ck CHECK (char_length(note) BETWEEN 1 AND 4000),
  CONSTRAINT evidence_files_ck CHECK (cardinality(attachment_ids) <= 5),
  -- Không FK tới attachments: bằng chứng sống lâu hơn dọn tệp; tệp được kiểm thuộc tenant lúc ghi (record_evidence).
  CONSTRAINT evidence_behalf_ck CHECK (on_behalf_of IS NULL OR on_behalf_of <> by_user)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS evidence_subject_idx ON hub.evidence (tenant_id, subject_kind, subject_id, at);
--> statement-breakpoint
ALTER TABLE hub.evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'evidence'
                 AND policyname = 'evidence_hub_select') THEN
    CREATE POLICY evidence_hub_select ON hub.evidence FOR SELECT TO hub_rw
      USING (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
  END IF;
END $$;
--> statement-breakpoint
-- Chỉ SELECT: INSERT đi qua `hub.record_evidence` (kiểm tệp thuộc tenant), UPDATE/DELETE không ai có.
GRANT SELECT ON hub.evidence TO hub_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.evidence_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'evidence: bằng chứng không sửa/xoá được' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'evidence_immutable' AND tgrelid = 'hub.evidence'::regclass) THEN
    CREATE TRIGGER evidence_immutable BEFORE UPDATE OR DELETE ON hub.evidence
      FOR EACH ROW EXECUTE FUNCTION hub.evidence_immutable();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'evidence_no_truncate' AND tgrelid = 'hub.evidence'::regclass) THEN
    CREATE TRIGGER evidence_no_truncate BEFORE TRUNCATE ON hub.evidence
      FOR EACH STATEMENT EXECUTE FUNCTION hub.evidence_immutable();
  END IF;
END $$;
--> statement-breakpoint

-- ── (3a) delegations (cần trước record_evidence: kiểm on_behalf_of) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.delegations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  from_user_id uuid NOT NULL,
  to_user_id uuid NOT NULL,
  from_at timestamptz NOT NULL,
  to_at timestamptz NOT NULL,
  kinds text[] NOT NULL,
  created_by uuid NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delegations_pkey PRIMARY KEY (id),
  CONSTRAINT delegations_self_ck CHECK (from_user_id <> to_user_id),
  CONSTRAINT delegations_range_ck CHECK (to_at > from_at),
  CONSTRAINT delegations_kinds_ck CHECK (cardinality(kinds) >= 1
    AND kinds <@ ARRAY['approve', 'form', 'milestone', 'esign']::text[])
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delegations_active_idx ON hub.delegations (tenant_id, from_user_id, from_at, to_at)
  WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delegations_to_idx ON hub.delegations (tenant_id, to_user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE hub.delegations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── (2) review_tasks / assignees / votes ────────────────────────────────────────────────────────────────────────────
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS need text NOT NULL DEFAULT 'one';
--> statement-breakpoint
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS claimed_by uuid;
--> statement-breakpoint
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
--> statement-breakpoint
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS claim_deadline_at timestamptz;
--> statement-breakpoint
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS subject_ref text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_need_ck'
                 AND conrelid = 'hub.review_tasks'::regclass) THEN
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_need_ck CHECK (need IN ('one', 'head', 'all'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_claim_ck'
                 AND conrelid = 'hub.review_tasks'::regclass) THEN
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_claim_ck CHECK (
      (claimed_by IS NULL) = (claimed_at IS NULL) AND (claim_deadline_at IS NULL OR claimed_by IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_subject_ref_ck'
                 AND conrelid = 'hub.review_tasks'::regclass) THEN
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_subject_ref_ck CHECK (
      subject_ref IS NULL OR char_length(subject_ref) BETWEEN 1 AND 200);
  END IF;
  -- kind += milestone (#53) + cột bắt buộc `subject_ref` cho kind đó (0019 `review_tasks_kind_cols_ck` giữ nguyên các nhánh cũ).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_kind_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%milestone%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_kind_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_kind_ck CHECK (kind IN ('review', 'ask', 'decision', 'milestone'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_milestone_ref_ck'
                 AND conrelid = 'hub.review_tasks'::regclass) THEN
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_milestone_ref_ck CHECK (
      kind <> 'milestone' OR subject_ref IS NOT NULL);
  END IF;
  -- Nhắc lặp + quá hạn chuyển cấp (0036 `review_tasks_remind_ck`, chỉ kind review) áp cả việc Xác nhận mốc (spec §5.9: Hạn / Quá hạn chuyển cho / Nhắc).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_remind_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%milestone%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_remind_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_remind_ck CHECK (
      remind_count BETWEEN 0 AND 10
      AND (remind_every_h IS NULL OR remind_every_h BETWEEN 4 AND 168)
      AND ((escalate_at IS NULL) = (escalate_group_id IS NULL))
      AND (kind IN ('review', 'milestone') OR (remind_every_h IS NULL AND escalate_at IS NULL)));
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_subject_idx ON hub.review_tasks (tenant_id, subject_ref) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_claim_deadline_idx ON hub.review_tasks (claim_deadline_at)
  WHERE status = 'open' AND claimed_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.review_task_assignees ADD COLUMN IF NOT EXISTS on_behalf_of uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_task_assignees_via_ck'
                 AND conrelid = 'hub.review_task_assignees'::regclass AND pg_get_constraintdef(oid) LIKE '%''delegated''%') THEN
    ALTER TABLE hub.review_task_assignees DROP CONSTRAINT IF EXISTS review_task_assignees_via_ck;
    ALTER TABLE hub.review_task_assignees ADD CONSTRAINT review_task_assignees_via_ck
      CHECK (via IN ('initial', 'forward', 'escalated', 'delegated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_task_assignees_behalf_ck'
                 AND conrelid = 'hub.review_task_assignees'::regclass) THEN
    ALTER TABLE hub.review_task_assignees ADD CONSTRAINT review_task_assignees_behalf_ck CHECK (
      on_behalf_of IS NULL OR (via = 'delegated' AND user_id IS NOT NULL AND on_behalf_of <> user_id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_notices_kind_ck'
                 AND conrelid = 'hub.process_notices'::regclass AND pg_get_constraintdef(oid) LIKE '%milestone_task%') THEN
    ALTER TABLE hub.process_notices DROP CONSTRAINT IF EXISTS process_notices_kind_ck;
    ALTER TABLE hub.process_notices ADD CONSTRAINT process_notices_kind_ck CHECK (kind IN (
      'review_requested', 'ask_requested', 'decision_requested', 'reminder', 'task_closed', 'run_finished',
      'escalated', 'task_released', 'milestone_task'));
  END IF;
END $$;
--> statement-breakpoint
-- "Cần: tất cả": mỗi người một phiếu (PK task+user); `user_id` = người được giao, `on_behalf_of` = người bỏ phiếu thay (uỷ quyền).
CREATE TABLE IF NOT EXISTS hub.review_task_votes (
  task_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  on_behalf_of uuid,
  result text NOT NULL,
  evidence_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_task_votes_pkey PRIMARY KEY (task_id, user_id),
  CONSTRAINT review_task_votes_result_ck CHECK (result IN ('pass', 'fail', 'reject')),
  CONSTRAINT review_task_votes_behalf_ck CHECK (on_behalf_of IS NULL OR on_behalf_of <> user_id),
  CONSTRAINT review_task_votes_task_fk FOREIGN KEY (task_id, tenant_id) REFERENCES hub.review_tasks (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT review_task_votes_evidence_fk FOREIGN KEY (evidence_id, tenant_id) REFERENCES hub.evidence (id, tenant_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_task_votes_tenant_idx ON hub.review_task_votes (tenant_id, task_id);
--> statement-breakpoint
ALTER TABLE hub.review_task_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── (4) task_signals ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.task_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL,
  subject_ref text NOT NULL,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT task_signals_pkey PRIMARY KEY (id),
  CONSTRAINT task_signals_kind_ck CHECK (kind IN ('milestone')),
  CONSTRAINT task_signals_result_ck CHECK (result IN ('done', 'cancelled')),
  CONSTRAINT task_signals_ref_ck CHECK (char_length(subject_ref) BETWEEN 1 AND 200)
);
--> statement-breakpoint
-- Cùng tín hiệu chưa xử lý ⇒ một hàng (gọi lại vô hại); vòng nền quét `processed_at IS NULL` theo lô `SKIP LOCKED`.
CREATE UNIQUE INDEX IF NOT EXISTS task_signals_pending_uq ON hub.task_signals (tenant_id, kind, subject_ref, result)
  WHERE processed_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS task_signals_sweep_idx ON hub.task_signals (created_at) WHERE processed_at IS NULL;
--> statement-breakpoint
ALTER TABLE hub.task_signals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ── (3b) tenant_flow_settings.claim_release_h ──────────────────────────────────────────────────────────────────────
ALTER TABLE hub.tenant_flow_settings ADD COLUMN IF NOT EXISTS claim_release_h integer NOT NULL DEFAULT 24;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_flow_settings_claim_release_ck'
                 AND conrelid = 'hub.tenant_flow_settings'::regclass) THEN
    ALTER TABLE hub.tenant_flow_settings ADD CONSTRAINT tenant_flow_settings_claim_release_ck
      CHECK (claim_release_h BETWEEN 1 AND 168);
  END IF;
END $$;
--> statement-breakpoint

-- ── RLS (mẫu v_t 0019: system, hoặc user đúng tenant) + GRANT ─────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  FOREACH t IN ARRAY ARRAY['delegations', 'review_task_votes', 'task_signals'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t
                   AND policyname = t || '_hub_rw') THEN
      EXECUTE format('CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw USING %s WITH CHECK %s', t || '_hub_rw', t, v_t, v_t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- delegations: huỷ = đặt `revoked_at` (không DELETE). votes: chỉ thêm. task_signals: engine đánh `processed_at`.
GRANT SELECT, INSERT, UPDATE ON hub.delegations TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.review_task_votes TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.task_signals TO hub_rw;
--> statement-breakpoint

-- ── Hàm SECURITY DEFINER (khuôn `hub.emit_flow_event` 0109: search_path cố định, tenant từ GUC, REVOKE PUBLIC) ────────
-- record_evidence: INSERT bằng chứng cho tenant/người của tx. Tệp (chữ ký PNG ≤ 200 KB, tệp ≤ 10 MB, ≤ 5) phải thuộc CHÍNH tenant này,
-- chưa bị dọn. `on_behalf_of` (người được giao thật) chỉ khi có uỷ quyền on→by CÒN HIỆU LỰC (chưa huỷ, trong khoảng) đúng loại việc (task_decision→approve/form, milestone/hold/penalty/exec_request→milestone, sign_cancel→esign), hoặc `by` là assignee `via='delegated'` của
-- đúng task đó (chống mạo danh người khác). `task_decision`: task phải thuộc tenant (kind khác nằm ở schema gói ⇒ gói tự kiểm hàng của mình).
CREATE OR REPLACE FUNCTION hub.record_evidence(
  p_subject_kind text,
  p_subject_id uuid,
  p_note text,
  p_signature_attachment_id uuid,
  p_attachment_ids uuid[],
  p_on_behalf_of uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_files uuid[] := COALESCE(p_attachment_ids, '{}'::uuid[]);
  v_id uuid;
BEGIN
  IF v_tid IS NULL OR v_uid IS NULL THEN
    RAISE EXCEPTION 'record_evidence: chưa đặt tenant/người dùng' USING ERRCODE = '42501';
  END IF;
  IF p_subject_id IS NULL OR p_note IS NULL OR char_length(p_note) NOT BETWEEN 1 AND 4000 THEN
    RAISE EXCEPTION 'record_evidence: cần ý kiến 1..4000 ký tự và đối tượng' USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_files) > 5 OR EXISTS (SELECT 1 FROM unnest(v_files) f WHERE f IS NULL) THEN
    RAISE EXCEPTION 'record_evidence: tối đa 5 tệp' USING ERRCODE = '22023';
  END IF;
  IF p_signature_attachment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM hub.attachments a
        WHERE a.id = p_signature_attachment_id AND a.tenant_id = v_tid AND a.purged_at IS NULL
          AND a.mime = 'image/png' AND a.size <= 204800) THEN
    RAISE EXCEPTION 'record_evidence: chữ ký phải là ảnh PNG ≤ 200 KB của công ty này' USING ERRCODE = '42501';
  END IF;
  IF cardinality(v_files) > 0 AND (SELECT count(*) FROM hub.attachments a
        WHERE a.id = ANY (v_files) AND a.tenant_id = v_tid AND a.purged_at IS NULL AND a.size <= 10485760)
      <> (SELECT count(DISTINCT f) FROM unnest(v_files) f) THEN
    RAISE EXCEPTION 'record_evidence: tệp không thuộc công ty này, đã bị dọn hoặc quá 10 MB' USING ERRCODE = '42501';
  END IF;
  IF p_subject_kind = 'task_decision' AND NOT EXISTS (
       SELECT 1 FROM hub.review_tasks t WHERE t.id = p_subject_id AND t.tenant_id = v_tid) THEN
    RAISE EXCEPTION 'record_evidence: việc không thuộc công ty này' USING ERRCODE = '42501';
  END IF;
  IF p_on_behalf_of IS NOT NULL AND (p_on_behalf_of = v_uid OR NOT (
       EXISTS (SELECT 1 FROM hub.delegations d
                WHERE d.tenant_id = v_tid AND d.from_user_id = p_on_behalf_of AND d.to_user_id = v_uid
                  AND d.revoked_at IS NULL AND now() >= d.from_at AND now() < d.to_at
                  AND (CASE p_subject_kind
                         WHEN 'task_decision' THEN d.kinds && ARRAY['approve', 'form']::text[]
                         WHEN 'sign_cancel' THEN 'esign' = ANY (d.kinds)
                         WHEN 'milestone' THEN 'milestone' = ANY (d.kinds)
                         WHEN 'hold' THEN 'milestone' = ANY (d.kinds)
                         WHEN 'penalty' THEN 'milestone' = ANY (d.kinds)
                         WHEN 'exec_request' THEN 'milestone' = ANY (d.kinds)
                         ELSE true END))
       OR (p_subject_kind = 'task_decision' AND EXISTS (
             SELECT 1 FROM hub.review_task_assignees a
              WHERE a.tenant_id = v_tid AND a.task_id = p_subject_id AND a.user_id = v_uid
                AND a.via = 'delegated' AND a.on_behalf_of = p_on_behalf_of)))) THEN
    RAISE EXCEPTION 'record_evidence: không có uỷ quyền từ người này' USING ERRCODE = '42501';
  END IF;
  INSERT INTO hub.evidence (tenant_id, subject_kind, subject_id, note, signature_attachment_id, attachment_ids,
                            by_user, on_behalf_of)
  VALUES (v_tid, p_subject_kind, p_subject_id, p_note, p_signature_attachment_id, v_files, v_uid, p_on_behalf_of)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
-- evidence_get: bằng chứng theo tập id, CHỈ của tenant hiện tại (id tenant khác / không có tenant ⇒ rỗng, không lộ có tồn tại).
CREATE OR REPLACE FUNCTION hub.evidence_get(p_ids uuid[]) RETURNS SETOF hub.evidence
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL OR p_ids IS NULL OR cardinality(p_ids) > 500 THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT e.* FROM hub.evidence e WHERE e.tenant_id = v_tid AND e.id = ANY (p_ids) ORDER BY e.at, e.id;
END $$;
--> statement-breakpoint
-- task_signal: gói ghi tín hiệu "việc của <subject_ref> xong/huỷ" cùng tx với bản ghi của nó; KHÔNG đụng review_tasks (tránh khoá ngược,
-- spec §5.9 #54). Trùng tín hiệu chưa xử lý ⇒ không ghi thêm (NULL).
CREATE OR REPLACE FUNCTION hub.task_signal(p_kind text, p_subject_ref text, p_result text) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_id uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'task_signal: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  INSERT INTO hub.task_signals (tenant_id, kind, subject_ref, result)
  VALUES (v_tid, p_kind, p_subject_ref, p_result)
  ON CONFLICT (tenant_id, kind, subject_ref, result) WHERE processed_at IS NULL DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
-- task_holder (#72): việc MỞ của `subject_ref` trong tenant hiện tại — người đã nhận (nếu có) + mọi người được giao (user trực tiếp ∪ thành viên
-- phòng giao). Đọc không khoá. Tenant khác / không tenant ⇒ rỗng.
CREATE OR REPLACE FUNCTION hub.task_holder(p_kind text, p_subject_ref text)
RETURNS TABLE (task_id uuid, claimed_by uuid, assignee_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT t.id, t.claimed_by,
         COALESCE((SELECT array_agg(DISTINCT u.uid) FROM (
            SELECT a.user_id AS uid FROM hub.review_task_assignees a
             WHERE a.task_id = t.id AND a.tenant_id = v_tid AND a.user_id IS NOT NULL
            UNION
            SELECT gm.user_id FROM admin.group_members gm
             WHERE gm.tenant_id = v_tid AND gm.group_id = t.assignee_group_id
            UNION
            SELECT gm.user_id FROM hub.review_task_assignees a
              JOIN admin.group_members gm ON gm.group_id = a.group_id AND gm.tenant_id = v_tid
             WHERE a.task_id = t.id AND a.tenant_id = v_tid AND a.group_id IS NOT NULL) u), '{}'::uuid[])
    FROM hub.review_tasks t
   WHERE t.tenant_id = v_tid AND t.status = 'open' AND t.kind = p_kind AND t.subject_ref = p_subject_ref
   ORDER BY t.created_at, t.id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.record_evidence(text, uuid, text, uuid, uuid[], uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.evidence_get(uuid[]) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.task_signal(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.task_holder(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.record_evidence(text, uuid, text, uuid, uuid[], uuid) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.evidence_get(uuid[]) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.task_signal(text, text, text) TO hub_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.task_holder(text, text) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.record_evidence(text, uuid, text, uuid, uuid[], uuid) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.evidence_get(uuid[]) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.task_signal(text, text, text) TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.task_holder(text, text) TO contracts_rw;
  END IF;
END $$;
