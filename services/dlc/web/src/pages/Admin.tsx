import { Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GROUP_MIME, WorkflowCanvas } from '@/canvas/WorkflowCanvas'
import type { Doc } from '@/canvas/WorkflowCanvas'
import { Shell } from '@/components/dlc'
import { SidecarsView } from '@/pages/Sidecars'
import { ProcessesView } from '@/pages/Processes'
import { BOX, Button, Chip, Field } from '@/components/ui'
import { api, can, useMe } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getChangeQueues, getClaudeToken, setClaudeToken, setQueueWait } from '@/lib/dlc'
import type { ChangeQueue, ClaudeToken, QueueSlot } from '@/lib/dlc'
import { go } from '@/lib/route'
import { ROLES } from '@/lib/types'
import type { Agent, AuditRow, Env, Group, KhTool, Lane, Provider, Role, Settings, Template, User, UserRole, Workflow } from '@/lib/types'

export type AdminSection = 'agents' | 'groups' | 'workflows' | 'templates' | 'users' | 'settings' | 'claude' | 'queue' | 'sidecars' | 'processes' | 'audit'
type Section = AdminSection

export function Admin({ section, id }: { section: Section; id?: string }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [tools, setTools] = useState<KhTool[]>([])
  const [flash, setFlash] = useState('')

  const reload = useCallback(async () => {
    const [a, g, w] = await Promise.all([
      api.get<{ items: Agent[] }>('/agents'),
      api.get<{ items: Group[] }>('/groups'),
      api.get<{ items: Workflow[] }>('/workflows'),
    ])
    setAgents(a.items)
    setGroups(g.items)
    setWorkflows(w.items)
  }, [])

  useEffect(() => {
    reload()
    api.get<{ providers: Provider[] }>('/llm').then((d) => setProviders(d.providers))
    api.get<{ tools: KhTool[] }>('/tools').then((d) => setTools(d.tools))
  }, [reload])

  const say = (t: string) => {
    setFlash(t)
    setTimeout(() => setFlash(''), 2500)
  }

  const { user } = useMe()

  const add = async (s: Section) => {
    if (s === 'agents') {
      const a = await api.post<Agent>('/agents', {
        name: 'New Agent',
        llmType: 'claude-cli',
        model: 'sonnet',
        args: providers[0]?.defaultArgs || [],
        tools: null,
      })
      await reload()
      go(`admin/agents/${a.id}`)
    } else if (s === 'groups') {
      const g = await api.post<Group>('/groups', { name: 'New Step', agentIds: [] })
      await reload()
      go(`admin/groups/${g.id}`)
    } else if (s === 'workflows') {
      const w = await api.post<Workflow>('/workflows', { name: 'New Process', kind: 'feature', doc: { nodes: [], edges: [] } })
      await reload()
      go(`admin/workflows/${w.id}`)
    }
  }

  const remove = async (s: Section, itemId: string) => {
    await api.del(`/${s}/${itemId}`)
    await reload()
    go(`admin/${s}`)
  }

  const current =
    section === 'agents'
      ? agents.find((a) => a.id === id) || agents[0]
      : section === 'groups'
        ? groups.find((g) => g.id === id) || groups[0]
        : workflows.find((w) => w.id === id) || workflows[0]

  return (
    <Shell fill extra={{
      'admin/workflows': {
        onAdd: () => add('workflows'),
        subs: workflows.map((w) => ({ key: w.id, label: w.name, href: `admin/workflows/${w.id}`, onRemove: () => remove('workflows', w.id) })),
      },
      'admin/groups': {
        onAdd: () => add('groups'),
        subs: groups.map((g) => ({ key: g.id, label: g.name, href: `admin/groups/${g.id}`, onRemove: () => remove('groups', g.id) })),
      },
      'admin/agents': { onAdd: () => add('agents') },
    }}>
      {!can(user, 'admin') && (
        <p className="mx-6 mt-4 rounded-md border border-[var(--amber)]/30 bg-[var(--amber)]/10 px-3 py-1.5 text-[12px] font-bold text-[var(--amber)]">
          You can look, but only an admin can change the process, agents, users and settings.
        </p>
      )}
      <section className="relative min-h-0 flex-1 overflow-hidden">
        {flash && (
          <div className="absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-xl border border-[var(--line2)] bg-[var(--head)] px-4 py-2 text-[12.5px] font-bold text-[var(--blue)] shadow-[0_10px_30px_rgba(77,141,255,0.2)]">
            {flash}
          </div>
        )}
        {section === 'agents' && (
          <AgentEditor
            key={(current as Agent)?.id}
            agent={current as Agent | undefined}
            agents={agents}
            providers={providers}
            tools={tools}
            onSaved={async (msg) => {
              await reload()
              say(msg)
            }}
            onRemove={(aid) => remove('agents', aid)}
          />
        )}
        {section === 'groups' && current && (
          <GroupEditor
            key={current.id}
            group={current as Group}
            agents={agents}
            onSaved={async (msg) => {
              await reload()
              say(msg)
            }}
          />
        )}
        {section === 'workflows' && current && (
          <WorkflowEditor
            key={current.id}
            workflow={current as Workflow}
            groups={groups}
            agents={agents}
            onSaved={async (msg) => {
              await reload()
              say(msg)
            }}
          />
        )}
        {section === 'templates' && <TemplatesEditor workflows={workflows} say={say} />}
        {section === 'users' && <UsersEditor say={say} />}
        {section === 'settings' && <SettingsEditor say={say} />}
        {section === 'claude' && <ClaudeTokenEditor say={say} />}
        {section === 'queue' && <ChangeQueueView say={say} />}
        {section === 'sidecars' && <SidecarsView id={id} />}
        {section === 'processes' && <ProcessesView id={id} />}
        {section === 'audit' && <AuditView />}
      </section>
    </Shell>
  )
}

