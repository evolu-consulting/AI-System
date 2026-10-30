// Client for the DLC engine, through this server's /api/dlc proxy (same origin; the access token
// rides in the Authorization header and the engine checks it again).
//
// A few routes (nodes, worklog, reports, app, pause) are newer than some engines; when one answers
// 404 the client falls back to what every engine has (the run, its events and the board).

import { accessToken, login } from '@/lib/oidc'

export class DlcError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code = '') {
    super(message)
    this.status = status
    this.code = code
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const t = accessToken()
  if (t) headers.Authorization = 'Bearer ' + t
  const res = await fetch('/api/dlc' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.status === 401) {
    void login()
  }
  if (!res.ok) {
    const d = (data || {}) as { error?: string; message?: string; detail?: unknown; code?: string }
    const msg = d.message || d.error || (typeof d.detail === 'string' ? d.detail : '') || res.statusText
    throw new DlcError(String(msg), res.status, String(d.code || d.error || ''))
  }
  return data as T
}

export const dlc = {
  get: <T>(p: string) => call<T>('GET', p),
  post: <T>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
}

// ------------------------------------------------------------------ types

export interface RunSummary {
  id: string
  state: string
  pack_path?: string
  created_ms: number
  updated_ms: number
  budget_usd?: number
  units?: number
  unit_states?: Record<string, number>
  /** merged units that changed nothing: their work was already on main (verify: already_satisfied) */
  nothing_to_merge?: number
  detail?: {
    target?: string; spent_usd?: number; flow?: string; name?: string; paused?: boolean
    /** the open gate: a person must decide (engine line.gates) */
    gate?: { name: string; round?: number; step?: number | string; ms?: number }
    /** the run waits for its turn in the project's change queue (engine line.changequeue) */
    queue_wait?: QueueWait
    [k: string]: unknown
  }
  paused?: boolean
  flow?: string
  name?: string
  progress?: number
}

export interface DlcEvent {
  seq: number
  kind: string
  ts_ms: number
  env: { run: string; unit: string; attempt: number; model?: string }
  body: Record<string, unknown>
  /** the event as a sentence for people (engines before the attention panel send none) */
  title?: string
  text?: string
}

export interface QueueWait { seq: number; behind: number; text: string; since_ms?: number; head?: { seq: number; run: string; state: string } }

export interface FlowNode {
  id: string
  title: string
  stage: string
  /** awaiting: an open gate, a person decides; queued: waits its turn in the change queue */
  state: 'pending' | 'running' | 'active' | 'awaiting' | 'queued' | 'done' | 'failed' | 'paused' | 'skipped' | string
  gate?: string
  queue?: QueueWait
  roles?: string[]
  started_ms?: number | null
  ended_ms?: number | null
  counts?: Record<string, number>
}

export interface WorklogEntry {
  ts: number
  role: string
  agent?: string
  kind: string
  title: string
  text: string
  cost_usd?: number
  artifact?: string
  /** the engine event kind and its own record, for the technical view */
  event?: string
  raw?: string
}

export interface Report {
  id: string
  kind: string
  title: string
  node?: string
  created_ms?: number
  mime?: string
  size?: number
  url?: string
}

export interface AppState {
  state: 'stopped' | 'starting' | 'running' | 'failed' | 'none' | string
  url?: string
  port?: number
  pid?: number
  log_tail?: string
  message?: string
  error?: string
  /** web: Start app / Open app; desktop: Build & download (a zip of the built program). */
  kind?: 'web' | 'desktop'
  build?: { state?: 'building' | 'built' | 'failed'; size?: number; error?: string; name?: string }
}

export interface FlowDef {
  id: string
  kind: 'new' | 'enhance' | 'bug' | 'migrate'
  label: string
  description: string
  fields: { name: string; label: string; required?: boolean; placeholder?: string; multiline?: boolean }[]
  enabled: boolean
  order: number
}

// ------------------------------------------------------------------ fallbacks

