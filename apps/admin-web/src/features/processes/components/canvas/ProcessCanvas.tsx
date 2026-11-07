// ADM-FR-71 · HUB-FR-104 · P-b2 (plan-frontend FB1/FB2/FB4/FB9, ADR-0013): canvas editor — lazy chunk `canvas`.
// CR-118 · cr118-flow-canvas: khung xyflow, cạnh quay lại/rẽ nhánh, fit/kéo nằm ở `@ai/flow-canvas` (mode "edit", layout "flow");
// CR-123 · u13: VỊ TRÍ node do ELK `layered` tính (gập hàng, cổng ra cố định thứ tự, cạnh vuông góc) mỗi khi cấu trúc đổi; node người dùng kéo tay
// giữ vị trí đã lưu (`ui.x` + `ui.y`), "Sắp xếp" xoá vị trí tay. File này giữ phần NGHIỆP VỤ: dựng node giai đoạn từ bản nháp. nodes/edges là DẪN XUẤT từ bản nháp.
// dlc-step-library: sơ đồ DLC ⇒ cạnh "Từ chối" tới NODE đích (không tới tiêu đề cột), cạnh tiến sau bước có cổng mang nhãn "Duyệt";
// `linkable` ⇒ kéo cổng "Từ chối" của bước nào có cổng cũng nối được (`ops.linkReject` kiểm đích đứng trước).

import type { LayoutDir } from "@ai/contracts/hub-admin";
import {
  type EdgeInsertInfo,
  FlowCanvas,
  type FlowLabels,
  type FlowPositions,
  toEdge,
  useFlowLayout,
} from "@ai/flow-canvas";
import {
  collidesWith,
  type FlowEdgeIn,
  type FlowNodeIn,
  NODE_H,
  NODE_W,
  portExtent,
  type SettleItem,
  settlePositions,
  stepEdges,
} from "@ai/flow-canvas/pure";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BridgeApi } from "../../hooks/use-bridge";
import { useStagesMax } from "../../hooks/use-stages-max";
import { exitHandle } from "../../lib/canvas-connect";
import { dropFreeEdges, isFree } from "../../lib/free-nodes";
import { applyJumps } from "../../lib/jump-edges";
import { isNarrowScreen } from "../../lib/layout-dir";
import { useFlowCtx } from "../flow/flow-ctx";
import { useLibraryCanvas } from "../library/library-canvas-ctx";
import { BridgeNode } from "./BridgeNode";
import { type CanvasHandlers, DirCtx, HandlersCtx } from "./canvas-ctx";
import {
  approveEdge,
  bridgePart,
  editableEdges,
  NO_WARN,
  NODE_SIZE,
  type TriggerInfo,
  triggerPart,
  type WarnEdges,
  warnStyle,
} from "./canvas-parts";
import { EdgeInsertMenu } from "./EdgeInsertMenu";
import { isTerminalView } from "./FlowNodeBody";
import { IfNode } from "./IfNode";
import { moduleEdges, withMainExit } from "./module-cluster";
import { StageNode } from "./StageNode";
import type { StageView } from "./stage-view";
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
  /** CR-125 · x9 · hướng bố cục: `RIGHT` Ngang (mặc định) / `DOWN` Dọc — ELK, mép cổng vào/ra của node và vùng chừa cho nhãn đầu ra theo hướng này. */
  dir?: LayoutDir;
  /** dlc-step-library · kéo cổng "Từ chối" của bước DLC sang bước đứng trước để đặt chỗ quay lại (Canvas thư viện, sửa được). */
  linkable?: boolean;
};

/** Cổng ra (id = `sourceHandle`) của node, từ trên xuống: Nếu ⇒ Đúng, Sai; ô module ⇒ các đầu ra khai báo (Ký xong / Từ chối / Hết hạn…). */
function portsOf(v: StageView): string[] | undefined {
  if (v.ifs != null) return ["yes", "no"];
  const exits = v.module?.exits;
  return exits && exits.length > 1 ? exits.map((x) => exitHandle(x.key, x.on)) : undefined;
}

function toNode(
  v: StageView,
  at: { x: number; y: number },
  selected: string | undefined,
  readOnly: boolean | undefined,
  connectable: boolean,
): Node {
  // `measured` đặt sẵn (kích thước đã biết) ⇒ xyflow không ẩn node chờ đo mỗi lần bố cục đổi.
  return {
    id: v.uid,
    position: at,
    type: v.ifs != null ? "if" : "stage",
    measured: NODE_SIZE,
    selectable: connectable,
    focusable: false,
    data: { v, selected: v.uid === selected, readOnly, connectable },
    draggable: !readOnly && !v.locked,
  };
}

