import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, Check, ChevronDown, ChevronRight, FileText, Pencil, RefreshCw, Send, Upload, User, X } from 'lucide-react'
import { AWAITING } from '@/components/dlc'
import { chatGate, decideGate, fileToBase64 } from '@/lib/dlc'
import type { Ask, ChatMessage, Gate, GateDoc, GateFile, RunSummary } from '@/lib/dlc'
import { profile } from '@/lib/oidc'

// A person's step of the gated flow (engine line.gates). What they read first is short: what the agent understood,
// what it will and will not do, and the points it decided alone, each to agree with or change. The full documents
// are one click away. When the step allows it (the definition's gate "chat": true), the same content is the start
// of a conversation with the step's agents, and the decision is taken inside it.

const muted = { color: 'var(--muted-ink)' }
const DECISION_LABEL: Record<string, string> = {
  approve: 'Approve', revise: 'Send back to rewrite', deploy: 'Deploy', hold: 'Hold (do not deploy)',
}
const GATE_FILES = '.pdf,.docx,.md,.markdown,.txt,.csv,.json,.xml,.yml,.yaml,.html,.htm'
const ROLE_LABEL: Record<string, string> = {
  spec_analyst: 'Spec Agent', domain_agent: 'Domain Agent', test_author: 'QC Agent', reviewer: 'Reviewer',
}

type Answer = { ok: boolean; text: string; editing?: boolean }
const keyOf = (a: Ask) => a.artifact + ':' + a.id

export function GatePanel({ run, gate, onDone }: { run: RunSummary; gate: Gate; onDone: () => void }) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const asks = gate.asks || []
  useEffect(() => setAnswers({}), [gate.name, gate.round])
  const thinking = (gate.messages || []).some((m) => m.state === 'thinking')
  useEffect(() => {                                     // the agent's answer comes on its own: look again
    if (!thinking) return
    const id = window.setInterval(onDone, 2500)
    return () => window.clearInterval(id)
  }, [thinking, onDone])
  const brief = <Brief gate={gate} />
  const points = asks.length > 0 && <Points asks={asks} answers={answers} setAnswers={setAnswers} />
  const decide = <Decide run={run} gate={gate} answers={answers} onDone={onDone} busyChat={thinking} />
  if (gate.chat) return <ChatWindow run={run} gate={gate} brief={brief} points={points} decide={decide} onSent={onDone} />
  return (
    <div className="mt-4 flex flex-col gap-3">
      {brief}
      {points}
      {decide}
    </div>
  )
}

// ------------------------------------------------------------------ what the agent understood

function Brief({ gate }: { gate: Gate }) {
  const withGlance = gate.docs.filter((d) => d.glance)
  const last = gate.refreshed?.[gate.refreshed.length - 1]
  return (
    <div className="flex flex-col gap-3">
      {last && (
        <div className="flex items-start gap-2 rounded-[12px] border border-[#8b6cf055] bg-[#8b6cf012] px-3 py-2 text-[12.5px]" style={{ color: 'var(--ink)' }}>
          <RefreshCw size={14} className="mt-0.5 shrink-0" color="#8b6cf0" />
          <span>
            Written again on top of the change queue ({new Date(last.ms).toLocaleTimeString()}): it now builds on{' '}
            {last.took.map((t, i) => (
              <span key={t.run}>{i > 0 && ', '}<b>#{t.seq}</b> {t.gone ? '(left the queue: no longer built on)' : ''}<span style={muted}> {t.run}</span></span>
            ))}.
          </span>
        </div>
      )}
      {withGlance.map((d) => <Glance key={d.id} doc={d} titled={gate.docs.filter((x) => x.glance).length > 1} />)}
      {withGlance.length === 0 && gate.docs.some((d) => !d.id.startsWith('@') && ['checks', 'drift', 'needs', 'metrics', 'rounds', 'findings'].indexOf(d.id) < 0) && (
        <p className="text-[12.5px]" style={muted}>The agent wrote no short summary for this step: read the documents below.</p>
      )}
      <Documents docs={gate.docs} open={withGlance.length === 0} />
    </div>
  )
}