/** Stages of a run, in order, with the run states and event kinds that belong to each. */
export const STAGES: { id: string; title: string; states: string[]; kinds: string[]; roles: string[] }[] = [
  { id: 'intake', title: 'Intake', states: ['admitted'], kinds: ['run.admitted', 'spec.', 'pack.'], roles: ['engine'] },
  { id: 'understand', title: 'Understand spec', states: ['understanding'], kinds: ['digest.', 'reconcile.', 'fgraph.', 'tests.', 'gap', 'assumption', 'question', 'decision', 'human.'], roles: ['reader', 'test author'] },
  { id: 'plan', title: 'Plan', states: ['planning'], kinds: ['graph.', 'plan.'], roles: ['planner'] },
  { id: 'build', title: 'Build', states: ['building'], kinds: ['unit.', 'builder.', 'verify.', 'review.', 'seal.', 'llm.'], roles: ['builder', 'verifier', 'reviewer'] },
  { id: 'integrate', title: 'Integrate', states: ['integrating'], kinds: ['merge.'], roles: ['merge queue'] },
  { id: 'qas', title: 'Test (QAS)', states: ['qas'], kinds: ['deploy.', 'qas.', 'fixer.'], roles: ['QAS runner', 'fixer'] },
  { id: 'done', title: 'Done', states: ['green', 'escalated'], kinds: ['run.green', 'run.escalated', 'escalation', 'app.'], roles: ['engine'] },
]

const ORDER = ['admitted', 'understanding', 'planning', 'building', 'integrating', 'qas', 'green']
const ALIAS: Record<string, string> = { testing: 'qas', deploying: 'qas', parked: 'understanding', paused: 'building' }

export function stageOfKind(kind: string): string {
  for (const s of STAGES) if (s.kinds.some((k) => (k.endsWith('.') ? kind.startsWith(k) : kind.startsWith(k)))) return s.id
  return 'build'
}

export function nodesFromRun(run: RunSummary): FlowNode[] {
  const st = ALIAS[run.state] && run.state !== 'paused' ? ALIAS[run.state] : run.state
  const idx = ORDER.indexOf(st === 'escalated' ? lastActive(run) : st === 'paused' ? lastActive(run) : st)
  return STAGES.map((s, i) => {
    let state: FlowNode['state'] = 'pending'
    if (st === 'green') state = 'done'
    else if (st === 'escalated') state = i < idx ? 'done' : i === idx ? 'failed' : 'pending'
    else if (i < idx) state = 'done'
    else if (i === idx) state = isPaused(run) ? 'paused' : waitsForPerson(run) ? 'awaiting' : 'running'
    if (s.id === 'done') state = st === 'green' ? 'done' : st === 'escalated' ? 'failed' : 'pending'
    return { id: s.id, title: s.title, stage: s.id, state, roles: s.roles }
  })
}

function lastActive(run: RunSummary): string {
  const s = String(run.detail?.escalated_at_state || run.detail?.last_state || 'building')
  return ORDER.includes(s) ? s : 'building'
}

/** An open gate: the run waits for a person's decision. */
export function waitsForPerson(run: RunSummary): boolean {
  return !!run.detail?.gate?.name && !isFinal(run)
}

export function isPaused(run: RunSummary): boolean {
  return !!(run.paused || run.detail?.paused || run.state === 'paused')
}

export function isFinal(run: RunSummary): boolean {
  return run.state === 'green' || run.state === 'escalated'
}

export function progressOf(run: RunSummary): number {
  if (typeof run.progress === 'number') return Math.max(0, Math.min(100, run.progress))
  if (run.state === 'green') return 100
  const i = Math.max(0, ORDER.indexOf(run.state))
  let p = (i / (ORDER.length - 1)) * 100
  const total = run.units || 0
  if (run.state === 'building' && total) {
    const merged = run.unit_states?.merged || 0
    p += (merged / total) * (100 / (ORDER.length - 1))
  }
  return Math.round(Math.min(99, p))
}

export function worklogFromEvents(events: DlcEvent[], node: string): WorklogEntry[] {
  return events
    .filter((e) => stageOfKind(e.kind) === node)
    .map((e) => ({
      ts: e.ts_ms,
      role: e.kind.split('.')[0],
      agent: e.env?.unit ? e.env.unit + (e.env.attempt ? ' #' + e.env.attempt : '') : '',
      kind: e.kind,
      title: e.kind,
      text: summarize(e.body),
      cost_usd: typeof e.body?.cost_usd === 'number' ? (e.body.cost_usd as number) : undefined,
    }))
}

