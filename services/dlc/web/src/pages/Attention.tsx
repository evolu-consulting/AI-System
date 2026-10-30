import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Bot, CheckCircle2, ClipboardCheck, HelpCircle, Lightbulb, PauseCircle, RotateCcw, Sparkles } from 'lucide-react'
import { Card } from '@/components/dlc'
import { GatePanel } from '@/components/gate'
import { answerQuestions, attention as loadAttention, explainRun, resolveRun, resumeRun, retryRun } from '@/lib/dlc'
import type { Attention, HookResult, Question, RunSummary } from '@/lib/dlc'
import { profile } from '@/lib/oidc'
import { go } from '@/lib/route'

const STEP_TITLE: Record<string, string> = {
  understand: 'Understand the spec', tests: 'Write acceptance tests', plan: 'Plan the units', build: 'Build the units',
  review: 'Review', merge: 'Merge to main', qas: 'Deploy and test (QAS)',
}

const muted = { color: 'var(--muted-ink)' }

/** What a person must do for this run, in plain words, with the actions that settle it. Renders nothing when
 *  nothing is needed (and the run was never resolved). `hook` renders the hook panel the page already has. */
export function AttentionPanel({ run, onChange, hook }: { run: RunSummary; onChange: () => void; hook: (h: HookResult) => ReactNode }) {
  const [a, setA] = useState<Attention | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      setA(await loadAttention(run.id))
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [run.id])
  useEffect(() => {
    void load()
  }, [load, run.state, run.updated_ms])
  const changed = () => {
    void load()
    onChange()
  }
  if (!a) return err ? <p className="mb-3 text-[12.5px] text-[var(--red)]">{err}</p> : null
  if (a.kind === 'hook' && a.hook) return <>{hook(a.hook)}</>
  if (!a.needed && !a.resolved && !a.supervisor && !a.attempts?.length) return null
  const sv = a.supervisor
  return (
    <Card className={'mb-5 ' + (a.needed ? '!border-[#ff5f6d]' : '!border-[#36c98a]')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0" style={{ color: a.needed ? '#ff5f6d' : '#36c98a' }}>
          {a.kind === 'gate' ? <ClipboardCheck size={22} /> : a.kind === 'questions' ? <HelpCircle size={22} /> : a.kind === 'paused' ? <PauseCircle size={22} /> :
            a.needed ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="title-navy text-[18px]">{a.needed ? a.title : a.resolved ? 'Resolved' : sv?.action === 'retry' ? 'Handled by the supervisor' : a.attempts?.length ? `Attempt ${a.attempt} of this run` : 'Resolved'}</h2>
          {a.attempts && a.attempts.length > 0 && <Attempts items={a.attempts} />}
          {sv && (
            <div className="mt-2 rounded-[12px] border border-[var(--edge)] bg-[var(--head)] px-3 py-2.5 text-[13px]" style={{ color: 'var(--ink)' }}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={muted}>
                <Bot size={13} /> Supervisor {sv.action === 'retry' ? 'ran it again' : 'left it to you'}
                {sv.by === 'rule' ? ' (line rule)' : ''}{sv.ms ? ' · ' + new Date(sv.ms).toLocaleString() : ''}
              </div>
              <p>{sv.reason}</p>
              {sv.hint && <p className="mt-1 whitespace-pre-wrap rounded-lg bg-[var(--row)] px-2 py-1.5 text-[12.5px]"><b>Hint given:</b> {sv.hint}</p>}
              {sv.retired && sv.retired.length > 0 && (
                <div className="mt-1 text-[12.5px]">
                  <b>Earlier locked tests retired</b> (this request changes what they asserted):
                  <ul className="list-disc pl-5">{sv.retired.map((t) => <li key={t.test}><code>{t.test}</code> · commit {t.commit.slice(0, 8)}</li>)}</ul>
                </div>
              )}
              {sv.severity && sv.action === 'retry' && (
                <p className="mt-1 text-[12.5px]">
                  {sv.severity === 'major' ? <><b>Major failure</b>: run again one level up{sv.level ? ` (level ${sv.level})` : ''}.</> : <><b>Minor failure</b>: run again at the same level.</>}
                </p>
              )}
              {sv.new_run && (
                <p className="mt-1 text-[12.5px]">New run:{' '}
                  <button className="font-semibold text-[var(--blue)] hover:underline" onClick={() => go('run/' + encodeURIComponent(sv.new_run as string))}>{sv.new_run}</button>
                </p>
              )}
            </div>
          )}
          {a.resolved && (
            <p className="mt-1 text-[13px]" style={{ color: 'var(--ink)' }}>
              <b>{a.resolved.by}</b> marked this run resolved {new Date(a.resolved.ms).toLocaleString()}: {a.resolved.note}
            </p>
          )}
          {a.needed && (
            <div className="mt-2 grid gap-3 text-[13px] md:grid-cols-3">
              <Block label="What happened">{a.what}</Block>
              <Block label="Why">{a.why}</Block>
              <Block label="What you can do">{a.do}</Block>
            </div>
          )}
          {a.needed && (a.step || a.unit) && (
            <p className="mt-3 text-[12.5px]" style={muted}>
              Where: {a.step ? (
                <button className="font-semibold text-[var(--blue)] hover:underline"
                  onClick={() => go(`run/${encodeURIComponent(run.id)}/node/${encodeURIComponent(a.step as string)}`)}>
                  {STEP_TITLE[a.step] || a.step}
                </button>
              ) : null}{a.unit ? <> · unit <b>{a.unit}</b></> : null}{a.code ? <> · <span title="the line's code">{a.code}</span></> : null}
            </p>
          )}
          {a.needed && a.reason && (
            <blockquote className="mt-2 whitespace-pre-wrap rounded-[12px] border-l-4 border-[#ff5f6d] bg-[var(--row)] px-3 py-2 text-[12.5px]" style={{ color: 'var(--ink)' }}>
              {a.reason}
            </blockquote>
          )}
          {a.kind === 'failed' && a.needed && <Explain run={run} a={a} onDone={load} />}
          {a.retried_by && (
            <p className="mt-3 text-[12.5px]" style={muted}>
              Started again as{' '}
              <button className="font-semibold text-[var(--blue)] hover:underline" onClick={() => go('run/' + encodeURIComponent(a.retried_by as string))}>
                {a.retried_by}
              </button>
            </p>
          )}
          {a.kind === 'gate' && a.gate && <GatePanel run={run} gate={a.gate} onDone={changed} />}
          {a.kind === 'questions' && <Questions run={run} items={a.questions || []} onDone={changed} />}
          {a.kind === 'paused' && <Resume run={run} onDone={changed} />}
          {a.kind === 'failed' && a.needed && <FailedActions run={run} onDone={changed} />}
        </div>
      </div>
    </Card>
  )
}

/** A run retried in place keeps its id: each earlier attempt, why it failed and who ran it again. */
function Attempts({ items }: { items: NonNullable<Attention['attempts']> }) {
  return (
    <div className="mt-2 rounded-[12px] border border-[var(--edge)] bg-[var(--head)] px-3 py-2.5 text-[12.5px]" style={{ color: 'var(--ink)' }}>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={muted}>
        <RotateCcw size={13} /> Earlier attempts of this run
      </div>
      <ul className="space-y-1.5">
        {items.map((t) => (
          <li key={t.n}>
            <b>Attempt {t.n}</b> failed{t.code ? <> (<span title="the line's code">{t.code}</span>)</> : null}: {t.message}
            <div style={muted}>
              Run again by {t.actor || t.by}{t.ms ? ' · ' + new Date(t.ms).toLocaleString() : ''}
              {t.level_up ? <> · <b>one level up, to level {t.level_up}</b></> : t.level ? <> · same level ({t.level})</> : null}
            </div>
            {t.hint && <p className="mt-0.5 whitespace-pre-wrap rounded-lg bg-[var(--row)] px-2 py-1">{t.hint}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-[12px] bg-[var(--row)] px-3 py-2.5">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={muted}>{label}</div>
      <div style={{ color: 'var(--ink)' }}>{children}</div>
    </div>
  )
}

function useAct(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
      onDone()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return { busy, err, act }
}

function Explain({ run, a, onDone }: { run: RunSummary; a: Attention; onDone: () => void }) {
  const { busy, err, act } = useAct(onDone)
  if (a.explain) {
    return (
      <div className="mt-3 rounded-[12px] border border-[var(--edge)] bg-[var(--head)] px-3 py-2.5 text-[13px]" style={{ color: 'var(--ink)' }}>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={muted}><Lightbulb size={13} /> In plain words</div>
        <p>{a.explain.what}</p>
        <p className="mt-1">{a.explain.why}</p>
        {a.explain.next.length > 0 && (
          <ul className="mt-1 list-disc pl-5">{a.explain.next.map((n, i) => <li key={i}>{n}</li>)}</ul>
        )}
      </div>
    )
  }
  return (
    <div className="mt-3">
      <button className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-[12.5px]" disabled={busy} onClick={() => act(() => explainRun(run.id))}>
        <Sparkles size={13} /> {busy ? 'Explaining…' : 'Explain in plain words'}
      </button>
      {err && <p className="mt-1 text-[12px] text-[var(--red)]">{err}</p>}
    </div>
  )
}

function FailedActions({ run, onDone }: { run: RunSummary; onDone: () => void }) {
  const [hint, setHint] = useState('')
  const [note, setNote] = useState('')
  const { busy, err, act } = useAct(onDone)
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <div className="rounded-[12px] border border-[var(--edge)] p-3">
        <div className="text-[13px] font-bold" style={{ color: 'var(--navy)' }}>Run it again</div>
        <p className="mt-0.5 text-[12px]" style={muted}>
          This same run goes on from the step it failed in (what was done stays). Add what the agents should know
          this time (optional): it goes into the request.
        </p>
        <textarea className="field-glass mt-2 block min-h-[72px] w-full resize-y px-3 py-2 text-[12.5px]" value={hint} onChange={(e) => setHint(e.target.value)}
          placeholder="e.g. The acceptance test must set NOTES_FILE to a temporary file." />
        <button className="btn-primary mt-2 flex items-center gap-1.5 px-3.5 py-2 text-[12.5px]" disabled={busy}
          onClick={() => act(async () => {
            await retryRun(run.id, hint)
          })}>
          <RotateCcw size={14} /> Run again
        </button>
      </div>
      <div className="rounded-[12px] border border-[var(--edge)] p-3">
        <div className="text-[13px] font-bold" style={{ color: 'var(--navy)' }}>Mark resolved</div>
        <p className="mt-0.5 text-[12px]" style={muted}>
          You fixed it yourself, or it is not needed any more. The warning goes; your note is kept for the next runs.
        </p>
        <textarea className="field-glass mt-2 block min-h-[72px] w-full resize-y px-3 py-2 text-[12.5px]" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="How was it settled?" />
        <button className="btn-ghost mt-2 flex items-center gap-1.5 px-3.5 py-2 text-[12.5px]" disabled={busy || !note.trim()}
          onClick={() => act(() => resolveRun(run.id, note))}>
          <CheckCircle2 size={14} /> Mark resolved
        </button>
      </div>
      {err && <p className="text-[12px] text-[var(--red)] md:col-span-2">{err}</p>}
    </div>
  )
}

function Resume({ run, onDone }: { run: RunSummary; onDone: () => void }) {
  const { busy, err, act } = useAct(onDone)
  return (
    <div className="mt-3">
      <button className="btn-primary px-3.5 py-2 text-[12.5px]" disabled={busy} onClick={() => act(() => resumeRun(run.id))}>Resume the run</button>
      {err && <p className="mt-1 text-[12px] text-[var(--red)]">{err}</p>}
    </div>
  )
}

function Questions({ run, items, onDone }: { run: RunSummary; items: Question[]; onDone: () => void }) {
  const open = items.filter((q) => !q.answer && q.state !== 'answered')
  const [pick, setPick] = useState<Record<string, string>>({})
  const [text, setText] = useState<Record<string, string>>({})
  const { busy, err, act } = useAct(onDone)
  if (!open.length) return <p className="mt-3 text-[12.5px]" style={muted}>No open question left; the run goes on.</p>
  const ready = open.every((q) => pick[q.qid] || (text[q.qid] || '').trim())
  return (
    <div className="mt-4 flex flex-col gap-3">
      {open.map((q) => (
        <div key={q.qid} className="rounded-[12px] border border-[var(--edge)] p-3">
          <div className="text-[13px] font-semibold" style={{ color: 'var(--navy)' }}>{q.decision || q.qid}</div>
          {q.f_items && q.f_items.length > 0 && <div className="text-[11.5px]" style={muted}>About {q.f_items.join(', ')}</div>}
          <div className="mt-2 flex flex-col gap-1.5">
            {(q.options || []).map((o) => (
              <label key={o.id} className="flex cursor-pointer items-start gap-2 text-[12.5px]" style={{ color: 'var(--ink)' }}>
                <input type="radio" name={q.qid} className="mt-0.5" checked={pick[q.qid] === o.id}
                  onChange={() => setPick((p) => ({ ...p, [q.qid]: o.id }))} />
                <span>
                  {o.text}
                  {q.recommended === o.id && <span className="ml-1.5 rounded-full bg-[#36c98a1a] px-2 py-0.5 text-[10.5px] font-bold text-[#36c98a]">recommended</span>}
                  {o.impact && <span className="block text-[11.5px]" style={muted}>{o.impact}</span>}
                </span>
              </label>
            ))}
          </div>
          <input className="field-glass mt-2 h-9 w-full px-3 text-[12.5px]" placeholder="Or answer in your own words" value={text[q.qid] || ''}
            onChange={(e) => setText((t) => ({ ...t, [q.qid]: e.target.value }))} />
        </div>
      ))}
      <div>
        <button className="btn-primary px-3.5 py-2 text-[12.5px]" disabled={busy || !ready}
          onClick={() => act(() => answerQuestions(run.id, open.map((q) => ({ qid: q.qid, option: pick[q.qid] || 'other', text: (text[q.qid] || '').trim() || undefined })), profile()?.name || 'a person'))}>
          Send answers
        </button>
        {err && <p className="mt-1 text-[12px] text-[var(--red)]">{err}</p>}
      </div>
    </div>
  )
}
