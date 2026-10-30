/**
 * The workflow canvas. The ONLY folder that imports @xyflow/react (same seam as
 * Slaves/Workflow): everything outside works on the plain {nodes, edges} doc.
 * Each node is one agent group; arrows give the order the groups run in.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
} from '@xyflow/react'
import type { Connection, Edge, EdgeChange, Node, NodeChange, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Group, WfEdge, WfNode } from '@/lib/types'

export const GROUP_MIME = 'application/kh-sdlc-group'

export interface Doc {
  nodes: WfNode[]
  edges: WfEdge[]
}

type CardData = { label: string; agents: string; gate: boolean; missing: boolean; lane: string; role: string; approval: boolean }

function GroupCard({ data, selected }: NodeProps) {
  const d = data as CardData
  return (
    <div
      className={
        'min-w-[170px] rounded-[10px] border px-5 py-4 text-center text-[var(--navy)] shadow-[0_10px_24px_rgba(0,0,0,0.3)] ' +
        (d.missing ? 'border-red-400/60 bg-red-500/10 ' : 'border-[var(--line2)] bg-gradient-to-br from-[var(--row)] to-[var(--head)] ') +
        (selected ? 'ring-4 ring-[rgba(77,141,255,0.35)]' : '')
      }
    >
      <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-[var(--panel)] !bg-[var(--blue)]" />
      <div className="mb-1 flex justify-center gap-1 text-[9px] font-bold uppercase tracking-wider">
        <span className={d.lane === 'pm' ? 'rounded-md bg-purple-500/15 px-1.5 text-purple-300' : 'rounded-md bg-[rgba(77,141,255,0.12)] px-1.5 text-[var(--blue)]'}>{d.lane}</span>
        <span className="rounded-md bg-[rgba(47,199,214,0.15)] px-1.5 text-[#0f8a96]">{d.role}</span>
      </div>
      <div className="text-[15px] font-extrabold leading-tight tracking-tight">{d.label}</div>
      <div className="mt-1 text-[10px] text-[var(--muted-ink)]">{d.agents || 'no agents'}</div>
      {d.gate && <div className="mt-1 text-[10px] font-bold text-[var(--blue)]">asks the user</div>}
      {d.approval && <div className="text-[10px] font-bold text-purple-300">needs approval</div>}
      <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-[var(--panel)] !bg-[var(--blue)]" />
    </div>
  )
}

const nodeTypes = { sdlcGroup: GroupCard }

export interface CanvasProps {
  doc: Doc
  groups: Group[]
  agentNames: Record<string, string>
  onChange: (doc: Doc) => void
  /** next: arrows build the main path; rework: an arrow goes BACK to the step that redoes the work on a fail verdict */
  mode?: 'next' | 'rework'
}

export function WorkflowCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  )
}

function toNodes(doc: Doc, groups: Group[], agentNames: Record<string, string>, prev: Node[]): Node[] {
  const before = new Map(prev.map((n) => [n.id, n]))
  return doc.nodes.map((n) => {
    const g = groups.find((x) => x.id === n.groupId)
    const old = before.get(n.id)
    return {
      ...(old || {}),
      id: n.id,
      type: 'sdlcGroup',
      position: old?.dragging ? old.position : { x: n.x, y: n.y },
      data: {
        label: g?.name || '(deleted group)',
        agents: (g?.agentIds || []).map((a) => agentNames[a] || a).join(', '),
        gate: !!g?.humanGate,
        missing: !g,
        lane: g?.lane || 'dev',
        role: g?.role || 'work',
        approval: !!g?.approval,
      },
    }
  })
}

function Inner({ doc, groups, agentNames, onChange, mode = 'next' }: CanvasProps) {
  const flow = useReactFlow()
  const [nodes, setNodes] = useState<Node[]>([])

  useEffect(() => {
    setNodes((prev) => toNodes(doc, groups, agentNames, prev))
  }, [doc, groups, agentNames])

  const edges: Edge[] = doc.edges.map((e, i) =>
    e.kind === 'rework'
      ? {
          id: e.id || `e-${e.source}-${e.target}-${i}`,
          source: e.source,
          target: e.target,
          type: 'default',
          label: 'rework',
          labelStyle: { fill: '#c2410c', fontSize: 10, fontWeight: 700 },
          labelBgStyle: { fill: '#fff7ed', stroke: '#fdba74' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#fb923c', width: 16, height: 16 },
          style: { stroke: '#fb923c', strokeWidth: 2, strokeDasharray: '6 4' },
        }
      : {
          id: e.id || `e-${e.source}-${e.target}-${i}`,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#4d8dff', width: 18, height: 18 },
          style: { stroke: '#4d8dff', strokeWidth: 2 },
        },
  )

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((ns) => applyNodeChanges(changes, ns))
      const removed = changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id)
      const moved = changes.filter((c) => c.type === 'position' && !c.dragging && c.position) as {
        id: string
        position: { x: number; y: number }
      }[]
      if (removed.length || moved.length) {
        const pos = new Map(moved.map((m) => [m.id, m.position]))
        onChange({
          nodes: doc.nodes
            .filter((n) => !removed.includes(n.id))
            .map((n) => (pos.has(n.id) ? { ...n, x: Math.round(pos.get(n.id)!.x), y: Math.round(pos.get(n.id)!.y) } : n)),
          edges: doc.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)),
        })
      }
    },
    [doc, onChange],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const removed = changes.filter((c) => c.type === 'remove').map((c) => c.id)
      if (removed.length) onChange({ ...doc, edges: doc.edges.filter((e, i) => !removed.includes(e.id || `e-${e.source}-${e.target}-${i}`)) })
    },
    [doc, onChange],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return
      if (mode === 'rework') {
        // One rework arrow per step: a new one replaces the old.
        const edges = doc.edges.filter((e) => !(e.kind === 'rework' && e.source === c.source))
        edges.push({ id: `r${Date.now()}`, source: c.source, target: c.target, kind: 'rework' })
        onChange({ ...doc, edges })
        return
      }
      // One straight main path: a new arrow replaces any main arrow leaving the source or entering the target.
      const edges = doc.edges.filter((e) => e.kind === 'rework' || (e.source !== c.source && e.target !== c.target))
      edges.push({ id: `e${Date.now()}`, source: c.source, target: c.target, kind: 'next' })
      onChange({ ...doc, edges })
    },
    [doc, onChange, mode],
  )

  const onDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault()
      const gid = ev.dataTransfer.getData(GROUP_MIME)
      if (!gid) return
      const p = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY })
      const id = `n${Date.now()}`
      const nodes = [...doc.nodes, { id, groupId: gid, x: Math.round(p.x - 85), y: Math.round(p.y - 35) }]
      // Convenience: a dropped group is chained after the current last step.
      const outs = new Set(doc.edges.filter((e) => e.kind !== 'rework').map((e) => e.source))
      const last = doc.nodes.filter((n) => !outs.has(n.id)).pop()
      const edges = last ? [...doc.edges, { id: `e${Date.now()}`, source: last.id, target: id, kind: 'next' as const }] : doc.edges
      onChange({ nodes, edges })
    },
    [doc, flow, onChange],
  )

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDrop={onDrop}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      fitView
      fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
      deleteKeyCode={['Delete', 'Backspace']}
      colorMode="light"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(77,141,255,0.18)" />
      <Controls showInteractive={false} />
    </ReactFlow>
  )
}
