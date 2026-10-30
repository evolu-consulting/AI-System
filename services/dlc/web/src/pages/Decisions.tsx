import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { Card } from '@/components/dlc'
import { decisionDoc, decisions as loadDecisions } from '@/lib/dlc'
import type { DecisionEntry, DecisionSignal, Decisions as DecisionsData } from '@/lib/dlc'

const muted = { color: 'var(--muted-ink)' }

const SIGNAL: Record<DecisionSignal, { label: string; color: string; hint: string }> = {
  positive: { label: 'Approved as proposed', color: 'var(--green)', hint: 'the agents keep this way of working' },
  mixed: { label: 'Approved with corrections', color: 'var(--amber)', hint: 'the corrections teach the agents' },
  negative: { label: 'Sent back', color: 'var(--red)', hint: 'the agents learn what to change' },
  auto: { label: 'Decided automatically', color: 'var(--blue)', hint: 'never teaches the agents' },
  neutral: { label: 'Recorded', color: 'var(--muted-ink)', hint: '' },
}

/** Every decision taken at the run's gates (engine line.decisions): what the person decided, each point the agents
 *  decided alone with the person's answer, the note, the chat, and the documents as the person saw them. */
export function DecisionHistory({ runId, tick }: { runId: string; tick: number }) {
  const [data, setData] = useState<DecisionsData | null>(null)
  const [open, setOpen] = useState<{ path: string; text: string } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    loadDecisions(runId).then((d) => { if (live) setData(d) }).catch(() => {})
    return () => { live = false }
  }, [runId, tick])
  if (!data || !data.entries.length) return null
  const show = async (path: string) => {
    setErr('')
    try {
      const d = await decisionDoc(runId, path)
      setOpen({ path: d.path, text: d.text })
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }
  return (
    <Card className="mt-5">
      <h2 className="title-navy mb-1 flex items-center gap-2 text-[17px]"><History size={16} /> Decisions at the gates</h2>
      <p className="mb-3 text-[12px]" style={muted}>
        Every decision people took in this run, kept in the run's folder, in the project's knowledge and with the change.
        The agents learn from them: approved as proposed keeps a way of working, corrections and send-backs change it.
      </p>
      <ol className="flex flex-col gap-3">
        {data.entries.map((e, i) => <EntryRow key={i} e={e} onDoc={show} />)}
      </ol>
      {err && <p className="mt-2 text-[12px] text-[var(--red)]">{err}</p>}
      {open && (
        <div className="mt-4 rounded-xl border border-[var(--line2)] bg-[var(--row)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
            <b style={{ color: 'var(--navy)' }}>{open.path}</b>
            <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={() => setOpen(null)}>Close</button>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words font-sans text-[12px]" style={{ color: 'var(--ink)' }}>{open.text}</pre>
        </div>
      )}
    </Card>
  )
}

function EntryRow({ e, onDoc }: { e: DecisionEntry; onDoc: (path: string) => void }) {
  const s = SIGNAL[e.signal] || SIGNAL.neutral
  return (
    <li className="rounded-xl bg-[var(--row)] px-3 py-2.5 text-[12.5px]" style={{ borderLeft: `3px solid ${s.color}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold" style={{ color: 'var(--navy)' }}>
          {e.title}, round {e.round}: {e.decision}{e.target ? ` (${e.target})` : ''} by {e.by || '-'}
        </span>
        <span className="text-[11.5px]" style={muted}>{e.ms ? new Date(e.ms).toLocaleString() : ''}</span>
      </div>
      <div className="mt-0.5 text-[11.5px]">
        <b style={{ color: s.color }}>{s.label}</b>
        {s.hint && <span style={muted}> · {s.hint}</span>}
        {e.personas.length > 0 && <span style={muted}> · {e.personas.join(', ')}</span>}
      </div>
      {e.points.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {e.points.map((p) => (
            <li key={p.artifact + p.id}>
              <b>{p.artifact} {p.id}</b> {p.question}
              {p.answer === 'agreed'
                ? <span style={{ color: 'var(--green)' }}> · agreed: {p.proposed || 'as proposed'}</span>
                : <span style={{ color: 'var(--amber)' }}> · changed: {p.text}{p.proposed ? ` (agents proposed: ${p.proposed})` : ''}</span>}
            </li>
          ))}
        </ul>
      )}
      {e.note && <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans" style={{ color: 'var(--ink)' }}>{e.note}</pre>}
      {e.chat.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-[12px]" style={muted}>Chat at the gate ({e.chat.length} messages)</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {e.chat.map((m, i) => (
              <li key={i}>
                <b style={{ color: m.who === 'person' ? 'var(--navy)' : 'var(--blue)' }}>{m.who === 'person' ? m.by || 'person' : 'agent'}</b>
                {m.edited?.length ? <span style={muted}> (changed {m.edited.join(', ')})</span> : null}: {m.text}
              </li>
            ))}
          </ul>
        </details>
      )}
      {Object.keys(e.documents).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Object.entries(e.documents).map(([name, path]) => (
            <button key={path} className="btn-ghost px-2.5 py-1 text-[11.5px]" onClick={() => onDoc(path)}>
              {name} as decided on
            </button>
          ))}
        </div>
      )}
    </li>
  )
}
