import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, Bot, Download, FileText, X } from 'lucide-react'
import { Card, isLive, NodeStatePill, Shell, StatePill } from '@/components/dlc'
import { AttentionPanel } from '@/pages/Attention'
import { getRun, nodes as loadNodes, reportBody, reports as loadReports, worklog as loadWorklog } from '@/lib/dlc'
import type { FlowNode, Report, ReportBody, RunSummary, WorklogEntry } from '@/lib/dlc'
import { cameFrom, goBack, goReplace } from '@/lib/route'
import { runName } from '@/pages/DlcHome'

const KIND_LABEL: Record<string, string> = {
  spec: 'Spec', implement: 'Implementation', test: 'Testing', qas: 'QAS', review: 'Review', questions: 'Questions',
  findings: 'Findings', decisions: 'Decisions', deploy: 'Deploy', seal: 'Seal', migration: 'Migration',
}

const ROLE_HUE = ['#4d8dff', '#2fc7d6', '#7c5cff', '#36c98a', '#ffb547', '#ff5f6d', '#8e9bbd']

function hue(role: string): string {
  let h = 0
  for (const ch of role) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return ROLE_HUE[h % ROLE_HUE.length]
}

export function DlcNode({ runId, nodeId }: { runId: string; nodeId: string }) {
  const [run, setRun] = useState<RunSummary | null>(null)
  const [list, setList] = useState<FlowNode[]>([])
  const [entries, setEntries] = useState<WorklogEntry[]>([])
  const [reps, setReps] = useState<Report[]>([])
  const [open, setOpen] = useState<Report | null>(null)
  const [err, setErr] = useState('')
  const node = list.find((n) => n.id === nodeId)
  const [back] = useState(() => { const f = cameFrom(); return !f ? 'Flow' : f.startsWith('run/') ? 'Back' : 'All runs' })
  const live = !!node && (isLive(node.state) || node.state === 'queued')

  const load = useCallback(async () => {
    try {
      const d = await getRun(runId)
      const r = (d.run || d) as RunSummary
      setRun(r)
      const [n, w, rp] = await Promise.all([loadNodes(r), loadWorklog(runId, nodeId), loadReports(runId)])
      setList(n)
      setEntries(w)
      setReps(rp)
      setErr('')
    } catch (e) {
      setErr(String((e as Error).message))
    }
  }, [runId, nodeId])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!live) return
    const id = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(id)
  }, [live, load])

  const nodeReports = useMemo(() => {
    const mine = reps.filter((r) => !r.node || r.node === nodeId)
    const others = reps.filter((r) => r.node && r.node !== nodeId)
    return { mine, others }
  }, [reps, nodeId])

  const roles = useMemo(() => Array.from(new Set(entries.map((e) => e.role || 'agent'))), [entries])
  const cost = entries.reduce((s, e) => s + (e.cost_usd || 0), 0)

  return (
    <Shell>
      <div className="mx-auto max-w-[1400px]">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-[12.5px]" onClick={() => goBack('run/' + encodeURIComponent(runId))}>
            <ArrowLeft size={14} /> {back}
          </button>
          {run && (
            <span className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: 'var(--navy)' }}>
              {runName(run)} <StatePill run={run} />
            </span>
          )}
        </div>
        <div className="mb-4 flex flex-wrap gap-1.5">
          {list.map((n) => (
            <button
              key={n.id}
              onClick={() => goReplace(`run/${encodeURIComponent(runId)}/node/${encodeURIComponent(n.id)}`)}
              className={'rounded-full px-3 py-1.5 text-[12px] font-semibold ' + (n.id === nodeId ? 'bg-[var(--head)] text-[var(--blue)] shadow-[0_4px_12px_rgba(77,141,255,.18)]' : 'bg-[var(--panel2)] text-[var(--muted-ink)] hover:bg-[rgba(77,141,255,0.08)]')}
            >
              {n.title}
            </button>
          ))}
        </div>
        {err && <p className="mb-3 text-[12.5px] text-[var(--red)]">{err}</p>}
        {run && node?.state === 'awaiting' && <AttentionPanel run={run} onChange={() => void load()} hook={() => null} />}
        {node?.state === 'queued' && node.queue && (
          <Card className="mb-5 !border-[#8b6cf0]">
            <div className="text-[14px] font-bold" style={{ color: '#8b6cf0' }}>Waiting its turn in the change queue</div>
            <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink)' }}>
              Approved and in the project's queue as #{node.queue.seq}; {node.queue.behind} approved run(s) build first
              {node.queue.head ? <> (now: #{node.queue.head.seq} {node.queue.head.run}, {node.queue.head.state})</> : null}. It builds on their result.
            </p>
          </Card>
        )}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="min-h-[520px]">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <h1 className="title-navy text-[22px]">{node?.title || nodeId}</h1>
              {node && <NodeStatePill state={node.state} />}
              <span className="ml-auto text-[12px]" style={{ color: 'var(--muted-ink)' }}>
                {entries.length} entries{roles.length ? ' · ' + roles.join(', ') : ''}{cost > 0 ? ` · $${cost.toFixed(2)}` : ''}
              </span>
            </div>
            {entries.length === 0 && (
              <p className="text-[13px]" style={{ color: 'var(--muted-ink)' }}>
                {node?.state === 'pending' ? 'This step has not started yet.' : 'No agent activity recorded for this step yet.'}
              </p>
            )}
            <ol className="flex flex-col gap-3">
              {entries.map((e, i) => {
                const c = hue(e.role || 'agent')
                return (
                  <li key={i} className="flex gap-3">
                    <span className="chip-glass !h-9 !w-9 shrink-0" style={{ color: c }} title={e.role}><Bot size={16} /></span>
                    <div className={'min-w-0 flex-1 rounded-[14px] border px-4 py-3 ' + (e.kind === 'error' ? 'border-[var(--red)]/40 bg-[#fdecec]/80' : 'border-[var(--edge)] bg-[var(--row)]')}>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]">
                        <span className="font-bold capitalize" style={{ color: c }}>{e.role || 'agent'}</span>
                        {e.agent && <span style={{ color: 'var(--muted-ink)' }}>{e.agent}</span>}
                        <span className="rounded-full bg-[rgba(77,141,255,.08)] px-2 py-0.5 font-semibold" style={{ color: 'var(--muted-ink)' }}>{e.kind}</span>
                        <span className="ml-auto" style={{ color: 'var(--muted-ink)' }}>
                          {e.ts ? new Date(e.ts).toLocaleString() : ''}{e.cost_usd ? ` · $${e.cost_usd.toFixed(3)}` : ''}
                        </span>
                      </div>
                      {e.title && <div className="mt-1 text-[13.5px] font-semibold" style={{ color: 'var(--navy)' }}>{e.title}</div>}
                      {e.text && (
                        <div className="prose-chat mt-1 break-words text-[13px]">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{e.text}</ReactMarkdown>
                        </div>
                      )}
                      {e.raw && e.raw !== e.text && (
                        <details className="mt-1.5 text-[11.5px]" style={{ color: 'var(--muted-ink)' }}>
                          <summary className="cursor-pointer select-none">Technical details{e.event ? ` · ${e.event}` : ''}</summary>
                          <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-[var(--head)] p-2 text-[11px]">{e.raw}</pre>
                        </details>
                      )}
                      {e.artifact && (
                        <button className="mt-1.5 flex items-center gap-1 text-[12px] font-semibold text-[var(--blue)]"
                          onClick={() => setOpen(reps.find((r) => r.id === e.artifact) || { id: e.artifact!, kind: 'output', title: e.artifact! })}>
                          <FileText size={13} /> {e.artifact}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </Card>
          <div className="flex flex-col gap-5">
            <Card>
              <h2 className="title-navy mb-3 text-[17px]">Reports for this step</h2>
              <ReportList items={nodeReports.mine} onOpen={setOpen} empty="No report for this step yet." />
            </Card>
            {nodeReports.others.length > 0 && (
              <Card>
                <h2 className="title-navy mb-3 text-[17px]">Other reports of the run</h2>
                <ReportList items={nodeReports.others} onOpen={setOpen} empty="" />
              </Card>
            )}
          </div>
        </div>
      </div>
      {open && <ReportViewer runId={runId} report={open} onClose={() => setOpen(null)} />}
    </Shell>
  )
}

function ReportList({ items, onOpen, empty }: { items: Report[]; onOpen: (r: Report) => void; empty: string }) {
  if (!items.length) return <p className="text-[12.5px]" style={{ color: 'var(--muted-ink)' }}>{empty}</p>
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.id}>
          <button className="flex w-full items-center gap-2.5 rounded-xl border border-[var(--edge)] bg-[var(--row)] px-3 py-2 text-left hover:bg-[rgba(77,141,255,0.08)]" onClick={() => onOpen(r)}>
            <span className="chip-glass !h-8 !w-8"><FileText size={14} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--navy)' }}>{r.title}</span>
              <span className="text-[11px]" style={{ color: 'var(--muted-ink)' }}>
                {KIND_LABEL[r.kind] || r.kind}{r.size ? ` · ${Math.max(1, Math.round(r.size / 1024))} KB` : ''}
                {r.created_ms ? ' · ' + new Date(r.created_ms).toLocaleString() : ''}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ReportViewer({ runId, report, onClose }: { runId: string; report: Report; onClose: () => void }) {
  const [body, setBody] = useState<ReportBody | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    reportBody(runId, report).then(setBody).catch((e) => setErr(String((e as Error).message)))
  }, [runId, report])
  const mime = (body?.mime || report.mime || '').toLowerCase()
  const isJson = mime.includes('json') || /\.json$/i.test(report.title)
  const isHtml = mime.includes('html') || /\.html?$/i.test(report.title)
  const download = () => {
    if (!body) return
    const blob = new Blob([body.text], { type: mime || 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = report.title.replace(/[^\w.-]+/g, '_') + (/\.\w+$/.test(report.title) ? '' : isJson ? '.json' : isHtml ? '.html' : '.md')
    a.click()
    URL.revokeObjectURL(a.href)
  }
  let pretty = body?.text || ''
  if (isJson) {
    try {
      pretty = JSON.stringify(JSON.parse(pretty), null, 2)
    } catch {
      /* keep raw */
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(11,31,75,.25)] p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-hi flex max-h-[88vh] w-full max-w-[980px] flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="title-navy min-w-0 flex-1 truncate text-[18px]">{report.title}</h2>
          <button className="btn-ghost flex items-center gap-1 px-3 py-1.5 text-[12px]" disabled={!body} onClick={download}><Download size={13} /> Download</button>
          <button className="btn-ghost px-2 py-1.5" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-[14px] bg-[var(--head)] p-4">
          {err && <p className="text-[12.5px] text-[var(--red)]">{err}</p>}
          {!body && !err && <p className="text-[12.5px]" style={{ color: 'var(--muted-ink)' }}>Loading…</p>}
          {body && isHtml && <iframe title={report.title} sandbox="" srcDoc={body.text} className="h-[70vh] w-full rounded-lg border-0 bg-[var(--head)]" />}
          {body && isJson && <pre className="whitespace-pre-wrap break-words text-[12px]">{pretty}</pre>}
          {body && !isHtml && !isJson && (
            <div className="prose-chat text-[13.5px]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{body.text}</ReactMarkdown></div>
          )}
        </div>
      </div>
    </div>
  )
}
