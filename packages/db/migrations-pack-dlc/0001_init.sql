-- dlc-engine · gói `dlc` (AI SDLC trong engine quy trình): 3 khe thư viện `dlc.new-system|enhancement|bug-fix` + tool bước DLC.
-- `flows` = trạng thái một lượt DLC theo `process_run_id` (plan đã duyệt, lệnh test, log build, báo cáo…) — các tool bước đọc/ghi
-- giữa các stage; code + queue vẫn ở workspace DLC (`apps/dlc-workspace`). Khuôn bảng gói: RLS FORCE theo `app.tenant_id`.
SELECT packs.install('dlc');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS dlc.flows (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  mode text NOT NULL,
  project text NOT NULL,
  ticket_id text,
  requirement text NOT NULL DEFAULT '',
  conversation_id uuid,
  started_by uuid NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flows_pkey PRIMARY KEY (id),
  CONSTRAINT flows_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT flows_mode_ck CHECK (mode IN ('new-system', 'enhancement', 'bug-fix')),
  CONSTRAINT flows_project_ck CHECK (project ~ '^[a-z0-9][a-z0-9-]{0,47}$'),
  CONSTRAINT flows_requirement_ck CHECK (char_length(requirement) <= 200000),
  CONSTRAINT flows_state_ck CHECK (jsonb_typeof(state) = 'object' AND pg_column_size(state) < 4000000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS flows_tenant_ticket_idx ON dlc.flows (tenant_id, ticket_id);
--> statement-breakpoint
SELECT packs.secure_table('dlc', 'flows');
