-- KH SDLC tool store. Admin config (agent, grp, group_agent, workflow) and the
-- app's runtime state (project, run, step_run, message, agent_session), plus the
-- PM governance layer that runs over every step: registers (RAIDEC + defects +
-- lessons), scope items, approvals, notifications, users, audit and settings.
--
-- Columns added after the first release are ALSO added by db.migrate() with
-- ALTER TABLE, because CREATE TABLE IF NOT EXISTS never changes a table that
-- already exists.

CREATE TABLE IF NOT EXISTS agent (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  llm_type TEXT NOT NULL DEFAULT 'claude-cli',
  model TEXT NOT NULL DEFAULT 'sonnet',
  args_json TEXT NOT NULL DEFAULT '[]',
  env_json TEXT NOT NULL DEFAULT '{}',      -- real values; the API only returns masked hints
  tools_json TEXT,                          -- NULL = every KH tool allowed
  role_prompt TEXT NOT NULL DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  deleted_at TEXT                           -- soft delete: running runs keep their snapshot
);

CREATE TABLE IF NOT EXISTS grp (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  workspace TEXT NOT NULL DEFAULT '{project_folder}\.sdlc\{run_slug}\{group_slug}',
  human_gate INTEGER NOT NULL DEFAULT 0,
  max_rounds INTEGER NOT NULL DEFAULT 2,
  created_at TEXT,
  updated_at TEXT,
  lane TEXT NOT NULL DEFAULT 'dev',         -- pm | dev: whose view of the flow this step belongs to
  role TEXT NOT NULL DEFAULT 'work',        -- intake | plan | work | review | test | uat | close
  approval INTEGER NOT NULL DEFAULT 0,      -- a human lead must approve the step's result
  verify_tests INTEGER NOT NULL DEFAULT 0,  -- the server re-runs the test command itself
  estimate_min INTEGER NOT NULL DEFAULT 10, -- planned minutes: the baseline for slip and health
  deleted_at TEXT,
  approvers_json TEXT NOT NULL DEFAULT '[]', -- sign-off titles that must ALL approve, e.g. ["business lead","pmo"]
  env TEXT NOT NULL DEFAULT ''              -- dev | qas | prd: the environment this step works in (promotion)
);

CREATE TABLE IF NOT EXISTS group_agent (
  group_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (group_id, agent_id)
);

CREATE TABLE IF NOT EXISTS workflow (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'feature',     -- feature | bugfix
  doc_json TEXT NOT NULL,                   -- {"nodes":[{id,groupId,x,y}],"edges":[{source,target,kind:"next"|"rework"}]}
  created_at TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

-- Every saved version of a workflow; a run records the version it was started on.
CREATE TABLE IF NOT EXISTS workflow_version (
  workflow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  doc_json TEXT NOT NULL,
  created_at TEXT,
  created_by TEXT,
  PRIMARY KEY (workflow_id, version)
);

CREATE TABLE IF NOT EXISTS template (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  workflow_id TEXT NOT NULL DEFAULT 'wf-new-system',
  test_command TEXT NOT NULL DEFAULT '',
  budget_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  folder TEXT NOT NULL,
  kh_project TEXT NOT NULL,
  created_at TEXT,
  owner TEXT NOT NULL DEFAULT '',           -- accountable person (user name)
  budget_usd REAL NOT NULL DEFAULT 0,       -- 0 = no cap
  test_command TEXT NOT NULL DEFAULT '',    -- what the server runs to verify tests
  jira_base TEXT NOT NULL DEFAULT '',       -- e.g. https://acme.atlassian.net
  template_id TEXT NOT NULL DEFAULT '',
  client_contact TEXT NOT NULL DEFAULT '',  -- the client's person: reminders on client-owned tasks go here
  holidays_json TEXT NOT NULL DEFAULT '[]', -- blackout ranges [{"from":"2026-12-21","to":"2027-01-08","label":"holiday"}]
  envs_json TEXT NOT NULL DEFAULT '[]'      -- [{"name":"DEV","url":"","version":"","promotedAt":"","by":""}]
);

CREATE TABLE IF NOT EXISTS run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending|running|waiting_human|paused|cancelled|done|failed
  current_pos INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  finished_at TEXT,
  owner TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 3,      -- 1 highest .. 5 lowest; the worker takes the best first
  due_at TEXT,
  estimate_min INTEGER NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL DEFAULT 0,
  external_key TEXT NOT NULL DEFAULT '',    -- Jira key, defect ref, ...
  epic TEXT NOT NULL DEFAULT '',            -- groups runs into a larger piece of work
  depends_on INTEGER,                       -- another run that must be done first
  process_json TEXT,                        -- the frozen process: workflow version, groups, agents
  status_reason TEXT NOT NULL DEFAULT '',
  rerun_from_node TEXT                      -- an approved change re-runs from this node after the current step
);

CREATE TABLE IF NOT EXISTS step_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  group_slug TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending|running|waiting_human|awaiting_approval|done|rework|failed|skipped
  started_at TEXT,
  finished_at TEXT,
  summary_json TEXT,
  forced INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  proceed INTEGER NOT NULL DEFAULT 0,
  node_id TEXT NOT NULL DEFAULT '',
  attempt INTEGER NOT NULL DEFAULT 1,
  lane TEXT NOT NULL DEFAULT 'dev',
  role TEXT NOT NULL DEFAULT 'work',
  waiting_since TEXT,
  nudge_level INTEGER NOT NULL DEFAULT 0,
  verify_json TEXT,
  verdict TEXT,                             -- pass | fail
  approved_by TEXT,
  approved_at TEXT,
  approval_note TEXT,
  UNIQUE (run_id, position)
);

