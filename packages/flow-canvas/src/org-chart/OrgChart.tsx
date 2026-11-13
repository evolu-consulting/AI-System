// CR-142 · sơ đồ tổ chức dạng cây (xyflow, chỉ xem): Công ty ở gốc → phòng → phòng con. Dùng ở Sổ Hợp Tác (xem) và admin «Cơ cấu» (xem trước, bấm thẻ ⇒ chọn phòng).
// Chỉ nạp lười (`import()` ở host). Chữ do host cấp (`labels`); lớp CSS dùng token shadcn có ở cả hai web.
import "@xyflow/react/dist/base.css";
import {
  Background,
  Controls,
  type Edge,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { HiddenHandle } from "../nodes/HiddenHandle";
import {
  buildOrgGraph,
  ORG_NODE_H,
  ORG_NODE_W,
  type OrgChartDept,
  type OrgNodeData,
} from "./org-graph";

export type OrgChartLabels = {
  noHead: string;
  people: (count: number) => string;
  canvas: string;
  controls?: { title: string; zoomIn: string; zoomOut: string; fit: string };
};

export type OrgChartProps = {
  depts: readonly OrgChartDept[];
  rootName: string;
  labels: OrgChartLabels;
  /** Phòng đang chọn (viền đậm). */
  selectedId?: string | null;
  /** Phòng được làm nổi (kết quả tìm kiếm). */
  highlightIds?: readonly string[];
  /** Đổi giá trị ⇒ đưa khung nhìn tới phòng đó. `seq` tăng để bấm lại cùng phòng vẫn nhảy tới. */
  focus?: { id: string; seq: number } | null;
  onSelectDept?: (id: string) => void;
  className?: string;
};

type CardData = OrgNodeData & {
  nodeId: string;
  labels: OrgChartLabels;
  selected: boolean;
  lit: boolean;
  onSelect?: (id: string) => void;
};
type CardNode = Node<CardData, "org">;

function Initials({ name }: { name: string }) {
  const t = name.trim().split(/\s+/);
  const s = ((t[t.length - 1]?.[0] ?? "") + (t.length > 1 ? (t[0]?.[0] ?? "") : "")).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
    >
      {s}
    </span>
  );
}

function OrgCard({ data }: NodeProps<CardNode>) {
  const company = data.kind === "company";
  const ring = data.selected
    ? "border-primary ring-2 ring-primary"
    : data.lit
      ? "border-primary ring-2 ring-primary/50"
      : "border-border";
  return (
    <>
      <HiddenHandle type="target" position={Position.Top} />
      <button
        type="button"
        data-testid={`org-node-${data.nodeId}`}
        data-selected={data.selected ? "true" : undefined}
        data-lit={data.lit ? "true" : undefined}
        disabled={company}
        onClick={() => data.onSelect?.(data.nodeId)}
        style={{ width: ORG_NODE_W, height: ORG_NODE_H }}
        className={`flex flex-col justify-between rounded-lg border bg-card px-3 py-2 text-left text-card-foreground shadow-sm ${ring} ${company ? "cursor-default bg-muted" : "cursor-pointer hover:bg-accent"}`}
      >
        <span className="line-clamp-2 text-sm font-semibold leading-tight">{data.name}</span>
        {company ? (
          <span className="text-xs text-muted-foreground">{data.labels.people(data.count)}</span>
        ) : (
          <span className="flex items-center gap-2 text-xs">
            {data.head ? <Initials name={data.head.name} /> : null}
            <span
              data-testid="org-head"
              className={`min-w-0 flex-1 truncate ${data.head ? "" : "text-muted-foreground"}`}
            >
              {data.head ? data.head.name : data.labels.noHead}
            </span>
            <span className="shrink-0 text-muted-foreground">{data.labels.people(data.count)}</span>
          </span>
        )}
      </button>
      <HiddenHandle type="source" position={Position.Bottom} />
    </>
  );
}

const NODE_TYPES = { org: OrgCard };

function FocusEffect({ focus, nodes }: { focus: OrgChartProps["focus"]; nodes: CardNode[] }) {
  const { setCenter } = useReactFlow();
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ nhảy khi `focus` đổi, không khi dữ liệu đổi
  useEffect(() => {
    const n = focus ? nodes.find((x) => x.id === focus.id) : undefined;
    if (n)
      void setCenter(n.position.x + ORG_NODE_W / 2, n.position.y + ORG_NODE_H / 2, {
        zoom: 1,
        duration: 300,
      });
  }, [focus?.id, focus?.seq]);
  return null;
}

function Inner(p: OrgChartProps) {
  const { depts, rootName, labels, selectedId, highlightIds, focus, onSelectDept } = p;
  // bố cục chỉ tính lại khi dữ liệu đổi (không khi chọn/tìm)
  const graph = useMemo(() => buildOrgGraph(depts, rootName), [depts, rootName]);
  const lit = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);
  const nodes = useMemo<CardNode[]>(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "org",
        position: { x: n.x, y: n.y },
        width: ORG_NODE_W,
        height: ORG_NODE_H,
        draggable: false,
        connectable: false,
        data: {
          ...n.data,
          nodeId: n.id,
          labels,
          selected: n.id === selectedId,
          lit: lit.has(n.id),
          ...(onSelectDept ? { onSelect: onSelectDept } : {}),
        },
      })),
    [graph, labels, selectedId, lit, onSelectDept],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({ ...e, type: "smoothstep", selectable: false, focusable: false })),
    [graph],
  );
  const c = labels.controls;
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.1}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      aria-label={labels.canvas}
    >
      <Background gap={24} />
      <Controls showInteractive={false} {...(c ? { "aria-label": c.title } : {})} />
      <FocusEffect focus={focus} nodes={nodes} />
    </ReactFlow>
  );
}

export function OrgChart(p: OrgChartProps) {
  return (
    <div
      data-testid="org-tree"
      className={
        p.className ?? "h-[min(70vh,640px)] min-h-[320px] w-full rounded-lg border bg-background"
      }
    >
      <ReactFlowProvider>
        <Inner {...p} />
      </ReactFlowProvider>
    </div>
  );
}
