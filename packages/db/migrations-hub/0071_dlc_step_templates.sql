-- dlc-step-library · thư viện BƯỚC DLC dùng lại (chỉ platform_admin — cổng ở route): mỗi hàng = một bước mẫu (việc, agent, lời dặn,
-- cổng duyệt theo MÃ Group, Chưa đạt ⇒ quay lại đâu, số vòng, hạn). Canvas khe `dlc.*` CHÉP mẫu thành bước (`slot.kind = dlc`) ⇒ sửa
-- mẫu không đổi quy trình đã có. `reject_to` (chỉ khi có cổng): 'self' (làm lại chính bước) | 'prev' (bước ngay trước) | <việc>
-- (bước gần nhất đứng trước làm việc đó). RLS: chỉ scope system. audit entity + `dlc_step_template`. Seed 8 bước = `defaultDlcBody`
-- (khớp kiểm ở `dlc-step-seed.rules.test.ts`). Số trong dải DLC (0070–0080), `when` > max journal. Chạy lại vô hại.
CREATE TABLE IF NOT EXISTS hub.dlc_step_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  action text NOT NULL,
  agent_key text,
  instruction text NOT NULL DEFAULT '',
  gate_group text,
  reject_to text,
  max_rounds integer NOT NULL DEFAULT 3,
  timeout_min integer NOT NULL DEFAULT 60,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dlc_step_templates_pkey PRIMARY KEY (id),
  CONSTRAINT dlc_step_templates_key_uq UNIQUE (key),
  CONSTRAINT dlc_step_templates_key_ck CHECK (key ~ '^[a-z][a-z0-9-]{0,39}$'),
  CONSTRAINT dlc_step_templates_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT dlc_step_templates_action_ck CHECK (action IN ('intake', 'spec', 'qc', 'setup', 'build', 'verify', 'report', 'deploy', 'agent')),
  CONSTRAINT dlc_step_templates_agent_ck CHECK (
    (agent_key IS NULL OR char_length(agent_key) BETWEEN 1 AND 64) AND (action <> 'agent' OR agent_key IS NOT NULL)),
  CONSTRAINT dlc_step_templates_instruction_ck CHECK (char_length(instruction) <= 8000),
  CONSTRAINT dlc_step_templates_gate_ck CHECK (gate_group IS NULL OR gate_group ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT dlc_step_templates_reject_ck CHECK (reject_to IS NULL OR (gate_group IS NOT NULL AND reject_to IN
    ('self', 'prev', 'intake', 'spec', 'qc', 'setup', 'build', 'verify', 'report', 'deploy', 'agent'))),
  CONSTRAINT dlc_step_templates_rounds_ck CHECK (max_rounds BETWEEN 1 AND 10),
  CONSTRAINT dlc_step_templates_timeout_ck CHECK (timeout_min BETWEEN 5 AND 1440),
  CONSTRAINT dlc_step_templates_version_ck CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE hub.dlc_step_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'dlc_step_templates'
                 AND policyname = 'dlc_step_templates_sys') THEN
    EXECUTE format('CREATE POLICY dlc_step_templates_sys ON hub.dlc_step_templates FOR ALL TO hub_rw'
      || ' USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.dlc_step_templates TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_entity_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%dlc_step_template%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
      entity IN ('agent_grant', 'run', 'agent', 'orchestrator', 'agent_entitlement', 'agent_default',
        'process_def', 'process_run', 'review_task', 'agent_team', 'secret', 'kh_connection', 'kh_query', 'kh_worklog',
        'provider', 'model_profile', 'dlc_step_template'));
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO hub.dlc_step_templates (key, name, action, gate_group, reject_to, max_rounds, timeout_min)
VALUES
  ('intake', 'Khởi tạo', 'intake', NULL, NULL, 3, 10),
  ('spec', 'Spec + plan', 'spec', 'dlc-editor', 'self', 3, 240),
  ('qc', 'Test case + script test', 'qc', 'dlc-editor', 'spec', 3, 240),
  ('setup', 'Chuẩn bị đội + queue', 'setup', NULL, NULL, 3, 10),
  ('build', 'Build theo queue', 'build', NULL, NULL, 3, 1440),
  ('verify', 'Nghiệm thu', 'verify', NULL, NULL, 1, 1440),
  ('report', 'Báo cáo · duyệt deploy', 'report', 'dlc-editor', 'build', 3, 10),
  ('deploy', 'Deploy', 'deploy', NULL, NULL, 3, 60)
ON CONFLICT (key) DO NOTHING;
