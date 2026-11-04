// CR-118 · @ai/flow-canvas · MỘT canvas xyflow cho mọi sơ đồ quy trình: `layout` = "columns" (editor admin) | "vertical" (sơ đồ duyệt),
// `mode` = "view" | "edit". Nodes/edges do host dựng bằng hàm bố cục thuần của gói (`layoutSteps`/`buildFlowCanvas`) và đưa vào đây.
// Kéo thả (edit): xyflow ở chế độ điều khiển chỉ phát `position`; ta ghi vị trí tạm để node đi theo chuột, thả xong thì xoá và báo host.
// Chỉ nạp lười (`import()` ở host): kéo theo @xyflow/react.
import "@xyflow/react/dist/base.css";
import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  type XYPosition,
} from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { type ColumnsFitOptions, FIT, FIT_COMPACT, useColumnsFit } from "./columns-fit";
import { type FlowHost, FlowHostCtx } from "./context";
import { BackEdge } from "./edges/BackEdge";
import { BranchEdge } from "./edges/BranchEdge";
import { type FlowMode, interactionOf } from "./mode";
import { JoinNode } from "./nodes/JoinNode";
import { StepHeaderNode } from "./nodes/StepHeaderNode";
import { VERTICAL_NODE_TYPES } from "./nodes/VerticalNodes";
import {
  DEFAULT_LABELS,
  DEFAULT_THEME,
  type FlowLabels,
  type FlowTheme,
  type RenderStepInfo,
} from "./theme";

const COLUMNS_NODE_TYPES = { stepHeader: StepHeaderNode, join: JoinNode } satisfies NodeTypes;
const EDGE_TYPES = { back: BackEdge, branch: BranchEdge };
const VERTICAL_EDGE_DEFAULTS = {
  markerEnd: { type: MarkerType.ArrowClosed },
  style: { strokeWidth: 1.5 },
};
const VERTICAL_FIT = { padding: 0.15, maxZoom: 1 };

export type FlowCanvasProps = {
  layout: "columns" | "vertical";
  mode: FlowMode;
  nodes: readonly Node[];
  edges: readonly Edge[];
  /** Node do host cấp (vd `stage`, `if` của editor); gộp lên registry mặc định của gói. */
  nodeTypes?: NodeTypes;
  labels?: Partial<FlowLabels>;
  theme?: Partial<FlowTheme>;
  /** Dòng thông tin của node bước (sơ đồ duyệt). */
  renderInfo?: RenderStepInfo;
  /** Hiện nút thêm giai đoạn ở tiêu đề cột (chỉ `edit`, `columns`). */
  onAddToStep?: (step: number) => void;
  /** Cột đầy đang bị rê vào khi kéo. */
  blockedStep?: number | null;
  /** Hiện nút phóng/thu + fit (mặc định có). */
  controls?: boolean;
  // ---- chỉ `columns` ----
  compact?: boolean;
  fitSig?: string;
  fitKey?: number;
  inset?: number;
  fitMin?: number;
  selectedId?: string;
  /** Đổi giá trị ⇒ dựng lại mảng nodes (node bị từ chối trượt về vị trí gốc). */
  resetKey?: number;
  // ---- móc của host (edit) ----
  onNodeDrag?: (node: Node, pos: XYPosition) => void;
  onNodeDragStop?: (node: Node, pos: XYPosition) => void;
  onConnect?: (c: { source: string; target: string }) => void;
  onNodeClick?: (node: Node) => void;
};

function useHostValue(p: FlowCanvasProps): { host: FlowHost; labels: FlowLabels } {
  const labels = useMemo<FlowLabels>(() => ({ ...DEFAULT_LABELS, ...p.labels }), [p.labels]);
  const theme = useMemo<FlowTheme>(() => ({ ...DEFAULT_THEME, ...p.theme }), [p.theme]);
  const host = useMemo<FlowHost>(
    () => ({
      theme,
      labels,
      mode: p.mode,
      renderInfo: p.renderInfo,
      onAddToStep: p.onAddToStep,
      blockedStep: p.blockedStep ?? null,
    }),
    [theme, labels, p.mode, p.renderInfo, p.onAddToStep, p.blockedStep],
  );
  return { host, labels };
}

