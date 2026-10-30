import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { BOX, Button, Field } from '@/components/ui'
import { cn } from '@/lib/cn'
import { addHook, changeHook, deleteHook, listHooks, listRuns, testHook } from '@/lib/dlc'
import type { HookResult, HooksAdmin, RunHook, RunHookInput, RunSummary } from '@/lib/dlc'
import { go } from '@/lib/route'

// Admin > Sidecars > Run hooks: agents that run at an event of every matching run (line/hooks.py), like
// Claude Code hooks. A background hook only reports; a waiting hook holds the run until its agent ends with
// SUBMIT (go on) or BLOCKED:<reason> (park the run, or stop it). New hooks need no engine deploy.

const EVENT_LABEL: Record<string, string> = {
  run_start: 'Run start (before the spec is read)',
  after_plan: 'After the plan',
  before_qas: 'Before the test stage (QAS)',
  before_green: 'Before the run ends green',
  run_done: 'Run done (green)',
  run_failed: 'Run failed (escalated)',
  agent_start: 'Every agent call: add instructions to its prompt',
  before_tool: 'Every shell command of an agent: refuse a pattern',
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--blue)', done: 'var(--green)', passed: 'var(--green)', blocked: 'var(--amber)', error: 'var(--red)',
}

const EMPTY: RunHookInput = {
  name: '', enabled: true, scope: 'agent', roles: [], pattern: '', prompt: '', event: 'agent_start', mode: 'background', on_block: 'wait', on_error: 'continue',
  projects: [], flows: [], apps: [], max_turns: 30, max_usd: 1.5,
}

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)

