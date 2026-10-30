import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Bot, Download, ExternalLink, FolderKanban, GitBranch, KeyRound, ListOrdered, LogOut, Minus, MoreVertical, Package, PanelLeftClose,
  PanelLeftOpen, Pause, Play, Plug, Plus, Rocket, Search, Settings, Square, Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { appState, buildApp, downloadApp, isFinal, isPaused, waitsForPerson, nodes as loadNodes, nodesFromRun, pauseRun, resumeRun, startApp, stopApp } from '@/lib/dlc'
import type { AppState, FlowNode, RunSummary } from '@/lib/dlc'
import { config, logout, profile } from '@/lib/oidc'
import { go, useRoute } from '@/lib/route'

export function Background() {
  return null   // style 24: the dark window sits on a plain pale page
}

export function Logo({ rail }: { rail?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-[17px] font-black tracking-[0.02em]" style={{ color: 'var(--navy)' }}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-black text-white" style={{ background: 'var(--blue2)' }}>AI</span>
      {!rail && <span>AI <b style={{ color: 'var(--blue)' }}>DLC</b></span>}
    </div>
  )
}

/** One sidebar entry: a page (href) with an icon, an optional count and optional sub-items. */
export interface SideEntry {
  key: string
  label: string
  href: string
  icon: LucideIcon
  count?: number
  subs?: { key: string; label: string; href: string; onRemove?: () => void }[]
  onAdd?: () => void
}

export interface SideGroup {
  title: string
  short: string
  items: SideEntry[]
}

// Project templates, Users and roles and Audit trail are left out of the menu until they are used (their pages stay)
const ADMIN_ITEMS: SideEntry[] = [
  { key: 'admin/processes', label: 'AI-SDLC processes', href: 'admin/processes', icon: GitBranch },
  { key: 'admin/workflows', label: 'Process', href: 'admin/workflows', icon: Workflow },
  { key: 'admin/groups', label: 'Steps', href: 'admin/groups', icon: ListOrdered },
  { key: 'admin/agents', label: 'Agents', href: 'admin/agents', icon: Bot },
  { key: 'admin/settings', label: 'Settings', href: 'admin/settings', icon: Settings },
  { key: 'admin/claude', label: 'Claude token', href: 'admin/claude', icon: KeyRound },
  { key: 'admin/queue', label: 'Change queue', href: 'admin/queue', icon: ListOrdered },
  {
    key: 'admin/sidecars', label: 'Sidecars', href: 'admin/sidecars', icon: Plug,
    subs: [
      { key: 'knowledge', label: 'Project knowledge', href: 'admin/sidecars/knowledge' },
      { key: 'autologin', label: 'Autologin', href: 'admin/sidecars/autologin' },
      { key: 'hooks', label: 'Hooks', href: 'admin/sidecars/hooks' },
    ],
  },
]

function readRail(): boolean {
  try {
    return localStorage.getItem('dlc.side.rail') === '1'
  } catch {
    return false
  }
}

/**
 * The app window (designer style 24): a deep sidebar on the left (search with '/', collapsible groups,
 * counts, sub-items, the user at the foot, collapsible to an icon rail) and the page on the right.
 * `extra` adds counts / sub-items / add buttons to entries by key (the admin page passes its processes
 * and steps); `fill` gives the page the full height without the padded scroll area.
 */
