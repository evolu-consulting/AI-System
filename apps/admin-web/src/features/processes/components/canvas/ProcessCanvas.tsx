// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend FB1/FB2/FB4/FB9, ADR-0013): canvas editor — lazy chunk `canvas`.
// CR-118 · cr118-flow-canvas: khung xyflow, bố cục, node khung (tiêu đề cột, join), cạnh quay lại/rẽ nhánh, fit/kéo nằm ở `@ai/flow-canvas`
// (mode "edit", layout "columns"); file này giữ phần NGHIỆP VỤ: dựng node giai đoạn từ bản nháp, luật thả (`ops.setStep` x chốt cột + `ops.setY`
// y tự do, lưu `ui.y`; cột đầy ⇒ trượt về chỗ cũ). nodes/edges là DẪN XUẤT từ bản nháp (không giữ state riêng).
// dlc-step-library: sơ đồ DLC ⇒ cạnh "Từ chối" tới NODE đích (không tới tiêu đề cột), cạnh tiến sau bước có cổng mang nhãn "Duyệt";
// `linkable` ⇒ kéo cổng "Từ chối" của bước nào có cổng cũng nối được (`ops.linkReject` kiểm đích đứng trước).
import { PROCESS_STAGES_MAX } from "@ai/contracts/hub-admin";
import { type EdgeInsertInfo, FlowCanvas, type FlowLabels, toEdge } from "@ai/flow-canvas";
import {
  COL_W,
  HEADER_H,
  HEADER_NODE_H,
  JOIN_H,
  JOIN_W,
  layoutSteps,
  NODE_H,
  NODE_W,
  ROW_H,
  stepFromDropX,
} from "@ai/flow-canvas/pure";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import { ChevronRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BridgeApi } from "../../hooks/use-bridge";
import { countAtStep } from "../../lib/step-ops";
import { useFlowCtx } from "../flow/flow-ctx";
import { BRIDGE_W, BridgeNode } from "./BridgeNode";
import { type CanvasHandlers, HandlersCtx } from "./canvas-ctx";
import { EdgeInsertMenu } from "./EdgeInsertMenu";
import { IfNode } from "./IfNode";
import { StageNode } from "./StageNode";
import type { StageView } from "./stage-view";
import { stepHeaderLabels } from "./stage-view";
import { TriggerNode } from "./TriggerNode";

const nodeTypes = { stage: StageNode, if: IfNode, trigger: TriggerNode, bridge: BridgeNode };

export type ProcessCanvasProps = CanvasHandlers & {
  views: readonly StageView[];
  selected: string | undefined;
  /** Canvas thấp, vừa khít cả flow (trang showcase chỉ đọc). */
  compact?: boolean;
  /** Đổi giá trị ⇒ canvas fit lại khung nhìn (sau "Sắp xếp"). */
  fitKey?: number;
  /** Bề rộng (px) ngăn chi tiết đang đè lên mép phải canvas (0 = không): fit chừa chỗ, chọn node dưới ngăn ⇒ pan vào. */
  inset?: number;
  /** CR-105 UX · mức zoom tối thiểu khi fit (quy trình khe: node đủ to đọc được; phần dư kéo ngang). Mặc định 0.3. */
  fitMin?: number;
  /** dlc-step-library · kéo cổng "Từ chối" của bước DLC sang bước đứng trước để đặt chỗ quay lại (Canvas thư viện, sửa được). */
  linkable?: boolean;
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
  labels: Map<number, number | null> | null,
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
    n.kind === "stepHeader"
      ? {
          step: n.step,
          full: n.full,
          ...(labels ? { label: labels.get(n.step) ?? null } : {}),
        }
      : { count: n.count };
  return { ...base, data, draggable: false };
}

/** Kẹp y thả vào khung nội dung (dưới tiêu đề, không quá hàng thấp nhất + một hàng) để node không rơi khỏi vùng nhìn. */
function clampY(y: number, nodes: readonly Node[]): number {
  const ys = nodes.filter((n) => n.type === "stage" || n.type === "if").map((n) => n.position.y);
  return Math.min(Math.max(y, HEADER_H), Math.max(...ys, HEADER_H) + ROW_H);
}

