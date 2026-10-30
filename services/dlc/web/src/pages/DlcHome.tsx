import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DragEvent, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Archive, Bug, Check, ChevronDown, ChevronRight, FileText, Folder, FolderPlus, GitBranch, Layers, OctagonX, Sparkles, Upload, X } from 'lucide-react'
import { AppButton, AWAITING, Card, NodeStrip, ProgressBar, RunControls, Shell, StatePill } from '@/components/dlc'
import { closeProject, convertDoc, createProject, fileToBase64, fmtAge, fmtDuration, fmtTokens, getProject, getWorkspace, isFinal, isPaused, listClosedProjects, listProjects, listRagProjects, listRuns, pauseAllRuns, progressOf, reopenProject, startFlow, URGENT_STOP_CONFIRM } from '@/lib/dlc'
import type { FlowDef, Project, ProjectSource, RagProject, RunSummary, WorkspaceFolder } from '@/lib/dlc'
import { accessToken } from '@/lib/oidc'
import { go } from '@/lib/route'

// Home, laid out like the classic AI DLC home: one card per project (the engine keeps each project's
// repository, so nobody types a server path), a "New" menu on each card that starts a flow on that project,
// and the project's runs (its features and fixes) when the card is opened.

const ICON: Record<string, typeof Sparkles> = { new: Sparkles, enhance: Layers, bug: Bug, migrate: GitBranch }

interface Attached {
  name: string
  text: string
}

export function runName(r: RunSummary): string {
  const n = (r.name || r.detail?.name || '') as string
  if (n) return n
  const p = (r.pack_path || '').replace(/[\\/]+$/, '')
  const base = p.split(/[\\/]/).pop() || r.id
  return base.replace(/-\d{8}-\d{6}$/, '')
}

export function flowLabel(r: RunSummary): string {
  const f = (r.flow || r.detail?.flow || '') as string
  if (f) return f.replace(/-/g, ' ')
  const base = (r.pack_path || '').split(/[\\/]/).pop() || ''
  if (base.startsWith('bug-')) return 'bug fix'
  if (base.startsWith('enhance-')) return 'enhancement'
  if (base.startsWith('mig')) return 'feature migration'
  return 'new system'
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'
const muted = { color: 'var(--muted-ink)' }

/** Why a flow cannot start on this project now ('' = it can). */
function blocked(flow: FlowDef, p: Project): string {
  // Enhancement and Bug Fix runs share a project: they plan in parallel and build in the order of its change queue
  const queued = (k: string) => /^(enhance|enhancement|bug|bug-fix|bugfix)$/.test(k)
  const live = p.live_runs ?? (p.active_run ? [{ id: p.active_run.id, state: '', flow: '' }] : [])
  if (live.length && !(queued(flow.kind) && live.every((r) => queued(r.flow)))) return 'a run is in progress on this project'
  if (flow.kind === 'new' && p.has_code) return 'already built: use Enhancement or Bug Fix'
  if ((flow.kind === 'enhance' || flow.kind === 'bug') && !p.has_code) return 'needs a completed New System run first'
  if (flow.kind === 'migrate') return 'not available for projects'
  return ''
}

// Home keeps what the person had open and where they were when they come back from a run or a step: the last
// lists stay in memory (no empty first frame), the open projects and the scroll position in sessionStorage.
const HOME_KEY = 'dlc.home'
const memo: { projects?: Project[] | null; runs?: RunSummary[]; projectRuns: Record<string, RunSummary[]> } = { projectRuns: {} }

function readHome(): { open: Record<string, boolean>; other?: boolean; scroll: number } {
  try {
    const v = JSON.parse(sessionStorage.getItem(HOME_KEY) || '{}')
    return { open: v.open || {}, other: v.other, scroll: Number(v.scroll) || 0 }
  } catch {
    return { open: {}, scroll: 0 }
  }
}

function saveHome(part: Partial<{ open: Record<string, boolean>; other: boolean; scroll: number }>) {
  try {
    sessionStorage.setItem(HOME_KEY, JSON.stringify({ ...readHome(), ...part }))
  } catch {
    /* private window: Home starts collapsed next time */
  }
}

export function DlcHome() {
  const [flows, setFlows] = useState<FlowDef[]>([])
  const [projects, setProjects] = useState<Project[] | null>(memo.projects === undefined ? [] : memo.projects)
  const [runs, setRuns] = useState<RunSummary[]>(memo.runs || [])
  const [open, setOpen] = useState<Record<string, boolean>>(() => readHome().open)
  const [loaded, setLoaded] = useState(memo.projects !== undefined)
  const top = useRef<HTMLDivElement>(null)
  const [creating, setCreating] = useState<SourceKind | null>(null)
  const [showClosed, setShowClosed] = useState(false)
  const [rag, setRag] = useState<RagProject[]>([])
  const [linkTo, setLinkTo] = useState<RagProject | null>(null)
  const [newFor, setNewFor] = useState<{ project: Project; flow: FlowDef } | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([listProjects(), listRuns()])
      memo.projects = p
      memo.runs = r
      setProjects(p)
      setRuns(r)
      setLoaded(true)
      setErr('')
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [])
  useEffect(() => {
    const h: Record<string, string> = {}
    const t = accessToken()
    if (t) h.Authorization = 'Bearer ' + t
    fetch('/api/fe/flows', { headers: h })
      .then((r) => r.json())
      .then((d) => setFlows((d.flows || []).filter((f: FlowDef) => f.enabled)))
      .catch(() => setFlows([]))
    void listRagProjects().then(setRag)
    void load()
    const id = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => saveHome({ open }), [open])
  // the scroll position: kept while the page scrolls, given back once the lists are on screen again
  useEffect(() => {
    const box = top.current?.closest('main')
    if (!box) return
    const on = () => saveHome({ scroll: box.scrollTop })
    box.addEventListener('scroll', on, { passive: true })
    return () => box.removeEventListener('scroll', on)
  }, [])
  const restored = useRef(false)
  useLayoutEffect(() => {
    if (restored.current || !loaded) return
    restored.current = true
    const box = top.current?.closest('main')
    const y = readHome().scroll
    if (box && y) requestAnimationFrame(() => { box.scrollTop = y })
  }, [loaded])

  const other = runs.filter((r) => !r.detail?.project)
  const projectFlows = flows.filter((f) => f.kind !== 'migrate')
  return (
    <Shell here="home">
      <div ref={top} className="mx-auto flex max-w-[1400px] flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="title-navy text-[24px]">Start on a project</h1>
            <p className="mt-1 text-[13px]" style={muted}>
              Each project keeps its own application on the server. Build it once with New System, then add features or fix bugs on the same project.
            </p>
          </div>
          <div className="flex flex-wrap items-start justify-end gap-2 pr-4">
            <UrgentStop running={runs.filter((r) => !isFinal(r) && !isPaused(r)).length} onDone={load} />
            {projects !== null && <AddProject onPick={setCreating} onClosed={() => setShowClosed(true)} />}
          </div>
        </header>
        {err && <p className="text-[12.5px] text-[var(--red)]">Engine: {err}</p>}
        {projects === null && (
          <Card><p className="text-[13px]" style={muted}>This engine has no project support yet; showing its runs only.</p></Card>
        )}
        {projects && projects.length > 0 && (
          <div className="flex flex-col gap-2">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} flows={projectFlows} open={!!open[p.id]}
                onToggle={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                onNew={(flow) => setNewFor({ project: p, flow })} reload={load} />
            ))}
          </div>
        )}
        {projects && projects.length === 0 && (
          <div className="glass px-6 py-12 text-center text-[13.5px]" style={muted}>
            No projects yet. Click <b>New Project</b>, give it a name and a specification; the first run builds it.
          </div>
        )}
        {rag.length > 0 && (
          <Card>
            <h2 className="text-[15px] font-bold" style={{ color: 'var(--navy)' }}>In the RAG System, not linked to code yet ({rag.length})</h2>
            <p className="mt-0.5 text-[12.5px]" style={muted}>History known to the agents (e.g. imported). Link one to its code to run Enhancement or Bug Fix on it with that history.</p>
            <div className="mt-3 flex flex-col gap-1.5">
              {rag.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-[10px] bg-[var(--panel2)] px-3 py-2">
                  <span className="text-[13.5px] font-bold" style={{ color: 'var(--navy)' }}>{r.id}</span>
                  {r.descriptor && <span className="min-w-0 flex-1 truncate text-[12px]" style={muted}>{r.descriptor}</span>}
                  <button className="btn-ghost ml-auto h-8 px-3 text-[12.5px]" onClick={() => setLinkTo(r)}>Link code</button>
                </div>
              ))}
            </div>
          </Card>
        )}
        {other.length > 0 && <OtherRuns runs={other} reload={load} defaultOpen={projects === null} />}
      </div>
      {(creating || linkTo) && (
        <NewProjectDialog flow={flows.find((f) => f.kind === 'new')} link={linkTo} kind0={creating || 'new'}
          onClose={() => { setCreating(null); setLinkTo(null) }}
          onDone={(run) => { setCreating(null); setLinkTo(null); void load(); void listRagProjects().then(setRag); if (run) go('run/' + run) }} />
      )}
      {showClosed && <ClosedProjectsDialog onClose={() => setShowClosed(false)} onReopened={() => void load()} />}
      {newFor && (
        <NewRunDialog project={newFor.project} flow={newFor.flow} onClose={() => setNewFor(null)}
          onDone={(run) => { setNewFor(null); void load(); go('run/' + run) }} />
      )}
    </Shell>
  )
}

