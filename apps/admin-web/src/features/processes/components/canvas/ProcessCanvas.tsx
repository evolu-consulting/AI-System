// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend FB1/FB2/FB4/FB9, ADR-0013): canvas editor — lazy chunk `canvas`.
// CR-118 · cr118-flow-canvas: khung xyflow, bố cục, node khung (tiêu đề cột, join), cạnh quay lại/rẽ nhánh, fit/kéo nằm ở `@ai/flow-canvas`
// (mode "edit", layout "columns"); file này giữ phần NGHIỆP VỤ: dựng node giai đoạn từ bản nháp, luật thả (`ops.setStep` x chốt cột + `ops.setY`
// y tự do, lưu `ui.y`; cột đầy ⇒ trượt về chỗ cũ). nodes/edges là DẪN XUẤT từ bản nháp (không giữ state riêng).
// dlc-step-library: sơ đồ DLC ⇒ cạnh "Từ chối" tới NODE đích (không tới tiêu đề cột), cạnh tiến sau bước có cổng mang nhãn "Duyệt";
// `linkable` ⇒ kéo cổng "Từ chối" của bước nào có cổng cũng nối được (`ops.linkReject` kiểm đích đứng trước).
import { type EdgeInsertInfo, FlowCanvas, type FlowLabels, toEdge } from "@ai/flow-canvas";
import { layoutSteps, stepFromDropX } from "@ai/flow-canvas/pure";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BridgeApi } from "../../hooks/use-bridge";
import { useStagesMax } from "../../hooks/use-stages-max";
import { collapseLoneJoins, dropFreeEdges, isFree } from "../../lib/free-nodes";
import { applyJumps } from "../../lib/jump-edges";
import { countAtStep } from "../../lib/step-ops";
import { useFlowCtx } from "../flow/flow-ctx";
import { useLibraryCanvas } from "../library/library-canvas-ctx";
import { BridgeNode } from "./BridgeNode";
import { type CanvasHandlers, HandlersCtx } from "./canvas-ctx";
import {
  approveEdge,
  bridgePart,
  clampY,
  editableEdges,
  MoreRight,
  NO_WARN,
  NODE_SIZE,
  type TriggerInfo,
  triggerPart,
  type WarnEdges,
  warnStyle,
} from "./canvas-parts";
import { EdgeInsertMenu } from "./EdgeInsertMenu";
import { IfNode } from "./IfNode";
import { moduleEdges } from "./module-cluster";
import { StageNode } from "./StageNode";
import type { StageView } from "./stage-view";
import { stepHeaderLabels } from "./stage-view";
import { TriggerNode } from "./TriggerNode";
import { CanvasDialogs, useCanvasEditing } from "./use-canvas-editing";

const nodeTypes = { stage: StageNode, if: IfNode, trigger: TriggerNode, bridge: BridgeNode };