function summarize(body: Record<string, unknown>): string {
  if (!body) return ''
  const pick = ['message', 'summary', 'reason', 'text', 'title', 'verdict', 'state', 'error']
  for (const k of pick) if (typeof body[k] === 'string' && body[k]) return String(body[k])
  const s = JSON.stringify(body)
  return s.length > 600 ? s.slice(0, 600) + '…' : s
}

// ------------------------------------------------------------------ calls with fallback

export async function listRuns(): Promise<RunSummary[]> {
  const d = await dlc.get<{ runs: RunSummary[] }>('/runs')
  return d.runs || []
}

export async function getRun(id: string): Promise<{ run: RunSummary; [k: string]: unknown }> {
  return dlc.get(`/runs/${encodeURIComponent(id)}`)
}

export async function events(id: string, after = 0, limit = 500): Promise<{ events: DlcEvent[]; last_seq: number }> {
  return dlc.get(`/runs/${encodeURIComponent(id)}/events?after_seq=${after}&limit=${limit}`)
}

export async function allEvents(id: string): Promise<DlcEvent[]> {
  let after = 0
  const out: DlcEvent[] = []
  for (let i = 0; i < 20; i++) {
    const d = await events(id, after, 1000)
    out.push(...(d.events || []))
    if (!d.events || d.events.length < 1000) break
    after = d.events[d.events.length - 1].seq
  }
  return out
}

export async function nodes(run: RunSummary): Promise<FlowNode[]> {
  try {
    const d = await dlc.get<{ nodes: FlowNode[] } | FlowNode[]>(`/runs/${encodeURIComponent(run.id)}/nodes`)
    const list = Array.isArray(d) ? d : d.nodes
    if (list && list.length) return list
  } catch (e) {
    if (!(e instanceof DlcError) || e.status !== 404) throw e
  }
  return nodesFromRun(run)
}

export async function worklog(runId: string, node: string): Promise<WorklogEntry[]> {
  try {
    const d = await dlc.get<{ worklog?: WorklogEntry[]; entries?: WorklogEntry[] } | WorklogEntry[]>(
      `/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(node)}/worklog`,
    )
    return Array.isArray(d) ? d : d.worklog || d.entries || []
  } catch (e) {
    if (!(e instanceof DlcError) || e.status !== 404) throw e
  }
  return worklogFromEvents(await allEvents(runId), node)
}

export async function reports(runId: string): Promise<Report[]> {
  try {
    const d = await dlc.get<{ reports: Report[] } | Report[]>(`/runs/${encodeURIComponent(runId)}/reports`)
    return Array.isArray(d) ? d : d.reports || []
  } catch (e) {
    if (!(e instanceof DlcError) || e.status !== 404) throw e
    return []
  }
}

export interface ReportBody {
  mime: string
  text: string
}

export async function reportBody(runId: string, r: Report): Promise<ReportBody> {
  const url = r.url ? (r.url.startsWith('/api/') ? '/api/dlc' + r.url.slice(4) : r.url) : `/api/dlc/runs/${encodeURIComponent(runId)}/reports/${encodeURIComponent(r.id)}`
  const headers: Record<string, string> = {}
  const t = accessToken()
  if (t) headers.Authorization = 'Bearer ' + t
  const res = await fetch(url, { headers })
  if (!res.ok) throw new DlcError('report not available (' + res.status + ')', res.status)
  const ctype = res.headers.get('Content-Type') || ''
  const raw = await res.text()
  if (ctype.includes('json')) {
    try {
      const d = JSON.parse(raw)
      if (d && typeof d.content === 'string') return { mime: d.report?.mime || r.mime || 'text/markdown', text: d.content }
      return { mime: 'application/json', text: JSON.stringify(d, null, 2) }
    } catch {
      /* not JSON after all */
    }
  }
  return { mime: r.mime || ctype || 'text/plain', text: raw }
}

export async function appState(runId: string): Promise<AppState | null> {
  try {
    return await dlc.get<AppState>(`/runs/${encodeURIComponent(runId)}/app`)
  } catch (e) {
    if (e instanceof DlcError && e.status === 404) return null
    throw e
  }
}

