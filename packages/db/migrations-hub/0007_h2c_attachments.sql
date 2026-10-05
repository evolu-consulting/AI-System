-- HUB-FR-44 · HUB-FR-75 · WRK-FR-11 · WRK-FR-18 · plan H2c §3, plan-db §1 (D1): file đính kèm (Storage local theo
-- tenant), tập file của run, lý do job `attachment`, index hội thoại đã xoá (sweeper R28).
-- Viết tay, idempotent (IF NOT EXISTS; đổi CHECK qua DO $$ … pg_constraint): chạy được trên DB sạch và DB đã có 0006.
-- Chỉ thêm bảng/cột/index, nới CHECK — không mất dữ liệu. RLS như `messages` (0001); `agent_runtime` không GRANT.

-- ── attachments: bảng mới (không FK conversation/flow/job — H1 P3; FK message_id SET NULL) ────────────────────────
CREATE TABLE IF NOT EXISTS hub.attachments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  origin text NOT NULL,
  job_id uuid,
  conversation_id uuid,
  flow_id uuid,
  message_id uuid,
  position smallint,
  filename text NOT NULL,
  safe_name text NOT NULL,
  mime text NOT NULL,
  size bigint NOT NULL,
  sha256 text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  bound_at timestamptz,
  purged_at timestamptz,
  CONSTRAINT attachments_pkey PRIMARY KEY (id),
  CONSTRAINT attachments_origin_check CHECK (origin IN ('upload', 'output')),
  CONSTRAINT attachments_output_job_ck CHECK ((origin = 'output') = (job_id IS NOT NULL)),
  CONSTRAINT attachments_size_check CHECK (size BETWEEN 1 AND 20971520),
  CONSTRAINT attachments_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT attachments_filename_check CHECK (char_length(filename) BETWEEN 1 AND 200),
  CONSTRAINT attachments_safe_name_check CHECK (octet_length(safe_name) BETWEEN 1 AND 120),
  CONSTRAINT attachments_mime_check CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg', 'image/gif',
    'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/markdown', 'text/csv', 'application/xml', 'application/json')),
  CONSTRAINT attachments_key_ck CHECK (storage_key = tenant_id::text || '/' || id::text),
  -- FK SET NULL chỉ xoá `message_id` ⇒ không ràng buộc ngược `bound_at`/`position` khi message_id NULL.
  -- `position IS NOT NULL` tường minh: `NULL BETWEEN 0 AND 9` = NULL ⇒ CHECK sẽ cho qua (BUILD D1, spec-decisions).
  CONSTRAINT attachments_bound_ck CHECK (message_id IS NULL
    OR (bound_at IS NOT NULL AND position IS NOT NULL AND position BETWEEN 0 AND 9
        AND conversation_id IS NOT NULL AND flow_id IS NOT NULL)),
  CONSTRAINT attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES hub.messages (id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_message_idx ON hub.attachments (message_id, position) WHERE message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_tenant_live_idx ON hub.attachments (tenant_id) INCLUDE (size) WHERE purged_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_unbound_idx ON hub.attachments (created_at) WHERE message_id IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_job_idx ON hub.attachments (job_id, safe_name, created_at) WHERE job_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS attachments_conv_live_idx ON hub.attachments (conversation_id)
  WHERE purged_at IS NULL AND conversation_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conversations_deleted_idx ON hub.conversations (id) WHERE deleted_at IS NOT NULL;
--> statement-breakpoint

-- ── RLS (như messages_hub_rw, 0001) + GRANT hub_rw ────────────────────────────────────────────────────────────────
ALTER TABLE hub.attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'attachments'
                 AND policyname = 'attachments_hub_rw') THEN
    CREATE POLICY attachments_hub_rw ON hub.attachments FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                 AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
      WITH CHECK (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                 AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.attachments TO hub_rw;
--> statement-breakpoint

-- ── runs.attachment_ids (R14, ≤ 10) · jobs.error_reason + `attachment` (tập 0006 + attachment) ─────────────────────
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS attachment_ids uuid[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_attachment_ids_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_attachment_ids_ck CHECK (cardinality(attachment_ids) <= 10);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_error_reason_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''attachment''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_error_reason_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_error_reason_check CHECK (
      error_reason IS NULL
      OR error_reason IN ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash',
                          'cancelled', 'timeout', 'invalid_payload', 'invalid_output', 'sandbox', 'credential',
                          'upstream', 'refused', 'attachment')
    );
  END IF;
END
$$;
