import { useEffect, useState } from 'react'
import { MessagesSquare } from 'lucide-react'
import { Card } from '@/components/dlc'
import { runBoard } from '@/lib/dlc'
import type { AgentMessage, BoardCard } from '@/lib/dlc'

const STEPS: [string, string][] = [
  ['understand', 'Understand the spec'], ['tests', 'Acceptance tests'], ['plan', 'Plan'], ['build', 'Build'],
  ['merge', 'Merge'], ['qas', 'Deploy and test (QAS)'], ['result', 'Result'],
]
const muted = { color: 'var(--muted-ink)' }

/** What every step settled (the board the agents read) and what the agents told each other through the project. */
export function RunBoard({ runId, tick }: { runId: string; tick: number }) {
  const [board, setBoard] = useState<Record<string, BoardCard>>({})
  const [msgs, setMsgs] = useState<AgentMessage[]>([])
  useEffect(() => {
    let live = true
    runBoard(runId).then((d) => { if (live && d) { setBoard(d.board || {}); setMsgs(d.messages || []) } }).catch(() => {})
    return () => { live = false }
  }, [runId, tick])
  const cards = STEPS.filter(([s]) => board[s])
  if (!cards.length && !msgs.length) return null
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <h2 className="title-navy mb-1 text-[17px]">Run board</h2>
        <p className="mb-3 text-[12px]" style={muted}>The latest status of every step, kept in the project's knowledge; the agents of the next steps continue from it.</p>
        <ul className="flex flex-col gap-2">
          {cards.map(([s, title]) => (
            <li key={s} className="rounded-xl bg-[var(--row)] px-3 py-2 text-[12.5px]">
              <div className="flex justify-between gap-2">
                <span className="font-semibold" style={{ color: 'var(--navy)' }}>{title}</span>
                <span style={muted}>{board[s].status}</span>
              </div>
              {board[s].detail && <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12px]" style={{ color: 'var(--ink)' }}>{board[s].detail}</pre>}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="max-h-[520px] overflow-auto">
        <h2 className="title-navy mb-3 flex items-center gap-2 text-[17px]"><MessagesSquare size={16} /> Agent messages</h2>
        {!msgs.length && <p className="text-[12.5px]" style={muted}>No message between agents in this run.</p>}
        <ul className="flex flex-col gap-2">
          {msgs.map((m) => (
            <li key={m.id} className="rounded-xl bg-[var(--row)] px-3 py-2 text-[12.5px]">
              <div className="flex flex-wrap justify-between gap-2 text-[11.5px]" style={muted}>
                <span><b style={{ color: 'var(--navy)' }}>{m.from}</b> → {m.to.map((t) => '@' + t).join(' ')} · {m.kind}</span>
                <span>{new Date(m.ms).toLocaleTimeString()}</span>
              </div>
              <div className="mt-0.5" style={{ color: 'var(--ink)' }}>{m.text}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