/** On/off switch. */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className="flex h-8 cursor-pointer items-center gap-2.5 text-[13px]">
      <span className={cn('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-[var(--blue)]' : 'bg-[rgba(77,141,255,0.18)]')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
      {label}
    </button>
  )
}

function Header({ title, onSave, busy, extra }: { title: string; onSave: () => void; busy?: boolean; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 pt-5">
      <h2 className="title-navy text-[22px]">{title}</h2>
      <div className="flex items-center gap-2">
        {extra}
        <Button tone="primary" className="h-10 rounded-[14px] px-7 text-[14.5px]" onClick={onSave} disabled={busy}>
          Save
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ agents

interface EnvRow {
  name: string
  value: string
  hint: string
}

function AgentEditor({
  agent,
  agents,
  providers,
  tools,
  onSaved,
  onRemove,
}: {
  agent?: Agent
  agents: Agent[]
  providers: Provider[]
  tools: KhTool[]
  onSaved: (msg: string) => void
  onRemove: (id: string) => void
}) {
  const [name, setName] = useState(agent?.name || '')
  const [llmType, setLlmType] = useState(agent?.llmType || 'claude-cli')
  const [model, setModel] = useState(agent?.model || 'sonnet')
  const [args, setArgs] = useState((agent?.args || []).join(' '))
  const [env, setEnv] = useState<EnvRow[]>((agent?.env || []).map((e) => ({ name: e.name, value: '', hint: e.hint })))
  const [sel, setSel] = useState<string[] | null>(agent?.tools ?? null)
  const [role, setRole] = useState(agent?.rolePrompt || '')
  const [busy, setBusy] = useState(false)
  const provider = providers.find((p) => p.id === llmType) || providers[0]
  const chosen = sel === null ? tools.map((t) => t.key) : sel
  const available = tools.filter((t) => !chosen.includes(t.key))

  if (!agent) return <div className="p-6 text-[13px] text-muted-foreground">No agents yet. Use + next to Agents.</div>

  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/agents/${agent.id}`, {
        name,
        llmType,
        model,
        args: args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [],
        env: env.filter((e) => e.name.trim()).map((e) => ({ name: e.name.trim(), value: e.value })),
        tools: sel,
        rolePrompt: role,
      })
      onSaved(`Saved ${name}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Header
        title="Generic Agents"
        onSave={save}
        busy={busy}
        extra={
          <Button tone="ghost" className="text-[12px]" onClick={() => confirm(`Delete ${agent.name}?`) && onRemove(agent.id)}>
            Delete agent
          </Button>
        }
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-8 overflow-y-auto px-6 pb-6 pt-4">
        <div>
          <Field label="Agent Name">
            <input className={BOX} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="LLM Type">
            <select className={BOX} value={llmType} onChange={(e) => setLlmType(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default model">
            <select className={BOX} value={model} onChange={(e) => setModel(e.target.value)}>
              {(provider?.models || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Arguments" hint="Passed to the CLI after -p --output-format json. Remove --setting-sources project to run with the full KH hooks of your Claude profile.">
            <input className={cn(BOX, 'font-mono text-[12px]')} value={args} onChange={(e) => setArgs(e.target.value)} />
          </Field>
          <Field label="Environments" hint={`Values are stored on this machine and shown masked. ${provider?.tokenEnv || ''} carries a Claude login token.`}>
            <div className="space-y-2">
              {env.map((row, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-2">
                  <input
                    className={cn(BOX, 'font-mono text-[12px]')}
                    value={row.name}
                    placeholder="NAME"
                    onChange={(e) => setEnv(env.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                  />
                  <input
                    className={cn(BOX, 'font-mono text-[12px]')}
                    type="password"
                    value={row.value}
                    placeholder={row.hint || 'value'}
                    onChange={(e) => setEnv(env.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                  />
                  <button className="cursor-pointer text-muted-foreground hover:text-[var(--red)]" onClick={() => setEnv(env.filter((_, j) => j !== i))}>
                    <Minus className="size-4" />
                  </button>
                </div>
              ))}
              <Button tone="ghost" className="h-7 text-[12px]" onClick={() => setEnv([...env, { name: env.length ? '' : provider?.tokenEnv || '', value: '', hint: '' }])}>
                <Plus className="size-3.5" /> Add variable
              </Button>
            </div>
          </Field>
          <Field label="Role">
            <textarea className={cn(BOX, 'h-24 py-2')} value={role} onChange={(e) => setRole(e.target.value)} placeholder="What this agent owns and how it works" />
          </Field>
          <Field label="Advanced Tools" hint={sel === null ? 'All KH tools are allowed (default). Remove a chip to restrict.' : `${chosen.length} of ${tools.length} KH tools allowed.`}>
            <div className="min-h-[120px] rounded-xl border border-[rgba(77,141,255,0.14)] bg-[var(--row)] p-2.5">
              <div className="flex flex-wrap gap-1.5">
                {chosen.map((k) => (
                  <Chip key={k} onRemove={() => setSel(chosen.filter((x) => x !== k))}>
                    {tools.find((t) => t.key === k)?.name || k}
                  </Chip>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                {available.length > 0 && (
                  <select
                    className={cn(BOX, 'h-7 w-56 text-[12px]')}
                    value=""
                    onChange={(e) => e.target.value && setSel([...chosen, e.target.value])}
                  >
                    <option value="">+ add a KH tool…</option>
                    {available.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
                {sel !== null && (
                  <Button tone="ghost" className="h-7 text-[12px]" onClick={() => setSel(null)}>
                    Allow all
                  </Button>
                )}
              </div>
            </div>
          </Field>
        </div>
        <div className="h-fit min-h-[420px] rounded-[18px] border border-[var(--line2)] bg-[var(--panel2)] p-3">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => go(`admin/agents/${a.id}`)}
              className={cn(
                'mb-1 block w-full cursor-pointer rounded-full px-3 py-1.5 text-left text-[14px] font-semibold',
                a.id === agent.id ? 'bg-[var(--head)] font-bold text-[var(--blue)] shadow-[0_4px_12px_rgba(77,141,255,0.12)]' : 'text-[var(--ink)] hover:bg-[rgba(77,141,255,0.08)]',
              )}
            >
              {a.name}
              <span className="ml-2 text-[11px] font-normal text-muted-foreground">{a.model}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ groups

function GroupEditor({ group, agents, onSaved }: { group: Group; agents: Agent[]; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(group.name)
  const [ids, setIds] = useState(group.agentIds)
  const [workspace, setWorkspace] = useState(group.workspace)
  const [goal, setGoal] = useState(group.goal)
  const [gate, setGate] = useState(group.humanGate)
  const [rounds, setRounds] = useState(group.maxRounds)
  const [lane, setLane] = useState<Lane>(group.lane)
  const [role, setRole] = useState<Role>(group.role)
  const [approval, setApproval] = useState(group.approval)
  const [verify, setVerify] = useState(group.verifyTests)
  const [estimate, setEstimate] = useState(group.estimateMin)
  const approvers = (group.approvers || []).join(', ')   // kept as is: titles return with people management
  const [env, setEnv] = useState<Env>(group.env || '')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const name_of = (id: string) => agents.find((a) => a.id === id)?.name || id
  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/groups/${group.id}`, {
        name,
        agentIds: ids,
        workspace,
        goal,
        humanGate: gate,
        maxRounds: rounds,
        lane,
        role,
        approval,
        verifyTests: verify,
        estimateMin: estimate,
        approvers: approvers.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
        env,
      })
      setErr('')
      onSaved(`Saved ${name}`)
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full flex-col">
      <Header title={name || 'Step'} onSave={save} busy={busy} />
      {err && <p className="mx-6 mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--red)]">{err}</p>}
      <div className="overflow-y-auto px-6 pb-6 pt-4">
        <Field label="Name">
          <input className={BOX} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Agents" hint="Turn order; the first agent leads and closes the step.">
          <div className="flex min-h-[46px] flex-wrap items-center gap-1.5 rounded-xl border border-[rgba(77,141,255,0.14)] bg-[var(--row)] p-2">
            {ids.map((id, i) => (
              <Chip key={id} tone={i === 0 ? 'lead' : 'default'} onRemove={() => setIds(ids.filter((x) => x !== id))}>
                {name_of(id)}
              </Chip>
            ))}
            <select className="h-7 cursor-pointer rounded-md bg-transparent px-1 text-[12px] text-muted-foreground outline-none" value="" onChange={(e) => e.target.value && setIds([...ids, e.target.value])}>
              <option value="">+ add agent</option>
              {agents
                .filter((a) => !ids.includes(a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </div>
        </Field>
        <Field label="Workspace" hint="Shared working folder. Placeholders: {project_folder} {project_slug} {run_slug} {group_slug}.">
          <input className={cn(BOX, 'font-mono text-[12px]')} value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
        </Field>
        <Field label="Goal">
          <textarea className={cn(BOX, 'h-24 py-2')} value={goal} onChange={(e) => setGoal(e.target.value)} />
        </Field>
        <Field label="Asks the user" hint="On: the step waits for a person to answer; any signed-in user can. Off: fully automatic.">
          <Toggle on={gate} onChange={setGate} label={gate ? 'Human in the loop' : 'Fully automatic'} />
        </Field>
        <Field label="View" hint="Whose step this is: the project manager's (scope, plan, UAT, close) or the developer's (spec, design, build, review, test).">
          <select className={cn(BOX, 'w-56')} value={lane} onChange={(e) => setLane(e.target.value as Lane)}>
            <option value="pm">PM</option>
            <option value="dev">Developer</option>
          </select>
        </Field>
        <Field
          label="Role"
          hint="intake: signs off the scope items. plan: PLAN.md, risks, test command. work: builds. review/test/uat: a fail verdict sends work back along the rework arrow (a reviewer must not be the builder). close: release notes and lessons."
        >
          <select className={cn(BOX, 'w-56')} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Approval" hint="On: when the lead agent closes the step, a person must Approve (or Reject) before the run goes on; any signed-in user can.">
          <Toggle on={approval} onChange={setApproval} label={approval ? 'A person approves' : 'No approval'} />
        </Field>
        <Field label="Environment" hint="When the step closes, the build is recorded as running in this environment (DEV -> QAS -> PRD).">
          <select className={cn(BOX, 'w-40')} value={env} onChange={(e) => setEnv(e.target.value as Env)}>
            <option value="">none</option>
            <option value="dev">DEV</option>
            <option value="qas">QAS</option>
            <option value="prd">PRD</option>
          </select>
        </Field>
        <Field label="Verify tests" hint="On: the server re-runs the project's test command after this step. A failure is a fail verdict, whatever the agent reported.">
          <Toggle on={verify} onChange={setVerify} label={verify ? 'Server runs the tests' : 'Agent result only'} />
        </Field>
        <Field label="Estimate (min)" hint="The baseline: a run's due time is the sum of its steps plus 50%; slipping past it turns health amber or red.">
          <input type="number" min={1} className={cn(BOX, 'w-24')} value={estimate} onChange={(e) => setEstimate(Number(e.target.value) || 1)} />
        </Field>
        <Field label="Max rounds" hint="Rounds of turns before the lead must close the step.">
          <input type="number" min={1} max={6} className={cn(BOX, 'w-24')} value={rounds} onChange={(e) => setRounds(Number(e.target.value) || 1)} />
        </Field>
        <Field label="KH (hidden)">
          <p className="pt-1.5 text-[12px] text-muted-foreground">
            Agents of this group share the run's KH project (sdlc-&lt;project&gt;), run in KH AUTO, and every message is mirrored to kh-message.
          </p>
        </Field>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ workflows

function WorkflowEditor({ workflow, groups, agents, onSaved }: { workflow: Workflow; groups: Group[]; agents: Agent[]; onSaved: (msg: string) => void }) {
  const [name, setName] = useState(workflow.name)
  const [kind, setKind] = useState(workflow.kind)
  const [doc, setDoc] = useState<Doc>(workflow.doc)
  const [mode, setMode] = useState<'next' | 'rework'>('next')
  const [versions, setVersions] = useState<{ version: number; createdAt: string; createdBy: string }[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    api.get<{ items: { version: number; createdAt: string; createdBy: string }[] }>(`/workflows/${workflow.id}/versions`).then((d) => setVersions(d.items))
  }, [workflow.id, workflow.version])
  const agentNames = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents])
  const save = async () => {
    setErr('')
    try {
      await api.put(`/workflows/${workflow.id}`, { name, kind, doc })
      onSaved(`Saved ${name}`)
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  return (
    <div className="flex h-full flex-col">
      <Header
        title={`${name} · v${workflow.version}`}
        onSave={save}
        extra={
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-[10px] border border-[var(--line2)] bg-[var(--panel2)] p-[3px] text-[12px]" title="What a new arrow means">
              <button className={cn('cursor-pointer rounded-lg px-3 py-1.5', mode === 'next' ? 'bg-[var(--head)] font-bold text-[var(--blue)] shadow-[0_2px_6px_rgba(77,141,255,0.15)]' : 'text-[var(--ink)]')} onClick={() => setMode('next')}>
                Next arrow
              </button>
              <button className={cn('cursor-pointer px-3 py-1.5', mode === 'rework' ? 'bg-orange-500/30 text-orange-100' : 'text-muted-foreground')} onClick={() => setMode('rework')}>
                Rework arrow
              </button>
            </div>
            <input className={cn(BOX, 'w-48')} value={name} onChange={(e) => setName(e.target.value)} />
            <select className={cn(BOX, 'w-32')} value={kind} onChange={(e) => setKind(e.target.value as 'feature' | 'bugfix')}>
              <option value="feature">Feature</option>
              <option value="bugfix">Bug fix</option>
            </select>
          </div>
        }
      />
      {err && <p className="mx-6 mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--red)]">{err}</p>}
      <div className="min-h-0 flex-1 px-2 pt-2">
        <WorkflowCanvas doc={doc} groups={groups} agentNames={agentNames} onChange={setDoc} mode={mode} />
      </div>
      <p className="mx-6 mt-1 text-[11px] text-muted-foreground">
        Saving makes version v{workflow.version + 1}; runs already started keep the version they started on.
        {versions.length > 0 &&
          ' History: ' +
            versions
              .slice(0, 6)
              .map((v) => `v${v.version} ${new Date(v.createdAt).toLocaleDateString()}${v.createdBy ? ' by ' + v.createdBy : ''}`)
              .join(' · ')}
      </p>
      <div className="mx-4 mb-3 flex flex-wrap items-center justify-center gap-2.5 rounded-[10px] border border-[var(--line2)] bg-[var(--row)] px-3 py-2.5"
        title="Drag a step onto the canvas · connect right handle to left handle · Rework arrow mode: draw from a review/test/UAT step back to the step that redoes the work · Delete removes">
        {groups.map((g) => (
          <div
            key={g.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(GROUP_MIME, g.id)
              e.dataTransfer.effectAllowed = 'move'
            }}
            className={cn(
              'cursor-grab rounded-xl border px-4 py-2 text-[12px] font-semibold shadow-[0_6px_14px_rgba(77,141,255,0.15)] active:cursor-grabbing',
              g.lane === 'pm' ? 'border-purple-400/40 bg-purple-500/20 text-purple-300' : 'border-[var(--line2)] bg-gradient-to-br from-[var(--row)] to-[var(--head)] text-[var(--navy)]',
            )}
          >
            {g.name}
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ templates

function TemplatesEditor({ workflows, say }: { workflows: Workflow[]; say: (m: string) => void }) {
  const [items, setItems] = useState<Template[]>([])
  const load = useCallback(() => api.get<{ items: Template[] }>('/templates').then((d) => setItems(d.items)), [])
  useEffect(() => {
    load()
  }, [load])
  const save = async (t: Template) => {
    await api.put(`/templates/${t.id}`, t)
    say(`Saved ${t.name}`)
    load()
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Project templates</h2>
        <Button onClick={() => api.post('/templates', { name: 'New template', workflowId: 'wf-new-system' }).then(load)}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
      <p className="mb-4 text-[12px] text-muted-foreground">
        A new project starts from a template (its process, test command and budget) or duplicates another project's settings. Editing a template
        never changes projects already created.
      </p>
      <div className="space-y-3">
        {items.map((t) => (
          <TemplateRow key={t.id} t={t} workflows={workflows} onSave={save} onDelete={() => api.del(`/templates/${t.id}`).then(load)} />
        ))}
      </div>
    </div>
  )
}

function TemplateRow({ t, workflows, onSave, onDelete }: { t: Template; workflows: Workflow[]; onSave: (t: Template) => void; onDelete: () => void }) {
  const [v, setV] = useState(t)
  return (
    <div className="grid grid-cols-[1fr_1fr_160px_100px_auto] items-end gap-2 rounded-xl border border-[var(--line2)] bg-[var(--panel2)] p-3">
      <label className="text-[11px] text-muted-foreground">
        Name
        <input className={cn(BOX, 'mt-1')} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </label>
      <label className="text-[11px] text-muted-foreground">
        Test command
        <input className={cn(BOX, 'mt-1 font-mono text-[12px]')} value={v.testCommand} onChange={(e) => setV({ ...v, testCommand: e.target.value })} />
      </label>
      <label className="text-[11px] text-muted-foreground">
        Process
        <select className={cn(BOX, 'mt-1')} value={v.workflowId} onChange={(e) => setV({ ...v, workflowId: e.target.value })}>
          {workflows.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-[11px] text-muted-foreground">
        Budget $
        <input className={cn(BOX, 'mt-1')} type="number" min={0} value={v.budgetUsd} onChange={(e) => setV({ ...v, budgetUsd: Number(e.target.value) || 0 })} />
      </label>
      <div className="flex gap-1">
        <Button onClick={() => onSave(v)}>Save</Button>
        <Button tone="ghost" onClick={() => confirm(`Delete ${t.name}?`) && onDelete()}>
          <Minus className="size-4" />
        </Button>
      </div>
      <label className="col-span-5 text-[11px] text-muted-foreground">
        Description
        <input className={cn(BOX, 'mt-1')} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
      </label>
    </div>
  )
}

// ------------------------------------------------------------------ users

function UsersEditor({ say }: { say: (m: string) => void }) {
  const [items, setItems] = useState<User[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('member')
  const [titles, setTitles] = useState('')
  const [token, setToken] = useState<{ name: string; token: string } | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(
    () =>
      api.get<{ items: User[] }>('/users').then(
        (d) => setItems(d.items),
        (e) => setErr(e.message),
      ),
    [],
  )
  useEffect(() => {
    load()
  }, [load])
  const create = async () => {
    try {
      const u = await api.post<User>('/users', { name, email, role, titles })
      setToken({ name: u.name, token: u.token || '' })
      setName('')
      setEmail('')
      load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  const update = async (u: User, body: Record<string, unknown>) => {
    const out = await api.put<User>(`/users/${u.id}`, { role: u.role, email: u.email, disabled: u.disabled, ...body })
    if (out.token) setToken({ name: u.name, token: out.token })
    say(`Saved ${u.name}`)
    load()
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <h2 className="text-[16px] font-semibold">Users and roles</h2>
      <p className="mb-4 mt-1 text-[12px] text-muted-foreground">
        With no users the tool is a one-person local tool and everyone is admin. Creating the first user switches every page to sign-in with a
        token, so create yourself as admin first and keep the token. viewer reads; member starts work, chats, attaches, raises changes; lead
        approves, rejects, pauses, cancels and edits registers; admin changes the process, users and settings.
      </p>
      {token && (
        <div className="mb-4 rounded-xl border border-green-400/25 bg-green-500/10 px-3 py-2 text-[12px] text-[var(--green)]">
          Token for <b>{token.name}</b> (shown once, hand it over privately): <code className="select-all">{token.token}</code>
        </div>
      )}
      {err && <p className="mb-3 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--red)]">{err}</p>}
      <div className="mb-5 flex items-end gap-2">
        <label className="text-[11px] text-muted-foreground">
          Name
          <input className={cn(BOX, 'mt-1 w-48')} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-[11px] text-muted-foreground">
          E-mail (KH notices go here)
          <input className={cn(BOX, 'mt-1 w-64')} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Role
          <select className={cn(BOX, 'mt-1 w-32')} value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {['viewer', 'member', 'lead', 'admin'].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-muted-foreground">
          Sign-off titles
          <input className={cn(BOX, 'mt-1 w-56')} value={titles} onChange={(e) => setTitles(e.target.value)} placeholder="business lead, pmo, client" />
        </label>
        <Button tone="primary" disabled={!name.trim()} onClick={create}>
          Create
        </Button>
      </div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[11px] uppercase text-muted-foreground">
            <th className="py-1">Name</th>
            <th>E-mail</th>
            <th>Role</th>
            <th>Sign-off titles</th>
            <th>Active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id} className="border-t border-[rgba(77,141,255,0.08)]">
              <td className="py-1.5">{u.name}</td>
              <td className="text-muted-foreground">{u.email || '-'}</td>
              <td>
                <select className={cn(BOX, 'h-7 w-28')} value={u.role} onChange={(e) => update(u, { role: e.target.value })}>
                  {['viewer', 'member', 'lead', 'admin'].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  className={cn(BOX, 'h-7 w-56')}
                  defaultValue={(u.titles || []).join(', ')}
                  onBlur={(e) => e.target.value !== (u.titles || []).join(', ') && update(u, { titles: e.target.value })}
                />
              </td>
              <td>
                <input type="checkbox" checked={!u.disabled} onChange={(e) => update(u, { disabled: !e.target.checked })} />
              </td>
              <td className="text-right">
                <Button
                  tone="ghost"
                  className="h-7 text-[12px]"
                  onClick={() => confirm(`New token for ${u.name}? The old one stops working.`) && update(u, { resetToken: true })}
                >
                  New token
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------------ settings

function SettingsEditor({ say }: { say: (m: string) => void }) {
  const [s, setS] = useState<Settings | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    api.get<Settings>('/settings').then(setS)
  }, [])
  if (!s) return null
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: Number(e.target.value) || 0 })
  const save = async () => {
    try {
      setS(await api.put<Settings>('/settings', s))
      setErr('')
      say('Settings saved')
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  return (
    <div className="flex h-full flex-col">
      <Header title="Settings" onSave={save} />
      {err && <p className="mx-6 mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--red)]">{err}</p>}
      <div className="overflow-y-auto px-6 pb-6 pt-4">
        <Field
          label="Reminder ladder (min)"
          hint="A step waiting for a person: nudge the run owner, then tell the project owner, then escalate (an escalation item and red health). The PM App uses +1/+3/+5 days for people; agents move faster."
        >
          <div className="flex gap-2">
            {s.ladderMinutes.map((m, i) => (
              <input
                key={i}
                type="number"
                min={1}
                className={cn(BOX, 'w-24')}
                value={m}
                onChange={(e) => setS({ ...s, ladderMinutes: s.ladderMinutes.map((x, j) => (j === i ? Number(e.target.value) || 1 : x)) })}
              />
            ))}
          </div>
        </Field>
        <Field label="Change request signatures" hint="In order; a change is approved when the last one signs (PM Works: steering committee, then client).">
          <input
            className={BOX}
            value={(s.crApprovers || []).join(', ')}
            onChange={(e) => setS({ ...s, crApprovers: e.target.value.split(',').map((x) => x.trim().toLowerCase()) })}
          />
        </Field>
        <Field label="Max rework" hint="How many times review, test or UAT may send the same work back before the step fails.">
          <input type="number" min={0} className={cn(BOX, 'w-24')} value={s.maxRework} onChange={num('maxRework')} />
        </Field>
        <Field label="Max concurrent calls" hint="Agent CLI calls running at once across all projects (rate limits, spend spikes). Takes effect on restart.">
          <input type="number" min={1} className={cn(BOX, 'w-24')} value={s.maxConcurrent} onChange={num('maxConcurrent')} />
        </Field>
        <Field label="Daily digest hour" hint="Local hour after which each active project gets its daily check-in line (notification + KH log).">
          <input type="number" min={0} max={23} className={cn(BOX, 'w-24')} value={s.digestHour} onChange={num('digestHour')} />
        </Field>
        <Field label="Test timeout (s)" hint="Longest the server waits for the test command.">
          <input type="number" min={10} className={cn(BOX, 'w-24')} value={s.testTimeoutSec} onChange={num('testTimeoutSec')} />
        </Field>
        <Field label="Earned vs burn" hint="Variance of % done minus % of budget spent: within amber% green, up to red% amber, worse red.">
          <div className="flex items-center gap-2 text-[12px]">
            amber <input type="number" min={1} className={cn(BOX, 'w-20')} value={s.burnAmberPct} onChange={num('burnAmberPct')} />
            red <input type="number" min={1} className={cn(BOX, 'w-20')} value={s.burnRedPct} onChange={num('burnRedPct')} />
          </div>
        </Field>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Claude token

const TOKEN_SOURCE: Record<ClaudeToken['source'], string> = {
  file: 'set here',
  service: 'from the install (service setting)',
  none: 'not set: agents cannot run',
}

/** The setup-token every DLC agent signs in with: tested with a real call on the engine host, used from the
 *  next agent call on (no restart). Needs the dlc-admin role. */
function ClaudeTokenEditor({ say }: { say: (m: string) => void }) {
  const [st, setSt] = useState<ClaudeToken | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    getClaudeToken().then(setSt).catch((e) => setErr(String((e as Error).message)))
  }, [])
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      setSt(await setClaudeToken(token.trim()))
      setToken('')
      say('Token tested and saved')
    } catch (e) {
      setErr(String((e as Error).message))
    }
    setBusy(false)
  }
  return (
    <div className="flex h-full flex-col">
      <Header title="Claude token" onSave={save} busy={busy || !token.trim()} />
      {err && <p className="mx-6 mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--red)]">{err}</p>}
      <div className="overflow-y-auto px-6 pb-6 pt-4">
        <Field label="In use" hint="The token every agent signs in with.">
          <p className="text-[13px]">
            {st ? TOKEN_SOURCE[st.source] : '…'}
            {st?.hint && <> · <code>{st.hint}</code></>}
            {st && st.set_ms > 0 && <span className="text-muted-foreground"> · {new Date(st.set_ms).toLocaleString()}{st.set_by ? ' by ' + st.set_by : ''}</span>}
          </p>
          {st?.rejected && (
            <p className="mt-1 text-[12px] font-semibold text-[var(--red)]">
              Refused by Claude at {new Date(st.rejected.ms).toLocaleString()}: {st.rejected.message}. Set a new token below.
            </p>
          )}
        </Field>
        <Field label="New setup-token" hint="Run 'claude setup-token' on any machine signed in to the Claude account the agents should use (it makes a token valid for a year), paste it here and Save: it is tested with a real call first. Do not copy the token from a person's Claude profile: that one is a short-lived access token (about 8 hours) and dies when the profile refreshes it.">
          <input type="password" autoComplete="off" className={BOX} value={token} placeholder="sk-ant-oat01-..."
            onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && token.trim() && !busy && save()} />
        </Field>
        {busy && <p className="text-[12px] text-muted-foreground">Testing the token…</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ change queue

const SLOT_STATE: Record<QueueSlot['state'], string> = {
  reserved: 'in design (not in the queue yet)',
  planned: 'approved, waits its turn',
  implementing: 'building / testing / merging',
  done: 'done',
  dropped: 'left the queue',
  ignored: 'ignored (its run stops)',
}

/** Every project's change queue: runs design in parallel; a run joins the queue when its drafts are approved
 *  (first approved, first served) and builds, tests, merges and delivers in queue order. How each process queues is
 *  its definition's "queue" block (Admin > AI-SDLC processes). The wait limit only matters for slots written by an
 *  engine before 0.7. Needs the dlc-admin role to change. */
function ChangeQueueView({ say }: { say: (m: string) => void }) {
  const [data, setData] = useState<{ wait_minutes: number; projects: ChangeQueue[] } | null>(null)
  const [wait, setWait] = useState('')
  const [edited, setEdited] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(() => {
    getChangeQueues().then((d) => {
      setData(d)
      setWait((w) => (edited ? w : String(d.wait_minutes)))
    }, (e) => setErr(String((e as Error).message)))
  }, [edited])
  useEffect(() => {
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [load])
  const save = async () => {
    setBusy(true)
    setErr('')
    try {
      const out = await setQueueWait(Number(wait))
      setWait(String(out.wait_minutes))
      setEdited(false)
      say('Wait limit saved')
      load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
    setBusy(false)
  }
  const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleTimeString() : '')
  const live = (s: QueueSlot) => ['reserved', 'planned', 'implementing'].includes(s.state)
  const shown = (data?.projects ?? []).filter((q) => q.active.length || q.recent.length)
  return (
    <div className="flex h-full flex-col">
      <Header title="Change queue" onSave={save} busy={busy || !/^\d+$/.test(wait.trim())} />
      {err && <p className="mx-6 mt-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--red)]">{err}</p>}
      <div className="overflow-y-auto px-6 pb-6 pt-4">
        <Field label="Wait limit (minutes)" hint="Since DLC 0.7 a run joins the queue only when its spec and plans are approved (first approved, first served), so nobody waits for a run that is still in design and nothing is ignored; when a run joins, the drafts still waiting for approval are written again on top of it. This limit is kept only for slots of runs started by an older engine. Where each process queues from, and until when a run holds its place: Admin > AI-SDLC processes, the process's change queue.">
          <input className={BOX + ' max-w-[160px]'} inputMode="numeric" value={wait} onChange={(e) => { setEdited(true); setWait(e.target.value) }} />
        </Field>
        {shown.map((q) => (
          <div key={q.project} className="mb-5">
            <h3 className="mb-1.5 text-[14px] font-semibold">{q.project}</h3>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase text-muted-foreground">
                  <th className="py-1 pr-2">#</th><th className="pr-2">Run</th><th className="pr-2">Flow</th><th className="pr-2">State</th>
                  <th className="pr-2">Request</th><th className="pr-2">Pushed</th><th>Times</th>
                </tr>
              </thead>
              <tbody>
                {[...q.active, ...q.recent.slice().reverse()].map((s) => (
                  <tr key={s.id} className={cn('border-t border-[rgba(77,141,255,0.08)] align-top', !live(s) && 'opacity-55')}>
                    <td className="py-1 pr-2 font-mono" title={'slot ' + s.seq}>{s.order ?? '-'}</td>
                    <td className="pr-2 font-mono">{s.run}</td>
                    <td className="pr-2">{s.flow}</td>
                    <td className="whitespace-nowrap pr-2">{SLOT_STATE[s.state]}{s.ignored_by ? ` by ${s.ignored_by} after ${s.waited_min} min` : ''}</td>
                    <td className="max-w-[420px] truncate pr-2" title={s.summary}>{s.summary}</td>
                    <td className="pr-2">{s.docs.join(', ')}</td>
                    <td className="whitespace-nowrap text-muted-foreground">
                      {[s.created_ms, s.planned_ms, s.started_ms, s.ended_ms].filter(Boolean).map((ms) => when(ms)).join(' → ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {data && !shown.length && <p className="text-[12.5px] text-muted-foreground">No project has queued a change yet.</p>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ audit

function AuditView() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [err, setErr] = useState('')
  useEffect(() => {
    api.get<{ items: AuditRow[] }>('/audit?limit=300').then(
      (d) => setRows(d.items),
      (e) => setErr(e.message),
    )
  }, [])
  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <h2 className="mb-3 text-[16px] font-semibold">Audit trail</h2>
      {err && <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-[var(--red)]">{err}</p>}
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-left text-[11px] uppercase text-muted-foreground">
            <th className="py-1">When</th>
            <th>Who</th>
            <th>What</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-[rgba(77,141,255,0.08)] align-top">
              <td className="whitespace-nowrap py-1 pr-3 text-muted-foreground">{new Date(r.ts).toLocaleString()}</td>
              <td className="pr-3">{r.actor}</td>
              <td className="pr-3 font-mono">{r.action}</td>
              <td className="max-w-[600px] truncate text-muted-foreground" title={r.detail}>
                {r.detail}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