export const startApp = (runId: string) => dlc.post<AppState>(`/runs/${encodeURIComponent(runId)}/app:start`)
export const stopApp = (runId: string) => dlc.post<AppState>(`/runs/${encodeURIComponent(runId)}/app:stop`)
/** Desktop app: start building it into a zip (poll appState for build.state). */
export const buildApp = (runId: string) => dlc.post<AppState>(`/runs/${encodeURIComponent(runId)}/app:build`)
/** Desktop app: save the built zip (a fetch with the sign-in token, then a local file link). */
export async function downloadApp(runId: string): Promise<void> {
  const headers: Record<string, string> = {}
  const t = accessToken()
  if (t) headers.Authorization = 'Bearer ' + t
  const res = await fetch('/api/dlc/runs/' + encodeURIComponent(runId) + '/app/download', { headers })
  if (!res.ok) throw new Error('download failed (HTTP ' + res.status + ')')
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || runId + '.zip'
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}
export const pauseRun = (runId: string) => dlc.post(`/runs/${encodeURIComponent(runId)}:pause`, { reason: 'stopped from Home' })
export const resumeRun = (runId: string) => dlc.post(`/runs/${encodeURIComponent(runId)}:resume`)
/** The text a person types to confirm an urgent stop (the engine refuses anything else). */
export const URGENT_STOP_CONFIRM = 'agree force stop'
/** Urgent stop: pause every unfinished run at once (running agents are killed); each resumes on its own. */
export const pauseAllRuns = (confirm: string) =>
  dlc.post<{ paused: string[]; stopping: string[] }>('/runs:pause_all', { confirm, reason: 'urgent stop from Home' })

export interface Project {
  id: string
  name: string
  description?: string
  created_ms: number
  created_by?: string
  runs: number
  has_code: boolean
  active_run: RunSummary | null
  /** every unfinished run (Enhancement and Bug Fix runs share a project through its change queue) */
  live_runs?: { id: string; state: string; flow: string }[]
  last_run: RunSummary | null
  last_green_run: string
  updated_ms: number
  source?: 'new' | 'folder' | 'git'
  workspace_path?: string
  repo_url?: string
  rag_project?: string
  provider?: string
  source_kind?: 'empty' | 'git' | 'files'
  source_branch?: string
  uncommitted_left_out?: number
  copied_files?: number
  /** What its runs cost: dollars and tokens over every model call (sent incl. cache, received). */
  usage?: { usd: number; tokens_in: number; tokens_out: number }
  /** Whether a person is needed now (held, stopped, waiting for answers, or the last run failed), and why. */
  /** kind approval: a live run waits at a gate (run: the first one, count: how many) */
  attention?: { needed: boolean; why: string; kind?: 'approval' | string; run?: string; count?: number }
  /** Complete nodes (done or skipped) over all nodes of all its runs. */
  progress?: { done: number; total: number; pct: number }
  /** Set when the project is closed (hidden from Home until re-opened). */
  closed?: { by: string; ms: number }
}

/** The closed projects (Home shows the open ones). */
export const listClosedProjects = async (): Promise<Project[]> =>
  (await dlc.get<{ projects: Project[] }>('/projects?closed=1')).projects || []
/** Close a project (refused while one of its processes runs) or re-open it. */
export const closeProject = (id: string) => dlc.post(`/projects/${encodeURIComponent(id)}:close`)
export const reopenProject = (id: string) => dlc.post(`/projects/${encodeURIComponent(id)}:reopen`)

/** 1234 -> '1.2k', 3400000 -> '3.4M'. */
export function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'
  return String(n)
}

/** Push the engine's work to the source repository as branch dlc/<project>. */
export const deliverProject = (id: string) =>
  dlc.post<{ project: string; branch: string; commit: string }>(`/projects/${encodeURIComponent(id)}:deliver`)

/** A RAG System project no DLC project is linked to yet (e.g. imported history): link it to code to work on it. */
export interface RagProject {
  id: string
  descriptor: string
  aliases: string[]
}

export async function listRagProjects(): Promise<RagProject[]> {
  try {
    return (await dlc.get<{ projects: RagProject[] }>('/rag-projects')).projects || []
  } catch {
    return [] // older engine, or no RAG System
  }
}

export interface ClaudeToken {
  source: 'file' | 'service' | 'none'
  hint: string
  set_ms: number
  set_by: string
  /** the last time an agent call met this token refused (revoked, expired); null = none since it was set */
  rejected?: { ms: number; message: string } | null
}