function Glance({ doc, titled }: { doc: GateDoc; titled: boolean }) {
  const g = doc.glance!
  const col = (label: string, items: string[], tone?: string) => (
    <div className="min-w-0 rounded-[12px] px-3 py-2.5" style={{ background: tone ? tone + '12' : 'var(--row)', border: tone ? `1px solid ${tone}44` : undefined }}>
      <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wide" style={{ color: tone || 'var(--muted-ink)' }}>{label}</div>
      {items.length ? (
        <ul className="flex flex-col gap-1 text-[12.5px] leading-snug" style={{ color: 'var(--ink)' }}>
          {items.map((t, i) => <li key={i} className="flex gap-1.5"><span style={{ color: tone || 'var(--muted-ink)' }}>•</span><span><Inline text={t} /></span></li>)}
        </ul>
      ) : <span className="text-[12.5px]" style={muted}>nothing</span>}
    </div>
  )
  const leftOut = g.will_not.filter((t) => !/^nothing\.?$/i.test(t.trim()))
  // orange only when something of the request is really left out (a point to decide), not for "nothing is left out"
  const warn = leftOut.some((t) => /(Q|A)\d+/.test(t) && !/nothing (is )?left out/i.test(t))
  return (
    <div>
      {titled && <div className="mb-1 text-[12px] font-bold" style={{ color: 'var(--navy)' }}>{doc.title}</div>}
      <div className="mb-2">{col('What the agent understood', g.understood)}</div>
      <div className="grid gap-2 md:grid-cols-2">
        {col('Will do', g.will_do)}
        {col('Will not do', leftOut, warn ? AWAITING : undefined)}
      </div>
    </div>
  )
}

function Inline({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <>{children}</> }}>{text}</ReactMarkdown>
}