export function HooksView() {
  const [data, setData] = useState<HooksAdmin | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [edit, setEdit] = useState<{ id?: number; v: RunHookInput } | null>(null)
  const [testFor, setTestFor] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { listHooks().then(setData).catch((e) => setErr(String((e as Error).message))) }, [])
  useEffect(load, [load])
  useEffect(() => { listRuns().then(setRuns).catch(() => setRuns([])) }, [])
  // a test runs on the engine in the background: poll while one is running
  const testing = Object.values(data?.tests || {}).some((t) => t.status === 'running')
  useEffect(() => {
    if (!testing) return
    const id = window.setInterval(load, 3000)
    return () => window.clearInterval(id)
  }, [testing, load])

  const save = async () => {
    if (!edit) return
    setErr('')
    try {
      if (edit.id) await changeHook(edit.id, edit.v)
      else await addHook(edit.v)
      setEdit(null)
      load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  const toggle = async (h: RunHook) => { await changeHook(h.id, { enabled: !h.enabled }); load() }
  const remove = async (h: RunHook) => {
    if (!confirm(`Delete hook "${h.name}"?`)) return
    await deleteHook(h.id)
    load()
  }
  const test = async (h: RunHook, run: string) => {
    setErr('')
    try {
      await testHook(h.id, run)
      setTestFor(null)
      load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between pr-6">
        <div className="flex items-center gap-2 px-6 pt-5">
          <button className="text-[13px] font-semibold text-[var(--muted-ink)] hover:text-[var(--blue)]" onClick={() => go('admin/sidecars')}>
            Sidecars <ChevronRight className="inline size-3.5" />
          </button>
          <h2 className="title-navy text-[22px]">Hooks</h2>
        </div>
        <Button tone="primary" className="mt-5 h-9 px-4" onClick={() => setEdit({ v: { ...EMPTY } })}><Plus className="size-4" /> Add hook</Button>
      </div>
      <p className="px-6 pt-1 text-[12.5px] leading-relaxed text-[var(--muted-ink)]">
        Two kinds. <b className="text-[var(--ink)]">Agent hooks</b> apply to every agent call (all agents, or the roles chosen): standing
        instructions added to each prompt, or shell commands refused by a pattern. <b className="text-[var(--ink)]">Run hooks</b>: an agent that runs at an event of every matching run, with the run's spec, repository and commits. <b className="text-[var(--ink)]">Background</b> hooks
        only do their work (e.g. close the ticket when a run is done). <b className="text-[var(--ink)]">Waiting</b> hooks hold the run until the agent ends with
        SUBMIT or BLOCKED:&lt;reason&gt;; a blocked run waits (a person can pass it in the run view) or stops.
      </p>
      {err && <p className="mx-6 mt-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-bold text-[var(--red)]">{err}</p>}
      {edit && data && (
        <HookForm value={edit.v} isNew={!edit.id} data={data} onChange={(v) => setEdit({ ...edit, v })} onSave={save} onCancel={() => setEdit(null)} />
      )}
      <div className="p-6">
        <div className="overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--panel2)]">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[var(--head)] text-left text-[11px] font-bold uppercase tracking-[0.03em] text-[var(--muted-ink)]">
                <th className="px-4 py-2.5">Name</th><th className="px-3">Event</th><th className="px-3">Mode</th>
                <th className="px-3">Applies to</th><th className="px-3">On</th><th className="px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.hooks.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-ink)]">No hook yet. Add one to run an agent at a run event.</td></tr>
              )}
              {data?.hooks.map((h) => (
                <tr key={h.id} className="border-t border-[var(--line)] align-top hover:bg-[rgba(77,141,255,0.06)]">
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-[var(--navy)]">{h.name}</div>
                    <div className="line-clamp-2 max-w-[420px] text-[11.5px] text-[var(--muted-ink)]">{h.prompt}</div>
                    {data.tests[String(h.id)] && <TestLine t={data.tests[String(h.id)]} />}
                    {testFor === h.id && <TestPicker runs={runs} onRun={(r) => void test(h, r)} onCancel={() => setTestFor(null)} />}
                  </td>
                  <td className="px-3 py-2.5">{h.event}</td>
                  <td className="px-3 py-2.5">
                    {h.scope === 'agent' ? (h.event === 'before_tool' ? `refuse /${h.pattern}/` : 'instructions')
                      : h.mode === 'wait' ? `wait · blocked: ${h.on_block === 'stop' ? 'stop' : 'park'}` : 'background'}
                  </td>
                  <td className="px-3 py-2.5 text-[12px]">
                    {h.scope === 'agent' ? <div>{h.roles?.length ? h.roles.join(', ') : 'all agents'}</div> : <>
                    <div>{h.projects.length ? h.projects.join(', ') : 'all projects'}</div>
                    <div className="text-[var(--muted-ink)]">{h.flows.length ? h.flows.join(', ') : 'all flows'}</div>
                    {h.apps.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {h.apps.map((a) => <span key={a} className="rounded-md bg-[rgba(77,141,255,0.12)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--blue)]">{a}</span>)}
                      </div>
                    )}
                    </>}
                  </td>
                  <td className="px-3 py-2.5"><Switch on={h.enabled} onChange={() => void toggle(h)} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Button className="h-7 px-2.5 text-[12px]" disabled={h.scope === 'agent' || data.tests[String(h.id)]?.status === 'running'} onClick={() => setTestFor(testFor === h.id ? null : h.id)}>
                        <FlaskConical className="size-3.5" /> Test
                      </Button>
                      <Button className="h-7 px-2" title="Edit" onClick={() => setEdit({ id: h.id, v: { ...h } })}><Pencil className="size-3.5" /></Button>
                      <Button tone="danger" className="h-7 px-2" title="Delete" onClick={() => void remove(h)}><Trash2 className="size-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export function HookStatus({ r }: { r: HookResult }) {
  return <span className="font-bold" style={{ color: STATUS_COLOR[r.status] || 'var(--muted-ink)' }}>{r.status}</span>
}

function TestLine({ t }: { t: HookResult }) {
  return (
    <div className="mt-1 text-[11.5px]">
      Test on {t.run}: <HookStatus r={t} />
      {t.reason ? <span className="text-[var(--muted-ink)]"> · {t.reason}</span> : null}
      {t.usd ? <span className="text-[var(--muted-ink)]"> · ${Number(t.usd).toFixed(2)}</span> : null}
    </div>
  )
}

function TestPicker({ runs, onRun, onCancel }: { runs: RunSummary[]; onRun: (run: string) => void; onCancel: () => void }) {
  const [run, setRun] = useState(runs[0]?.id || '')
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select className={cn(BOX, 'h-8 w-72 text-[12px]')} value={run} onChange={(e) => setRun(e.target.value)}>
        {runs.map((r) => <option key={r.id} value={r.id}>{r.name || r.detail?.name || r.id} · {r.state}</option>)}
        {!runs.length && <option value="">no run yet</option>}
      </select>
      <Button tone="primary" className="h-8 px-3 text-[12px]" disabled={!run} onClick={() => onRun(run)}>Run once</Button>
      <Button className="h-8 px-3 text-[12px]" onClick={onCancel}>Cancel</Button>
      <span className="w-full text-[11px] text-[var(--muted-ink)]">The hook's agent does its real work on that run's data; the run itself is not changed.</span>
    </div>
  )
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex h-6 cursor-pointer items-center">
      <span className={cn('relative inline-flex h-5 w-9 rounded-full transition-colors', on ? 'bg-[var(--blue)]' : 'bg-[var(--row)]')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}

function HookForm({ value: v, isNew, data, onChange, onSave, onCancel }: {
  value: RunHookInput; isNew: boolean; data: HooksAdmin; onChange: (v: RunHookInput) => void; onSave: () => void; onCancel: () => void
}) {
  const set = (k: keyof RunHookInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...v, [k]: e.target.value })
  // comma lists are edited as text and split on save, so a trailing comma does not vanish while typing
  const [projects, setProjects] = useState((v.projects || []).join(', '))
  const [flows, setFlows] = useState((v.flows || []).join(', '))
  const agent = v.scope === 'agent'
  const roles = v.roles || []
  const canWait = data.wait_events.includes(v.event || '')
  const mode = canWait ? v.mode : 'background'
  const apps = v.apps || []
  return (
    <div className="mx-6 mt-4 rounded-[10px] border border-[var(--line2)] bg-[var(--panel2)] p-4">
      <div className="mb-2 text-[15px] font-black text-[var(--navy)]">{isNew ? 'Add hook' : `Edit ${v.name}`}</div>
      <Field label="Name"><input className={BOX} value={v.name || ''} onChange={set('name')} placeholder="e.g. Close the Jira ticket" /></Field>
      <Field label="Kind">
        <select className={cn(BOX, 'w-80')} value={agent ? 'agent' : 'run'}
          onChange={(e) => onChange({ ...v, scope: e.target.value as 'run' | 'agent', event: e.target.value === 'agent' ? 'agent_start' : 'run_done', mode: 'background' })}>
          <option value="agent">Agent hook: every agent call</option><option value="run">Run hook: an event of the run</option>
        </select>
      </Field>
      {agent ? <>
      <Field label="Event">
        <select className={cn(BOX, 'w-96')} value={v.event} onChange={set('event')}>
          {(data.agent_events || ['agent_start', 'before_tool']).map((x) => <option key={x} value={x}>{EVENT_LABEL[x] || x}</option>)}
        </select>
      </Field>
      {v.event === 'before_tool' && (
        <Field label="Pattern" hint="A regular expression checked against every shell command of the agent (case-insensitive).">
          <input className={cn(BOX, 'font-mono text-[12px]')} value={v.pattern || ''} onChange={set('pattern')} placeholder="e.g. (^|\s)npm\s+install" />
        </Field>
      )}
      <Field label={v.event === 'before_tool' ? 'Reason' : 'Instructions'} hint={v.event === 'before_tool' ? 'What the agent reads when its command is refused.' : 'Added to the prompt of every matching agent call.'}>
        <textarea className={cn(BOX, 'h-32 py-2 font-mono text-[12px]')} value={v.prompt || ''} onChange={set('prompt')}
          placeholder={v.event === 'before_tool' ? 'e.g. this project uses pnpm, not npm' : 'e.g. Write commit messages in English, imperative mood.'} />
      </Field>
      <Field label="Agents" hint="None chosen = every agent. A role covers its variants (reader = reader_a, reader_b).">
        <div className="flex flex-wrap gap-4">
          {(data.roles || []).map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Switch on={roles.includes(r)} onChange={(on) => onChange({ ...v, roles: on ? [...roles, r] : roles.filter((x) => x !== r) })} />
              {r}
            </label>
          ))}
        </div>
      </Field>
      </> : <>
      <Field label="Event">
        <select className={cn(BOX, 'w-80')} value={v.event} onChange={(e) => onChange({ ...v, event: e.target.value, mode: data.wait_events.includes(e.target.value) ? v.mode : 'background' })}>
          {data.events.map((x) => <option key={x} value={x}>{EVENT_LABEL[x] || x}</option>)}
        </select>
      </Field>
      <Field label="Mode" hint={canWait ? 'Waiting: the run goes on only after the agent ends with SUBMIT.' : 'This event comes after the run ended: background only.'}>
        <select className={cn(BOX, 'w-48')} value={mode} disabled={!canWait} onChange={set('mode')}>
          <option value="background">background</option><option value="wait">wait</option>
        </select>
      </Field>
      {mode === 'wait' && (
        <div className="flex flex-wrap gap-6">
          <Field label="When blocked">
            <select className={cn(BOX, 'w-56')} value={v.on_block} onChange={set('on_block')}>
              <option value="wait">park the run (a person can pass it)</option><option value="stop">stop the run</option>
            </select>
          </Field>
          <Field label="When the agent fails">
            <select className={cn(BOX, 'w-56')} value={v.on_error} onChange={set('on_error')}>
              <option value="continue">let the run go on</option><option value="wait">park the run</option>
            </select>
          </Field>
        </div>
      )}
      <Field label="Prompt" hint={v.event === 'run_start' ? 'At run start the agent may write spec_addendum.md: it is added to the spec.' : 'The agent also gets the run, its spec, repository, branch and commits.'}>
        <textarea className={cn(BOX, 'h-40 py-2 font-mono text-[12px]')} value={v.prompt || ''} onChange={set('prompt')}
          placeholder="e.g. Find the Jira ticket named in the spec, move it to Done and fill Solution and Root cause from the commits." />
      </Field>
      <div className="flex flex-wrap gap-6">
        <Field label="Projects" hint="Comma separated; empty = all.">
          <input className={cn(BOX, 'w-72')} value={projects} onChange={(e) => { setProjects(e.target.value); onChange({ ...v, projects: list(e.target.value) }) }} />
        </Field>
        <Field label="Flows" hint="Comma separated; empty = all.">
          <input className={cn(BOX, 'w-72')} value={flows} onChange={(e) => { setFlows(e.target.value); onChange({ ...v, flows: list(e.target.value) }) }} />
        </Field>
      </div>
      <Field label="Apps" hint="Autologin accounts the hook's agent may use (whatever their agent groups).">
        <div className="flex flex-wrap gap-4">
          {data.apps.map((a) => (
            <label key={a} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Switch on={apps.includes(a)} onChange={(on) => onChange({ ...v, apps: on ? [...apps, a] : apps.filter((x) => x !== a) })} />
              {a}
            </label>
          ))}
          {!data.apps.length && <span className="text-[12px] text-[var(--muted-ink)]">No Autologin account yet.</span>}
        </div>
      </Field>
      <div className="flex flex-wrap gap-6">
        <Field label="Max turns"><input type="number" min={1} max={200} className={cn(BOX, 'w-28')} value={v.max_turns ?? 30} onChange={(e) => onChange({ ...v, max_turns: Number(e.target.value) })} /></Field>
        <Field label="Max USD"><input type="number" min={0.05} max={50} step={0.05} className={cn(BOX, 'w-28')} value={v.max_usd ?? 1.5} onChange={(e) => onChange({ ...v, max_usd: Number(e.target.value) })} /></Field>
      </div>
      </>}
      <div className="mt-3 flex justify-end gap-2">
        <Button className="h-9 px-4" onClick={onCancel}>Cancel</Button>
        <Button tone="primary" className="h-9 px-5" disabled={!v.name?.trim() || !v.prompt?.trim()} onClick={() => onSave()}>Save</Button>
      </div>
    </div>
  )
}