export interface QueueSlot {
  id: string
  seq: number
  run: string
  flow: string
  /** its place in the queue (order of approval); null while its run is still in design */
  order?: number | null
  /** reserved = in design (not in the queue yet); planned = approved, waits its turn; implementing = building,
   *  testing, merging, delivering */
  state: 'reserved' | 'planned' | 'implementing' | 'done' | 'dropped' | 'ignored'
  summary: string
  docs: string[]
  created_ms: number
  planned_ms?: number | null
  started_ms?: number | null
  ended_ms?: number | null
  end?: string | null
  ignored_by?: string | null
  waited_min?: number | null
  actor?: string
}
export interface ChangeQueue { project: string; wait_minutes: number; active: QueueSlot[]; recent: QueueSlot[] }
export const getChangeQueues = () => dlc.get<{ wait_minutes: number; projects: ChangeQueue[] }>('/admin/change-queue')
export const setQueueWait = (wait_minutes: number) => dlc.post<{ wait_minutes: number }>('/admin/change-queue', { wait_minutes })
export const getProjectQueue = (project: string) => dlc.get<ChangeQueue>(`/projects/${encodeURIComponent(project)}/queue`)

export const getClaudeToken = () => dlc.get<ClaudeToken>('/admin/claude-token')
export const setClaudeToken = (token: string) => dlc.post<ClaudeToken>('/admin/claude-token', { token })
export const getEngineMe = () => dlc.get<{ enabled: boolean; actor: string; roles: string[]; admin: boolean }>('/me')

/** Where a project's code comes from: a new folder the engine picks, a folder under the workspace root, or a git clone into it. */
export type ProjectSource =
  | { kind: 'new' }
  | { kind: 'folder'; path: string }
  | { kind: 'git'; url: string; token?: string; folder?: string; branch?: string; username?: string }

export interface WorkspaceFolder {
  name: string
  path: string
  kind: 'empty' | 'git' | 'files' | 'unreadable'
  branch?: string
  has_code: boolean
  project?: string
  why: string
  uncommitted?: number
  nested?: string[]
}

/** One level of the engine's workspace root; root '' = none configured (or an engine without it). */
export async function getWorkspace(path = ''): Promise<{ root: string; path: string; folders: WorkspaceFolder[]; current?: WorkspaceFolder | null }> {
  try {
    return await dlc.get(`/workspace${path ? '?path=' + encodeURIComponent(path) : ''}`)
  } catch (e) {
    if (e instanceof DlcError && e.status === 404 && !path) return { root: '', path: '', folders: [] }
    throw e
  }
}

export async function listProjects(): Promise<Project[] | null> {
  try {
    const d = await dlc.get<{ projects: Project[] }>('/projects')
    return d.projects || []
  } catch (e) {
    if (e instanceof DlcError && e.status === 404) return null // engine without projects
    throw e
  }
}

export const getProject = (id: string) =>
  dlc.get<{ project: Project; runs: RunSummary[] }>(`/projects/${encodeURIComponent(id)}`)

export const createProject = (name: string, description = '', source: ProjectSource = { kind: 'new' }, ragProject = '') =>
  dlc.post<Project>('/projects', {
    name, description, ...(source.kind === 'new' ? {} : { source }), ...(ragProject ? { rag_project: ragProject } : {}),
  })

/** Start a flow: create the spec pack from markdown, then the run (or a migration). With a project, the run
 *  works on the project's repository (the engine keeps it; no server paths). */
export async function startFlow(flow: FlowDef, name: string, spec: string, fields: Record<string, string>, project = ''): Promise<string> {
  if (flow.kind === 'migrate') {
    const d = await dlc.post<{ migration: string }>('/migrations', { v1: fields.v1, v2: fields.v2, mode: 'decide', notes_text: spec })
    return d.migration
  }
  const packBody: Record<string, unknown> =
    flow.kind === 'bug'
      ? { kind: 'bug', name, report: spec } // what happened, free text: the agents read links and the project's knowledge
      : { kind: flow.kind, name, spec }
  const pack = await dlc.post<{ pack: string }>('/packs', packBody)
  const runBody: Record<string, unknown> = { pack: pack.pack, flow: flow.id, name, human_mode: 'decide' }
  if (project) runBody.project = project
  else if (fields.target) runBody.target = fields.target
  const run = await dlc.post<{ run: string }>('/runs', runBody)
  return run.run
}

export function fmtAge(ms?: number): string {
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.round(s / 60) + ' min ago'
  if (s < 86400) return Math.round(s / 3600) + ' h ago'
  return Math.round(s / 86400) + ' d ago'
}

