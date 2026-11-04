// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend FB1/FB2/FB4/FB9, ADR-0013): canvas editor — lazy chunk `canvas`.
// CR-118 · cr118-flow-canvas: khung xyflow, bố cục, node khung (tiêu đề cột, join), cạnh quay lại/rẽ nhánh, fit/kéo nằm ở `@ai/flow-canvas`
// (mode "edit", layout "columns"); file này giữ phần NGHIỆP VỤ: dựng node giai đoạn từ bản nháp, luật thả (`ops.setStep` x chốt cột + `ops.setY`
// y tự do, lưu `ui.y`; cột đầy ⇒ trượt về chỗ cũ). nodes/edges là DẪN XUẤT từ bản nháp (không giữ state riêng).
import { FlowCanvas, type FlowLabels, toEdge } from "@ai/flow-canvas";
import {
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
import type { Node, XYPosition } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { countAtStep } from "../../lib/step-ops";
import { type CanvasHandlers, HandlersCtx } from "./canvas-ctx";
import { IfNode } from "./IfNode";
import { StageNode } from "./StageNode";
import type { StageView } from "./stage-view";
import { stepHeaderLabels } from "./stage-view";

const nodeTypes = { stage: StageNode, if: IfNode };

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

function useFlowGraph(p: ProcessCanvasProps) {
  const { views, selected, readOnly } = p;
  return useMemo(() => {
    const lay = layoutSteps(views);
    const byUid = new Map(views.map((v) => [v.uid, v]));
    const labels = stepHeaderLabels(views);
    const nodes = lay.nodes.map((n) => toNode(n, byUid, selected, readOnly, labels));
    // dlc-engine · bước DLC và bước duyệt không nối với nhau (một sơ đồ chỉ một loại bước).
    const fam = (id: string) => byUid.get(id)?.family ?? null;
    const linked = lay.edges.filter((e) => {
      const [a, b] = [fam(e.source), fam(e.target)];
      return a === null || b === null || a === b;
    });
    return { nodes, edges: linked.map(toEdge), steps: lay.steps };
  }, [views, selected, readOnly]);
}

function useCanvasLabels(): Partial<FlowLabels> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      stepTitle: (n) => t("process.admin.canvas.step.title", { n }),
      addToStep: (n) => t("process.admin.canvas.step.addTo", { n }),
      join: (n) => t("process.admin.canvas.join", { n }),
      edgeBack: t("process.admin.canvas.edge.back"),
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
    [t],
  );
}

export default function ProcessCanvas(p: ProcessCanvasProps) {
  const [tick, setTick] = useState(0);
  const [blocked, setBlocked] = useState<number | null>(null);
  const handlers = useRef<CanvasHandlers>(p);
  handlers.current = p;
  const g = useFlowGraph(p);
  const labels = useCanvasLabels();
  const onAddToStep = useCallback((step: number) => handlers.current.ops.add(step), []);

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
      className={`${p.compact ? "h-[280px]" : "h-[min(70vh,640px)]"} overflow-hidden rounded-md border border-border bg-background`}
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
        />
      </HandlersCtx.Provider>
    </div>
  );
}