/** Cạnh tiến ra khỏi bước DLC có cổng = nhánh "Duyệt" (đi tiếp bước kế). */
const approveEdge = (e: Edge, label: string): Edge => ({
  ...e,
  label,
  labelStyle: { fill: "var(--color-success)", fontSize: 12 },
  labelBgStyle: { fill: "var(--color-card)" },
});

type TriggerInfo = { label: string; summary: string } | null;

/** CR-122 · U2c: node "Bắt đầu khi" ở cột đầu (x = −1 cột), nối tới mọi giai đoạn của bước đầu. */
function triggerPart(views: readonly StageView[], t: TriggerInfo): { node: Node[]; edges: Edge[] } {
  if (!t) return { node: [], edges: [] };
  const node: Node = {
    id: "trigger",
    type: "trigger",
    position: { x: -COL_W, y: HEADER_H },
    measured: NODE_SIZE.stage,
    selectable: false,
    focusable: false,
    draggable: false,
    data: t,
  };
  const edges = views
    .filter((v) => v.step === 0)
    .map((v) =>
      toEdge({ id: `trigger>${v.uid}`, source: "trigger", target: v.uid, kind: "forward" }),
    );
  return { node: [node], edges };
}

type WarnEdges = readonly {
  from: string;
  to: string;
  keys: string[];
  labels: string[];
  toName: string;
}[];
const NO_WARN: WarnEdges = [];

/** CR-122 · U2d: ô gợi ý cầu nối dưới mỗi cạnh vàng; có đề xuất ⇒ thêm cạnh nét đứt qua ô (xem trước node Ghi giá trị mờ). */
function bridgePart(
  nodes: readonly Node[],
  warn: WarnEdges,
  api: BridgeApi | undefined,
): { node: Node[]; edges: Edge[] } {
  if (!api) return { node: [], edges: [] };
  const out: { node: Node[]; edges: Edge[] } = { node: [], edges: [] };
  for (const w of warn) {
    const a = nodes.find((n) => n.id === w.from);
    const b = nodes.find((n) => n.id === w.to);
    if (!a || !b) continue;
    const id = `bridge:${w.from}>${w.to}`;
    const ok = api.ui(w).kind === "ok";
    out.node.push({
      id,
      type: "bridge",
      position: {
        // ô đặt lệch về bên trái cạnh để câu không bị mép phải khung cắt
        x: (a.position.x + NODE_W + b.position.x) / 2 - BRIDGE_W * 0.8,
        y: Math.max(a.position.y, b.position.y) + NODE_H + 28,
      },
      measured: { width: BRIDGE_W, height: ok ? 150 : 76 },
      selectable: false,
      focusable: false,
      draggable: false,
      data: { from: w.from, to: w.to, keys: w.keys, labels: w.labels, toName: w.toName },
    });
    if (ok)
      for (const [s, t] of [
        [w.from, id],
        [id, w.to],
      ] as const)
        out.edges.push({
          ...toEdge({ id: `${s}>${t}`, source: s, target: t, kind: "forward" }),
          style: { strokeDasharray: "5 4" },
        });
  }
  return out;
}

/** CR-122 · FR-26 · cạnh vàng: bước sau cần đầu vào mà bước trước không có (nét vàng + nhãn, không chỉ màu). */
function warnStyle(edges: Edge[], warn: WarnEdges): Edge[] {
  if (warn.length === 0) return edges;
  const bad = new Set(warn.map((w) => `${w.from}>${w.to}`));
  return edges.map((e) =>
    bad.has(`${e.source}>${e.target}`)
      ? {
          ...e,
          label: "⚠",
          style: { stroke: "var(--color-warning)", strokeWidth: 2.5 },
          labelStyle: { fill: "var(--color-warning)", fontSize: 12 },
          labelBgStyle: { fill: "var(--color-card)" },
        }
      : e,
  );
}