/** Kéo (edit): ghi vị trí tạm để node đi theo chuột; thả xong thì xoá và báo host (host quyết định giữ/trượt về). */
function useDragOverlay(p: FlowCanvasProps) {
  const [drag, setDrag] = useState<Record<string, XYPosition>>({});
  const lastPos = useRef<Record<string, XYPosition>>({});
  const onNodesChange = useCallback((cs: NodeChange[]) => {
    const moved: Record<string, XYPosition> = {};
    for (const c of cs)
      if (c.type === "position" && c.dragging && c.position) moved[c.id] = c.position;
    if (Object.keys(moved).length === 0) return;
    Object.assign(lastPos.current, moved);
    setDrag((d) => ({ ...d, ...moved }));
  }, []);
  const nodes = useMemo(() => {
    if (Object.keys(drag).length)
      return p.nodes.map((n) => (drag[n.id] ? { ...n, position: drag[n.id] as XYPosition } : n));
    // bản sao ⇒ xyflow nhận lại vị trí gốc của node bị từ chối
    return p.resetKey === undefined ? [...p.nodes] : p.nodes.map((n) => ({ ...n }));
  }, [p.nodes, drag, p.resetKey]);
  const posOf = (node: Node): XYPosition => lastPos.current[node.id] ?? node.position;
  const onNodeDrag = (_: unknown, node: Node) => p.onNodeDrag?.(node, posOf(node));
  const onNodeDragStop = (_: unknown, node: Node) => {
    const pos = posOf(node);
    lastPos.current = {};
    setDrag({});
    p.onNodeDragStop?.(node, pos);
  };
  return { nodes, onNodesChange, onNodeDrag, onNodeDragStop };
}

const ariaOf = (c: FlowLabels["controls"]) =>
  c && {
    "controls.ariaLabel": c.title,
    "controls.zoomIn.ariaLabel": c.zoomIn,
    "controls.zoomOut.ariaLabel": c.zoomOut,
    "controls.fitView.ariaLabel": c.fit,
  };

function Flow(p: FlowCanvasProps) {
  const columns = p.layout === "columns";
  const { host, labels } = useHostValue(p);
  const d = useDragOverlay(p);
  const it = interactionOf(p.mode, p);
  const nodeTypes = useMemo(
    () => ({ ...(columns ? COLUMNS_NODE_TYPES : VERTICAL_NODE_TYPES), ...p.nodeTypes }),
    [columns, p.nodeTypes],
  );
  const common = {
    nodes: d.nodes,
    edges: p.edges as Edge[],
    nodeTypes,
    nodesFocusable: false,
    edgesFocusable: false,
    deleteKeyCode: null,
    fitView: true,
    minZoom: 0.3,
    maxZoom: 1.5,
    nodesDraggable: it.nodesDraggable,
    nodesConnectable: it.nodesConnectable,
    elementsSelectable: it.elementsSelectable,
    onNodeDrag: d.onNodeDrag,
    onNodeDragStop: d.onNodeDragStop,
    onConnect: p.onConnect,
    onNodeClick: p.onNodeClick && ((_: unknown, n: Node) => p.onNodeClick?.(n)),
  } as const;
  const furniture = (
    <>
      <Background gap={20} />
      {p.controls === false ? null : <Controls showInteractive={false} />}
    </>
  );
  return (
    <FlowHostCtx.Provider value={host}>
      {columns ? (
        <>
          <ColumnsFit
            sig={p.fitSig ?? ""}
            fitKey={p.fitKey ?? 0}
            inset={p.inset ?? 0}
            compact={!!p.compact}
            fitMin={p.fitMin ?? FIT.minZoom}
            selected={p.selectedId}
          />
          <ReactFlow
            {...common}
            onNodesChange={d.onNodesChange}
            edgeTypes={EDGE_TYPES}
            aria-label={labels.canvas}
            ariaLabelConfig={ariaOf(labels.controls)}
            fitViewOptions={p.compact ? FIT_COMPACT : FIT}
            disableKeyboardA11y
            zoomOnScroll={false}
            preventScrolling={false}
          >
            {furniture}
          </ReactFlow>
        </>
      ) : (
        <ReactFlow
          {...common}
          defaultEdgeOptions={VERTICAL_EDGE_DEFAULTS}
          fitViewOptions={VERTICAL_FIT}
          onNodesChange={it.nodesDraggable ? d.onNodesChange : undefined}
        >
          {furniture}
        </ReactFlow>
      )}
    </FlowHostCtx.Provider>
  );
}
/** Khung nhìn của canvas `columns` (đứng trong `ReactFlowProvider`, không vẽ gì). */
function ColumnsFit(o: ColumnsFitOptions): null {
  useColumnsFit(o);
  return null;
}

export function FlowCanvas(p: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Flow {...p} />
    </ReactFlowProvider>
  );
}
