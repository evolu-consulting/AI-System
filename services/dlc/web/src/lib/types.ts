export type Status =
  | 'pending'
  | 'running'
  | 'waiting_human'
  | 'awaiting_approval'
  | 'done'
  | 'rework'
  | 'failed'
  | 'skipped'
  | 'paused'
  | 'cancelled'

export type Lane = 'pm' | 'dev'
export type Role = 'intake' | 'plan' | 'blueprint' | 'work' | 'review' | 'test' | 'uat' | 'cutover' | 'release' | 'hypercare' | 'close'
export const ROLES: Role[] = ['intake', 'plan', 'blueprint', 'work', 'review', 'test', 'uat', 'cutover', 'release', 'hypercare', 'close']
export type Env = '' | 'dev' | 'qas' | 'prd'
export type Rag = 'green' | 'amber' | 'red'
export type UserRole = 'viewer' | 'member' | 'lead' | 'admin'

export interface Agent {
  id: string
  name: string
  llmType: string
  model: string
  args: string[]
  env: { name: string; hint: string }[]
  tools: string[] | null
  rolePrompt: string
}

export interface Group {
  id: string
  name: string
  slug: string
  goal: string
  workspace: string
  humanGate: boolean
  maxRounds: number
  agentIds: string[]
  lane: Lane
  role: Role
  approval: boolean
  verifyTests: boolean
  estimateMin: number
  /** sign-off titles that must all sign, e.g. ['business lead', 'pmo'] */
  approvers: string[]
  env: Env
}

export interface Signoff {
  title: string
  approver: string
  decision: 'approved' | 'rejected'
  note: string
  at: string
}

export interface WfNode {
  id: string
  groupId: string
  x: number
  y: number
}

export interface WfEdge {
  id?: string
  source: string
  target: string
  /** next = the main path; rework = back to an earlier step when this one's verdict is fail */
  kind?: 'next' | 'rework'
}

export interface Workflow {
  id: string
  name: string
  kind: 'feature' | 'bugfix'
  version: number
  doc: { nodes: WfNode[]; edges: WfEdge[] }
}

export interface Template {
  id: string
  name: string
  description: string
  workflowId: string
  testCommand: string
  budgetUsd: number
}

export interface Provider {
  id: string
  name: string
  models: { id: string; label: string }[]
  defaultArgs: string[]
  tokenEnv: string
}

export interface KhTool {
  key: string
  name: string
  work: string
}

export interface StepSummary {
  summary?: string
  artifacts?: string[]
  decisions?: (string | { title?: string; why?: string })[]
  next_input?: string
  tests?: unknown
  verdict?: string
}

export interface Verify {
  command: string
  ran: boolean
  passed: boolean
  exit: number | null
  output: string
  seconds?: number
  claimed?: boolean | null
}

export interface Health {
  rag: Rag
  reasons: string[]
  earned?: number
  burn?: number | null
  spent?: number
}

export interface Step {
  id: number
  position: number
  groupId: string
  groupName: string
  groupSlug: string
  status: Status
  startedAt: string | null
  finishedAt: string | null
  summary: StepSummary | null
  forced: boolean
  error: string | null
  nodeId: string
  attempt: number
  lane: Lane
  role: Role
  waitingSince: string | null
  nudgeLevel: number
  verify: Verify | null
  verdict: 'pass' | 'fail' | null
  approvedBy: string | null
  approvedAt: string | null
  approvalNote: string | null
  signoffs?: Signoff[]
  approvers?: string[]
  waitingFor?: string[]
  env?: Env
}

export type RegisterKind = 'risk' | 'action' | 'issue' | 'decision' | 'escalation' | 'change' | 'defect' | 'lesson'

export interface RegisterItem {
  id: number
  projectId: string
  runId: number | null
  stepRunId: number | null
  kind: RegisterKind
  ref: string
  title: string
  detail: string
  owner: string
  status: 'open' | 'proposed' | 'approved' | 'rejected' | 'mitigated' | 'closed'
  probability: number | null
  impact: number | null
  category: number | null
  review: string | null
  mitigation: string
  severity: string
  dueAt: string | null
  approver: string | null
  approvedAt: string | null
  signoffs?: Signoff[]
  link: string
  createdBy: string
  createdAt: string
}

export interface ScopeItem {
  id: number
  ref: string
  text: string
  acceptance: string
  status: 'open' | 'met' | 'not_met' | 'dropped'
  evidence: string
}