/** Đồ thị CẤU TRÚC (chưa có toạ độ): node + cạnh cuối cùng, và đầu vào của ELK. Chỉ đổi khi bản nháp đổi (không phụ thuộc chọn / kéo). */
function useFlowStructure(
  p: ProcessCanvasProps,
  approve: string,
  trig: TriggerInfo,
  insertable: boolean,
  connectable: boolean,
) {
  const { views } = p;
  return useMemo(() => {
    const dlc = views.some((v) => v.dlc);
    const byUid = new Map(views.map((v) => [v.uid, v]));
    // CR-122 · C: flow có "Bắt đầu khi" bỏ cạnh quay lại tới bước đầu (không còn tiêu đề cột để neo)
    const lay = stepEdges(
      views.map((v) => ({ ...v, terminal: isTerminalView(v) })),
      { back: !trig },
    );
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
      lay,
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
    const tp = triggerPart(views, trig, connectable);
    // node đứng riêng (vừa thả) không có cạnh tự động vào/ra: nối bằng mũi tên (CR-123 · u5)
    const free = new Set(views.filter((v) => isFree(v.src)).map((v) => v.uid));
    const all = withMainExit(
      dropFreeEdges([...tp.edges, ...edges, ...moduleEdges(views)], free),
      views,
    );
    // ELK: cạnh quay lại không tham gia xếp tầng (giữ luồng trái → phải)
    const flowEdges: FlowEdgeIn[] = all
      .filter((e) => e.type !== "back")
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
      }));
    const flowNodes: FlowNodeIn[] = [
      ...(trig ? [{ id: "trigger" }] : []),
      ...views.map((v) => ({ id: v.uid, ports: portsOf(v) })),
    ];
    return { edges: all, flowNodes, flowEdges, dlc, tp };
  }, [views, approve, trig, insertable, connectable]);
}

/**
 * CR-125 · x4 · đầu vào của `settlePositions`: vị trí kéo tay (đã lưu) + toạ độ ELK của từng node. Vị trí tay chỉ được giữ khi không đè node nào
 * (đè ⇒ node quay về toạ độ ELK); chưa có cả hai ⇒ node chưa hiện (chờ lượt bố cục đầu).
 */
function settleItems(
  views: readonly StageView[],
  auto: FlowPositions | null,
  trig: TriggerInfo,
  dir: LayoutDir,
): SettleItem[] {
  const box = (v: StageView) => {
    const x = portExtent(dir, portsOf(v)?.length ?? 0);
    return { w: NODE_W + x.w, h: NODE_H + x.h };
  };
  return [
    ...(trig ? [{ id: "trigger", auto: auto?.get("trigger") }] : []),
    ...views.map((v) => ({ id: v.uid, manual: v.pos, auto: auto?.get(v.uid), ...box(v) })),
  ];
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
  const s = useFlowStructure(p, approve, trig, insertable, connectable);
  const dir = p.dir ?? "RIGHT";
  const auto = useFlowLayout(s.flowNodes, s.flowEdges, {
    direction: dir,
    ...(dir === "DOWN" ? { aspectRatio: isNarrowScreen() ? 0.8 : 1.8 } : {}),
  });
  return useMemo(() => {
    const at = settlePositions(settleItems(views, auto, trig, dir));
    const stageNodes = views.flatMap((v) => {
      const pt = at.get(v.uid);
      return pt ? [toNode(v, pt, selected, readOnly, connectable)] : [];
    });
    const tAt = at.get("trigger");
    const trigger = s.tp.node.flatMap((n) => (tAt ? [{ ...n, position: tAt }] : []));
    const bp = bridgePart(stageNodes, warn, bridge);
    const nodes = [...trigger, ...stageNodes, ...bp.node];
    const have = new Set(nodes.map((n) => n.id));
    const all = warnStyle([...s.edges, ...bp.edges], warn)
      .filter((e) => have.has(e.source) && have.has(e.target))
      .map((e) => (e.type === undefined ? { ...e, type: "routed" } : e)); // cạnh vuông góc NÉ node (CR-125 · x9)
    return {
      nodes,
      edges: connectable ? editableEdges(all, new Set(views.map((v) => v.uid))) : all,
      ready: auto !== null,
      dlc: s.dlc,
    };
  }, [s, auto, views, trig, dir, selected, readOnly, warn, bridge, connectable]);
}

/**
 * CR-123 · u14 · node đang làm việc: node mới thêm + hai đầu của cạnh mới (thả, nối, chèn, nối lại) — khung nhìn giữ chúng trọn trong khung sau mỗi lần ELK bố cục lại.
 * Lần dựng đầu (mở flow) không tính; "Sắp xếp" (`fitKey` đổi) xoá để fit toàn sơ đồ không bị kéo lệch.
 */