function useFlowGraph(
  p: ProcessCanvasProps,
  approve: string,
  trig: TriggerInfo,
  warn: WarnEdges,
  bridge: BridgeApi | undefined,
  insertable: boolean,
) {
  const { views, selected, readOnly } = p;
  return useMemo(() => {
    const dlc = views.some((v) => v.dlc);
    const lay = layoutSteps(views, dlc ? { back: "node" } : {});
    const byUid = new Map(views.map((v) => [v.uid, v]));
    const labels = stepHeaderLabels(views);
    const nodes = lay.nodes.map((n) => toNode(n, byUid, selected, readOnly, labels));
    // dlc-engine · bước DLC và bước duyệt không nối với nhau (một sơ đồ chỉ một loại bước).
    const fam = (id: string) => byUid.get(id)?.family ?? null;
    const linked = lay.edges.filter((e) => {
      const [a, b] = [fam(e.source), fam(e.target)];
      return a === null || b === null || a === b;
    });
    const gated = (id: string) => byUid.get(id)?.dlc?.gate === true;
    // CR-122 · P8: cạnh tiến giữa hai node có nút "+" (kiểu `forward`) khi sơ đồ sửa được và có bảng node.
    const mk = (e: (typeof linked)[number]): Edge => {
      const base = toEdge(e);
      return insertable && e.kind === "forward" && byUid.has(e.source) && byUid.has(e.target)
        ? { ...base, type: "forward" }
        : base;
    };
    const edges = linked.map((e) =>
      e.kind === "forward" && gated(e.source) ? approveEdge(mk(e), approve) : mk(e),
    );
    const tp = triggerPart(views, trig);
    const bp = bridgePart(nodes, warn, bridge);
    // CR-122 · C: flow bỏ hàng tiêu đề cột "Bước n" + nút + đầu cột (thêm bước qua menu "Thêm bước"); cạnh nối tới tiêu đề cũng bỏ.
    const isHeader = (id: string) => /^h\d+$/.test(id);
    const shown = trig ? nodes.filter((n) => n.type !== "stepHeader") : nodes;
    const shownEdges = trig
      ? edges.filter((e) => !isHeader(e.source) && !isHeader(e.target))
      : edges;
    return {
      nodes: [...tp.node, ...shown, ...bp.node],
      edges: warnStyle([...tp.edges, ...shownEdges, ...bp.edges], warn),
      steps: lay.steps,
      dlc,
    };
  }, [views, selected, readOnly, approve, trig, warn, bridge, insertable]);
}

function useCanvasLabels(dlc: boolean): Partial<FlowLabels> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      stepTitle: (n) => t("process.admin.canvas.step.title", { n }),
      addToStep: (n) => t("process.admin.canvas.step.addTo", { n }),
      join: (n) => t("process.admin.canvas.join", { n }),
      edgeBack: t(dlc ? "process.admin.library.dlc.reject" : "process.admin.canvas.edge.back"),
      edgeBranch: (n) => t("process.admin.canvas.edge.branch", { n }),
      yes: t("process.admin.canvas.if.yes"),
      no: t("process.admin.canvas.if.no"),
      canvas: t("process.admin.canvas.title"),
      controls: {
        title: t("process.admin.canvas.controls.title"),
        zoomIn: t("process.admin.canvas.controls.zoomIn"),
        zoomOut: t("process.admin.canvas.controls.zoomOut"),
        fit: t("process.admin.canvas.controls.fit"),
      },
    }),
    [t, dlc],
  );
}