export type ProcessCanvasProps = CanvasHandlers & {
  views: readonly StageView[];
  /** Số stage THẬT (views đã gộp ô module ít hơn) — tính chỗ còn lại cho trần số bước. Vắng ⇒ `views.length`. */
  stageCount?: number;
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

function toNode(
  n: Lay["nodes"][number],
  byUid: Map<string, StageView>,
  selected: string | undefined,
  readOnly: boolean | undefined,
  labels: Map<number, number | null> | null,
  connectable: boolean,
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
      selectable: connectable,
      data: { v: byUid.get(n.id), selected: n.id === selected, readOnly, connectable },
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

function useFlowGraph(
  p: ProcessCanvasProps,
  approve: string,
  trig: TriggerInfo,
  warn: WarnEdges,
  bridge: BridgeApi | undefined,
  insertable: boolean,
  connectable: boolean,
) {
  const { views, selected, readOnly } = p;
  return useMemo(() => {
    const dlc = views.some((v) => v.dlc);
    const lay = layoutSteps(views, dlc ? { back: "node" } : {});
    const byUid = new Map(views.map((v) => [v.uid, v]));
    const labels = stepHeaderLabels(views);
    const nodes = lay.nodes.map((n) => toNode(n, byUid, selected, readOnly, labels, connectable));
    // dlc-engine · bước DLC và bước duyệt không nối với nhau (một sơ đồ chỉ một loại bước).
    const fam = (id: string) => byUid.get(id)?.family ?? null;
    const jumped = applyJumps(
      views.map((v) => ({
        uid: v.uid,
        step: v.step,
        isIf: v.ifs != null,
        nextStep: v.src.nextStep,
        terminal: v.src.outcome !== undefined || v.src.executor === "wait_event",
      })),
      lay.edges,
    );
    const linked = jumped.filter((e) => {
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
    // node đứng riêng (vừa thả) không có cạnh tự động vào/ra: nối bằng mũi tên (CR-123 · u5)
    const free = new Set(views.filter((v) => isFree(v.src)).map((v) => v.uid));
    const kept = collapseLoneJoins(
      shown,
      dropFreeEdges([...tp.edges, ...shownEdges, ...moduleEdges(views), ...bp.edges], free),
    );
    const all = warnStyle(kept.edges, warn);
    return {
      nodes: [...tp.node, ...kept.nodes, ...bp.node],
      edges: connectable ? editableEdges(all, new Set(byUid.keys())) : all,
      steps: lay.steps,
      dlc,
    };
  }, [views, selected, readOnly, approve, trig, warn, bridge, insertable, connectable]);
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
  // CR-122 · p22 · kéo cổng ra để đặt đích: canvas sửa được, không phải canvas thư viện khe (ở đó chỉ cổng "Từ chối" của bước DLC).
  const lib = useLibraryCanvas();
  const connectable = !p.readOnly && !p.compact && !lib;
  const g = useFlowGraph(
    p,
    t("process.admin.library.dlc.approve"),
    trig,
    warn,
    flowCtx?.bridge,
    insertable,
    connectable,
  );
  const labels = useCanvasLabels(g.dlc);
  const room = useStagesMax() - (p.stageCount ?? p.views.length); // ô module = số stage thật của cụm
  // CR-123 · p25: kéo từ bảng mẫu, nối lại, chọn nhiều, xoá, chép/dán, hoàn tác, minimap (chỉ canvas sửa được của trình soạn).
  const ed = useCanvasEditing({
    enabled: connectable,
    palette: !!flowCtx,
    compact: !!p.compact,
    latest: { views: p.views, nodes: g.nodes, edges: g.edges, steps: g.steps, ops: p.ops },
  });
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
      const ops = handlers.current.ops;
      if (c.sourceHandle === "back") ops.linkReject(c.source, c.target);
      else ops.connect(c);
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
  // CR-123 · p25 · kéo nhóm: cả nhóm dời cùng số cột (luật cột giữ như kéo một node); không đổi cột ⇒ lưu y từng node.
  const dragGroup = (group: { id: string; pos: XYPosition }[], delta: number) => {
    const uids = group.map((x) => x.id).filter((id) => p.views.some((v) => v.uid === id));
    if (delta !== 0) p.ops.moveGroup(uids, delta);
    else
      for (const x of group) {
        const y0 = g.nodes.find((n) => n.id === x.id)?.position.y ?? x.pos.y;
        if (Math.abs(x.pos.y - y0) >= 1) p.ops.setY(x.id, clampY(x.pos.y, g.nodes));
      }
    setTick((n) => n + 1);
  };
  // fnr-canvas: kéo tự do — x chốt vào cột gần nhất (đổi bước theo luật cũ), y được LƯU (`ui.y`) khi thả; cột đầy ⇒ trượt về.
  const onDragStop = (node: Node, pos: XYPosition, group?: { id: string; pos: XYPosition }[]) => {
    setBlocked(null);
    const t0 = target(node, pos);
    if (group && group.length > 1 && t0) return dragGroup(group, t0.step - t0.v.step);
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
          onConnect={(p.linkable || connectable) && !p.readOnly ? onConnect : undefined}
          editing={ed.editing}
        />
        <CanvasDialogs pending={ed.pending} close={ed.close} views={p.views} ops={p.ops} />
      </HandlersCtx.Provider>
      {trig && g.steps >= 4 ? <MoreRight label={t("process.admin.flow.moreRight")} /> : null}
    </div>
  );
}
