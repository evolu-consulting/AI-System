-- DLC-R14 · workflow loại "DLC" (flow nội tại của engine AI SDLC) bên cạnh workflow Dify của Admin: một preset chạy
-- process của engine (new-system | enhancement | bug-fix) với chế độ hỏi người (`ask` | `decide`, NULL = mặc định engine)
-- và lane (`trivial` | `small` | `full`, NULL = engine tự định cỡ). Danh mục cấp platform (như hub.agents, không RLS);
-- platform_admin sửa qua Hub `/dlc/workflows`; Agent Runtime đọc khi bắt đầu run DLC. Chỉ thêm bảng — không mất dữ liệu.
CREATE TABLE IF NOT EXISTS hub.dlc_workflows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  process text NOT NULL,
  human_mode text,
  lane text,
  is_default boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dlc_workflows_pkey PRIMARY KEY (id),
  CONSTRAINT dlc_workflows_key_uq UNIQUE (key),
  CONSTRAINT dlc_workflows_key_ck CHECK (key ~ '^[a-z][a-z0-9-]{1,47}$'),
  CONSTRAINT dlc_workflows_name_ck CHECK (char_length(name) BETWEEN 1 AND 100),
  CONSTRAINT dlc_workflows_process_ck CHECK (process IN ('new-system', 'enhancement', 'bug-fix')),
  CONSTRAINT dlc_workflows_human_ck CHECK (human_mode IS NULL OR human_mode IN ('ask', 'decide')),
  CONSTRAINT dlc_workflows_lane_ck CHECK (lane IS NULL OR lane IN ('trivial', 'small', 'full'))
);
--> statement-breakpoint
-- Mỗi process tối đa một workflow mặc định (dùng khi tin chat không chọn `#key`).
CREATE UNIQUE INDEX IF NOT EXISTS dlc_workflows_default_uq ON hub.dlc_workflows (process) WHERE is_default;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.dlc_workflows TO hub_rw;
--> statement-breakpoint
GRANT SELECT ON hub.dlc_workflows TO agent_runtime;
