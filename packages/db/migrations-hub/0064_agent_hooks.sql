-- dlc-dify · hook của agent (giống hook Claude CLI): mỗi loại sự kiện chọn MỘT workflow Dify trong catalog Admin. Cấu hình
-- NỀN TẢNG như `agent_kh` (không tenant_id, không RLS; route Studio chỉ platform_admin). `workflow_id` trỏ `admin.workflows`
-- (khác schema, không FK — service kiểm trên catalog; workflow mất/tắt ⇒ hook bỏ qua lúc chạy). Chỉ thêm bảng.
CREATE TABLE IF NOT EXISTS hub.agent_hooks (
  agent_id uuid NOT NULL,
  event text NOT NULL,
  workflow_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_hooks_pkey PRIMARY KEY (agent_id, event),
  CONSTRAINT agent_hooks_event_ck CHECK (event IN ('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
    'Stop', 'SubagentStop', 'PreCompact', 'PostCompact', 'Notification', 'SessionEnd')),
  CONSTRAINT agent_hooks_agent_fk FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_hooks_workflow_idx ON hub.agent_hooks (workflow_id);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.agent_hooks TO hub_rw;