function Documents({ docs, open }: { docs: GateDoc[]; open: boolean }) {
  const [shown, setShown] = useState<string>(open ? docs[0]?.id || '' : '')
  if (!docs.length) return null
  const doc = docs.find((d) => d.id === shown)
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {docs.map((d) => (
          <button key={d.id} onClick={() => setShown(shown === d.id ? '' : d.id)}
            className={'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold ' + (shown === d.id ? 'border-[var(--blue)] text-[var(--blue)]' : 'border-[var(--edge)] text-[var(--muted-ink)] hover:text-[var(--blue)]')}>
            {shown === d.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <FileText size={13} /> {d.title}
            {d.text ? <span className="font-normal" style={muted}>{Math.max(1, Math.round(d.text.length / 1024))} KB</span> : null}
            {d.edited_ms ? <span className="rounded-full bg-[#4d8dff1a] px-1.5 text-[10.5px] text-[var(--blue)]">changed in chat</span> : null}
          </button>
        ))}
      </div>
      {doc && (
        <div className="field-glass prose-chat mt-2 max-h-[520px] overflow-auto px-4 py-3 text-[13px]">
          {doc.text ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.text}</ReactMarkdown> : <span style={muted}>Nothing written.</span>}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ the points the agent decided alone

function Points({ asks, answers, setAnswers }: {
  asks: Ask[]; answers: Record<string, Answer>; setAnswers: (f: (a: Record<string, Answer>) => Record<string, Answer>) => void
}) {
  const done = asks.filter((a) => ready(a, answers[keyOf(a)])).length
  const set = (k: string, v: Answer) => setAnswers((cur) => ({ ...cur, [k]: v }))
  return (
    <div className="rounded-[14px] border border-[var(--edge)] p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[13px] font-bold" style={{ color: 'var(--navy)' }}>Decisions for you</span>
        <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: done === asks.length ? 'var(--green)' : AWAITING, background: (done === asks.length ? '#36c98a' : AWAITING) + '1a' }}>
          {done}/{asks.length}
        </span>
        <span className="text-[11.5px]" style={muted}>the agent decided these alone: agree, or say what you want instead</span>
      </div>
      <ul className="flex flex-col gap-2">
        {asks.map((a) => {
          const k = keyOf(a)
          const v = answers[k]
          const open = a.status === 'open'
          const editing = open || v?.editing || (v && !v.ok)
          return (
            <li key={k} className="rounded-[12px] bg-[var(--row)] px-3 py-2">
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-0.5 rounded-md px-1.5 text-[11px] font-bold" style={{ background: (open ? AWAITING : '#4d8dff') + '1a', color: open ? AWAITING : 'var(--blue)' }}>{a.id}</span>
                <div className="min-w-0 flex-1 text-[12.5px]" style={{ color: 'var(--ink)' }}>
                  <div className="font-semibold"><Inline text={a.question || a.id} /></div>
                  {a.answer && <div className="mt-0.5" style={muted}><span className="font-semibold">{open ? 'Missing: ' : 'Agent proposes: '}</span><Inline text={a.answer} /></div>}
                  {open && !a.answer && <div className="mt-0.5" style={{ color: AWAITING }}>The agent could not propose an answer.</div>}
                </div>
                {!open && (
                  <div className="flex shrink-0 gap-1">
                    <button className={'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold ' + (v?.ok ? 'bg-[#36c98a] text-white' : 'border border-[var(--edge)] text-[var(--muted-ink)] hover:text-[#36c98a]')}
                      onClick={() => set(k, { ok: true, text: '' })}><Check size={12} /> Agree</button>
                    <button className={'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold ' + (v && !v.ok ? 'text-white' : 'border border-[var(--edge)] text-[var(--muted-ink)]')}
                      style={v && !v.ok ? { background: AWAITING } : undefined}
                      onClick={() => set(k, { ok: false, text: v?.text || '', editing: true })}><Pencil size={12} /> Change</button>
                  </div>
                )}
              </div>
              {editing && (
                <input autoFocus={!open} className="field-glass mt-2 h-9 w-full px-3 text-[12.5px]" value={v?.text || ''}
                  placeholder={open ? 'Your answer' : 'What you want instead'}
                  onChange={(e) => set(k, { ok: false, text: e.target.value, editing: true })} />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function ready(a: Ask, v?: Answer): boolean {
  if (!v) return false
  return a.status === 'open' || !v.ok ? !!v.text.trim() : true
}

// ------------------------------------------------------------------ the decision

function Decide({ run, gate, answers, onDone, busyChat }: { run: RunSummary; gate: Gate; answers: Record<string, Answer>; onDone: () => void; busyChat: boolean }) {
  const [note, setNote] = useState('')
  const [more, setMore] = useState(false)
  const [target, setTarget] = useState(gate.default_target || gate.targets[0] || '')
  const [files, setFiles] = useState<(GateFile & { size: number })[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const asks = gate.asks || []
  const revise = gate.revise ?? ['revise']
  const pass = gate.pass ?? gate.decisions.filter((d) => !revise.includes(d))
  const label = (d: string) => gate.decision_labels?.[d] || DECISION_LABEL[d] || d
  const targetLabel = (t: string) => gate.target_labels?.[t] || t
  const answered = asks.every((a) => ready(a, answers[keyOf(a)]))
  const changed = asks.filter((a) => answers[keyOf(a)] && !answers[keyOf(a)].ok && answers[keyOf(a)].text.trim()).length
  const canRevise = !!note.trim() || files.length > 0 || changed > 0
  const add = async (list: FileList) => {
    const picked = await Promise.all(Array.from(list).map(async (f) => ({ name: f.name, data: await fileToBase64(f), size: f.size })))
    setFiles((cur) => [...cur.filter((c) => !picked.some((p) => p.name === c.name)), ...picked])
  }
  const send = async (decision: string) => {
    setBusy(true)
    setErr('')
    try {
      await decideGate(run.id, gate.name, {
        decision, note: note.trim() || undefined, who: profile()?.name || 'a person',
        target: revise.includes(decision) && gate.targets.length ? target : undefined,
        files: files.length ? files.map(({ name, data }) => ({ name, data })) : undefined,
        answers: asks.filter((a) => ready(a, answers[keyOf(a)])).map((a) => ({ artifact: a.artifact, id: a.id, ok: answers[keyOf(a)].ok, text: answers[keyOf(a)].text.trim() || undefined })),
      })
      onDone()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  const showMore = more || gate.review
  return (
    <div className="rounded-[14px] border-2 p-3" style={{ borderColor: AWAITING + '66', background: AWAITING + '0a' }}>
      {gate.history.length > 0 && (
        <details className="mb-2 text-[12px]" style={muted}>
          <summary className="cursor-pointer">Earlier decisions at this step ({gate.history.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {gate.history.map((h, i) => (
              <li key={i}>round {h.round}: <b>{label(h.decision)}</b>{h.target ? ` (${targetLabel(h.target)})` : ''} by {h.by}
                {h.note ? <>: <span className="whitespace-pre-wrap">{h.note}</span></> : null}{h.files.length ? <> · files: {h.files.map((f) => f.name).join(', ')}</> : null}</li>
            ))}
          </ul>
        </details>
      )}
      {!showMore ? (
        <button className="mb-2 text-[12px] font-semibold text-[var(--blue)] hover:underline" onClick={() => setMore(true)}>+ Add a note or files</button>
      ) : (
        <>
          <label className="mb-1 block text-[12px] font-semibold" style={{ color: 'var(--navy)' }}>
            {gate.note_label || (gate.review ? 'Corrected solutions for the findings (they go back to the agents through the retro)' : 'A note for the agents')}
          </label>
          <textarea className="field-glass block min-h-[72px] w-full resize-y px-3 py-2 text-[12.5px]" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={gate.note_placeholder || ''} />
          {revise.some((d) => gate.decisions.includes(d)) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="btn-ghost flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-[12px]">
                <Upload size={13} /> Attach PDF, Word or text
                <input type="file" multiple className="hidden" accept={GATE_FILES} onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = '' }} />
              </label>
              {files.map((f) => (
                <span key={f.name} className="glass flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold">
                  <FileText size={13} color="#4d8dff" /> {f.name} <span style={muted}>({Math.ceil(f.size / 1024)} KB)</span>
                  <button aria-label={'remove ' + f.name} onClick={() => setFiles(files.filter((x) => x.name !== f.name))}><X size={13} /></button>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {gate.targets.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]" style={{ color: 'var(--ink)' }}>
          <span style={muted}>Send back:</span>
          {gate.targets.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-1.5">
              <input type="radio" name={'gate-target-' + gate.name} checked={target === t} onChange={() => setTarget(t)} /> {targetLabel(t)}
            </label>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {gate.decisions.map((d) => {
          const isPass = pass.includes(d)
          const blocked = isPass ? !answered : revise.includes(d) && !canRevise
          const why = isPass && !answered ? 'Answer every decision above first' : revise.includes(d) && !canRevise ? 'Change a decision, write a note or attach a file' : undefined
          return (
            <button key={d} className={(isPass && d === pass[0] ? 'btn-primary' : 'btn-ghost') + ' px-3.5 py-2 text-[12.5px]'}
              disabled={busy || busyChat || blocked} title={busyChat ? 'Wait for the agent to answer' : why} onClick={() => void send(d)}>
              {busy ? 'Sending…' : label(d)}
            </button>
          )
        })}
        <span className="text-[11.5px]" style={muted}>
          {!answered ? `${asks.filter((a) => !ready(a, answers[keyOf(a)])).length} decision(s) left` : changed ? `${changed} change(s): approve to pass them on, or send back to rewrite` : `round ${gate.round}`}
        </span>
      </div>
      {err && <p className="mt-1 text-[12px] text-[var(--red)]">{err}</p>}
    </div>
  )
}

// ------------------------------------------------------------------ the chat

function ChatWindow({ run, gate, brief, points, decide, onSent }: {
  run: RunSummary; gate: Gate; brief: ReactNode; points: ReactNode; decide: ReactNode; onSent: () => void
}) {
  const msgs = gate.messages || []
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const thinking = msgs.some((m) => m.state === 'thinking')
  const agent = useMemo(() => {
    const role = msgs.find((m) => m.who === 'agent')?.role || ''
    return ROLE_LABEL[role] || (gate.name === 'plan' ? 'Domain + QC agents' : gate.name === 'spec' ? 'Spec Agent' : 'Agent')
  }, [msgs, gate.name])
  // a new message scrolls the conversation itself, never the page (the summary stays where the person reads it)
  const seen = useRef(msgs.length)
  useEffect(() => {
    if (msgs.length !== seen.current && box.current) box.current.scrollTop = box.current.scrollHeight
    seen.current = msgs.length
  }, [msgs.length, thinking])
  const send = async () => {
    const t = text.trim()
    if (!t) return
    setBusy(true)
    setErr('')
    try {
      await chatGate(run.id, gate.name, t, profile()?.name || 'a person')
      setText('')
      onSent()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 flex flex-col overflow-hidden rounded-[16px] border border-[var(--edge)] bg-[var(--head)]">
      <div ref={box} className="flex max-h-[760px] flex-col gap-3 overflow-y-auto p-3">
        <Bubble who="agent" name={agent}>
          <p className="mb-2 text-[13px]" style={{ color: 'var(--ink)' }}>
            Here is what I understood and what I will do. Ask me anything, or tell me what to change: I will change the document right here.
          </p>
          {brief}
        </Bubble>
        {msgs.map((m) => <Message key={m.id} m={m} agent={agent} docs={gate.docs} />)}
        <Bubble who="agent" name="Your decision" wide>
          <div className="flex flex-col gap-3">
            {points}
            {decide}
          </div>
        </Bubble>
      </div>
      <div className="flex items-end gap-2 border-t border-[var(--edge)] p-2.5">
        <textarea className="field-glass block max-h-[160px] min-h-[42px] flex-1 resize-y px-3 py-2 text-[13px]" value={text} disabled={busy}
          placeholder={thinking ? 'The agent is answering…' : 'Ask the agent, or tell it what to change (Enter to send, Shift+Enter for a new line)'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !thinking) { e.preventDefault(); void send() } }} />
        <button className="btn-primary flex h-[42px] items-center gap-1.5 px-4 text-[12.5px]" disabled={busy || thinking || !text.trim()} onClick={() => void send()}>
          <Send size={14} /> Send
        </button>
      </div>
      {err && <p className="px-3 pb-2 text-[12px] text-[var(--red)]">{err}</p>}
    </div>
  )
}

function Message({ m, agent, docs }: { m: ChatMessage; agent: string; docs: GateDoc[] }) {
  if (m.who === 'person') {
    return <Bubble who="person" name={m.by || 'You'} ms={m.ms}><div className="whitespace-pre-wrap text-[13px]">{m.text}</div></Bubble>
  }
  const title = (id: string) => docs.find((d) => d.id === id)?.title || id
  return (
    <Bubble who="agent" name={agent} ms={m.ms}>
      {m.state === 'thinking' ? (
        <span className="flex items-center gap-1.5 text-[12.5px]" style={muted}>
          <span className="inline-flex gap-0.5">{[0, 1, 2].map((i) => <i key={i} className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--blue)]" style={{ animationDelay: `${i * 150}ms` }} />)}</span>
          reading the documents and the code…
        </span>
      ) : (
        <>
          <div className={'prose-chat text-[13px] ' + (m.state === 'failed' ? 'text-[var(--red)]' : '')}><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>
          {m.edited && m.edited.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {m.edited.map((e) => (
                <span key={e} className="flex items-center gap-1 rounded-full bg-[#36c98a1a] px-2 py-0.5 text-[11px] font-bold text-[#1f9c69]"><Pencil size={11} /> {title(e)} changed</span>
              ))}
            </div>
          )}
        </>
      )}
    </Bubble>
  )
}

function Bubble({ who, name, ms, wide, children }: { who: 'agent' | 'person'; name: string; ms?: number; wide?: boolean; children: ReactNode }) {
  const mine = who === 'person'
  return (
    <div className={'flex gap-2 ' + (mine ? 'flex-row-reverse' : '')}>
      <span className="chip-glass mt-0.5 !h-8 !w-8 shrink-0" style={{ color: mine ? 'var(--navy)' : 'var(--blue)' }}>{mine ? <User size={15} /> : <Bot size={15} />}</span>
      <div className={'min-w-0 ' + (wide ? 'flex-1' : 'max-w-[88%]')}>
        <div className={'mb-0.5 text-[11px] font-semibold ' + (mine ? 'text-right' : '')} style={muted}>{name}{ms ? ' · ' + new Date(ms).toLocaleTimeString() : ''}</div>
        <div className={'rounded-[14px] px-3.5 py-2.5 ' + (mine ? 'bg-[#4d8dff] text-white' : 'border border-[var(--edge)] bg-[var(--panel2,var(--row))]')}>{children}</div>
      </div>
    </div>
  )
}
