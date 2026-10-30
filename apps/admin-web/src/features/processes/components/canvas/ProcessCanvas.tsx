// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend FB1/FB2/FB4/FB9, ADR-0013): canvas xyflow — lazy chunk `canvas`.
// nodes/edges là DẪN XUẤT từ bản nháp (không giữ state riêng); kéo thả `onNodeDragStop` ⇒ `ops.setStep` (x chốt cột) + `ops.setY`
// (y tự do, lưu `ui.y`); cột đầy ⇒ trượt về chỗ cũ.
import "@xyflow/react/dist/base.css";
import {
  Background,
  Controls,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type XYPosition,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  HEADER_H,
  HEADER_NODE_H,
  JOIN_H,
  JOIN_W,
  layoutSteps,
  NODE_H,
  NODE_W,
  ROW_H,
  revealDx,
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
// fnr-canvas-fit: editor vừa khung cả flow (thu tới 0.3 = mức zoom tối thiểu của canvas; dưới nữa thì người dùng kéo/zoom tay), vừa lại khi khung đổi cỡ.
const FIT = { padding: 0.08, maxZoom: 1, minZoom: 0.3 } as const;
/** Fit vào vùng canvas còn lại bên trái ngăn chi tiết rộng `inset` (px) — tự tính viewport, không dùng padding có đơn vị. */
function fitBesideDrawer(
  rf: ReactFlowInstance,
  size: { w: number; h: number },
  inset: number,
  ms: number,
) {
  const b = getNodesBounds(rf.getNodes());
  const v = getViewportForBounds(
    b,
    Math.max(size.w - inset, 200),
    size.h,
    FIT.minZoom,
    FIT.maxZoom,
    FIT.padding,
  );
  return rf.setViewport(v, { duration: ms });
}
/** Fit khi tải / "Sắp xếp" / đổi cỡ khung: cả flow vừa khung (chừa ngăn chi tiết nếu đang mở). */
function runFit(
  rf: ReactFlowInstance,
  size: { w: number; h: number },
  inset: number,
  compact: boolean,
) {
  const ms = reduceMotion() ? 0 : 200;
  if (compact) return rf.fitView({ ...FIT_COMPACT, duration: ms });
  const done =
    inset > 0 ? fitBesideDrawer(rf, size, inset, ms) : rf.fitView({ ...FIT, duration: ms });
  return done.then(() => {
    // quá rộng cho cả mức zoom nhỏ nhất ⇒ neo mép trái (bước đầu luôn thấy), phần còn lại kéo ngang
    const v = rf.getViewport();
    if (v.zoom <= FIT.minZoom + 0.001) void rf.setViewport({ ...v, x: 16 });
  });
}
// `compact` (trang showcase, chỉ đọc): canvas thấp + cho thu nhỏ hơn để cả flow vừa khung và nằm giữa.
const FIT_COMPACT = { padding: 0.02, maxZoom: 1, minZoom: 0.4 } as const;
const reduceMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type ProcessCanvasProps = CanvasHandlers & {
  views: readonly StageView[];
  selected: string | undefined;
  /** Canvas thấp, vừa khít cả flow (trang showcase chỉ đọc). */
  compact?: boolean;
  /** Đổi giá trị ⇒ canvas fit lại khung nhìn (sau "Sắp xếp"). */
  fitKey?: number;
  /** Bề rộng (px) ngăn chi tiết đang đè lên mép phải canvas (0 = không): fit chừa chỗ, chọn node dưới ngăn ⇒ pan vào. */
  inset?: number;
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
      draggable: !readOnly && !byUid.get(n.id)?.locked,
    };
  const data =
    n.kind === "stepHeader" ? { step: n.step, full: n.full, readOnly } : { count: n.count };
  return { ...base, data, draggable: false };
}

/** Kẹp y thả vào khung nội dung (dưới tiêu đề, không quá hàng thấp nhất + một hàng) để node không rơi khỏi vùng nhìn. */
function clampY(y: number, nodes: readonly Node[]): number {
  const ys = nodes.filter((n) => n.type === "stage" || n.type === "if").map((n) => n.position.y);
  return Math.min(Math.max(y, HEADER_H), Math.max(...ys, HEADER_H) + ROW_H);
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
  // khung đổi cỡ (mở/đóng panel giai đoạn, resize cửa sổ) ⇒ fit lại; còn lại giữ pan/zoom của người dùng
  const box = useStore((s) => `${Math.round(s.width / 8)}x${Math.round(s.height / 8)}`);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const widthRef = useRef(0);
  widthRef.current = width;
  const inset = useRef(0);
  inset.current = p.inset ?? 0;
  const stepsKey = `${g.steps}:${p.views.length}:${p.fitKey ?? 0}:${box}`;
  // chỉ khi số bước / số giai đoạn / "Sắp xếp" / cỡ khung đổi (`rf` ổn định)
  // biome-ignore lint/correctness/useExhaustiveDependencies: stepsKey chủ ý
  useEffect(() => {
    const size = { w: width, h: height };
    const id = window.setTimeout(() => void runFit(rf, size, inset.current, !!p.compact), 60);
    return () => window.clearTimeout(id);
  }, [stepsKey]);

  // chọn node nằm dưới ngăn chi tiết ⇒ pan vào vùng thấy được (không đổi zoom, không fit lại khi mở/đóng ngăn)
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khi đổi node chọn / bật tắt ngăn
  useEffect(() => {
    const sel = p.selected;
    if (!sel || inset.current <= 0) return;
    const id = window.setTimeout(() => {
      const n = rf.getNode(sel);
      if (!n) return;
      const v = rf.getViewport();
      const left = n.position.x * v.zoom + v.x;
      const right = left + (n.measured?.width ?? NODE_W) * v.zoom;
      const dx = revealDx(left, right, widthRef.current, inset.current);
      if (dx !== 0)
        void rf.setViewport({ ...v, x: v.x + dx }, { duration: reduceMotion() ? 0 : 200 });
    }, 260);
    return () => window.clearTimeout(id);
  }, [p.selected, (p.inset ?? 0) > 0]);

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
  // fnr-canvas: kéo tự do — x chốt vào cột gần nhất (đổi bước theo luật cũ), y được LƯU (`ui.y`) khi thả; cột đầy ⇒ trượt về.
  const onDragStop = (_: unknown, node: Node) => {
    setBlocked(null);
    const t0 = target(node);
    const y = (lastPos.current[node.id] ?? node.position).y;
    const y0 = g.nodes.find((n) => n.id === node.id)?.position.y ?? y;
    lastPos.current = {};
    setDrag({});
    if (!t0) return;
    const moved = t0.step !== t0.v.step;
    if (moved) p.ops.setStep(t0.v.index, t0.step); // cột đầy ⇒ ops báo lỗi, bản nháp không đổi
    // Đổi cột ⇒ node vào vị trí tự động của cột mới (bỏ `ui.y` cũ); cùng cột ⇒ lưu y (kẹp trong khung nội dung để không rơi ra ngoài).
    if (moved) {
      if (!(countAtStep(p.views, t0.step, t0.v.uid) >= 3)) p.ops.setY(t0.v.uid, undefined);
    } else if (Math.abs(y - y0) >= 1) p.ops.setY(t0.v.uid, clampY(y, g.nodes));
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
      className={`${p.compact ? "h-[280px]" : "h-[min(70vh,640px)]"} overflow-hidden rounded-md border border-border bg-background`}
    >
      <ReactFlowProvider>
        <Flow {...p} />
      </ReactFlowProvider>
    </div>
  );
}
