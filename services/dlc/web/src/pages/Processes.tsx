import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, GitBranch, Plus } from 'lucide-react'
import { BOX, Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { dlc, listProjects } from '@/lib/dlc'
import type { Project } from '@/lib/dlc'
import { go } from '@/lib/route'

// Admin > AI-SDLC processes (engine line.process): an organisation's processes as data. AI agents do the work of
// each step; people supply what the agents need, decide at gates, handle stops and teach the system. Versions are
// immutable; a process is deprecated or retired, never deleted; what the agents learned stays with each project.

interface Summary { id: string; status: string; version: number; title: string; owner: string; flows: string[]; has_draft: boolean; replaced_by: string }
interface Version { v: number; def: Def; by: string; ms: number; reason: string; changes: string[] }
interface Queue { enabled?: boolean; serial_from?: string; hold_until?: 'end' | 'merged'; refresh_drafts?: boolean }
interface Def { id?: string; title?: string; purpose?: string; queue?: Queue; owner?: string; kpi?: Record<string, number>; input?: string; output?: string; applies?: { flows?: string[] }; needs?: Need[]; steps?: Step[]; [k: string]: unknown }
interface Need { id: string; what: string; kind?: string; owner: string; scope?: string; required?: string }
interface Gate { name: string; title?: string; chat?: boolean; approvers?: string[]; decisions?: string[]; auto?: { criteria: string; kind?: string; min_precedents?: number }; routes?: Record<string, { back_to: string }> }
interface Step { id: string; kind: string; agents?: { artifact: string; role: string }[]; needs?: Need[]; gate?: Gate; supervisor?: string; incident?: string; target?: { kpi?: Record<string, number> }; checks?: { check: string }[] }
interface Record_ { id: string; status: string; draft?: Def; versions: Version[]; replaced_by?: string; history: { what: string; by: string; ms: number; reason?: string }[] }
interface Impact { live_runs: { run: string; version: string; at: string }[]; live_by_version: Record<string, number>; projects: { project: string; flow: string; binding: string }[]; runs: number }
interface Readiness { ready: boolean; table: string; needs: (Need & { ok: boolean; how: string })[] }

const STATUS_COLOR: Record<string, string> = { active: 'var(--green)', draft: 'var(--amber)', deprecated: 'var(--amber)', retired: 'var(--dim)' }
const TEMPLATE = { id: 'my-process', extends: 'gated-change', title: 'My process', owner: 'dlc-admin', applies: { flows: ['enhancement'] }, needs: [], steps: [] }

export function ProcessesView({ id }: { id?: string }) {
  return id ? <ProcessDetail pid={id} /> : <ProcessList />
}

function Title({ text, back }: { text: string; back?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-6 pt-5">
      {back && (
        <button className="text-[13px] font-semibold text-[var(--muted-ink)] hover:text-[var(--blue)]" onClick={() => go('admin/processes')}>
          Processes <ChevronRight className="inline size-3.5" />
        </button>
      )}
      <h2 className="title-navy text-[22px]">{text}</h2>
    </div>
  )
}

function Badge({ status }: { status: string }) {
  return <span className="pill" style={{ background: 'var(--row)', color: STATUS_COLOR[status] || 'var(--ink)' }}><i style={{ background: STATUS_COLOR[status] || 'var(--dim)' }} />{status}</span>
}

function ProcessList() {
  const [items, setItems] = useState<Summary[] | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { dlc.get<{ processes: Summary[] }>('/admin/processes').then((d) => setItems(d.processes)).catch((e) => setErr(String((e as Error).message))) }, [])
  useEffect(load, [load])
  const create = async () => {
    const pid = (prompt('Id of the new process (letters, digits, - and _)') || '').trim()
    if (!pid) return
    try {
      await dlc.post('/admin/processes', { ...TEMPLATE, id: pid, title: pid })
      go(`admin/processes/${pid}`)
    } catch (e) { setErr(String((e as Error).message)) }
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Title text="AI-SDLC processes" />
      <p className="px-6 pt-1 text-[12.5px] text-[var(--muted-ink)]">
        Each process is a company process trimmed to what AI agents do: its steps, the agents and tools of each step, what people must supply first, who approves, supervises and handles a stop, and the targets. Projects bind to a process per flow.
      </p>
      {err && <p className="mx-6 mt-3 text-[12px] text-[var(--red)]">{err}</p>}
      <div className="px-6 pt-4"><Button onClick={create}><Plus className="mr-1 inline size-4" />New process</Button></div>
      <div className="grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-3">
        {items?.length === 0 && <p className="text-[12.5px] text-[var(--muted-ink)]">No process in the registry yet: runs use the built-in definitions.</p>}
        {items?.map((p) => (
          <button key={p.id} className="glass flex flex-col gap-2 p-4 text-left transition hover:border-[var(--blue)]" onClick={() => go(`admin/processes/${p.id}`)}>
            <span className="flex items-center gap-3">
              <span className="chip-glass !h-9 !w-9"><GitBranch size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold text-[var(--navy)]">{p.title}</span>
                <span className="text-[11.5px] text-[var(--muted-ink)]">{p.id} · v{p.version}{p.has_draft ? ' · draft pending' : ''}</span>
              </span>
              <Badge status={p.status} />
            </span>
            <span className="text-[12px] text-[var(--muted-ink)]">flows: {p.flows.join(', ') || '-'} · owner: {p.owner || '-'}{p.replaced_by ? ` · replaced by ${p.replaced_by}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

type Tab = 'steps' | 'draft' | 'versions' | 'impact' | 'readiness'

function ProcessDetail({ pid }: { pid: string }) {
  const [rec, setRec] = useState<Record_ | null>(null)
  const [impact, setImpact] = useState<Impact | null>(null)
  const [tab, setTab] = useState<Tab>('steps')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    dlc.get<{ process: Record_; impact: Impact }>(`/admin/processes/${encodeURIComponent(pid)}`)
      .then((d) => { setRec(d.process); setImpact(d.impact) }).catch((e) => setErr(String((e as Error).message)))
  }, [pid])
  useEffect(load, [load])
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr('')
    try { await fn(); load() } catch (e) { setErr(String((e as Error).message)) } finally { setBusy(false) }
  }
  if (!rec) return <div className="p-6 text-[12.5px] text-[var(--muted-ink)]">{err || 'Loading…'}</div>
  const latest = rec.versions[rec.versions.length - 1]
  const def: Def = latest?.def || rec.draft || {}
  const status = (to: string) => act(async () => {
    const reason = prompt(`Why ${to}?`) || ''
    const replaced_by = to !== 'active' ? (prompt('Successor process id (optional)') || '') : ''
    await dlc.post(`/admin/processes/${encodeURIComponent(pid)}:status`, { status: to, reason, replaced_by })
  })
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Title text={def.title || pid} back />
      <div className="flex flex-wrap items-center gap-2 px-6 pt-2 text-[12.5px] text-[var(--muted-ink)]">
        <Badge status={rec.status} /> <span>{pid} · {latest ? `v${latest.v}` : 'never published'}</span>
        {def.owner && <span>· owner {def.owner}</span>}{rec.replaced_by && <span>· replaced by {rec.replaced_by}</span>}
        <span className="ml-auto flex gap-2">
          {rec.draft && rec.status !== 'retired' && <Button disabled={busy} onClick={() => act(() => dlc.post(`/admin/processes/${encodeURIComponent(pid)}:publish`, { reason: prompt('What changes in this version?') || '' }))}>Publish draft</Button>}
          {rec.status === 'active' && <Button tone="ghost" disabled={busy} onClick={() => status('deprecated')}>Deprecate</Button>}
          {rec.status === 'deprecated' && <Button tone="ghost" disabled={busy} onClick={() => status('active')}>Re-activate</Button>}
          {rec.status !== 'retired' && <Button tone="ghost" disabled={busy} onClick={() => confirm('Retire this process? It becomes read only; its history stays.') && status('retired')}>Retire</Button>}
        </span>
      </div>
      {def.purpose && <p className="px-6 pt-2 text-[12.5px]">{def.purpose}</p>}
      {err && <p className="mx-6 mt-2 text-[12px] text-[var(--red)]">{err}</p>}
      <div className="mt-3 flex gap-1.5 px-6">
        {(['steps', 'draft', 'versions', 'impact', 'readiness'] as Tab[]).map((t) => (
          <button key={t} className={'rounded-lg px-3 py-1 text-[12.5px] font-semibold ' + (tab === t ? 'bg-[var(--head)] text-[var(--blue)] shadow' : 'text-[var(--muted-ink)]')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      <div className="p-6 pt-3">
        {tab === 'steps' && <StepsView def={def} />}
        {tab === 'draft' && <DraftEditor pid={pid} draft={rec.draft || latest?.def || {}} readOnly={rec.status === 'retired'} onSaved={load} />}
        {tab === 'versions' && <VersionsView rec={rec} />}
        {tab === 'impact' && impact && <ImpactView pid={pid} impact={impact} onChanged={load} />}
        {tab === 'readiness' && <ReadinessView pid={pid} />}
      </div>
    </div>
  )
}

function StepsView({ def }: { def: Def }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="glass p-3 text-[12.5px]">
        <b>Input</b>: {def.input || '-'} · <b>Output</b>: {def.output || '-'} · <b>Targets</b>: {Object.entries(def.kpi || {}).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}
        <NeedsList needs={def.needs || []} />
      </div>
      <QueueView def={def} />
      {(def.steps || []).map((s, i) => (
        <div key={s.id} className="glass p-3 text-[12.5px]">
          <div className="text-[14px] font-bold text-[var(--navy)]">{i + 1}. {s.gate?.title || s.id} <span className="text-[11.5px] font-normal text-[var(--muted-ink)]">({s.kind})</span></div>
          {s.agents && <div>Agents: {s.agents.map((a) => `${a.role} → ${a.artifact}`).join(', ')}</div>}
          {s.checks && s.checks.length > 0 && <div>Checks: {s.checks.map((c) => c.check).join(', ')}</div>}
          <div>Supervisor: {s.supervisor || def.owner || '-'} · Handles a stop: {s.incident || def.owner || '-'}</div>
          {s.target?.kpi && <div>Targets: {Object.entries(s.target.kpi).map(([k, v]) => `${k} ${v}`).join(', ')}</div>}
          {s.gate && (
            <div>Gate <b>{s.gate.name}</b>: decided by {s.gate.approvers?.join(' or ') || 'anyone signed in'} ({s.gate.decisions?.join(' / ')})
              {s.gate.routes && Object.entries(s.gate.routes).map(([d, r]) => <span key={d}> · {d} → back to {r.back_to}</span>)}
              {s.gate.chat && <div className="mt-1 text-[var(--muted-ink)]">Chat: the person can talk with this step's agents at the gate; they answer and change their documents</div>}
              {s.gate.auto && <div className="mt-1 text-[var(--muted-ink)]">Auto-approve after {s.gate.auto.min_precedents ?? 1} approved case(s) of this project when: {s.gate.auto.criteria}</div>}
            </div>
          )}
          <NeedsList needs={s.needs || []} />
        </div>
      ))}
    </div>
  )
}

/** The process's change queue (engine line.changequeue); the defaults when the definition says nothing. Edit it in
 *  the draft as "queue": {"enabled", "serial_from", "hold_until", "refresh_drafts"}. */
function QueueView({ def }: { def: Def }) {
  const q = { enabled: true, serial_from: 'build', hold_until: 'end', refresh_drafts: true, ...(def.queue || {}) }
  const from = (def.steps || []).find((s) => s.id === q.serial_from || s.kind === q.serial_from)
  return (
    <div className="glass p-3 text-[12.5px]">
      <div className="text-[14px] font-bold text-[var(--navy)]">Change queue {def.queue ? '' : <span className="text-[11.5px] font-normal text-[var(--muted-ink)]">(defaults)</span>}</div>
      {!q.enabled ? <div>Off: a run of this process owns its project alone.</div> : (
        <ul className="mt-1 list-disc pl-5">
          <li>Runs of one project design in parallel; a run joins the queue when its drafts are approved (first approved, first served).</li>
          <li>From step <b>{from ? (from.gate?.title || from.id) : q.serial_from}</b> on, one run of the project at a time.</li>
          <li>The place is held {q.hold_until === 'merged' ? <b>until the build is merged</b> : <b>until the run ends (final review included)</b>}.</li>
          <li>{q.refresh_drafts ? <>When another run joins the queue, the drafts still waiting for approval are <b>written again on top of it</b>.</> : <>Drafts waiting for approval are not written again when the queue moves.</>}</li>
        </ul>
      )}
    </div>
  )
}

function NeedsList({ needs }: { needs: Need[] }) {
  if (!needs.length) return null
  return (
    <ul className="mt-1 list-disc pl-5 text-[var(--muted-ink)]">
      {needs.map((n) => <li key={n.id}>needs <b>{n.what}</b> ({n.kind || 'business'}, {n.scope || 'project'}, {n.required || 'block'}) supplied by {n.owner}</li>)}
    </ul>
  )
}

function DraftEditor({ pid, draft, readOnly, onSaved }: { pid: string; draft: Def; readOnly: boolean; onSaved: () => void }) {
  const [text, setText] = useState(JSON.stringify(draft, null, 2))
  const [msg, setMsg] = useState('')
  const save = async () => {
    try {
      const body = JSON.parse(text) as Def
      await dlc.post('/admin/processes', { ...body, id: pid })
      setMsg('Draft saved: publish it to make it the next version.'); onSaved()
    } catch (e) { setMsg(String((e as Error).message)) }
  }
  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--muted-ink)]">The process as data (docs: process.md). It may extend another process and give only what changes; it is checked when published.</p>
      <textarea className={cn(BOX, 'h-[460px] w-full py-2 font-mono text-[12px]')} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} readOnly={readOnly} />
      <div className="mt-2 flex items-center gap-3">{!readOnly && <Button onClick={save}>Save draft</Button>}<span className="text-[12px] text-[var(--muted-ink)]">{msg}</span></div>
    </div>
  )
}

function VersionsView({ rec }: { rec: Record_ }) {
  return (
    <div className="flex flex-col gap-2 text-[12.5px]">
      {[...rec.versions].reverse().map((v) => (
        <div key={v.v} className="glass p-3"><b>v{v.v}</b> · {new Date(v.ms).toLocaleString()} · {v.by}{v.reason ? ` · ${v.reason}` : ''}<div className="text-[var(--muted-ink)]">{v.changes.join('; ')}</div></div>
      ))}
      <details className="text-[12px] text-[var(--muted-ink)]"><summary className="cursor-pointer">History</summary>
        <ul className="list-disc pl-5">{rec.history.map((h, i) => <li key={i}>{new Date(h.ms).toLocaleString()}: {h.what} by {h.by}{h.reason ? ` (${h.reason})` : ''}</li>)}</ul>
      </details>
    </div>
  )
}

function ImpactView({ pid, impact, onChanged }: { pid: string; impact: Impact; onChanged: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState('')
  const [flow, setFlow] = useState('enhancement')
  const [ref, setRef] = useState(pid)
  const [msg, setMsg] = useState('')
  useEffect(() => { listProjects().then((p) => setProjects(p || [])).catch(() => setProjects([])) }, [])
  const bind = async () => {
    try { await dlc.post(`/admin/projects/${encodeURIComponent(project)}/processes`, { flow, process: ref }); setMsg('Bound.'); onChanged() } catch (e) { setMsg(String((e as Error).message)) }
  }
  const adopt = async (run: string) => {
    const to = prompt('Move this run to which version? (e.g. ' + pid + '@2)')
    if (!to) return
    try { await dlc.post(`/admin/runs/${encodeURIComponent(run)}:adopt-process`, { process: to }); onChanged() } catch (e) { setMsg(String((e as Error).message)) }
  }
  return (
    <div className="flex flex-col gap-3 text-[12.5px]">
      <div className="glass p-3"><b>Runs in progress</b> ({Object.entries(impact.live_by_version).map(([v, n]) => `${v}: ${n}`).join(', ') || 'none'}) · {impact.runs} run(s) in all
        <ul className="list-disc pl-5">{impact.live_runs.map((r) => <li key={r.run}>{r.run} on {r.version}{r.at ? `, waiting at ${r.at}` : ''} {r.at && <button className="text-[var(--blue)]" onClick={() => adopt(r.run)}>move to another version</button>}</li>)}</ul>
      </div>
      <div className="glass p-3"><b>Projects bound to it</b>
        <ul className="list-disc pl-5">{impact.projects.map((p) => <li key={p.project + p.flow}>{p.project} for {p.flow}: {p.binding}</li>)}</ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className={cn(BOX, 'w-48')} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
          </select>
          <input className={cn(BOX, 'w-36')} value={flow} onChange={(e) => setFlow(e.target.value)} />
          <input className={cn(BOX, 'w-48')} value={ref} onChange={(e) => setRef(e.target.value)} title="id (latest version) or id@n (pinned); empty to unbind" />
          <Button disabled={!project} onClick={bind}>Bind</Button><span className="text-[var(--muted-ink)]">{msg}</span>
        </div>
      </div>
    </div>
  )
}

function ReadinessView({ pid }: { pid: string }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [project, setProject] = useState('')
  const [out, setOut] = useState<Readiness | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { listProjects().then((p) => setProjects(p || [])).catch(() => setProjects([])) }, [])
  const check = async (p: string) => {
    setProject(p); setOut(null); setErr('')
    if (!p) return
    try { setOut(await dlc.get<Readiness>(`/admin/processes/${encodeURIComponent(pid)}/readiness?project=${encodeURIComponent(p)}`)) } catch (e) { setErr(String((e as Error).message)) }
  }
  return (
    <div className="text-[12.5px]">
      <p className="mb-2 text-[var(--muted-ink)]">What people must supply before the agents can work well on a project (without it they would guess).</p>
      <select className={cn(BOX, 'w-64')} value={project} onChange={(e) => check(e.target.value)}>
        <option value="">project…</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
      </select>
      {err && <p className="mt-2 text-[var(--red)]">{err}</p>}
      {out && (
        <div className="glass mt-3 p-3">
          <b style={{ color: out.ready ? 'var(--green)' : 'var(--amber)' }}>{out.ready ? 'Ready' : 'Not ready'}</b>
          <ul className="mt-1 list-disc pl-5">{out.needs.map((n) => <li key={n.id}>{n.ok ? '✓' : '✗'} {n.what} ({n.owner}): {n.how}</li>)}</ul>
        </div>
      )}
    </div>
  )
}