export function Shell({ children, here, extra, projectsCount, fill }: {
  children: ReactNode
  here?: string
  extra?: Record<string, Partial<SideEntry>>
  projectsCount?: number
  fill?: boolean
}) {
  const me = profile()
  const auth = config()?.auth.enabled
  const parts = useRoute()
  const path = parts.join('/')
  const [rail, setRail] = useState(readRail)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        if (rail) setRail(false)
        setTimeout(() => search.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [rail])
  const toggleRail = () => {
    setRail((r) => {
      try { localStorage.setItem('dlc.side.rail', r ? '0' : '1') } catch { /* private window */ }
      return !r
    })
  }
  const groups: SideGroup[] = [
    { title: 'Main', short: 'Main', items: [{ key: 'home', label: 'Projects', href: '', icon: FolderKanban, count: projectsCount }] },
    { title: 'Admin', short: 'Admin', items: ADMIN_ITEMS.map((it) => ({ ...it, ...(extra?.[it.key] || {}) })) },
  ]
  const active = (it: SideEntry) =>
    it.key === 'home' ? here === 'home' || path === '' || parts[0] === 'run' : path === it.href || path.startsWith(it.href + '/') || (it.key === 'admin/workflows' && path === 'admin')
  const needle = q.trim().toLowerCase()
  const match = (s: string) => !needle || s.toLowerCase().includes(needle)
  return (
    <div className="app-window">
      <aside className={'side' + (rail ? ' rail' : '')}>
        <div className={'flex items-center gap-2 pb-4 pt-5 ' + (rail ? 'justify-center px-2' : 'px-5')}>
          <button onClick={() => go('')} className="cursor-pointer" aria-label="Projects"><Logo rail={rail} /></button>
          {!rail && (
            <button className="ml-auto rounded-md p-1.5 hover:bg-[var(--row)]" style={{ color: 'var(--muted-ink)' }} onClick={toggleRail} title="Collapse sidebar">
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>
        {rail ? (
          <button className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-lg" style={{ background: 'var(--row)', color: 'var(--muted-ink)' }}
            onClick={() => { toggleRail(); setTimeout(() => search.current?.focus(), 0) }} title="Search (/)">
            <Search size={16} />
          </button>
        ) : (
          <label className="mx-4 mb-3 flex h-9 items-center gap-2 rounded-lg px-2.5" style={{ background: 'var(--row)', border: '1px solid var(--line2)' }}>
            <Search size={15} style={{ color: 'var(--muted-ink)' }} />
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              onKeyDown={(e) => e.key === 'Escape' && (setQ(''), (e.target as HTMLInputElement).blur())}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" style={{ color: 'var(--ink)' }} />
            <span className="side-kbd">/</span>
          </label>
        )}
        <nav className="min-h-0 flex-1 overflow-y-auto pb-3">
          {groups.map((g) => {
            const items = g.items.filter((it) => match(it.label) || (it.subs || []).some((s) => match(s.label)))
            if (!items.length) return null
            const shut = closed[g.title] && !needle
            return (
              <div key={g.title} className="border-t pt-3 pb-1" style={{ borderColor: 'var(--line)' }}>
                {rail ? (
                  <div className="pb-1.5 text-center text-[11px]" style={{ color: 'var(--dim)' }}>{g.short}</div>
                ) : (
                  <button className="flex w-full items-center px-5 pb-1.5 text-[12px]" style={{ color: 'var(--dim)' }}
                    onClick={() => setClosed((c) => ({ ...c, [g.title]: !c[g.title] }))} title={shut ? 'Expand' : 'Collapse'}>
                    {g.title}
                    <span className="ml-auto">{shut ? <Plus size={13} /> : <Minus size={13} />}</span>
                  </button>
                )}
                {!shut && items.map((it) => {
                  const on = active(it)
                  const Icon = it.icon
                  const subs = (it.subs || []).filter((s) => match(s.label) || match(it.label))
                  const cur = (it.subs || []).find((s) => s.href === path)?.key ?? (it.onAdd ? it.subs?.[0]?.key : undefined)   // an editor list opens its first
                  return (
                    <div key={it.key}>
                      <div className={'side-item group' + (on ? ' on' : '') + (rail ? ' justify-center !px-0' : '')}
                        onClick={() => go(it.href)} title={rail ? it.label : undefined}>
                        <Icon size={16} className="shrink-0" />
                        {!rail && <span className="min-w-0 flex-1 truncate">{it.label}</span>}
                        {!rail && it.onAdd && (
                          <button className="rounded p-0.5 opacity-0 hover:bg-[var(--row)] group-hover:opacity-100" title={`Add to ${it.label}`}
                            onClick={(e) => { e.stopPropagation(); it.onAdd!() }}><Plus size={13} /></button>
                        )}
                        {!rail && it.count !== undefined && <span className="side-count">{it.count}</span>}
                      </div>
                      {!rail && on && subs.map((s) => (
                        <div key={s.key} className={'side-sub group' + (s.key === cur ? ' on' : '')} onClick={() => go(s.href)}>
                          <span className="min-w-0 flex-1 truncate">{s.label}</span>
                          {s.onRemove && (
                            <button className="rounded p-0.5 opacity-0 hover:text-[var(--red)] group-hover:opacity-100" title="Delete"
                              onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${s.label}"?`)) s.onRemove!() }}><Minus size={12} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </nav>
        {rail && (
          <button className="mx-auto mb-2 rounded-md p-1.5 hover:bg-[var(--row)]" style={{ color: 'var(--muted-ink)' }} onClick={toggleRail} title="Expand sidebar">
            <PanelLeftOpen size={16} />
          </button>
        )}
        {auth && me && (
          <div className={'relative m-3 flex items-center gap-2.5 rounded-lg ' + (rail ? 'justify-center p-1.5' : 'p-2.5')}
            style={{ background: 'var(--panel)', border: '1px solid var(--line2)' }}>
            <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-black text-white" style={{ background: 'var(--blue2)' }}>
              {me.name.slice(0, 1).toUpperCase()}
              <i className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2" style={{ background: 'var(--green)', borderColor: 'var(--panel)' }} />
            </span>
            {!rail && (
              <>
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="truncate text-[13px] font-bold" style={{ color: 'var(--navy)' }}>{me.name}</div>
                  {me.email && <div className="truncate text-[11px]" style={{ color: 'var(--muted-ink)' }}>{me.email}</div>}
                </div>
                <button className="rounded p-1 hover:bg-[var(--row)]" style={{ color: 'var(--muted-ink)' }} onClick={() => setMenu((m) => !m)} title="More">
                  <MoreVertical size={15} />
                </button>
                {menu && (
                  <div className="absolute bottom-full right-0 mb-1.5 w-40 rounded-lg p-1 shadow-xl" style={{ background: 'var(--head)', border: '1px solid var(--line2)' }}
                    onMouseLeave={() => setMenu(false)}>
                    <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] hover:bg-[var(--row)]" onClick={() => void logout()}>
                      <LogOut size={14} /> Sign out
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </aside>
      <main className={'relative min-h-0 min-w-0 ' + (fill ? 'flex flex-col' : 'overflow-y-auto px-7 pb-12 pt-7')}>{children}</main>
    </div>
  )
}

/** A step that waits for a person's decision (an open gate), and one that waits its turn in the change queue. */
export const AWAITING = '#f08c00'
export const QUEUED = '#8b6cf0'

const STATE_TONE: Record<string, [string, string]> = {
  green: ['#36c98a', 'Completed'],
  escalated: ['#ff5f6d', 'Needs attention'],
  paused: ['#ffb547', 'Stopped'],
  admitted: ['#4d8dff', 'Starting'],
  understanding: ['#4d8dff', 'Understanding spec'],
  planning: ['#4d8dff', 'Planning'],
  building: ['#4d8dff', 'Building'],
  integrating: ['#2fc7d6', 'Integrating'],
  qas: ['#2fc7d6', 'Testing'],
  testing: ['#2fc7d6', 'Testing'],
  deploying: ['#2fc7d6', 'Deploying'],
  parked: ['#ffb547', 'Waiting'],
  awaiting: [AWAITING, 'Needs your approval'],
  queued: [QUEUED, 'In the change queue'],
}

export function StatePill({ run }: { run: RunSummary }) {
  const key = isPaused(run) && !isFinal(run) ? 'paused' : waitsForPerson(run) ? 'awaiting' : run.detail?.queue_wait && !isFinal(run) ? 'queued' : run.state
  const [color, label] = STATE_TONE[key] || ['#6b7a99', run.state]
  return (
    <span className="pill" style={{ color, background: color + '1a' }}>
      <i style={{ background: color, boxShadow: `0 0 0 3px ${color}33` }} />
      {label}
    </span>
  )
}

export function NodeStatePill({ state }: { state: string }) {
  const map: Record<string, [string, string]> = {
    done: ['#36c98a', 'Done'],
    running: ['#4d8dff', 'Running'],
    active: ['#4d8dff', 'Running'],
    paused: ['#ffb547', 'Stopped'],
    awaiting: [AWAITING, 'Needs your approval'],
    queued: [QUEUED, 'In queue'],
    failed: ['#ff5f6d', 'Failed'],
    pending: ['#6b7a99', 'Waiting'],
    skipped: ['#6b7a99', 'Skipped'],
  }
  const [color, label] = map[state] || ['#6b7a99', state]
  return (
    <span className="pill" style={{ color, background: color + '1a' }}>
      <i style={{ background: color }} />
      {label}
    </span>
  )
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="bar-glass" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(2, value)}%` }} />
    </div>
  )
}

/** Stop / Resume for a run that is not finished. */
export function RunControls({ run, onChange }: { run: RunSummary; onChange?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (isFinal(run)) return null
  const paused = isPaused(run)
  const act = async () => {
    setBusy(true)
    setErr('')
    try {
      if (paused) await resumeRun(run.id)
      else await pauseRun(run.id)
      onChange?.()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      {paused ? (
        <button className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-[12.5px]" disabled={busy} onClick={act}
          title="Resume the delivery process of this run from where it stopped">
          <Play size={14} /> Resume process
        </button>
      ) : (
        <button className="btn-danger flex items-center gap-1.5 px-3.5 py-2 text-[12.5px]" disabled={busy} onClick={act}
          title="Stop the delivery process of this run (it can be resumed later); the deployed app is not touched">
          <Pause size={14} /> Stop process
        </button>
      )}
      {err && <span className="max-w-[220px] text-right text-[11px] text-[var(--red)]">{err}</span>}
    </span>
  )
}

/** Start the app a completed run deployed, or open it when it already runs. */
export function AppButton({ run, compact, small }: { run: RunSummary; compact?: boolean; small?: boolean }) {
  const [app, setApp] = useState<AppState | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const refresh = useCallback(async () => {
    try {
      setApp(await appState(run.id))
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [run.id])
  useEffect(() => {
    if (run.state === 'green') void refresh()
  }, [run.state, refresh])
  if (run.state !== 'green' || app === null) return null
  if (app?.kind === 'desktop') return <DesktopBuild run={run} app={app} small={small} onChange={setApp} />
  const running = app?.state === 'running' && !!app.url
  const start = async () => {
    setBusy(true)
    setErr('')
    try {
      let s = await startApp(run.id)
      for (let i = 0; i < 30 && s.state === 'starting'; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        s = (await appState(run.id)) || s
      }
      setApp(s)
      if (s.state === 'running' && s.url) window.open(s.url, '_blank', 'noopener')
      else setErr(s.error || s.message || 'the app did not start')
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    setBusy(true)
    try {
      setApp(await stopApp(run.id))
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex gap-1.5">
        {running ? (
          <a className={'btn-primary flex items-center gap-1.5 px-3.5 text-[12.5px] ' + (small ? 'h-[34px] whitespace-nowrap' : 'py-2')} href={app!.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} /> Open app
          </a>
        ) : (
          <button className={'btn-primary flex items-center gap-1.5 px-3.5 text-[12.5px] ' + (small ? 'h-[34px] whitespace-nowrap' : 'py-2')} disabled={busy} onClick={start}>
            <Rocket size={14} /> {busy ? 'Starting…' : 'Start app'}
          </button>
        )}
        {running && !compact && (
          <button className="btn-ghost flex items-center gap-1 px-2.5 py-2 text-[12px]" disabled={busy} onClick={stop} title="Stop the app">
            <Square size={13} /> Stop app
          </button>
        )}
      </span>
      {running && !compact && <span className="text-[11px]" style={{ color: 'var(--muted-ink)' }}>{app!.url}</span>}
      {(err || app?.state === 'failed') && (
        <span className="max-w-[320px] text-right text-[11px] text-[var(--red)]" title={app?.log_tail || ''}>
          {err || app?.error || 'the app failed to start'}
          {app?.log_tail && <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-left text-[10.5px] opacity-80">{app.log_tail}</pre>}
        </span>
      )}
    </span>
  )
}

/** A desktop app is not started on the server: it is built into a zip (flet pack / PyInstaller) and downloaded. */
function DesktopBuild({ run, app, small, onChange }: { run: RunSummary; app: AppState; small?: boolean; onChange: (a: AppState) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const b = app.build || {}
  const cls = 'btn-primary flex items-center gap-1.5 px-3.5 text-[12.5px] ' + (small ? 'h-[34px] whitespace-nowrap' : 'py-2')
  const mb = b.size ? ` (${(b.size / 1048576).toFixed(0)} MB)` : ''
  const download = async () => {
    try {
      await downloadApp(run.id)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  const go = async () => {
    setBusy(true)
    setErr('')
    try {
      let s = await buildApp(run.id)
      for (let i = 0; i < 600 && s.build?.state === 'building'; i++) {   // a build takes minutes: poll up to 30 min
        onChange(s)
        await new Promise((r) => setTimeout(r, 3000))
        s = (await appState(run.id)) || s
      }
      onChange(s)
      if (s.build?.state === 'built') await download()
      else setErr(s.build?.error || 'the build failed')
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  const building = busy || b.state === 'building'
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex gap-1.5">
        {b.state === 'built' && !building ? (
          <button className={cls} onClick={() => void download()} title="Download the built desktop app (zip)">
            <Download size={14} /> Download{mb}
          </button>
        ) : (
          <button className={cls} disabled={building} onClick={() => void go()}
            title="Build the desktop app on the server, zip it and download it">
            <Package size={14} /> {building ? 'Building…' : 'Build & download'}
          </button>
        )}
        {b.state === 'built' && !building && !small && (
          <button className="btn-ghost flex items-center gap-1 px-2.5 py-2 text-[12px]" onClick={() => void go()} title="Build it again">
            Rebuild
          </button>
        )}
      </span>
      {(err || b.state === 'failed') && (
        <span className="max-w-[320px] text-right text-[11px] text-[var(--red)]">{err || b.error || 'the build failed'}</span>
      )}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={'glass p-5 ' + className}>{children}</section>
}

export const NODE_COLOR: Record<string, string> = {
  done: '#36c98a', running: '#4d8dff', active: '#4d8dff', paused: '#ffb547', failed: '#ff5f6d', pending: '#9aa7c2', skipped: '#9aa7c2',
  awaiting: AWAITING, queued: QUEUED,
}

/** A step that moves (pulse): running, or waiting for a person. */
export const isLive = (state: string) => state === 'running' || state === 'active' || state === 'awaiting'

/** The run's stages as small clickable steps; a click opens that node's session (worklog + reports). */
export function NodeStrip({ run }: { run: RunSummary }) {
  const [list, setList] = useState<FlowNode[]>(() => nodesFromRun(run))
  useEffect(() => {
    let live = true
    loadNodes(run).then((n) => live && setList(n)).catch(() => undefined)
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, run.state, run.updated_ms])
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1">
      {list.map((n, i) => {
        const c = NODE_COLOR[n.state] || '#9aa7c2'
        return (
          <span key={n.id} className="flex items-center gap-1">
            {i > 0 && <span className="h-px w-3" style={{ background: 'rgba(77,141,255,.25)' }} />}
            <button
              onClick={() => go(`run/${encodeURIComponent(run.id)}/node/${encodeURIComponent(n.id)}`)}
              className="flex items-center gap-1.5 rounded-full border border-[var(--edge)] bg-[var(--row)] px-2.5 py-1 text-[11px] font-semibold hover:bg-[rgba(77,141,255,0.08)]"
              title={n.state === 'awaiting' ? n.title + ' - waits for your approval: open it' : n.state === 'queued' ? n.title + ' - ' + (n.queue?.text || 'waits its turn in the change queue') : n.title + ' - open the session'}
              style={n.state === 'awaiting' || n.state === 'queued'
                ? { color: c, borderColor: c, background: c + '14', boxShadow: `0 0 0 3px ${c}22` }
                : { color: n.state === 'pending' ? 'var(--muted-ink)' : 'var(--navy)' }}
            >
              <i className={'inline-block h-2 w-2 rounded-full ' + (isLive(n.state) ? 'animate-pulse' : '')}
                style={{ background: c }} />
              {n.title}
            </button>
          </span>
        )
      })}
    </div>
  )
}