function useFocusIds(
  nodes: readonly Node[],
  edges: readonly Edge[],
  fitKey: number | undefined,
): string[] {
  const [focus, setFocus] = useState<string[]>([]);
  const seen = useRef<{ nodes: Set<string>; edges: Set<string> } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ khi "Sắp xếp"
  useEffect(() => {
    seen.current = null;
    setFocus([]);
  }, [fitKey]);
  useEffect(() => {
    if (nodes.length === 0) return;
    const now = { nodes: new Set(nodes.map((n) => n.id)), edges: new Set(edges.map((e) => e.id)) };
    const before = seen.current;
    seen.current = now;
    if (!before) return;
    const work = (id: string) => id !== "trigger" && !id.startsWith("bridge:");
    const ids = [
      ...nodes.map((n) => n.id).filter((id) => !before.nodes.has(id) && work(id)),
      ...edges.filter((e) => !before.edges.has(e.id)).flatMap((e) => [e.target, e.source]),
    ].filter((id, i, all) => work(id) && now.nodes.has(id) && all.indexOf(id) === i);
    if (ids.length > 0) setFocus(ids.slice(0, 3));
  }, [nodes, edges]);
  return focus;
}

function useCanvasLabels(dlc: boolean): Partial<FlowLabels> {
  const { t } = useTranslation();
  return useMemo(
    () => ({
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
        minimap: t("process.admin.canvas.controls.minimap"),
      },
    }),
    [t, dlc],
  );
}

export default function ProcessCanvas(p: ProcessCanvasProps) {
  const [tick, setTick] = useState(0);
  const dir = p.dir ?? "RIGHT";
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
  const focusIds = useFocusIds(g.nodes, g.edges, p.fitKey);
  const labels = useCanvasLabels(g.dlc);
  const room = useStagesMax() - (p.stageCount ?? p.views.length); // ô module = số stage thật của cụm
  // CR-123 · p25: kéo từ bảng mẫu, nối lại, chọn nhiều, xoá, chép/dán, hoàn tác, minimap (chỉ canvas sửa được của trình soạn).
  const ed = useCanvasEditing({
    enabled: connectable,
    palette: !!flowCtx,
    compact: !!p.compact,
    latest: { views: p.views, nodes: g.nodes, edges: g.edges, ops: p.ops },
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
  const onConnect = useCallback(
    (c: { source: string; target: string; sourceHandle?: string | null }) => {
      const ops = handlers.current.ops;
      if (c.sourceHandle === "back") ops.linkReject(c.source, c.target);
      else ops.connect(c);
    },
    [],
  );

  // CR-123 · u13: kéo tự do — vị trí (x, y) được LƯU (`ui.x` + `ui.y`) khi thả; thứ tự bước chỉ đổi bằng mũi tên.
  const onDragStop = (node: Node, pos: XYPosition, group?: { id: string; pos: XYPosition }[]) => {
    const moved = group && group.length > 0 ? group : [{ id: node.id, pos }];
    // CR-125 · x4: thả đè lên node khác ⇒ không lưu vị trí (node quay về chỗ cũ), sơ đồ không bao giờ có hai node chồng nhau
    const items = settleItems(p.views, null, trig, dir);
    const cur = new Map(g.nodes.map((n) => [n.id, n.position]));
    for (const m of moved) cur.set(m.id, m.pos);
    for (const m of moved) {
      if (collidesWith(m.pos, m.id, items, cur)) continue;
      const at = g.nodes.find((n) => n.id === m.id)?.position;
      const v = p.views.find((x) => x.uid === m.id);
      if (v && (!at || Math.abs(m.pos.x - at.x) >= 1 || Math.abs(m.pos.y - at.y) >= 1))
        p.ops.setPos(m.id, m.pos);
    }
    setTick((n) => n + 1);
  };

  return (
    <div
      className={`${p.compact ? "h-[280px]" : trig ? "h-[min(62vh,520px)]" : "h-[min(70vh,640px)]"} relative overflow-hidden rounded-md border border-border bg-background`}
    >
      <DirCtx.Provider value={dir}>
        <HandlersCtx.Provider value={handlers}>
          <FlowCanvas
            layout="flow"
            mode={p.readOnly ? "view" : "edit"}
            nodes={g.nodes}
            edges={g.edges}
            nodeTypes={nodeTypes}
            labels={labels}
            renderEdgeInsert={renderEdgeInsert}
            controls={!p.compact}
            compact={p.compact}
            fitSig={`${g.ready}:${g.nodes.length}:${dir}`}
            fitKey={p.fitKey}
            inset={p.inset}
            fitMin={p.fitMin}
            selectedId={p.selected}
            focusIds={focusIds}
            resetKey={tick}
            onNodeDragStop={onDragStop}
            onConnect={(p.linkable || connectable) && !p.readOnly ? onConnect : undefined}
            editing={ed.editing}
          />
          <CanvasDialogs pending={ed.pending} close={ed.close} views={p.views} ops={p.ops} />
        </HandlersCtx.Provider>
      </DirCtx.Provider>
    </div>
  );
}
