// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend FB1/FB2/FB4/FB9, ADR-0013): canvas xyflow — lazy chunk `canvas`.
// nodes/edges là DẪN XUẤT từ bản nháp (không giữ state riêng); kéo thả `onNodeDragStop` ⇒ `ops.setStep`; cột đầy ⇒ trượt về chỗ cũ.
import "@xyflow/react/dist/base.css";
import {
  Background,
  Controls,
  type Node,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type XYPosition,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  HEADER_NODE_H,
  JOIN_H,
  JOIN_W,
  layoutSteps,
  NODE_H,
  NODE_W,
  stepFromDropX,
} from "../../lib/canvas-layout";
import { countAtStep } from "../../lib/step-ops";
import { BackEdge } from "./BackEdge";
import { BranchEdge } from "./BranchEdge";
import { BlockedStepCtx, type CanvasHandlers, HandlersCtx } from "./canvas-ctx";
import { toEdge } from "./canvas-edges";
import { IfNode } from "./IfNode";
import { JoinNode } from "./JoinNode";
import { StageNode } from "./StageNode";
import { StepHeaderNode } from "./StepHeaderNode";
import type { StageView } from "./stage-view";

const nodeTypes = { stage: StageNode, stepHeader: StepHeaderNode, join: JoinNode, if: IfNode };
const edgeTypes = { back: BackEdge, branch: BranchEdge };
// UAT L3: không thu dưới 0.65 (chữ ≥ ~9 px); nhiều bước thì neo về mép trái và để người dùng kéo ngang (pan).
const FIT_MIN_ZOOM = 0.65;
const FIT = { padding: 0.1, maxZoom: 1, minZoom: FIT_MIN_ZOOM } as const;
// `compact` (trang showcase, chỉ đọc): canvas thấp + cho thu nhỏ hơn để cả flow vừa khung và nằm giữa.
const FIT_COMPACT = { padding: 0.02, maxZoom: 1, minZoom: 0.4 } as const;
const reduceMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type ProcessCanvasProps = CanvasHandlers & {
  views: readonly StageView[];
  selected: string | undefined;
  /** Canvas thấp, vừa khít cả flow (trang showcase chỉ đọc). */
  compact?: boolean;
};

type Lay = ReturnType<typeof layoutSteps>;

const NODE_SIZE = {
  stage: { width: NODE_W, height: NODE_H },
  join: { width: JOIN_W, height: JOIN_H },
  stepHeader: { width: NODE_W, height: HEADER_NODE_H },
} as const;

function toNode(
  n: Lay["nodes"][number],
  byUid: Map<string, StageView>,
  selected: string | undefined,
  readOnly: boolean | undefined,
): Node {
  // `measured` đặt sẵn (kích thước đã biết) ⇒ xyflow không ẩn node chờ đo mỗi lần bố cục đổi.
  const isIfNode = n.kind === "stage" && byUid.get(n.id)?.ifs != null;
  const base = {
    id: n.id,
    position: { x: n.x, y: n.y },
    type: isIfNode ? "if" : n.kind,
    measured: NODE_SIZE[n.kind],
    selectable: false,
    focusable: false,
  };
  if (n.kind === "stage")
    return {
      ...base,
      data: { v: byUid.get(n.id), selected: n.id === selected, readOnly },
      draggable: !readOnly,
    };
  const data =
    n.kind === "stepHeader" ? { step: n.step, full: n.full, readOnly } : { count: n.count };
  return { ...base, data, draggable: false };
}

function useFlowGraph(p: ProcessCanvasProps, resetTick: number) {
  const { views, selected, readOnly } = p;
  // `resetTick` ép tạo lại mảng nodes ⇒ node bị từ chối trượt về vị trí gốc.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetTick chủ ý
  return useMemo(() => {
    const lay = layoutSteps(views);
    const byUid = new Map(views.map((v) => [v.uid, v]));
    const nodes = lay.nodes.map((n) => toNode(n, byUid, selected, readOnly));
    return { nodes, edges: lay.edges.map(toEdge), steps: lay.steps };
  }, [views, selected, readOnly, resetTick]);
}