function ProjectCard({ project: p, flows, open, onToggle, onNew, reload }: {
  project: Project; flows: FlowDef[]; open: boolean; onToggle: () => void; onNew: (f: FlowDef) => void; reload: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [closing, setClosing] = useState(false)
  const [runs, setRuns] = useState<RunSummary[] | null>(memo.projectRuns[p.id] || null)
  useEffect(() => {
    if (!open) return
    let live = true
    getProject(p.id).then((d) => { memo.projectRuns[p.id] = d.runs; if (live) setRuns(d.runs) }).catch(() => live && setRuns([]))
    return () => { live = false }
  }, [open, p.id, p.updated_ms, p.runs])
  const run = p.active_run || p.last_run
  const green: RunSummary | null = p.last_green_run ? { id: p.last_green_run, state: 'green', created_ms: 0, updated_ms: 0 } : null
  const u = p.usage || { usd: 0, tokens_in: 0, tokens_out: 0 }
  const att = p.attention || { needed: false, why: '' }
  const prog = p.progress || { done: 0, total: 0, pct: 0 }
  const pct = prog.pct
  return (
    <section className="glass overflow-visible">
      <div className="px-4 py-2">
        <div className="flex items-center gap-3">
          {/* collapsed: name, attention, progress, money, tokens (the rest is in the tooltip and when opened) */}
          <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={onToggle}
            title={[p.description, `Runs: ${p.runs}`, p.workspace_path, p.source_branch, `Updated ${fmtAge(p.updated_ms)}`]
              .filter(Boolean).join(' · ')}>
            {open ? <ChevronDown size={16} className="shrink-0" color="#4d8dff" /> : <ChevronRight size={16} className="shrink-0" color="#4d8dff" />}
            <span className="w-[160px] shrink-0 truncate text-[15px] font-bold" style={{ color: 'var(--navy)' }}>{p.name}</span>
            <span className="w-[130px] shrink-0">
              {att.kind === 'approval' ? (
                <span className="pill cursor-pointer hover:brightness-95" role="link" title={att.why + ' · click to review'}
                  style={{ color: AWAITING, background: AWAITING + '1a' }}
                  onClick={(e) => { e.stopPropagation(); if (att.run) go('run/' + encodeURIComponent(att.run)) }}>
                  <i className="animate-pulse" style={{ background: AWAITING, boxShadow: `0 0 0 3px ${AWAITING}33` }} />Approve{(att.count || 0) > 1 ? ` (${att.count})` : ''}
                </span>
              ) : att.needed ? (
                <span className="pill cursor-pointer hover:brightness-95" role="link" title={att.why + ' · click to see what to do'}
                  style={{ color: '#ff5f6d', background: '#ff5f6d1a' }}
                  onClick={(e) => { e.stopPropagation(); if (run) go('run/' + encodeURIComponent(run.id)) }}>
                  <i style={{ background: '#ff5f6d', boxShadow: '0 0 0 3px #ff5f6d33' }} />Needs attention
                </span>
              ) : (
                <span className="pill" style={{ color: '#36c98a', background: '#36c98a1a' }}>
                  <i style={{ background: '#36c98a', boxShadow: '0 0 0 3px #36c98a33' }} />OK
                </span>
              )}
            </span>
            <span className="flex min-w-[120px] flex-1 items-center gap-2"
              title={`${prog.done} of ${prog.total} steps complete over all runs` + (run ? ` · latest: ${flowLabel(run)} · ${runName(run)}` : '')}>
              <span className="flex-1"><ProgressBar value={pct} /></span>
              <span className="w-9 text-right text-[12px] font-bold" style={{ color: 'var(--blue)' }}>{pct}%</span>
            </span>
            <span className="w-[64px] shrink-0 text-right text-[12.5px] font-bold" style={{ color: 'var(--navy)' }} title="Money spent by all runs">
              ${u.usd.toFixed(2)}
            </span>
            <span className="w-[110px] shrink-0 text-right text-[12px]" style={muted}
              title={`Tokens sent (incl. cache) ${u.tokens_in.toLocaleString()} · received ${u.tokens_out.toLocaleString()}`}>
              ↑ {fmtTokens(u.tokens_in)} ↓ {fmtTokens(u.tokens_out)}
            </span>
          </button>
          <span className="flex shrink-0 items-center gap-2">
            <span className="flex w-[160px] justify-end">{green && <AppButton run={green} compact small />}</span>
            <div className="relative">
              <button className="btn-ghost flex h-[34px] items-center gap-1.5 whitespace-nowrap px-3.5 text-[12.5px]" onClick={() => setMenu((m) => !m)}>
                New <ChevronDown size={14} />
              </button>
              {menu && (
                <div className="glass absolute right-0 z-30 mt-1.5 w-[300px] p-1.5 shadow-[0_14px_34px_rgba(11,31,75,.18)]" onMouseLeave={() => setMenu(false)}>
                  {flows.map((f) => {
                    const why = blocked(f, p)
                    const Icon = ICON[f.kind] || Sparkles
                    return (
                      <button key={f.id} disabled={!!why} title={why}
                        className="flex w-full items-start gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-[rgba(77,141,255,0.08)] disabled:cursor-not-allowed disabled:opacity-45"
                        onClick={() => { setMenu(false); onNew(f) }}>
                        <span className="chip-glass !h-7 !w-7 shrink-0"><Icon size={14} /></span>
                        <span>
                          <span className="block text-[13px] font-bold" style={{ color: 'var(--navy)' }}>{f.label}</span>
                          <span className="block text-[11px] leading-snug" style={muted}>{why || f.description}</span>
                        </span>
                      </button>
                    )
                  })}
                  <div className="my-1 border-t border-[var(--edge)]" />
                  <button className="flex w-full items-start gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-[rgba(255,95,109,0.08)]"
                    onClick={() => { setMenu(false); setClosing(true) }}>
                    <span className="chip-glass !h-7 !w-7 shrink-0"><Archive size={14} color="#ff5f6d" /></span>
                    <span>
                      <span className="block text-[13px] font-bold" style={{ color: '#ff5f6d' }}>Close Project</span>
                      <span className="block text-[11px] leading-snug" style={muted}>Hide it from Home; re-open it from Add Project → Closed Projects</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </span>
        </div>
      </div>
      {closing && <CloseProjectDialog project={p} onClose={() => setClosing(false)} onDone={reload} />}
      {open && (
        <div className="flex flex-col gap-3 border-t border-[var(--edge)] bg-[var(--panel2)] px-3 py-2">
          {runs === null && <p className="text-[12.5px]" style={muted}>Loading…</p>}
          {runs && runs.length === 0 && <p className="text-[12.5px]" style={muted}>No runs yet. Use <b>New</b> to start the first one.</p>}
          {runs?.map((r) => <RunRow key={r.id} run={r} onChange={reload} />)}
        </div>
      )}
    </section>
  )
}

/** Add Project: start one (New / an existing folder / a git repository) or bring back a closed one. */
function AddProject({ onPick, onClosed }: { onPick: (k: SourceKind) => void; onClosed: () => void }) {
  const [open, setOpen] = useState(false)
  const items: [string, string, typeof Sparkles, () => void][] = [
    ['New Project', 'An empty project: the first run builds it', Sparkles, () => onPick('new')],
    ['Existing Folder', 'Code already in a folder of the workspace', Folder, () => onPick('folder')],
    ['From Git', 'Clone a GitHub / GitLab / Bitbucket / git repository', GitBranch, () => onPick('git')],
    ['Closed Projects', 'Re-open a project you closed', Archive, onClosed],
  ]
  return (
    <div className="relative">
      <button className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-[12.5px]" onClick={() => setOpen((o) => !o)}>
        <FolderPlus size={14} /> Add Project <ChevronDown size={14} />
      </button>
      {open && (
        <div className="glass absolute right-0 z-30 mt-1.5 w-[300px] p-1.5 shadow-[0_14px_34px_rgba(11,31,75,.18)]" onMouseLeave={() => setOpen(false)}>
          {items.map(([label, desc, Icon, act], i) => (
            <div key={label}>
              {i === 3 && <div className="my-1 border-t border-[var(--edge)]" />}
              <button className="flex w-full items-start gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-[rgba(77,141,255,0.08)]"
                onClick={() => { setOpen(false); act() }}>
                <span className="chip-glass !h-7 !w-7 shrink-0"><Icon size={14} /></span>
                <span>
                  <span className="block text-[13px] font-bold" style={{ color: 'var(--navy)' }}>{label}</span>
                  <span className="block text-[11px] leading-snug" style={muted}>{desc}</span>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Close a project, after a confirmation (it disappears from Home; its code, runs and knowledge stay). */
function CloseProjectDialog({ project: p, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const close = async () => {
    setBusy(true)
    setErr('')
    try {
      await closeProject(p.id)
      onClose()
      onDone()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,31,75,.35)] p-4" onClick={onClose}>
      <div className="glass w-full max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="flex items-center gap-2 text-[16px] font-bold" style={{ color: 'var(--navy)' }}>
          <Archive size={18} color="#ff5f6d" /> Close {p.name}?
        </h2>
        <p className="mt-2 text-[13px]" style={muted}>
          The project disappears from Home and takes no new run until it is re-opened (Add Project → Closed Projects).
          Its code, its {p.runs} run{p.runs === 1 ? '' : 's'} and its knowledge stay as they are.
        </p>
        {err && <p className="mt-2 text-[12px] text-[var(--red)]">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost h-[34px] px-4 text-[12.5px]" onClick={onClose}>Cancel</button>
          <button className="btn-danger h-[34px] px-4 text-[12.5px]" disabled={busy} onClick={() => void close()}>
            {busy ? 'Closing…' : 'Close Project'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The closed projects, each with Re-open (back on Home). */
function ClosedProjectsDialog({ onClose, onReopened }: { onClose: () => void; onReopened: () => void }) {
  const [list, setList] = useState<Project[] | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    listClosedProjects().then(setList).catch((e) => { setErr(String((e as Error).message)); setList([]) })
  }, [])
  const reopen = async (id: string) => {
    setBusy(id)
    setErr('')
    try {
      await reopenProject(id)
      setList((l) => (l || []).filter((x) => x.id !== id))
      onReopened()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,31,75,.35)] p-4" onClick={onClose}>
      <div className="glass flex max-h-[80vh] w-full max-w-[560px] flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-[16px] font-bold" style={{ color: 'var(--navy)' }}><Archive size={18} /> Closed Projects</h2>
          <button className="btn-ghost h-8 w-8 p-0" onClick={onClose} title="Close"><X size={16} className="mx-auto" /></button>
        </div>
        {err && <p className="mt-2 text-[12px] text-[var(--red)]">{err}</p>}
        <div className="mt-3 flex flex-col gap-1.5 overflow-y-auto">
          {list === null && <p className="text-[12.5px]" style={muted}>Loading…</p>}
          {list && list.length === 0 && <p className="text-[12.5px]" style={muted}>No closed project.</p>}
          {list?.map((x) => (
            <div key={x.id} className="flex items-center gap-3 rounded-[10px] bg-[var(--panel2)] px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold" style={{ color: 'var(--navy)' }}>{x.name}</span>
                <span className="block text-[11.5px]" style={muted}>
                  Closed {x.closed ? fmtAge(x.closed.ms) : ''}{x.closed?.by ? ' by ' + x.closed.by : ''} · {x.runs} run{x.runs === 1 ? '' : 's'}
                  {x.usage ? ` · $${x.usage.usd.toFixed(2)}` : ''}
                </span>
              </span>
              <button className="btn-primary h-[34px] px-3.5 text-[12.5px]" disabled={busy === x.id} onClick={() => void reopen(x.id)}>
                {busy === x.id ? 'Re-opening…' : 'Re-open'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Urgent stop of every running process: never one click. The person types the confirmation text; anything
 *  else closes the dialog and says nothing was stopped. The engine checks the same text again. */
function UrgentStop({ running, onDone }: { running: number; onDone: () => void }) {
  const [asking, setAsking] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const close = () => { setAsking(false); setTyped('') }
  const confirm = async () => {
    if (typed.trim().split(/\s+/).join(' ') !== URGENT_STOP_CONFIRM) {
      close()
      setNote({ text: 'Not stopped: the confirmation text did not match.', bad: true })
      return
    }
    setBusy(true)
    try {
      const out = await pauseAllRuns(URGENT_STOP_CONFIRM)
      setNote({ text: `Stopped ${out.paused.length} process${out.paused.length === 1 ? '' : 'es'}; resume each one from its own row.`, bad: false })
      onDone()
    } catch (e) {
      setNote({ text: 'Not stopped: ' + String((e as Error).message), bad: true })
    } finally {
      setBusy(false)
      close()
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button className="btn-danger flex items-center gap-1.5 px-3.5 py-2 text-[12.5px]" disabled={running === 0}
        title={running ? `Force stop all ${running} running process${running === 1 ? '' : 'es'} at once` : 'No process is running'}
        onClick={() => { setNote(null); setAsking(true) }}>
        <OctagonX size={14} /> Urgent stop{running ? ` (${running})` : ''}
      </button>
      {note && <span className={'max-w-[320px] text-right text-[11px] ' + (note.bad ? 'text-[var(--red)]' : '')} style={note.bad ? undefined : muted}>{note.text}</span>}
      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,31,75,.35)] p-4" onClick={close}>
          <div className="glass w-full max-w-[440px] p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="flex items-center gap-2 text-[16px] font-bold" style={{ color: 'var(--navy)' }}>
              <OctagonX size={18} color="var(--red)" /> Urgent stop
            </h2>
            <p className="mt-2 text-[13px]" style={muted}>
              This force-stops all {running} running process{running === 1 ? '' : 'es'} now: their agents are killed mid-step.
              Each one can be resumed later from its own row.
            </p>
            <p className="mt-3 text-[13px]" style={{ color: 'var(--navy)' }}>Type <b>{URGENT_STOP_CONFIRM}</b> to confirm:</p>
            <input autoFocus className="field-glass mt-1.5 h-10 w-full px-3" value={typed} onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void confirm(); if (e.key === 'Escape') close() }} />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost h-9 px-4 text-[13px]" onClick={close}>Cancel</button>
              <button className="btn-danger h-9 px-4 text-[13px]" disabled={busy} onClick={() => void confirm()}>Force stop</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OtherRuns({ runs, reload, defaultOpen }: { runs: RunSummary[]; reload: () => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(() => readHome().other ?? defaultOpen)
  return (
    <Card>
      <button className="flex items-center gap-2" onClick={() => { saveHome({ other: !open }); setOpen(!open) }}>
        {open ? <ChevronDown size={16} color="#4d8dff" /> : <ChevronRight size={16} color="#4d8dff" />}
        <span className="text-[14px] font-bold" style={{ color: 'var(--navy)' }}>Runs outside projects ({runs.length})</span>
      </button>
      {open && <div className="mt-3 flex flex-col gap-3">{runs.slice(0, 30).map((r) => <RunRow key={r.id} run={r} onChange={reload} />)}</div>}
    </Card>
  )
}

function RunRow({ run, onChange }: { run: RunSummary; onChange: () => void }) {
  const p = progressOf(run)
  const spent = Number(run.detail?.spent_usd || 0)
  return (
    <div className="rounded-[14px] border border-[var(--edge)] bg-[var(--row)] p-3.5 shadow-[0_4px_10px_rgba(77,141,255,.06)]">
      <div className="flex flex-wrap items-start gap-3">
        <button className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => go('run/' + run.id)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-bold" style={{ color: 'var(--navy)' }}>{runName(run)}</span>
            <StatePill run={run} />
          </div>
          <div className="mt-0.5 text-[11.5px] capitalize" style={muted}>
            {flowLabel(run)} · {run.id} · started {fmtAge(run.created_ms)} · {fmtDuration(run.created_ms, isFinal(run) ? run.updated_ms : undefined)}
            {spent > 0 && <> · ${spent.toFixed(2)}</>}
          </div>
        </button>
        <span className="flex flex-wrap items-start gap-2">
          <RunControls run={run} onChange={onChange} />
        </span>
      </div>
      {!isFinal(run) && (
        <div className="mt-2.5 flex items-center gap-3">
          <div className="flex-1"><ProgressBar value={p} /></div>
          <span className="w-10 text-right text-[12px] font-bold" style={{ color: 'var(--blue)' }}>{p}%</span>
        </div>
      )}
      <NodeStrip run={run} />
    </div>
  )
}

// ------------------------------------------------------------------ dialogs

function Dialog({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(11,31,75,.28)] px-4 py-10 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="glass w-full max-w-[860px] p-6" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="title-navy text-[20px]">{title}</h2>
            {sub && <p className="mt-1 text-[12.5px]" style={muted}>{sub}</p>}
          </div>
          <button aria-label="close" className="btn-ghost p-2" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Markdown spec: write / preview, plus .md files added or dropped. Returns the combined text through onChange. */
const MD_FILE = /\.(md|markdown|txt)$/i
const TEXT_FILE = /\.(md|markdown|txt|text|html?|log|csv|json|xml|ya?ml)$/i
/** business documents: the engine turns them into markdown (text and tables, no OCR) */
const DOC_FILE = /\.(pdf|docx)$/i

/** An HTML file as readable text (scripts and styles dropped), so a saved ticket page reads plainly. */
function htmlText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, noscript').forEach((n) => n.remove())
  return (doc.body?.innerText || doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

function SpecEditor({ label, placeholder, onChange, onFirstFile, anyText }: {
  label: string; placeholder: string; onChange: (full: string) => void; onFirstFile?: (name: string) => void; anyText?: boolean
}) {
  const accepted = anyText ? TEXT_FILE : MD_FILE
  const [spec, setSpec] = useState('')
  const [files, setFiles] = useState<Attached[]>([])
  const [preview, setPreview] = useState(false)
  const [drag, setDrag] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const full = [spec.trim(), ...files.map((f) => `<!-- file: ${f.name} -->\n\n${f.text.trim()}`)].filter(Boolean).join('\n\n')
  useEffect(() => onChange(full), [full]) // eslint-disable-line react-hooks/exhaustive-deps
  const addFiles = async (list: FileList | File[]) => {
    const picked: Attached[] = []
    const rejected: string[] = []
    for (const f of Array.from(list)) {
      if (DOC_FILE.test(f.name)) {
        try {
          const d = await convertDoc(f.name, await fileToBase64(f))
          picked.push({ name: f.name, text: d.text + (d.warnings.length ? `\n\n<!-- ${d.warnings.join('; ')} -->` : '') })
        } catch (e) {
          rejected.push(`${f.name} (${String((e as Error).message)})`)
        }
        continue
      }
      if (!accepted.test(f.name)) {
        rejected.push(f.name)
        continue
      }
      const raw = await f.text()
      picked.push({ name: f.name, text: /\.html?$/i.test(f.name) ? htmlText(raw) : raw })
    }
    setFiles((cur) => [...cur.filter((c) => !picked.some((p) => p.name === c.name)), ...picked])
    if (picked[0]) onFirstFile?.(picked[0].name.replace(/\.[a-z]+$/i, ''))
    setErr(rejected.length ? (anyText ? 'Only text, PDF and Word files are accepted: ' : 'Only .md, PDF and Word files are accepted: ') + rejected.join(', ') : '')
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDrag(false)
    if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files)
  }
  return (
    <div>
      <div className="mb-1.5 mt-2 flex items-center justify-between">
        <label className="block text-[12.5px] font-semibold">{label}</label>
        <div className="flex rounded-[10px] border border-[var(--edge)] bg-[var(--panel2)] p-0.5 text-[12px] font-semibold">
          <button className={'rounded-lg px-3 py-1 ' + (!preview ? 'bg-[var(--head)] text-[var(--blue)] shadow' : 'text-[var(--muted-ink)]')} onClick={() => setPreview(false)}>Write</button>
          <button className={'rounded-lg px-3 py-1 ' + (preview ? 'bg-[var(--head)] text-[var(--blue)] shadow' : 'text-[var(--muted-ink)]')} onClick={() => setPreview(true)}>Preview</button>
        </div>
      </div>
      <div className={'rounded-[14px] ' + (drag ? 'drop-on' : '')}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        {preview ? (
          <div className="field-glass prose-chat min-h-[300px] overflow-auto px-4 py-3">
            {full ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{full}</ReactMarkdown> : <span style={muted}>Nothing to preview yet.</span>}
          </div>
        ) : (
          <textarea className="field-glass block min-h-[300px] w-full resize-y px-4 py-3 font-mono text-[13px] leading-relaxed"
            value={spec} onChange={(e) => setSpec(e.target.value)} placeholder={placeholder} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[12.5px]" onClick={() => input.current?.click()}>
          <Upload size={14} /> {anyText ? 'Add files (.md, .html, .txt, .pdf, .docx)' : 'Add files (.md, .pdf, .docx)'}
        </button>
        <input ref={input} type="file" multiple className="hidden"
          accept={(anyText ? '.md,.markdown,.txt,.text,.html,.htm,.log,.csv,.json,.xml,.yml,.yaml' : '.md,.markdown,.txt,text/markdown') + ',.pdf,.docx'}
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = '' }} />
        <span className="text-[11.5px]" style={muted}>or drag and drop them on the editor</span>
      </div>
      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {files.map((f) => (
            <span key={f.name} className="glass flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold">
              <FileText size={13} color="#4d8dff" /> {f.name}
              <span style={muted}>({Math.ceil(f.text.length / 1024)} KB)</span>
              <button aria-label={'remove ' + f.name} onClick={() => setFiles(files.filter((x) => x.name !== f.name))}><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-[12px] text-[var(--red)]">{err}</p>}
    </div>
  )
}

const SPEC_HINT = '# What to build\n\nDescribe the application, its users and features.\n\n## F1 First feature\n- what it does\n- how we know it works\n\nOr drop .md files here.'

type SourceKind = ProjectSource['kind']

const HOST: Record<string, string> = { github: 'GitHub', gitlab: 'GitLab', bitbucket: 'Bitbucket', git: 'Git server' }
const gitHost = (url: string) => {
  const h = url.toLowerCase().replace(/^[a-z+]+:\/\//, '').split('/')[0].split('@').pop()!.split(':')[0]
  return (['github', 'gitlab', 'bitbucket'] as const).find((n) => h.includes(n)) || 'git'
}

const SOURCES: { kind: SourceKind; label: string; hint: string }[] = [
  { kind: 'new', label: 'New', hint: 'The server keeps the project in a folder it chooses; the first run (New System) builds it from your specification.' },
  { kind: 'folder', label: 'Existing folder', hint: 'Any folder in the workspace, with or without git. DLC works on its own copy, so your folder is not changed.' },
  { kind: 'git', label: 'Clone from git', hint: 'GitHub, GitLab, Bitbucket or any git server, cloned into the workspace folder. The access token is used for this clone only and is not stored.' },
]

function NewProjectDialog({ flow, link, kind0 = 'new', onClose, onDone }: {
  flow?: FlowDef; link?: RagProject | null; kind0?: SourceKind; onClose: () => void; onDone: (run: string) => void
}) {
  const [name, setName] = useState(link?.aliases[0] || link?.id || '')
  const [description, setDescription] = useState('')
  const [spec, setSpec] = useState('')
  const [kind, setKind] = useState<SourceKind>(kind0)
  const [root, setRoot] = useState('')
  const [picked, setPicked] = useState<WorkspaceFolder | null>(null)
  const [git, setGit] = useState({ url: '', token: '', folder: '', branch: '', username: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  useEffect(() => { getWorkspace().then((w) => setRoot(w.root)).catch(() => setRoot('')) }, [])
  // existing code is enhanced or fixed later; only a new or empty folder takes a first-build specification
  const buildable = kind === 'new' || (kind === 'folder' && !!picked && !picked.has_code)
  const sourceOk = kind === 'new' || (kind === 'folder' ? !!picked : !!git.url.trim())
  const source = (): ProjectSource =>
    kind === 'folder' ? { kind, path: picked!.path }
      : kind === 'git' ? {
        kind, url: git.url.trim(), token: git.token.trim() || undefined, folder: git.folder.trim() || undefined,
        branch: git.branch.trim() || undefined, username: git.username.trim() || undefined,
      }
        : { kind: 'new' }
  const submit = async (build: boolean) => {
    setBusy(true)
    setErr('')
    try {
      const p = await createProject(name.trim(), description.trim(), source(), link?.id || '')
      if (build && flow) onDone(await startFlow(flow, slug(name), spec, {}, p.id))
      else onDone('')
    } catch (e) {
      setErr(String((e as Error).message))
      setBusy(false)
    }
  }
  const host = gitHost(git.url)
  const repoName = (url: string) => url.replace(/\/+$/, '').split(/[/:]/).pop()?.replace(/\.git$/, '') || ''
  return (
    <Dialog title={link ? `Link code · ${link.id}` : 'New project'} sub={SOURCES.find((s) => s.kind === kind)!.hint} onClose={onClose}>
      {root && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {SOURCES.map((s) => (
            <button key={s.kind} className={`${kind === s.kind ? 'btn-primary' : 'btn-ghost'} h-9 px-3.5 text-[12.5px]`}
              onClick={() => { setKind(s.kind); setErr('') }}>{s.label}</button>
          ))}
        </div>
      )}
      {kind === 'folder' && (
        <FolderPicker root={root} picked={picked}
          onPick={(f) => { setPicked(f); if (!name.trim()) setName(f.name) }} />
      )}
      {kind === 'git' && (
        <div className="mb-3 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold">Repository URL <span className="text-[var(--red)]">*</span></label>
            <input className="field-glass h-11 w-full px-3.5" value={git.url} placeholder="https://github.com/org/app.git"
              onChange={(e) => {
                const url = e.target.value
                setGit({ ...git, url })
                if (!name.trim() || name === repoName(git.url)) setName(repoName(url))
              }} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold">Folder in workspace</label>
            <input className="field-glass h-11 w-full px-3.5" value={git.folder} placeholder={repoName(git.url) || 'from the URL'}
              onChange={(e) => setGit({ ...git, folder: e.target.value })} />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold">Access token <span className="font-normal" style={muted}>(private repository, https only)</span></label>
            <input type="password" autoComplete="off" className="field-glass h-11 w-full px-3.5" value={git.token}
              onChange={(e) => setGit({ ...git, token: e.target.value })} placeholder="used for this clone only, never stored" />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold">Branch</label>
            <input className="field-glass h-11 w-full px-3.5" value={git.branch} placeholder="default branch"
              onChange={(e) => setGit({ ...git, branch: e.target.value })} />
          </div>
          {host === 'bitbucket' && (
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[12.5px] font-semibold">Bitbucket username <span className="font-normal" style={muted}>(only for an app password; leave empty for an access token)</span></label>
              <input className="field-glass h-11 w-full px-3.5" value={git.username} onChange={(e) => setGit({ ...git, username: e.target.value })} />
            </div>
          )}
          <p className="text-[12px] sm:col-span-2" style={muted}>
            {git.url.trim() && <><b>{HOST[host]}</b> · </>}Cloned into <code>{root}</code>; DLC then works on its own copy.
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold">Name <span className="text-[var(--red)]">*</span></label>
          <input ref={ref} className="field-glass h-11 w-full px-3.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Order Portal" />
        </div>
        <div>
          <label className="mb-1.5 block text-[12.5px] font-semibold">Description</label>
          <input className="field-glass h-11 w-full px-3.5" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="one line, optional" />
        </div>
      </div>
      {buildable ? (
        <SpecEditor label="Specification for the first build (markdown)" placeholder={SPEC_HINT} onChange={setSpec}
          onFirstFile={(n) => { if (!name) setName(n) }} />
      ) : (
        <p className="mt-3 text-[12.5px]" style={muted}>The project starts from its existing code: after creating it, use <b>New → Enhancement</b> or <b>Bug Fix</b> on its card.</p>
      )}
      {err && <p className="mt-3 text-[12.5px] text-[var(--red)]">{err}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className={`${buildable ? 'btn-ghost h-[46px] px-4 text-[13px]' : 'btn-primary h-[46px] px-6 text-[14px]'}`}
          disabled={busy || !name.trim() || !sourceOk} onClick={() => submit(false)}>
          {busy && !buildable ? (kind === 'git' ? 'Cloning…' : 'Creating…') : buildable ? 'Create only' : 'Create project'}
        </button>
        {buildable && (
          <button className="btn-primary h-[46px] px-6 text-[14px]" disabled={busy || !name.trim() || !sourceOk || !spec.trim() || !flow} onClick={() => submit(true)}>
            {busy ? 'Starting…' : 'Create and build'}
          </button>
        )}
      </div>
    </Dialog>
  )
}

/** What the engine will do with a folder, in one sentence. */
function folderPlan(f: WorkspaceFolder): string {
  if (f.why) return f.why
  if (f.kind === 'empty') return 'Empty folder: New System builds the application right here.'
  if (f.kind === 'git') {
    const left = f.uncommitted ? ` ${f.uncommitted} uncommitted change${f.uncommitted > 1 ? 's are' : ' is'} not included (commit first if needed).` : ''
    return `Git repository${f.branch ? ` on branch ${f.branch}` : ''}: DLC works on its own copy of the last commit; your folder and branches stay as they are. Every green run ends with a Deliver step that pushes the results as branch dlc/<project>.${left}`
  }
  return 'No git needed: DLC copies the files (without node_modules, .env, logs and build output) and works on that copy; your folder is not changed.'
    + (f.has_code ? '' : ' No code found: New System can build from your specification.')
}

/** Browse the engine's workspace root: click a folder to see what DLC will do with it, then Use this folder.
 *  Double-click (or the arrow) opens a folder; the opened folder itself can be used too. */
function FolderPicker({ root, picked, onPick }: { root: string; picked: WorkspaceFolder | null; onPick: (f: WorkspaceFolder) => void }) {
  const [path, setPath] = useState('')
  const [folders, setFolders] = useState<WorkspaceFolder[] | null>(null)
  const [current, setCurrent] = useState<WorkspaceFolder | null>(null)
  const [focus, setFocus] = useState<WorkspaceFolder | null>(picked)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    setFolders(null)
    setErr('')
    getWorkspace(path).then((w) => {
      if (!live) return
      setFolders(w.folders)
      setCurrent(w.current || null)
    }).catch((e) => live && setErr(String((e as Error).message)))
    return () => { live = false }
  }, [path])
  const open = (p: string) => { setFocus(null); setPath(p) }
  const crumbs = path ? path.split('/') : []
  const KIND: Record<string, string> = { empty: 'empty', git: 'git', files: 'no git', unreadable: '?' }
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[12.5px]">
        <button className="font-semibold hover:underline" style={{ color: 'var(--blue)' }} onClick={() => open('')}>{root}</button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={12} style={muted} />
            <button className="font-semibold hover:underline" style={{ color: 'var(--blue)' }} onClick={() => open(crumbs.slice(0, i + 1).join('/'))}>{c}</button>
          </span>
        ))}
        {current && (
          <button className="btn-ghost ml-auto h-7 px-2.5 text-[12px]" onClick={() => setFocus(current)}>This folder: {current.name}</button>
        )}
      </div>
      <div className="field-glass max-h-[240px] overflow-y-auto p-1">
        {err && <p className="px-2.5 py-2 text-[12.5px] text-[var(--red)]">{err}</p>}
        {!err && folders === null && <p className="px-2.5 py-2 text-[12.5px]" style={muted}>Loading…</p>}
        {folders?.length === 0 && <p className="px-2.5 py-2 text-[12.5px]" style={muted}>No folders here.</p>}
        {folders?.map((f) => {
          const on = focus?.path === f.path
          return (
            <div key={f.path} className={`flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-1.5 ${on ? 'bg-[var(--head)] ring-1 ring-[var(--blue)]' : 'hover:bg-[rgba(77,141,255,0.08)]'}`}
              onClick={() => setFocus(f)} onDoubleClick={() => f.kind !== 'empty' && open(f.path)} title="click to select, double-click to open">
              {f.kind === 'git' ? <GitBranch size={14} color="#4d8dff" /> : <Folder size={14} style={muted} />}
              <span className={`truncate text-[13px] ${f.why ? 'opacity-55' : 'font-semibold'}`} style={{ color: 'var(--navy)' }}>{f.name}</span>
              <span className="shrink-0 rounded-full bg-[var(--row)] px-2 py-0.5 text-[10.5px]" style={muted}>{KIND[f.kind]}{f.branch ? ' · ' + f.branch : ''}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <button className={`${picked?.path === f.path ? 'btn-primary' : 'btn-ghost'} flex h-7 items-center gap-1 px-2.5 text-[12px]`}
                  disabled={!!f.why} title={f.why || folderPlan(f)}
                  onClick={(e) => { e.stopPropagation(); setFocus(f); onPick(f) }}>
                  {picked?.path === f.path ? <><Check size={13} /> Selected</> : 'Select'}
                </button>
                {f.kind !== 'empty' ? (
                  <button aria-label={`open ${f.name}`} className="btn-ghost p-1" title="open folder"
                    onClick={(e) => { e.stopPropagation(); open(f.path) }}><ChevronRight size={14} /></button>
                ) : <span className="w-[22px]" />}
              </span>
            </div>
          )
        })}
      </div>
      {focus && (
        <div className="mt-2 flex flex-wrap items-start gap-3 rounded-[12px] bg-[var(--row)] px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-bold" style={{ color: 'var(--navy)' }}><code>{focus.path}</code></div>
            <p className={`mt-0.5 text-[12px] ${focus.why ? 'text-[var(--red)]' : ''}`} style={focus.why ? undefined : muted}>{folderPlan(focus)}</p>
            {focus.nested && focus.nested.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {focus.nested.map((n) => (
                  <button key={n} className="btn-ghost h-7 px-2.5 text-[12px]" onClick={() => open(`${focus.path}/${n}`.split('/').slice(0, -1).join('/'))}>
                    open {n}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn-primary h-9 shrink-0 px-4 text-[13px]" disabled={!!focus.why} onClick={() => onPick(focus)}>
            {picked?.path === focus.path ? 'Selected' : 'Use this folder'}
          </button>
        </div>
      )}
      {picked && (!focus || focus.path !== picked.path) && (
        <p className="mt-1.5 text-[12px]" style={muted}>Selected: <code>{picked.path}</code></p>
      )}
    </div>
  )
}

function NewRunDialog({ project, flow, onClose, onDone }: { project: Project; flow: FlowDef; onClose: () => void; onDone: (run: string) => void }) {
  const [name, setName] = useState(flow.kind === 'new' ? project.name : '')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [spec, setSpec] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const isBug = flow.kind === 'bug'
  // a bug fix is one free-text box: what happened, a ticket link, attached notes; the agents work out the rest
  const missing = isBug ? [] : flow.fields.filter((f) => f.required && !(fields[f.name] || '').trim()).map((f) => f.label)
  const firstLine = spec.split('\n').map((l) => l.replace(/^[#>*\s-]+/, '').trim()).find((l) => l && !l.startsWith('<!--')) || 'bug'
  const label = isBug ? firstLine.slice(0, 60) : name
  const can = !busy && missing.length === 0 && !!spec.trim() && (isBug || !!name.trim())
  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      onDone(await startFlow(flow, slug(label), spec, fields, project.id))
    } catch (e) {
      setErr(String((e as Error).message))
      setBusy(false)
    }
  }
  return (
    <Dialog title={`${flow.label} · ${project.name}`} sub={flow.description} onClose={onClose}>
      {!isBug && (
        <div className="mb-3">
          <label className="mb-1.5 block text-[12.5px] font-semibold">{flow.kind === 'new' ? 'Name' : 'Feature name'} <span className="text-[var(--red)]">*</span></label>
          <input className="field-glass h-11 w-full px-3.5" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. export-to-excel" />
        </div>
      )}
      {!isBug && flow.fields.map((f) => (
        <div key={f.name} className="mb-3">
          <label className="mb-1.5 block text-[12.5px] font-semibold">{f.label} {f.required && <span className="text-[var(--red)]">*</span>}</label>
          {f.multiline ? (
            <textarea className="field-glass min-h-[72px] w-full resize-y px-3.5 py-2.5" value={fields[f.name] || ''} placeholder={f.placeholder}
              onChange={(e) => setFields({ ...fields, [f.name]: e.target.value })} />
          ) : (
            <input className="field-glass h-11 w-full px-3.5" value={fields[f.name] || ''} placeholder={f.placeholder}
              onChange={(e) => setFields({ ...fields, [f.name]: e.target.value })} />
          )}
        </div>
      ))}
      <SpecEditor label={isBug ? 'What happened?' : flow.kind === 'enhance' ? 'What to add or change (markdown)' : 'Specification (markdown)'}
        anyText={isBug}
        placeholder={isBug ? 'Describe what happened, paste the Jira link, or drop .md / .html / .txt / PDF / Word files here.' : flow.kind === 'enhance' ? '# Change\n\n## F1 New feature\n- what it does\n- how we know it works' : SPEC_HINT}
        onChange={setSpec} onFirstFile={(n) => { if (!name) setName(n) }} />
      {missing.length > 0 && <p className="mt-3 text-[12px]" style={muted}>Still needed: {missing.join(', ')}</p>}
      {err && <p className="mt-3 text-[12.5px] text-[var(--red)]">{err}</p>}
      <div className="mt-5 flex justify-end">
        <button className="btn-primary h-[46px] px-6 text-[14px]" disabled={!can} onClick={submit}>{busy ? 'Starting…' : `Start ${flow.label}`}</button>
      </div>
    </Dialog>
  )
}
