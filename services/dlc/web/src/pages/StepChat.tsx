import { ArrowDown, Check, CornerUpLeft, FastForward, FileUp, GitPullRequestArrow, Paperclip, RotateCcw, SendHorizontal, Ticket, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Avatar, BOX, Button, Dialog, Label, LaneTag, RagDot, STATUS_TEXT, StatusIcon, TopBar } from '@/components/ui'
import { api, can, fileToBase64, useMe } from '@/lib/api'
import { cn } from '@/lib/cn'
import { go } from '@/lib/route'
import type { Message, Project, Run, Step } from '@/lib/types'

export function StepChat({ runId, pos }: { runId: number; pos: number }) {
  const { user } = useMe()
  const [run, setRun] = useState<Run | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [step, setStep] = useState<Step | null>(null)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const [dialog, setDialog] = useState<'' | 'reject' | 'change' | 'jira' | 'rerun'>('')
  const lastSeq = useRef(0)
  const scroller = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const follow = useRef(true)

  // Reset when the step changes.
  useEffect(() => {
    lastSeq.current = 0
    setMessages([])
    follow.current = true
  }, [runId, pos])

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ run: Run; project: Project }>(`/runs/${runId}`)
      setRun(r.run)
      setProject(r.project)
      const m = await api.get<{ step: Step; messages: Message[] }>(`/runs/${runId}/steps/${pos}/messages?after=${lastSeq.current}`)
      setStep(m.step)
      if (m.messages.length) {
        lastSeq.current = m.messages[m.messages.length - 1].seq
        setMessages((old) => [...old, ...m.messages])
      }
      setErr('')
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [runId, pos])

  useEffect(() => {
    load()
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const el = scroller.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  }, [messages])

  const active = run && !['done', 'failed', 'cancelled'].includes(run.status)
  const isCurrent = !!run && run.currentPos === pos && !!active
  const thinking = step?.status === 'running'
  const canSend = isCurrent && can(user, 'member')
  const hasRework = !!(run && step && run.rework[step.nodeId])

  const doPost = async (path: string, body?: unknown) => {
    try {
      await api.post(path, body)
      setErr('')
      load()
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }

  const send = async () => {
    const content = text.trim()
    if (!content) return
    setText('')
    follow.current = true
    await doPost(`/runs/${runId}/messages`, { content })
  }

  const attach = async (files: FileList | null) => {
    for (const f of Array.from(files || [])) {
      await doPost(`/runs/${runId}/attachments`, { name: f.name, data: await fileToBase64(f) })
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  // Agents alternate sides in order of first appearance, people are always right.
  const sides: Record<string, 'left' | 'right'> = {}
  let n = 0
  for (const m of messages) {
    if (m.senderKind === 'agent' && !(m.senderName in sides)) sides[m.senderName] = n++ % 2 === 0 ? 'left' : 'right'
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar here="" />
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-6 pb-5 pt-4">
        <header className="mb-3 flex items-center justify-between">
          <h1 className="text-[20px] font-semibold tracking-tight">{project?.name || 'Project'}</h1>
          <Button className="h-9 rounded-xl px-6 text-[14px]" onClick={() => go('')}>
            Back
          </Button>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] gap-5">
          <aside className="flex min-h-0 flex-col overflow-y-auto rounded-lg border border-white/10 bg-white/[0.04]">
            {project && (
              <div className="border-b border-white/10 bg-card px-4 py-3">
                {project.envs && project.envs.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {project.envs.map((e) => (
                      <span key={e.name} className="rounded border border-sky-400/40 px-1.5 text-[10px] text-sky-100" title={`${e.version || ''} ${e.promotedAt || ''}`}>
                        {e.name}: {(e.version || '').split(' (')[0] || '-'}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 text-[14px] font-semibold">
                  <RagDot rag={project.health?.rag} reasons={project.health?.reasons} />
                  {project.name}
                </div>
                <div className="mt-1 flex gap-4 pl-4 text-[12px] font-semibold">
                  <span>Total {project.total}</span>
                  <span>Done {project.completed}</span>
                  <span>Doing {project.doing}</span>
                </div>
              </div>
            )}
            {run && (
              <div className="px-4 py-3">
                <div
                  className={cn(
                    'mx-auto mb-2 w-fit rounded-full border px-3 py-0.5 text-[11px]',
                    run.kind === 'bugfix' ? 'border-orange-400/60 bg-orange-500/80 text-neutral-950' : 'border-white/15 bg-white/[0.08]',
                  )}
                >
                  {run.kind === 'bugfix' ? 'Bug fix' : 'Feature'} #{run.id}: {run.title}
                </div>
                <div className="mb-3 flex flex-wrap justify-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <RagDot rag={run.health?.rag} reasons={run.health?.reasons} label />
                  <span>{STATUS_TEXT[run.status]}</span>
                  <span>P{run.priority}</span>
                  {run.owner && <span>owner {run.owner}</span>}
                  {run.externalKey && <span className="font-mono">{run.externalKey}</span>}
                </div>
                {run.health && run.health.reasons.length > 0 && (
                  <ul className="mb-3 list-disc space-y-0.5 pl-4 text-[11px] text-amber-200/80">
                    {run.health.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-col items-center">
                  {run.steps.map((s, i) => (
                    <div key={s.id} className="flex w-full flex-col items-center">
                      {i > 0 && <ArrowDown className="my-0.5 size-4 text-white/50" />}
                      <button
                        onClick={() => go(`runs/${run.id}/steps/${s.position}`)}
                        className={cn(
                          'flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] transition-colors',
                          s.position === pos ? 'ring-2 ring-white/40' : '',
                          s.status === 'running' || s.status === 'waiting_human'
                            ? 'border-green-500/80 bg-green-500/80 text-neutral-950'
                            : s.status === 'awaiting_approval'
                              ? 'border-purple-400/70 bg-purple-500/30'
                              : s.status === 'failed'
                                ? 'border-red-400/50 bg-red-500/15'
                                : s.status === 'rework'
                                  ? 'border-orange-400/40 bg-orange-500/10'
                                  : 'border-white/15 bg-white/[0.08] hover:bg-white/[0.12]',
                        )}
                        title={STATUS_TEXT[s.status]}
                      >
                        <StatusIcon status={s.status} className={s.status === 'running' || s.status === 'waiting_human' ? 'text-neutral-950' : ''} />
                        <LaneTag lane={s.lane} />
                        {s.groupName}
                        {s.attempt > 1 && <span className="text-[10px]">×{s.attempt}</span>}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-center text-[11px] text-muted-foreground">
                  {run.workflowName}
                  {run.workflowVersion ? ` v${run.workflowVersion}` : ''} · run {STATUS_TEXT[run.status].toLowerCase()}
                </div>

                {run.scope && run.scope.length > 0 && (
                  <Panel title="Signed-off scope">
                    {run.scope.map((s) => (
                      <div key={s.ref} className="flex gap-2 py-0.5 text-[12px]" title={(s.acceptance ? 'Acceptance: ' + s.acceptance + '\n' : '') + (s.evidence || '')}>
                        <span className="w-7 shrink-0 font-mono text-muted-foreground">{s.ref}</span>
                        <span className="min-w-0 flex-1">{s.text}</span>
                        <span className={cn('shrink-0 text-[10px] uppercase', s.status === 'met' ? 'text-green-300' : s.status === 'not_met' ? 'text-red-300' : 'text-muted-foreground')}>
                          {s.status.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </Panel>
                )}
                {run.registers && run.registers.length > 0 && (
                  <Panel title="Registers of this run" action={<button className="cursor-pointer text-[11px] text-sky-300 hover:underline" onClick={() => go(`governance/${run.projectId}`)}>all</button>}>
                    {run.registers.slice(0, 14).map((i) => (
                      <div key={i.id} className="flex gap-2 py-0.5 text-[12px]" title={i.detail || i.mitigation}>
                        <span className="w-10 shrink-0 font-mono text-muted-foreground">{i.ref}</span>
                        <span className="min-w-0 flex-1 truncate">{i.title}</span>
                        <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{i.status}</span>
                      </div>
                    ))}
                  </Panel>
                )}
                {run.attachments && run.attachments.length > 0 && (
                  <Panel title="Attachments">
                    {run.attachments.map((a) => (
                      <div key={a.id} className="truncate py-0.5 font-mono text-[11px]" title={a.path}>
                        {a.name} <span className="text-muted-foreground">({Math.ceil(a.size / 1024)} KB)</span>
                      </div>
                    ))}
                  </Panel>
                )}
              </div>
            )}
          </aside>

          <section className="flex min-h-0 flex-col">
            {step && (
              <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                <StatusIcon status={step.status} />
                <LaneTag lane={step.lane} />
                <span className="font-medium text-foreground">
                  Step {step.position}: {step.groupName}
                  {step.attempt > 1 && ` (attempt ${step.attempt})`}
                </span>
                {step.env && <span className="rounded border border-sky-400/40 px-1.5 text-sky-200">{step.env.toUpperCase()}</span>}
                <span>{STATUS_TEXT[step.status]}</span>
                {step.verdict && (
                  <span className={cn('rounded border px-1.5', step.verdict === 'pass' ? 'border-green-400/40 text-green-200' : 'border-orange-400/40 text-orange-200')}>
                    verdict {step.verdict}
                  </span>
                )}
                {step.forced && <span className="rounded border border-amber-400/40 px-1.5 text-amber-200">summary forced</span>}
                {step.approvedBy && <span className="rounded border border-green-400/30 px-1.5 text-green-200">approved by {step.approvedBy}</span>}
                <div className="ml-auto flex gap-2">
                  {step.status === 'waiting_human' && can(user, 'member') && (
                    <Button className="h-7 text-[12px]" onClick={() => doPost(`/runs/${runId}/steps/${pos}/proceed`)}>
                      <FastForward className="size-3.5" /> Continue
                    </Button>
                  )}
                  {step.status === 'failed' && can(user, 'member') && (
                    <Button tone="danger" className="h-7 text-[12px]" onClick={() => doPost(`/runs/${runId}/steps/${pos}/retry`)}>
                      <RotateCcw className="size-3.5" /> Retry
                    </Button>
                  )}
                  {step.status === 'done' && step.nodeId && can(user, 'lead') && run?.status !== 'cancelled' && (
                    <Button tone="ghost" className="h-7 text-[12px]" onClick={() => setDialog('rerun')} title="Re-do the work from this step">
                      <CornerUpLeft className="size-3.5" /> Re-run from here
                    </Button>
                  )}
                </div>
              </div>
            )}

            {step?.status === 'awaiting_approval' && (
              <div className="mb-3 rounded-lg border border-purple-400/40 bg-purple-500/10 px-4 py-3 text-[13px]">
                <div className="mb-1 font-semibold text-purple-100">
                  {step.forced
                    ? 'The lead never closed this step: its summary was forced. Approve it as it is, or reject it.'
                    : step.approvers && step.approvers.length
                      ? `${step.groupName} needs the sign-off of: ${step.approvers.join(', ')}. Each person signs under a title they hold.`
                      : `${step.groupName} needs a lead's approval before the run goes on.`}
                </div>
                {step.summary?.summary && <p className="text-foreground/90">{step.summary.summary}</p>}
                {step.approvers && step.approvers.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="text-muted-foreground">Sign-offs:</span>
                    {step.approvers.map((t) => {
                      const signed = (step.signoffs || []).find((x) => x.title === t && x.decision === 'approved')
                      return (
                        <span
                          key={t}
                          className={cn('rounded-full border px-2 py-0.5', signed ? 'border-green-400/50 bg-green-500/15 text-green-100' : 'border-white/20')}
                          title={signed ? `${signed.approver} ${new Date(signed.at).toLocaleString()}` : 'waiting'}
                        >
                          {signed ? '✓ ' : ''}
                          {t}
                          {signed ? ` · ${signed.approver}` : ''}
                        </span>
                      )
                    })}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {step.approvers && step.approvers.length > 0 ? (
                    (step.waitingFor || []).map((t) => (
                      <Button key={t} tone="good" onClick={() => doPost(`/runs/${runId}/steps/${pos}/approve`, { note: '', title: t })}>
                        <Check className="size-4" /> Sign as {t}
                      </Button>
                    ))
                  ) : can(user, 'lead') ? (
                    <Button tone="good" onClick={() => doPost(`/runs/${runId}/steps/${pos}/approve`, { note: '' })}>
                      <Check className="size-4" /> Approve
                    </Button>
                  ) : null}
                  {(can(user, 'lead') || (step.approvers || []).some((t) => (user?.titles || []).includes(t))) && (
                    <Button tone="danger" onClick={() => setDialog('reject')}>
                      <X className="size-4" /> Reject…
                    </Button>
                  )}
                </div>
                {!can(user, 'lead') && !(step.approvers || []).length && (
                  <p className="mt-2 text-[12px] text-muted-foreground">A lead must approve this step.</p>
                )}
              </div>
            )}

            <div
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget
                follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
              }}
              className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-2"
            >
              {messages.length === 0 && !thinking && (
                <p className="pt-10 text-center text-[13px] text-muted-foreground">
                  {step?.status === 'pending' ? 'This step has not started yet.' : 'No messages in this step.'}
                </p>
              )}
              {messages.map((m) => (
                <Bubble key={m.seq} m={m} side={m.senderKind === 'human' ? 'right' : sides[m.senderName] || 'left'} />
              ))}
              {thinking && (
                <div className="flex items-center gap-3 pl-2 text-[12px] text-muted-foreground">
                  <span className="flex gap-1">
                    <i className="size-1.5 animate-pulse rounded-full bg-white/60" />
                    <i className="size-1.5 animate-pulse rounded-full bg-white/60 [animation-delay:150ms]" />
                    <i className="size-1.5 animate-pulse rounded-full bg-white/60 [animation-delay:300ms]" />
                  </span>
                  agents are working…
                </div>
              )}
              {step?.verify && (
                <details className={cn('rounded-lg border px-4 py-2 text-[12px]', step.verify.passed ? 'border-green-400/25 bg-green-500/[0.05]' : 'border-red-400/30 bg-red-500/[0.07]')}>
                  <summary className="cursor-pointer">
                    Server test run: <b>{step.verify.passed ? 'PASS' : 'FAIL'}</b> · <code>{step.verify.command || 'no command'}</code>
                    {step.verify.exit !== null && ` · exit ${step.verify.exit}`}
                    {step.verify.seconds !== undefined && ` · ${step.verify.seconds}s`}
                    {step.verify.claimed === true && !step.verify.passed && <span className="ml-2 text-red-300">(the agent claimed it passed)</span>}
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{step.verify.output}</pre>
                </details>
              )}
              {(step?.status === 'done' || step?.status === 'rework') && step.summary?.summary && (
                <div className={cn('rounded-lg border px-4 py-3 text-[13px]', step.status === 'rework' ? 'border-orange-400/25 bg-orange-500/[0.06]' : 'border-green-400/25 bg-green-500/[0.06]')}>
                  <div className={cn('mb-1 text-[11px] font-semibold uppercase tracking-wide', step.status === 'rework' ? 'text-orange-300' : 'text-green-300')}>
                    {step.status === 'rework' ? 'Verdict fail: work sent back' : 'Step summary (pushed to dashboard and KH)'}
                  </div>
                  {step.summary.summary}
                </div>
              )}
              {step?.error && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">{step.error}</div>}
            </div>
            {err && <p className="mt-2 text-[12px] text-red-300">{err}</p>}
            <div className="mt-3 rounded-lg border border-white/12 bg-white/[0.06] p-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send()
                    }
                  }}
                  disabled={!canSend}
                  rows={3}
                  placeholder={
                    isCurrent
                      ? step?.status === 'waiting_human'
                        ? 'The agents are waiting for your answer…'
                        : step?.status === 'awaiting_approval'
                          ? 'Comment (Approve or Reject above moves the run on)'
                          : 'Steer the agents: your message reaches them on their next turn'
                      : 'This step is not the active one'
                  }
                  className="min-h-[64px] flex-1 resize-none bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                />
                <button
                  onClick={send}
                  disabled={!canSend || !text.trim()}
                  className="grid size-11 cursor-pointer place-items-center rounded-full text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
                  title="Send"
                >
                  <SendHorizontal className="size-7" />
                </button>
              </div>
              {active && can(user, 'member') && (
                <div className="mt-2 flex gap-1 border-t border-white/8 pt-2">
                  <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => attach(e.target.files)} />
                  <Button tone="ghost" className="h-7 text-[12px]" onClick={() => fileInput.current?.click()} title="Attach a SOW, ticket, spreadsheet… (max 15 MB)">
                    <Paperclip className="size-3.5" /> Attach file
                  </Button>
                  <Button tone="ghost" className="h-7 text-[12px]" onClick={() => setDialog('change')} title="Raise a change request: the agents assess its impact, a lead approves it">
                    <GitPullRequestArrow className="size-3.5" /> Change request
                  </Button>
                  <Button tone="ghost" className="h-7 text-[12px]" onClick={() => setDialog('jira')} title="Pull a Jira issue into this conversation (read-only)">
                    <Ticket className="size-3.5" /> Pull Jira issue
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      {dialog === 'reject' && (
        <RejectDialog
          hasRework={hasRework}
          onClose={() => setDialog('')}
          onSubmit={(note, sendBack) => doPost(`/runs/${runId}/steps/${pos}/reject`, { note, sendBack }).then(() => setDialog(''))}
        />
      )}
      {dialog === 'change' && <ChangeDialog onClose={() => setDialog('')} onSubmit={(title, detail) => doPost(`/runs/${runId}/changes`, { title, detail }).then(() => setDialog(''))} />}
      {dialog === 'jira' && <JiraDialog initial={run?.externalKey || ''} onClose={() => setDialog('')} onSubmit={(key) => doPost(`/runs/${runId}/jira`, { key }).then(() => setDialog(''))} />}
      {dialog === 'rerun' && step && (
        <TextDialog
          title={`Re-run from '${step.groupName}'`}
          label="Why? The agents of the re-done steps read this first."
          action="Re-run"
          onClose={() => setDialog('')}
          onSubmit={(reason) => doPost(`/runs/${runId}/steps/${pos}/rerun`, { reason }).then(() => setDialog(''))}
        />
      )}
    </div>
  )
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-md border border-white/10 bg-card px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
        {action}
      </div>
      {children}
    </div>
  )
}

function RejectDialog({ hasRework, onClose, onSubmit }: { hasRework: boolean; onClose: () => void; onSubmit: (note: string, sendBack: boolean) => void }) {
  const [note, setNote] = useState('')
  const [sendBack, setSendBack] = useState(hasRework)
  return (
    <Dialog title="Reject this step" onClose={onClose}>
      <Label text="What is wrong? The agents read this.">
        <textarea autoFocus className={cn(BOX, 'h-28 py-2')} value={note} onChange={(e) => setNote(e.target.value)} />
      </Label>
      {hasRework && (
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px]">
          <input type="checkbox" checked={sendBack} onChange={(e) => setSendBack(e.target.checked)} />
          Send the work back along the rework arrow (otherwise this step's own agents redo it)
        </label>
      )}
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="danger" disabled={!note.trim()} onClick={() => onSubmit(note.trim(), sendBack)}>
          Reject
        </Button>
      </div>
    </Dialog>
  )
}

function ChangeDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (title: string, detail: string) => void }) {
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  return (
    <Dialog title="Change request" onClose={onClose}>
      <p className="mb-3 text-[12px] text-muted-foreground">
        It goes into the change register. While the run is active its agents assess the impact on scope, time and cost. A lead approves it in
        Governance and may re-run the work from an earlier step; approved changes are added to the scope.
      </p>
      <div className="space-y-3">
        <Label text="Title">
          <input autoFocus className={BOX} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Label>
        <Label text="What should change, and why">
          <textarea className={cn(BOX, 'h-28 py-2')} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Label>
      </div>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="primary" disabled={!title.trim()} onClick={() => onSubmit(title.trim(), detail.trim())}>
          Raise
        </Button>
      </div>
    </Dialog>
  )
}

function JiraDialog({ initial, onClose, onSubmit }: { initial: string; onClose: () => void; onSubmit: (key: string) => void }) {
  const [key, setKey] = useState(initial)
  return (
    <Dialog title="Pull a Jira issue" onClose={onClose}>
      <Label text="Issue key (read-only; the summary and description go into this conversation)">
        <input autoFocus className={cn(BOX, 'font-mono')} value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="ABC-123" />
      </Label>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="primary" disabled={!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)} onClick={() => onSubmit(key)}>
          <FileUp className="size-4" /> Pull
        </Button>
      </div>
    </Dialog>
  )
}

export function TextDialog({ title, label, action, onClose, onSubmit }: { title: string; label: string; action: string; onClose: () => void; onSubmit: (text: string) => void }) {
  const [text, setText] = useState('')
  return (
    <Dialog title={title} onClose={onClose}>
      <Label text={label}>
        <textarea autoFocus className={cn(BOX, 'h-24 py-2')} value={text} onChange={(e) => setText(e.target.value)} />
      </Label>
      <div className="flex justify-end gap-2 pt-4">
        <Button tone="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button tone="primary" disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>
          {action}
        </Button>
      </div>
    </Dialog>
  )
}

// The protocol markers are for the engine; the STEP_DONE json is shown as the step summary card instead.
function visible(content: string): string {
  const cut = content.search(/^\s*\**STEP_DONE\**\s*$/m)
  const text = cut >= 0 ? content.slice(0, cut) : content
  return text.replace(/^\s*\**NEED_HUMAN\**\s*$/gm, '').trim() || '(step closed)'
}

function Bubble({ m, side }: { m: Message; side: 'left' | 'right' }) {
  if (m.senderKind === 'system') {
    return <div className="whitespace-pre-wrap text-center text-[11px] text-muted-foreground">{m.content}</div>
  }
  const human = m.senderKind === 'human'
  return (
    <div className={cn('flex items-start gap-3', side === 'right' && 'flex-row-reverse')}>
      <Avatar name={m.senderName} human={human} />
      <div className={cn('flex max-w-[75%] flex-col', side === 'right' && 'items-end')}>
        <div className="mb-1 px-2 text-[11px] text-muted-foreground">
          {m.senderName} · {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <div
          className={cn(
            'prose-chat rounded-2xl border px-4 py-3 text-[13px] leading-relaxed',
            human ? 'border-white/15 bg-white/[0.14]' : 'border-white/10 bg-card',
          )}
        >
          <Markdown remarkPlugins={[remarkGfm]}>{visible(m.content)}</Markdown>
        </div>
      </div>
    </div>
  )
}
