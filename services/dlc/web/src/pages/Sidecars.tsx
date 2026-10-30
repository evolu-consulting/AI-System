import { useCallback, useEffect, useState } from 'react'
import { BookOpen, ChevronRight, KeyRound, Pencil, Plug, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { BOX, Button, Field } from '@/components/ui'
import { cn } from '@/lib/cn'
import {
  addAutologin, askKnowledge, changeAutologin, deleteAutologin, listAutologin, listProjects, listSidecars, testAutologin,
} from '@/lib/dlc'
import type { AutologinEntry, AutologinInput, Project, Sidecar } from '@/lib/dlc'
import { go } from '@/lib/route'
import { HooksView } from '@/pages/Hooks'

// Admin > Sidecars: the satellite tools the engine runs next to the line (like a workspace's side tools).
// Project knowledge is built in (the agents' search_knowledge tool); Autologin holds the web-app accounts
// the agents may sign in to, per agent group. Every account here is 'never ask': no confirmation step.

const ICON: Record<string, typeof Plug> = { knowledge: BookOpen, autologin: KeyRound }
const GROUPS: [string, string][] = [['spec', 'Spec analyst'], ['dev', 'Dev agents'], ['deploy', 'Deploy agents'], ['test', 'Test agents']]
const KIND_HINT: Record<string, string> = {
  password: 'The engine fills the user name and password on the sign-in page.',
  sso: 'The engine clicks the provider button, then fills the provider\'s form. MFA cannot be done unattended.',
  passcode: 'SAP one-time passcode page (login.cf.<region>...): used by cf_login only; the code is never shown.',
  steps: 'Your own sign-in steps for a login page the engine does not know. The steps follow the screen: one the site does not show is skipped.',
  cli: 'Signs a command-line tool on the engine host in (e.g. gcloud): step 1 runs the command, the next steps finish its browser part. Used by cli_login only.',
}
const STEPS_HINT = 'One step per line: click "Sign in" · fill "Email" = {{username}} · fill #password = {{password}} · press Enter · ' +
  'wait "Welcome" · pause 2 · login · sso "microsoft" pick "S00123" · passcode · run "gcloud auth login --no-launch-browser" (first step only) · code'
const STEPS_EXAMPLE: Record<string, string> = {
  steps: 'click "Sign in"\nfill "Email" = {{username}}\nfill "Password" = {{password}}\nclick "Log in"',
  cli: 'run "gcloud auth login --no-launch-browser"\ncode',
}
const NEEDS_NO_PASSWORD = ['sso', 'steps', 'cli']

export function SidecarsView({ id }: { id?: string }) {
  if (id === 'autologin') return <AutologinView />
  if (id === 'knowledge') return <KnowledgeView />
  if (id === 'hooks') return <HooksView />
  return <SidecarList />
}

function Title({ text, back }: { text: string; back?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-6 pt-5">
      {back && (
        <button className="text-[13px] font-semibold text-[var(--muted-ink)] hover:text-[var(--blue)]" onClick={() => go('admin/sidecars')}>
          Sidecars <ChevronRight className="inline size-3.5" />
        </button>
      )}
      <h2 className="title-navy text-[22px]">{text}</h2>
    </div>
  )
}

function SidecarList() {
  const [items, setItems] = useState<Sidecar[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { listSidecars().then(setItems).catch((e) => setErr(String((e as Error).message))) }, [])
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Title text="Sidecars" />
      <p className="px-6 pt-1 text-[12.5px] text-[var(--muted-ink)]">Tools the agents use during a run, next to the delivery line.</p>
      {err && <p className="mx-6 mt-3 text-[12px] text-[var(--red)]">{err}</p>}
      <div className="grid gap-3 p-6 sm:grid-cols-2 xl:grid-cols-3">
        {items?.map((s) => {
          const Icon = ICON[s.id] || Plug
          return (
            <button key={s.id} className="glass flex flex-col gap-2 p-4 text-left transition hover:border-[var(--blue)]" onClick={() => go(`admin/sidecars/${s.id}`)}>
              <span className="flex items-center gap-3">
                <span className="chip-glass !h-9 !w-9"><Icon size={17} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-bold text-[var(--navy)]">{s.name}</span>
                  <span className="text-[11.5px] text-[var(--muted-ink)]">
                    {s.builtin ? 'built in' : s.enabled ? `on · ${s.count} account${s.count === 1 ? '' : 's'}` : `off · ${s.count ?? 0} accounts`}
                  </span>
                </span>
                <i className="h-2 w-2 rounded-full" style={{ background: s.enabled ? 'var(--green)' : 'var(--dim)' }} />
              </span>
              <span className="text-[12.5px] leading-relaxed text-[var(--muted-ink)]">{s.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ project knowledge

function KnowledgeView() {
  const [projects, setProjects] = useState<Project[]>([])
  const [rp, setRp] = useState('')
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<{ text: string; error?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    listProjects().then((p) => {
      setProjects(p || [])
      if (p && p[0]?.rag_project) setRp(p[0].rag_project)
    }).catch(() => setProjects([]))
  }, [])
  const ask = async () => {
    setBusy(true)
    try { setAnswer(await askKnowledge(rp, q.trim())) } catch (e) { setAnswer({ text: String((e as Error).message), error: true }) }
    setBusy(false)
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Title text="Project knowledge" back />
      <div className="px-6 pb-6 pt-3">
        <p className="mb-4 text-[12.5px] leading-relaxed text-[var(--muted-ink)]">
          Every agent of a run gets the <b className="text-[var(--ink)]">search_knowledge</b> tool: it reads the run's project in the RAG System
          (decisions, earlier fixes, how to build, test and deploy, lessons, worklog) and then the shared lessons. Ask here what an agent of a project would get.
        </p>
        <Field label="Project">
          <select className={cn(BOX, 'w-80')} value={rp} onChange={(e) => setRp(e.target.value)}>
            {projects.map((p) => <option key={p.id} value={p.rag_project || ''}>{p.name} ({p.rag_project})</option>)}
            {!projects.length && <option value="">no project yet</option>}
          </select>
        </Field>
        <Field label="Question">
          <div className="flex gap-2">
            <input className={BOX} value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. how do we deploy to QA?"
              onKeyDown={(e) => e.key === 'Enter' && q.trim() && !busy && ask()} />
            <Button tone="primary" className="h-9 px-4" disabled={busy || !q.trim()} onClick={ask}>{busy ? 'Asking…' : 'Ask'}</Button>
          </div>
        </Field>
        {answer && (
          <pre className={cn('mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-[10px] border border-[var(--line2)] bg-[var(--row)] p-4 text-[12.5px] leading-relaxed',
            answer.error ? 'text-[var(--red)]' : 'text-[var(--ink)]')}>{answer.text}</pre>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ autologin

const EMPTY: AutologinInput = { name: '', url: '', env: 'dev', kind: 'password', username: '', provider: '', roles: ['spec', 'dev', 'deploy', 'test'], enabled: true, secret: '' }

function AutologinView() {
  const [rows, setRows] = useState<AutologinEntry[] | null>(null)
  const [edit, setEdit] = useState<{ id?: number; v: AutologinInput; hasSecret?: boolean } | null>(null)
  const [msg, setMsg] = useState<Record<number, { ok: boolean; text: string }>>({})
  const [testing, setTesting] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(() => { listAutologin().then(setRows).catch((e) => setErr(String((e as Error).message))) }, [])
  useEffect(load, [load])
  const save = async () => {
    if (!edit) return
    setErr('')
    try {
      if (edit.id) await changeAutologin(edit.id, edit.v)
      else await addAutologin(edit.v)
      setEdit(null)
      load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  const test = async (id: number) => {
    setTesting(id)
    try {
      const r = await testAutologin(id)
      setMsg((m) => ({ ...m, [id]: { ok: r.signed_in, text: r.text } }))
    } catch (e) {
      setMsg((m) => ({ ...m, [id]: { ok: false, text: String((e as Error).message) } }))
    }
    setTesting(null)
  }
  const toggle = async (r: AutologinEntry) => { await changeAutologin(r.id, { enabled: !r.enabled }); load() }
  const remove = async (r: AutologinEntry) => {
    if (!confirm(`Delete "${r.name}"?`)) return
    await deleteAutologin(r.id)
    load()
  }
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-center justify-between pr-6">
        <Title text="Autologin" back />
        <Button tone="primary" className="mt-5 h-9 px-4" onClick={() => setEdit({ v: { ...EMPTY } })}><Plus className="size-4" /> Add account</Button>
      </div>
      <p className="px-6 pt-1 text-[12.5px] leading-relaxed text-[var(--muted-ink)]">
        Web-app accounts the agents may sign in to. The engine signs in in its own browser and the agent works through that session
        (list_apps, get_session, open_page, fetch, run_js, cf_login); it never sees the password. Accounts here are never asked for confirmation.
      </p>
      {err && <p className="mx-6 mt-3 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-bold text-[var(--red)]">{err}</p>}
      {edit && <EntryForm value={edit.v} hasSecret={edit.hasSecret} isNew={!edit.id} onChange={(v) => setEdit({ ...edit, v })} onSave={save} onCancel={() => setEdit(null)} />}
      <div className="p-6">
        <div className="overflow-hidden rounded-[10px] border border-[var(--line)] bg-[var(--panel2)]">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[var(--head)] text-left text-[11px] font-bold uppercase tracking-[0.03em] text-[var(--muted-ink)]">
                <th className="px-4 py-2.5">Name</th><th className="px-3">Environment</th><th className="px-3">Kind</th>
                <th className="px-3">Agents</th><th className="px-3">On</th><th className="px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows?.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--muted-ink)]">No account yet. Add one to let agents sign in to an app.</td></tr>
              )}
              {rows?.map((r) => (
                <tr key={r.id} className="border-t border-[var(--line)] align-top hover:bg-[rgba(77,141,255,0.06)]">
                  <td className="px-4 py-2.5">
                    <div className="font-bold text-[var(--navy)]">{r.name}</div>
                    <div className="text-[11.5px] text-[var(--muted-ink)]">{r.url}{r.username ? ` · ${r.username}` : ''}{!r.has_secret && !NEEDS_NO_PASSWORD.includes(r.kind) ? ' · no password' : ''}</div>
                    {msg[r.id] && <div className={cn('mt-1 text-[11.5px] font-semibold', msg[r.id].ok ? 'text-[var(--green)]' : 'text-[var(--amber)]')}>{msg[r.id].text}</div>}
                  </td>
                  <td className="px-3 py-2.5">{r.env || '-'}</td>
                  <td className="px-3 py-2.5">{r.kind}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.roles.map((g) => <span key={g} className="rounded-md bg-[rgba(77,141,255,0.12)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--blue)]">{g}</span>)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><Switch on={r.enabled} onChange={() => void toggle(r)} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Button className="h-7 px-2.5 text-[12px]" disabled={testing === r.id} onClick={() => void test(r.id)}>
                        <ShieldCheck className="size-3.5" /> {testing === r.id ? 'Signing in…' : 'Test'}
                      </Button>
                      <Button className="h-7 px-2" title="Edit" onClick={() => setEdit({ id: r.id, hasSecret: r.has_secret, v: { ...r, secret: '' } })}><Pencil className="size-3.5" /></Button>
                      <Button tone="danger" className="h-7 px-2" title="Delete" onClick={() => void remove(r)}><Trash2 className="size-3.5" /></Button>
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

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex h-6 cursor-pointer items-center">
      <span className={cn('relative inline-flex h-5 w-9 rounded-full transition-colors', on ? 'bg-[var(--blue)]' : 'bg-[var(--row)]')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
    </button>
  )
}

function EntryForm({ value: v, hasSecret, isNew, onChange, onSave, onCancel }: {
  value: AutologinInput; hasSecret?: boolean; isNew: boolean; onChange: (v: AutologinInput) => void; onSave: () => void; onCancel: () => void
}) {
  const set = (k: keyof AutologinInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange({ ...v, [k]: e.target.value })
  // a built-in kind runs its preset steps; the steps box is for 'steps' and 'cli' only
  const setKind = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const kind = e.target.value as AutologinInput['kind']
    onChange({ ...v, kind, steps: kind === 'steps' || kind === 'cli' ? (v.steps || STEPS_EXAMPLE[kind as string]) : '' })
  }
  const kind = v.kind || 'password'
  const roles = v.roles || []
  return (
    <div className="mx-6 mt-4 rounded-[10px] border border-[var(--line2)] bg-[var(--panel2)] p-4">
      <div className="mb-2 text-[15px] font-black text-[var(--navy)]">{isNew ? 'Add account' : `Edit ${v.name}`}</div>
      <Field label="Name"><input className={BOX} value={v.name || ''} onChange={set('name')} placeholder="e.g. Jira, Ticketing QA, BTP us30" /></Field>
      <Field label="URL" hint="The page that asks for the sign-in (or the app's start page)."><input className={BOX} value={v.url || ''} onChange={set('url')} placeholder="https://..." /></Field>
      <Field label="Environment">
        <select className={cn(BOX, 'w-48')} value={v.env || ''} onChange={set('env')}>
          {['dev', 'qa', 'uat', 'prod', 'other'].map((x) => <option key={x}>{x}</option>)}
        </select>
      </Field>
      <Field label="Kind" hint={KIND_HINT[kind]}>
        <select className={cn(BOX, 'w-48')} value={kind} onChange={setKind}>
          {['password', 'sso', 'passcode', 'steps', 'cli'].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </Field>
      {(kind === 'sso' || kind === 'passcode') && (
        <Field label="Provider" hint="The text of the provider button to click, e.g. 'Microsoft', or 'default identity provider :: S00123' to pick an account.">
          <input className={BOX} value={v.provider || ''} onChange={set('provider')} />
        </Field>
      )}
      {(kind === 'steps' || kind === 'cli') && (
        <Field label="Sign-in steps" hint={STEPS_HINT}>
          <textarea className={cn(BOX, 'h-32 py-2 font-mono text-[12px]')} value={v.steps || ''} onChange={set('steps')} spellCheck={false} />
        </Field>
      )}
      <Field label="User name"><input className={BOX} value={v.username || ''} onChange={set('username')} autoComplete="off" /></Field>
      <Field label="Password" hint={hasSecret ? 'Stored. Leave empty to keep it.' : 'Write-only: it is never shown again.'}>
        <input type="password" className={BOX} value={v.secret || ''} onChange={set('secret')} autoComplete="new-password" placeholder={hasSecret ? '••••••••' : ''} />
      </Field>
      <Field label="Agents" hint="Which agent groups may sign in with this account.">
        <div className="flex flex-wrap gap-4">
          {GROUPS.map(([g, label]) => (
            <label key={g} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <Switch on={roles.includes(g)} onChange={(on) => onChange({ ...v, roles: on ? [...roles, g] : roles.filter((x) => x !== g) })} />
              {label}
            </label>
          ))}
        </div>
      </Field>
      <div className="mt-3 flex justify-end gap-2">
        <Button className="h-9 px-4" onClick={onCancel}>Cancel</Button>
        <Button tone="primary" className="h-9 px-5" disabled={!v.name?.trim() || !v.url?.trim()} onClick={onSave}>Save</Button>
      </div>
    </div>
  )
}
