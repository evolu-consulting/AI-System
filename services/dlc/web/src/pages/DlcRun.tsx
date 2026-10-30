import { useCallback, useEffect, useMemo, useState } from 'react'
import { Background as FlowBg, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowLeft, Hand } from 'lucide-react'
import { Card, isLive, NODE_COLOR, NodeStatePill, ProgressBar, RunControls, Shell, StatePill } from '@/components/dlc'
import { events as loadEvents, fmtDuration, getRun, isFinal, nodes as loadNodes, passHook, progressOf, resumeRun } from '@/lib/dlc'
import type { DlcEvent, FlowNode, HookResult, RunSummary } from '@/lib/dlc'
import { go } from '@/lib/route'
import { flowLabel, runName } from '@/pages/DlcHome'
import { HookStatus } from '@/pages/Hooks'
import { AttentionPanel } from '@/pages/Attention'
import { RunBoard } from '@/pages/RunBoard'
import { DecisionHistory } from '@/pages/Decisions'


type CardData = { node: FlowNode }

function StageCard({ data }: NodeProps) {
  const n = (data as CardData).node
  const c = NODE_COLOR[n.state] || '#9aa7c2'
  const live = isLive(n.state) || n.state === 'queued'
  return (
    <div
      className="w-[190px] cursor-pointer rounded-[18px] border-2 bg-[var(--head)] px-4 py-3 text-left shadow-[0_10px_24px_rgba(77,141,255,.12)] backdrop-blur hover:bg-[rgba(77,141,255,0.08)]"
      style={{ borderColor: live ? c : 'var(--line2)', boxShadow: live ? `0 0 0 4px ${c}26, 0 10px 24px rgba(0,0,0,.25)` : undefined }}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-[#9cc6fb]" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-bold" style={{ color: 'var(--navy)' }}>{n.title}</span>
        <i className={'inline-block h-2.5 w-2.5 rounded-full ' + (live ? 'animate-pulse' : '')} style={{ background: c }} />
      </div>
      <div className="mt-1.5"><NodeStatePill state={n.state} /></div>
      {n.state === 'awaiting' && <div className="mt-1 text-[10.5px] font-semibold" style={{ color: c }}>Click to review and decide</div>}
      {n.state === 'queued' && n.queue && <div className="mt-1 text-[10.5px] font-semibold" style={{ color: c }}>#{n.queue.seq} in queue, {n.queue.behind} ahead</div>}
      {n.roles && n.roles.length > 0 && (
        <div className="mt-1.5 truncate text-[10.5px]" style={{ color: 'var(--muted-ink)' }}>{n.roles.join(' · ')}</div>
      )}
      {n.counts && (
        <div className="mt-1 text-[10.5px]" style={{ color: 'var(--muted-ink)' }}>
          {n.counts.llm_calls ? `${n.counts.llm_calls} agent calls` : ''}
          {n.counts.units ? ` · ${n.counts.merged || 0}/${n.counts.units} units` : ''}
          {n.counts.already_satisfied ? ` · ${n.counts.already_satisfied} already satisfied (no changes)` : ''}
          {n.counts.usd ? ` · $${Number(n.counts.usd).toFixed(2)}` : ''}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-[#9cc6fb]" />
    </div>
  )
}

const nodeTypes = { stage: StageCard }

export function DlcRun({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunSummary | null>(null)
  const [list, setList] = useState<FlowNode[]>([])
  const [feed, setFeed] = useState<DlcEvent[]>([])
  const [after, setAfter] = useState(0)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    try {
      const d = await getRun(runId)
      const r = (d.run || d) as RunSummary
      setRun(r)
      setList(await loadNodes(r))
      const ev = await loadEvents(runId, after, 300)
      if (ev.events?.length) {
        setFeed((cur) => [...cur, ...ev.events].slice(-60))
        setAfter(ev.last_seq || ev.events[ev.events.length - 1].seq)
      }
      setErr('')
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [runId, after])
  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(id)
  }, [load])

  const { flowNodes, flowEdges } = useMemo(() => {
    const flowNodes: Node[] = list.map((n, i) => ({
      id: n.id,
      type: 'stage',
      position: { x: (i % 4) * 240, y: Math.floor(i / 4) * 170 },
      data: { node: n },
      draggable: false,
    }))
    const flowEdges: Edge[] = list.slice(1).map((n, i) => ({
      id: `${list[i].id}-${n.id}`,
      source: list[i].id,
      target: n.id,
      type: 'smoothstep',
      animated: isLive(n.state),
      style: { stroke: 'rgba(77,141,255,.45)', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(77,141,255,.6)' },
    }))
    return { flowNodes, flowEdges }
  }, [list])

  const p = run ? progressOf(run) : 0
  return (
    <Shell>
      <div className="mx-auto max-w-[1400px]">
        <button className="btn-ghost mb-4 flex items-center gap-1.5 px-3 py-2 text-[12.5px]" onClick={() => go('')}>
          <ArrowLeft size={14} /> All runs
        </button>
        {err && <p className="mb-3 text-[12.5px] text-[var(--red)]">{err}</p>}
        {run && (
          <Card className="mb-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="title-navy truncate text-[24px]">{runName(run)}</h1>
                  <StatePill run={run} />
                </div>
                <div className="mt-1 text-[12px] capitalize" style={{ color: 'var(--muted-ink)' }}>
                  {flowLabel(run)} · {run.id} · {fmtDuration(run.created_ms, isFinal(run) ? run.updated_ms : undefined)}
                  {Number(run.detail?.spent_usd || 0) > 0 && <> · ${Number(run.detail?.spent_usd).toFixed(2)} spent</>}
                  {run.units ? <> · {(run.unit_states?.merged || 0) - (run.nothing_to_merge || 0)}/{run.units} units merged</> : null}
                  {run.nothing_to_merge ? <> · {run.nothing_to_merge} already satisfied (no changes)</> : null}
                </div>
                <div className="mt-3 flex max-w-[640px] items-center gap-3">
                  <div className="flex-1"><ProgressBar value={p} /></div>
                  <span className="text-[13px] font-bold" style={{ color: 'var(--blue)' }}>{p}%</span>
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2">
                <RunControls run={run} onChange={load} />
              </div>
            </div>
          </Card>
        )}
        {run && <AttentionPanel run={run} onChange={load} hook={(h) => <HookHold run={run} hold={h} onChange={load} />} />}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-4">
              <h2 className="title-navy text-[17px]">Flow</h2>
              <span className="text-[12px]" style={{ color: 'var(--muted-ink)' }}>Click a step to see what its agents did</span>
            </div>
            <div className="h-[460px]">
              <ReactFlowProvider>
                <ReactFlow
                  nodes={flowNodes}
                  edges={flowEdges}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.2 }}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  onNodeClick={(_, n) => go(`run/${encodeURIComponent(runId)}/node/${encodeURIComponent(n.id)}`)}
                  proOptions={{ hideAttribution: true }}
                >
                  <FlowBg variant={BackgroundVariant.Dots} gap={22} size={1.4} color="rgba(77,141,255,.18)" />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          </Card>
          <Card className="max-h-[540px] overflow-auto">
            <h2 className="title-navy mb-3 text-[17px]">Live activity</h2>
            {feed.length === 0 && <p className="text-[12.5px]" style={{ color: 'var(--muted-ink)' }}>Waiting for events…</p>}
            <ul className="flex flex-col-reverse gap-2">
              {feed.map((e) => (
                <li key={e.seq} className="rounded-xl bg-[var(--row)] px-3 py-2 text-[12px]">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold" style={{ color: 'var(--navy)' }} title={e.kind}>{e.title || e.kind}</span>
                    <span style={{ color: 'var(--muted-ink)' }}>{new Date(e.ts_ms).toLocaleTimeString()}</span>
                  </div>
                  {e.text ? <div className="line-clamp-3" style={{ color: 'var(--muted-ink)' }}>{e.text}</div>
                    : e.env?.unit && <div style={{ color: 'var(--muted-ink)' }}>{e.env.unit}</div>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <DecisionHistory runId={runId} tick={after} />
        <RunBoard runId={runId} tick={after} />
      </div>
    </Shell>
  )
}

/** A run hook (Admin > Sidecars > Run hooks) holds the run: pass it by hand, or ask the hook again. */
function HookHold({ run, hold, onChange }: { run: RunSummary; hold: HookResult; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setErr('')
    try {
      await fn()
      onChange()
    } catch (e) {
      setErr(String((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="mb-5 !border-[var(--amber)]">
      <div className="flex flex-wrap items-start gap-4">
        <Hand size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
        <div className="min-w-0 flex-1 text-[12.5px]">
          <div className="text-[14px] font-bold" style={{ color: 'var(--navy)' }}>
            Held by hook "{hold.name}" at {hold.event} · <HookStatus r={hold} />
          </div>
          {hold.reason && <div className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--ink)' }}>{hold.reason}</div>}
          <div className="mt-1" style={{ color: 'var(--muted-ink)' }}>
            Fix what it asks for and ask it again, or pass it by hand: the run goes on as if the hook said SUBMIT.
          </div>
          {err && <div className="mt-1 text-[var(--red)]">{err}</div>}
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost px-3.5 py-2 text-[12.5px]" disabled={busy} onClick={() => act(() => resumeRun(run.id))}>Ask again</button>
          {hold.key && (
            <button className="btn-primary px-3.5 py-2 text-[12.5px]" disabled={busy} onClick={() => act(() => passHook(run.id, hold.key as string))}>Pass and resume</button>
          )}
        </div>
      </div>
    </Card>
  )
}