CREATE TABLE IF NOT EXISTS message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_run_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  sender_kind TEXT NOT NULL,                -- agent | human | system
  sender_name TEXT NOT NULL,
  agent_id TEXT,
  content TEXT NOT NULL,
  created_at TEXT,
  UNIQUE (step_run_id, seq)
);

CREATE TABLE IF NOT EXISTS agent_session (
  step_run_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (step_run_id, agent_id)
);

-- One row per CLI call (a turn's retries are separate calls: their tokens were spent too).
-- Counts are that call's running total, rewritten while the call streams; final=1 once the
-- CLI's result event replaced the pricing.json estimate with its own total_cost_usd.
CREATE TABLE IF NOT EXISTS llm_call (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  step_run_id INTEGER NOT NULL,
  agent_id TEXT,
  model TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  final INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  updated_at TEXT
);

-- RAIDEC (risk, action, issue, decision, escalation, change) plus defect and lesson:
-- the PM registers, one table, cross-linked by run and step. ref is R-1, A-3, DEF-2 ...
CREATE TABLE IF NOT EXISTS register_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  run_id INTEGER,
  step_run_id INTEGER,
  kind TEXT NOT NULL,                       -- risk|action|issue|decision|escalation|change|defect|lesson
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',      -- open|proposed|approved|rejected|mitigated|closed
  probability INTEGER,                      -- risk: 1-5
  impact INTEGER,                           -- risk: 1-5
  category INTEGER,                         -- risk: 1 (review daily) .. 4 (monthly)
  mitigation TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT '',        -- defect/issue: critical|high|medium|low
  due_at TEXT,
  approver TEXT,
  approved_at TEXT,
  link TEXT NOT NULL DEFAULT '',            -- file:line, run id, external key ...
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (project_id, ref)
);

-- The accepted scope of a run: every item must be traced to a passing test before UAT.
CREATE TABLE IF NOT EXISTS scope_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  ref TEXT NOT NULL,
  text TEXT NOT NULL,
  acceptance TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',      -- open | met | not_met | dropped
  evidence TEXT NOT NULL DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE (run_id, ref)
);

CREATE TABLE IF NOT EXISTS attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  recipient TEXT NOT NULL DEFAULT '',       -- user name; '' = everyone
  project_id TEXT,
  run_id INTEGER,
  step_pos INTEGER,
  kind TEXT NOT NULL,                       -- waiting|approval|failed|budget|escalation|done|digest|slip
  level INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  read_at TEXT
);

CREATE TABLE IF NOT EXISTS user_account (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',      -- admin | lead | member | viewer
  titles TEXT NOT NULL DEFAULT '',          -- sign-off titles this person holds: "business lead, pmo"
  token_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);

-- One sign-off on a step or a change request: who signed, under which title.
CREATE TABLE IF NOT EXISTS approval (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,                     -- step:<step_run id> | item:<register id>
  title TEXT NOT NULL,                      -- business lead | pmo | steering committee | client | lead ...
  approver TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'approved',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT
);

-- The PM's plan: a WBS of phases, tasks and milestones per project, the way the PM
-- schedules a real implementation (dates on working days, FS/SS/FF dependencies,
-- baseline vs actual, client vs Laidon vs agent tasks, invoice milestones).
CREATE TABLE IF NOT EXISTS task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  parent_id INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'task',        -- phase | task | milestone
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  side TEXT NOT NULL DEFAULT 'laidon',      -- laidon | client | agent
  owner TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  stream TEXT NOT NULL DEFAULT '',          -- domain / object stream, e.g. Material Management
  duration_days INTEGER NOT NULL DEFAULT 1, -- working days; 0 for a milestone
  loe_hours REAL NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  pinned_start TEXT,                        -- a fixed start; otherwise dependencies decide
  baseline_start TEXT,
  baseline_end TEXT,
  actual_end TEXT,
  pct REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'not_started', -- not_started | in_progress | completed
  deps_json TEXT NOT NULL DEFAULT '[]',     -- [{"task": id, "type": "FS"|"SS"|"FF", "lag": 0}]
  invoice INTEGER NOT NULL DEFAULT 0,       -- completing this milestone triggers a customer invoice
  invoice_sent TEXT,
  client_visible INTEGER NOT NULL DEFAULT 1,
  run_id INTEGER,                           -- an agent run this task follows
  node_id TEXT NOT NULL DEFAULT '',         -- ... or one step of it
  nudged TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_run_project ON run (project_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_call_run ON llm_call (run_id);
CREATE INDEX IF NOT EXISTS idx_msg_step ON message (step_run_id, seq);
CREATE INDEX IF NOT EXISTS idx_reg_project ON register_item (project_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_reg_run ON register_item (run_id);
CREATE INDEX IF NOT EXISTS idx_note_ts ON notification (id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit (id DESC);
CREATE INDEX IF NOT EXISTS idx_task_project ON task (project_id, sort);
CREATE INDEX IF NOT EXISTS idx_approval_target ON approval (target);
