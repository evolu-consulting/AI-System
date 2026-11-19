// CR-142 · sơ đồ tổ chức dạng cây (xyflow, chỉ xem): Công ty ở gốc → phòng → phòng con. Dùng ở Sổ Hợp Tác (xem) và admin «Cơ cấu» (xem trước, bấm thẻ ⇒ chọn phòng).
// Chỉ nạp lười (`import()` ở host). Chữ do host cấp (`labels`); lớp CSS dùng token shadcn có ở cả hai web.
import "@xyflow/react/dist/base.css";
import { PersonAvatar, PersonAvatarGroup } from "@ai/web-kit/ui/kit/person-avatar";
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
  /** «· tổng M» — chỉ hiện khi phòng có phòng con. */
  peopleTotal: (total: number) => string;
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

function staffList(data: CardData) {
  return data.staff.map((m) => ({
    id: m.id,
    name: m.name,
    jobTitle: m.jobTitle ?? null,
    src: m.avatar ?? null,
  }));
}

function ringClass(data: CardData): string {
  if (data.selected) return "border-primary ring-2 ring-primary";
  return data.lit ? "border-primary ring-2 ring-primary/50" : "border-border";
}

/** BR-189-2 · thẻ phòng: tên · trưởng phòng (avatar + họ tên) · «N người · tổng M» · hàng avatar nhân viên (bấm mở danh sách). */
function OrgCard({ data }: NodeProps<CardNode>) {
  const company = data.kind === "company";
  const ring = ringClass(data);
  const staff = staffList(data);
  return (
    <>
      <HiddenHandle type="target" position={Position.Top} />
      <div
        data-testid={`org-node-${data.nodeId}`}
        data-selected={data.selected ? "true" : undefined}
        data-lit={data.lit ? "true" : undefined}
        style={{ width: ORG_NODE_W, height: ORG_NODE_H }}
        className={`flex flex-col rounded-lg border bg-card text-left text-card-foreground shadow-sm ${ring} ${company ? "bg-muted" : ""}`}
      >
        <button
          type="button"
          data-testid={`org-open-${data.nodeId}`}
          disabled={company}
          onClick={() => data.onSelect?.(data.nodeId)}
          className={`flex min-h-0 flex-1 flex-col gap-1 rounded-t-lg px-3 pt-2 text-left ${company ? "cursor-default" : "cursor-pointer hover:bg-accent"}`}
        >
          <span className="line-clamp-1 text-sm font-semibold leading-tight">{data.name}</span>
          {company ? null : (
            <span className="flex items-center gap-2 text-xs">
              {data.head ? (
                <PersonAvatar
                  id={data.head.id}
                  name={data.head.name}
                  src={data.head.avatar ?? null}
                  size={24}
                  interactive={false}
                />
              ) : null}
              <span
                data-testid="org-head"
                className={`min-w-0 flex-1 truncate ${data.head ? "" : "text-muted-foreground"}`}
              >
                {data.head ? data.head.name : data.labels.noHead}
              </span>
            </span>
          )}
          <span className="text-xs text-muted-foreground" data-testid="org-count">
            {data.labels.people(data.count)}
            {data.hasChildren ? ` ${data.labels.peopleTotal(data.total)}` : ""}
          </span>
        </button>
        <div className="nodrag nopan flex h-9 items-center px-3 pb-2">
          {staff.length > 0 ? (
            <PersonAvatarGroup
              people={staff}
              size={24}
              testId="org-card-avatars"
              className="min-h-6"
            />
          ) : null}
        </div>
      </div>
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