function Flow(p: ProcessCanvasProps) {
  const { t } = useTranslation();
  const rf = useReactFlow();
  const [tick, setTick] = useState(0);
  const [blocked, setBlocked] = useState<number | null>(null);
  const handlers = useRef<CanvasHandlers>(p);
  handlers.current = p;
  const g = useFlowGraph(p, tick);
  // Kéo: xyflow ở chế độ điều khiển chỉ phát `position`; ta ghi vị trí tạm để node đi theo chuột, thả xong thì xoá.
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
  const nodes = useMemo(
    () =>
      Object.keys(drag).length
        ? g.nodes.map((n) => (drag[n.id] ? { ...n, position: drag[n.id] as XYPosition } : n))
        : g.nodes,
    [g.nodes, drag],
  );
  const stepsKey = `${g.steps}:${p.views.length}`;
  // chỉ khi số bước / số giai đoạn đổi (`rf` ổn định)
  // biome-ignore lint/correctness/useExhaustiveDependencies: stepsKey chủ ý
  useEffect(() => {
    const id = window.setTimeout(
      () =>
        void rf
          .fitView({ ...(p.compact ? FIT_COMPACT : FIT), duration: reduceMotion() ? 0 : 200 })
          .then(() => {
            const v = rf.getViewport();
            if (!p.compact && v.zoom <= FIT_MIN_ZOOM + 0.001) void rf.setViewport({ ...v, x: 16 });
          }),
      60,
    );
    return () => window.clearTimeout(id);
  }, [stepsKey]);

  const target = (node: Node): { v: StageView; step: number } | null => {
    const v = p.views.find((x) => x.uid === node.id);
    const x = (lastPos.current[node.id] ?? node.position).x;
    return v ? { v, step: stepFromDropX(x, g.steps) } : null;
  };
  const onDrag = (_: unknown, node: Node) => {
    const t0 = target(node);
    const full =
      t0 && t0.step !== t0.v.step && countAtStep(p.views, t0.step, t0.v.uid) >= 3 ? t0.step : null;
    setBlocked((prev) => (prev === full ? prev : full));
  };
  const onDragStop = (_: unknown, node: Node) => {
    setBlocked(null);
    const t0 = target(node);
    lastPos.current = {};
    setDrag({});
    if (!t0) return;
    if (t0.step !== t0.v.step) p.ops.setStep(t0.v.index, t0.step);
    setTick((n) => n + 1);
  };

  return (
    <HandlersCtx.Provider value={handlers}>
      <BlockedStepCtx.Provider value={blocked}>
        <ReactFlow
          nodes={nodes}
          onNodesChange={onNodesChange}
          edges={g.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          aria-label={t("process.admin.canvas.title")}
          ariaLabelConfig={{
            "controls.ariaLabel": t("process.admin.canvas.controls.title"),
            "controls.zoomIn.ariaLabel": t("process.admin.canvas.controls.zoomIn"),
            "controls.zoomOut.ariaLabel": t("process.admin.canvas.controls.zoomOut"),
            "controls.fitView.ariaLabel": t("process.admin.canvas.controls.fit"),
          }}
          fitView
          fitViewOptions={p.compact ? FIT_COMPACT : FIT}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable={!p.readOnly}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          disableKeyboardA11y
          zoomOnScroll={false}
          preventScrolling={false}
          onNodeDrag={onDrag}
          onNodeDragStop={onDragStop}
        >
          <Background gap={20} />
          {p.compact ? null : <Controls showInteractive={false} />}
        </ReactFlow>
      </BlockedStepCtx.Provider>
    </HandlersCtx.Provider>
  );
}

export default function ProcessCanvas(p: ProcessCanvasProps) {
  return (
    <div
      className={`${p.compact ? "h-[280px]" : "h-[520px]"} overflow-hidden rounded-md border border-border bg-background`}
    >
      <ReactFlowProvider>
        <Flow {...p} />
      </ReactFlowProvider>
    </div>
  );
}