export default function ProcessCanvas(p: ProcessCanvasProps) {
  const [tick, setTick] = useState(0);
  const [blocked, setBlocked] = useState<number | null>(null);
  const handlers = useRef<CanvasHandlers>(p);
  handlers.current = p;
  const { t } = useTranslation();
  const flowCtx = useFlowCtx();
  const tc = flowCtx?.trigger;
  const tLabel = tc?.label;
  const tSummary = tc?.summary;
  const trig = useMemo(
    () => (tLabel === undefined ? null : { label: tLabel, summary: tSummary ?? "" }),
    [tLabel, tSummary],
  );
  const warn = flowCtx?.warnEdges ?? NO_WARN;
  const insertable = !!flowCtx && !p.readOnly;
  const g = useFlowGraph(
    p,
    t("process.admin.library.dlc.approve"),
    trig,
    warn,
    flowCtx?.bridge,
    insertable,
  );
  const labels = useCanvasLabels(g.dlc);
  const room = PROCESS_STAGES_MAX - p.views.length;
  const renderEdgeInsert = useMemo(
    () =>
      insertable
        ? (e: EdgeInsertInfo) => (
            <EdgeInsertMenu
              edge={{ from: e.source, to: e.target, side: e.side }}
              ops={handlers.current.ops}
              room={room}
            />
          )
        : undefined,
    [insertable, room],
  );
  const onAddToStep = useCallback((step: number) => handlers.current.ops.add(step), []);
  const onConnect = useCallback(
    (c: { source: string; target: string; sourceHandle?: string | null }) => {
      if (c.sourceHandle === "back") handlers.current.ops.linkReject(c.source, c.target);
    },
    [],
  );

  const target = (node: Node, pos: XYPosition): { v: StageView; step: number } | null => {
    const v = p.views.find((x) => x.uid === node.id);
    return v ? { v, step: stepFromDropX(pos.x, g.steps) } : null;
  };
  const onDrag = (node: Node, pos: XYPosition) => {
    const t0 = target(node, pos);
    const full =
      t0 && t0.step !== t0.v.step && countAtStep(p.views, t0.step, t0.v.uid) >= 3 ? t0.step : null;
    setBlocked((prev) => (prev === full ? prev : full));
  };
  // fnr-canvas: kéo tự do — x chốt vào cột gần nhất (đổi bước theo luật cũ), y được LƯU (`ui.y`) khi thả; cột đầy ⇒ trượt về.
  const onDragStop = (node: Node, pos: XYPosition) => {
    setBlocked(null);
    const t0 = target(node, pos);
    const y = pos.y;
    const y0 = g.nodes.find((n) => n.id === node.id)?.position.y ?? y;
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
    <div
      className={`${p.compact ? "h-[280px]" : trig ? "h-[min(62vh,460px)]" : "h-[min(70vh,640px)]"} relative overflow-hidden rounded-md border border-border bg-background`}
    >
      <HandlersCtx.Provider value={handlers}>
        <FlowCanvas
          layout="columns"
          mode={p.readOnly ? "view" : "edit"}
          nodes={g.nodes}
          edges={g.edges}
          nodeTypes={nodeTypes}
          labels={labels}
          onAddToStep={onAddToStep}
          renderEdgeInsert={renderEdgeInsert}
          blockedStep={blocked}
          controls={!p.compact}
          compact={p.compact}
          fitSig={`${g.steps}:${p.views.length}`}
          fitKey={p.fitKey}
          inset={p.inset}
          fitMin={p.fitMin}
          selectedId={p.selected}
          resetKey={tick}
          onNodeDrag={onDrag}
          onNodeDragStop={onDragStop}
          onConnect={p.linkable && !p.readOnly ? onConnect : undefined}
        />
      </HandlersCtx.Provider>
      {trig && g.steps >= 4 ? <MoreRight label={t("process.admin.flow.moreRight")} /> : null}
    </div>
  );
}

/** CR-122 · U2e: flow dài hơn khung ⇒ bóng mờ + mũi tên ở mép phải báo "còn bước bên phải" (kéo ngang để xem). */
function MoreRight({ label }: { label: string }) {
  return (
    <div
      aria-hidden
      title={label}
      className="pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end bg-gradient-to-l from-background to-transparent pr-1 text-muted-foreground"
    >
      <ChevronRight className="size-5" />
    </div>
  );
}