export function fmtDuration(from?: number, to?: number): string {
  if (!from) return ''
  const s = Math.max(0, Math.round(((to || Date.now()) - from) / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`
}

// ------------------------------------------------------------------ sidecars (Admin > Sidecars)

export interface Sidecar {
  id: string
  name: string
  description: string
  enabled: boolean
  builtin: boolean
  count: number | null
}

export interface AutologinEntry {
  id: number
  name: string
  url: string
  host: string
  env: string
  kind: 'password' | 'sso' | 'passcode' | 'steps' | 'cli'
  username: string
  provider: string
  steps?: string
  roles: string[]
  enabled: boolean
  has_secret: boolean
}

export type AutologinInput = Partial<Omit<AutologinEntry, 'id' | 'host' | 'has_secret'>> & { secret?: string }

export const listSidecars = () => dlc.get<{ sidecars: Sidecar[] }>('/admin/sidecars').then((d) => d.sidecars)
export const listAutologin = () => dlc.get<{ entries: AutologinEntry[] }>('/admin/sidecars/autologin').then((d) => d.entries)
export const addAutologin = (e: AutologinInput) => dlc.post<AutologinEntry>('/admin/sidecars/autologin', e)
export const changeAutologin = (id: number, e: AutologinInput) => dlc.post<AutologinEntry>(`/admin/sidecars/autologin/${id}`, e)
export const deleteAutologin = (id: number) => dlc.post(`/admin/sidecars/autologin/${id}:delete`)
export const testAutologin = (id: number) => dlc.post<{ signed_in: boolean; text: string }>(`/admin/sidecars/autologin/${id}:test`)
export const askKnowledge = (ragProject: string, question: string) =>
  dlc.post<{ text: string; error?: boolean }>('/admin/sidecars/knowledge:ask', { rag_project: ragProject, question })

// ------------------------------------------------------------------ run hooks (Admin > Sidecars > Run hooks)

export interface RunHook {
  id: number
  name: string
  enabled: boolean
  /** run: an event of every matching run; agent: every matching agent call (agent_start, before_tool) */
  scope?: 'run' | 'agent'
  roles?: string[]
  pattern?: string
  prompt: string
  event: string
  mode: 'background' | 'wait'
  on_block: 'wait' | 'stop'
  on_error: 'continue' | 'wait'
  projects: string[]
  flows: string[]
  apps: string[]
  max_turns: number
  max_usd: number
  by?: string
}

export type RunHookInput = Partial<Omit<RunHook, 'id' | 'by'>>

/** One hook's result on a run (key '<event>:<hook id>'); a test result also carries its run. */
export interface HookResult {
  key?: string
  hook?: number
  name?: string
  event?: string
  mode?: string
  status: 'running' | 'done' | 'passed' | 'blocked' | 'error' | string
  reason?: string
  outcome?: string
  usd?: number
  run?: string
  ms?: number
  done_ms?: number
  passed_by?: string
}

export interface HooksAdmin {
  hooks: RunHook[]
  events: string[]
  wait_events: string[]
  agent_events?: string[]
  roles?: string[]
  apps: string[]
  tests: Record<string, HookResult>
}

export const listHooks = () => dlc.get<HooksAdmin>('/admin/hooks')
export const addHook = (h: RunHookInput) => dlc.post<RunHook>('/admin/hooks', h)
export const changeHook = (id: number, h: RunHookInput) => dlc.post<RunHook>(`/admin/hooks/${id}`, h)
export const deleteHook = (id: number) => dlc.post(`/admin/hooks/${id}:delete`)
export const testHook = (id: number, run: string) => dlc.post<HookResult>(`/admin/hooks/${id}:test`, { run })

/** The run's hook results and the hook holding it (null = none, or an engine without hooks). */
export async function runHooks(runId: string): Promise<{ results: Record<string, HookResult>; hold: HookResult | null }> {
  try {
    const d = await dlc.get<{ results: Record<string, HookResult>; hold: HookResult | null }>(`/runs/${encodeURIComponent(runId)}/hooks`)
    return { results: d.results || {}, hold: d.hold || null }
  } catch (e) {
    if (e instanceof DlcError && e.status === 404) return { results: {}, hold: null }
    throw e
  }
}

/** A person lets a run held by a hook go on: the hook counts as passed, then the run resumes. */
export async function passHook(runId: string, key: string): Promise<void> {
  const [event, hook] = key.split(':')
  await dlc.post(`/runs/${encodeURIComponent(runId)}/hooks/${encodeURIComponent(event)}/${encodeURIComponent(hook)}:pass`)
  await resumeRun(runId)
}

// ------------------------------------------------------------------ attention panel

export interface Question {
  qid: string
  state?: string
  kind?: string
  decision?: string
  options?: { id: string; text: string; impact?: string }[]
  recommended?: string
  f_items?: string[]
  answer?: unknown
}

export interface Attention {
  needed: boolean
  kind: 'gate' | 'hook' | 'paused' | 'questions' | 'failed' | 'none'
  run?: string
  state?: string
  title?: string
  code?: string
  what?: string
  why?: string
  do?: string
  unit?: string
  reason?: string
  step?: string
  options?: string[]
  questions?: Question[]
  hook?: HookResult
  gate?: Gate
  resolved?: { by: string; ms: number; note: string }
  explain?: { what: string; why: string; next: string[]; usd?: number }
  /** a run started again as a new run (before 2026-10-25; a retry now runs the same run again) */
  retried_by?: string
  /** what the supervisor agent decided about this failed run */
  supervisor?: { action: 'retry' | 'person'; impact?: string; severity?: 'minor' | 'major'; reason: string; hint?: string; by?: string; new_run?: string; reopened?: number; level?: number; ms?: number; retired?: { test: string; commit: string; reason: string }[] }
  /** the attempt the run is on, when it was run again in place (engine line.reopen) */
  attempt?: number
  /** the earlier attempts of this run, oldest first: why each failed and who ran it again */
  attempts?: { n: number; code: string; message: string; by: string; actor: string; hint: string; level?: number | null; level_up?: number; ms: number }[]
}

/** A person's step of the gated Enhancement / Bug Fix flow (engine line.gates): spec (5), plan (8), final (13). */
/** An open gate of a run's process definition (engine line.process): names, decisions, targets and labels are
 *  the definition's data, so a project with its own process gets its own gates here without a frontend change. */
/** What the agent understood, will do and will not do (the document's "At a glance" section). */
export interface Glance { understood: string[]; will_do: string[]; will_not: string[] }

/** A point the agent decided alone (a proposed or open question, an assumption): the person confirms or changes it. */
export interface Ask { id: string; question: string; status: 'proposed' | 'open' | string; answer: string; artifact: string; artifact_title?: string }

export interface GateDoc { id: string; title: string; text: string; glance?: Glance | null; asks?: Ask[]; edited_ms?: number | null }

/** A message of the chat at a gate (engine line.gatechat). */
export interface ChatMessage { id: string; who: 'person' | 'agent'; by?: string; role?: string; text: string; ms: number; round?: number; state?: 'thinking' | 'done' | 'failed'; edited?: string[]; usd?: number }

export interface Gate {
  name: string
  step: number | string
  round: number
  title: string
  process?: string
  docs: GateDoc[]
  /** every point to confirm, of every document shown */
  asks?: Ask[]
  /** the decisions that pass the gate (approve, deploy ...) */
  pass?: string[]
  /** the definition allows talking with the step's agents here */
  chat?: boolean
  messages?: ChatMessage[]
  /** the drafts were written again because the change queue moved */
  refreshed?: { n: number; ms: number; artifacts: string[]; took: { seq: number; run: string; gone: boolean; pushed: string[] }[] }[]
  decisions: string[]
  decision_labels?: Record<string, string>
  revise?: string[]
  targets: string[]
  target_labels?: Record<string, string>
  default_target?: string
  review?: boolean
  approvers?: string[]
  supervisor?: string
  note_label?: string
  note_placeholder?: string
  history: { round: number; decision: string; target?: string; note: string; by: string; ms: number; files: { name: string; warnings?: string }[] }[]
}

/** A file a person adds: PDF and Word go as they are (base64), the engine turns them into text. */
export interface GateFile { name: string; data: string }

export async function fileToBase64(f: File): Promise<string> {
  const bytes = new Uint8Array(await f.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** Decide at the open gate; the run goes on by itself. */
export interface GateAnswer { artifact: string; id: string; ok: boolean; text?: string }

export const decideGate = (runId: string, gate: string, body: { decision: string; note?: string; target?: string; who?: string; files?: GateFile[]; answers?: GateAnswer[] }) =>
  dlc.post<{ gate: string; decision: string; round: number }>(`/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(gate)}`, body)

/** Write to the step's agents at the open gate; the answer comes on its own (poll the attention view). */
export const chatGate = (runId: string, gate: string, message: string, who?: string) =>
  dlc.post<{ gate: string; messages: ChatMessage[] }>(`/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(gate)}/chat`, { message, who })

/** A decision taken at a gate, as the engine's decision ledger keeps it (line.decisions). */
export type DecisionSignal = 'positive' | 'mixed' | 'negative' | 'auto' | 'neutral'

export interface DecisionPoint { artifact: string; id: string; question: string; status: string; proposed: string; answer: 'agreed' | 'changed'; text: string }

export interface DecisionEntry {
  run: string
  gate: string
  title: string
  round: number
  decision: string
  signal: DecisionSignal
  by: string
  ms: number
  target?: string
  auto?: boolean
  note: string
  files: string[]
  points: DecisionPoint[]
  chat: { who: 'person' | 'agent'; by: string; text: string; ms: number; edited?: string[] }[]
  /** artifact -> path of the document as the person saw it when deciding (read with decisionDoc) */
  documents: Record<string, string>
  personas: string[]
  precedents?: string[]
}

export interface Decisions { run: string; entries: DecisionEntry[]; markdown: string; signal: Record<string, Record<string, number>> }

/** Every decision taken at the run's gates (null = an engine without the decision ledger). */
export async function decisions(runId: string): Promise<Decisions | null> {
  try {
    return await dlc.get<Decisions>(`/runs/${encodeURIComponent(runId)}/decisions`)
  } catch (e) {
    if (e instanceof DlcError && e.status === 404) return null
    throw e
  }
}

/** A document of the decision history, as the person saw it when deciding. */
export const decisionDoc = (runId: string, path: string) =>
  dlc.get<{ run: string; path: string; text: string }>(`/runs/${encodeURIComponent(runId)}/decisions?doc=${encodeURIComponent(path)}`)

/** A PDF or Word document as markdown text (no OCR). */
export const convertDoc = (name: string, data: string) =>
  dlc.post<{ name: string; kind: string; pages: number; chars: number; warnings: string[]; text: string }>('/docs:convert', { name, data })

/** What a person must do for the run now (null = an engine without the attention panel). */
export async function attention(runId: string): Promise<Attention | null> {
  try {
    return await dlc.get<Attention>(`/runs/${encodeURIComponent(runId)}/attention`)
  } catch (e) {
    if (e instanceof DlcError && e.status === 404) return null
    throw e
  }
}

export const resolveRun = (runId: string, note: string) =>
  dlc.post<{ run: string; resolved: Attention['resolved'] }>(`/runs/${encodeURIComponent(runId)}:resolve`, { note })

export const retryRun = (runId: string, hint: string) =>
  dlc.post<{ run: string; state: string; attempt: number; retry_of: string }>(`/runs/${encodeURIComponent(runId)}:retry`, { hint })

export const explainRun = (runId: string) =>
  dlc.post<{ run: string; explain: NonNullable<Attention['explain']> }>(`/runs/${encodeURIComponent(runId)}:explain`)

/** Answer open questions of a parked run; the run resumes after the last one. */
export const answerQuestions = (runId: string, answers: { qid: string; option: string; text?: string }[], who: string) =>
  dlc.post<{ remaining: number; resume: boolean }>(`/runs/${encodeURIComponent(runId)}/answers`, { answers, who })

// ------------------------------------------------------------------ run board + project messages

export interface BoardCard { step: string; status: string; detail?: string; ms?: number }
export interface AgentMessage { id: string; from: string; to: string[]; kind: string; text: string; ms: number; reply_to?: string }

/** The latest status of every step of a run and the messages its agents left each other (null = older engine). */
export async function runBoard(runId: string): Promise<{ board: Record<string, BoardCard>; messages: AgentMessage[] } | null> {
  try {
    return await dlc.get<{ board: Record<string, BoardCard>; messages: AgentMessage[] }>(`/runs/${encodeURIComponent(runId)}/board`)
  } catch (e) {
    if (e instanceof DlcError && e.status === 404) return null
    throw e
  }
}