export interface Attachment {
  id: number
  name: string
  path: string
  size: number
  createdBy: string
  createdAt: string
}

export interface Run {
  id: number
  projectId: string
  workflowId: string
  workflowName: string
  kind: 'feature' | 'bugfix'
  title: string
  slug: string
  status: Status
  currentPos: number
  createdAt: string
  finishedAt: string | null
  steps: Step[]
  owner: string
  createdBy: string
  priority: number
  dueAt: string | null
  estimateMin: number
  budgetUsd: number
  externalKey: string
  epic: string
  dependsOn: number | null
  dependsOnStatus?: string | null
  statusReason: string
  workflowVersion: number | null
  rework: Record<string, string>
  health?: Health
  scope?: ScopeItem[]
  attachments?: Attachment[]
  registers?: RegisterItem[]
}

export interface Project {
  id: string
  name: string
  slug: string
  folder: string
  khProject: string
  total: number
  completed: number
  doing: number
  failed: number
  cancelled: number
  runs: Run[]
  owner: string
  budgetUsd: number
  testCommand: string
  jiraBase: string
  templateId: string
  health?: { rag: Rag; reasons: string[]; spent: number }
  open?: Partial<Record<RegisterKind, number>>
  clientContact: string
  holidays: Holiday[]
  envs: EnvRow[]
}

export interface Holiday {
  from: string
  to: string
  label?: string
}

export interface EnvRow {
  name: string
  url?: string
  version?: string
  promotedAt?: string
  by?: string
}

export type TaskSide = 'laidon' | 'client' | 'agent'
export type TaskStatus = 'not_started' | 'in_progress' | 'completed'
export type PlanHealth = 'blue' | 'green' | 'yellow' | 'red'

export interface TaskDep {
  task: number
  type: 'FS' | 'SS' | 'FF'
  lag: number
}

export interface PlanTask {
  id: number
  parentId: number | null
  sort: number
  kind: 'phase' | 'task' | 'milestone'
  title: string
  details: string
  side: TaskSide
  owner: string
  role: string
  stream: string
  durationDays: number
  loeHours: number
  start: string | null
  end: string | null
  pinnedStart: string | null
  baselineStart: string | null
  baselineEnd: string | null
  actualEnd: string | null
  pct: number
  status: TaskStatus
  deps: TaskDep[]
  invoice: boolean
  invoiceSent: string | null
  clientVisible: boolean
  runId: number | null
  nodeId: string
  wbs: string
  level: number
  isParent: boolean
  expected: number
  variance: number
  remaining: number
  pastDue: boolean
  health: PlanHealth
  lookahead: number | null
  critical: boolean
  floatDays: number
  slipDays: number | null
}

export interface PlanView {
  projectId: string
  today: string
  planStart: string
  holidays: Holiday[]
  summary: {
    pct: number
    start: string | null
    end: string | null
    durationDays: number
    remainingDays: number
    health: 'green' | 'yellow' | 'red'
    completed: number
    inProgress: number
    notStarted: number
    pastDue: number
    red: number
    yellow: number
    critical: number
    invoicesDue: number
    clientOpen: number
  }
  tasks: PlanTask[]
  invoices: { id: number; title: string; wbs: string; end: string | null; status: TaskStatus; invoiceSent: string | null; due: boolean }[]
}

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  titles?: string[]
  disabled?: boolean
  token?: string
}

export interface Notice {
  id: number
  ts: string
  kind: string
  level: number
  text: string
  projectId: string | null
  runId: number | null
  stepPos: number | null
  read: boolean
}

export interface Settings {
  ladderMinutes: number[]
  maxRework: number
  maxConcurrent: number
  digestHour: number
  testTimeoutSec: number
  burnAmberPct: number
  burnRedPct: number
  crApprovers: string[]
}

export interface PortfolioRow {
  id: string
  name: string
  owner: string
  rag: Rag
  reasons: string[]
  total: number
  completed: number
  doing: number
  failed: number
  waiting: number
  spent: number
  budgetUsd: number
  open: Partial<Record<RegisterKind, number>>
}

export interface AuditRow {
  id: number
  ts: string
  actor: string
  action: string
  entity: string
  entityId: string
  detail: string
}

export interface Message {
  seq: number
  senderKind: 'agent' | 'human' | 'system'
  senderName: string
  agentId: string | null
  content: string
  createdAt: string
}

export interface Usage {
  tokens: number
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  costUsd: number
  calls: number
}

export interface UsageMap {
  projects: Record<string, Usage>
  runs: Record<string, Usage>
}
