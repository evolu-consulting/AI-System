-- CR-122 · E1 · ADR-0038 · FLOW2-FR-19/20 · hàng đợi sự kiện app (`hub.flow_events`) cho bộ điều phối flow.
-- (1) App ghi `{event, ref, facts, event_id, actor}` CÙNG tx với thay đổi bản ghi; `(tenant_id, event_id)` duy nhất ⇒ ghi lại vô hại.
-- (2) Bộ điều phối (`processes/triggers`) nhận lô `FOR UPDATE SKIP LOCKED` theo `next_at`; lỗi ⇒ `attempts + 1`, `next_at` lùi
--     (≤ 5 lần, readiness Q3), quá 5 ⇒ `processed_at` + `error` (ops-watch báo ở M1). `outcome` = flow đã chạy / không chạy + lý do.
-- (3) `process_runs.flow_event_id` + `company_flow_id`: lượt mở từ sự kiện — unique (flow_event_id, company_flow_id) ⇒ chạy lại sau
--     lỗi giữa chừng không mở lượt thứ hai cho cùng flow (idempotent theo sự kiện × flow).
-- (4) RLS: đọc/ghi theo tenant (scope user đúng `app.tenant_id`) hoặc system. Chạy lại vô hại.
CREATE TABLE IF NOT EXISTS hub.flow_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_id text NOT NULL,
  event text NOT NULL,
  ref text NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  outcome jsonb,
  CONSTRAINT flow_events_pkey PRIMARY KEY (id),
  CONSTRAINT flow_events_event_uq UNIQUE (tenant_id, event_id),
  CONSTRAINT flow_events_event_id_ck CHECK (length(event_id) BETWEEN 1 AND 200),
  CONSTRAINT flow_events_event_ck CHECK (event ~ '^[a-z][a-z0-9_-]{0,39}\.[a-z][a-z0-9_-]{0,39}$'),
  CONSTRAINT flow_events_ref_ck CHECK (length(ref) BETWEEN 1 AND 200),
  CONSTRAINT flow_events_facts_ck CHECK (jsonb_typeof(facts) = 'object'),
  CONSTRAINT flow_events_attempts_ck CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT flow_events_error_ck CHECK (error IS NULL OR length(error) <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS flow_events_pending_idx ON hub.flow_events (next_at) WHERE processed_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS flow_events_ref_idx ON hub.flow_events (tenant_id, ref);
--> statement-breakpoint
ALTER TABLE hub.flow_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'flow_events'
                 AND policyname = 'flow_events_rw') THEN
    EXECUTE format('CREATE POLICY flow_events_rw ON hub.flow_events FOR ALL TO hub_rw USING %s WITH CHECK %s', v_t, v_t);
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.flow_events TO hub_rw;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS flow_event_id uuid;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS company_flow_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS process_runs_flow_event_uq
  ON hub.process_runs (flow_event_id, company_flow_id) WHERE flow_event_id IS NOT NULL;
