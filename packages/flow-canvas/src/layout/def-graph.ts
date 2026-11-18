// CR-184 · sơ đồ CHỈ XEM của một quy trình đang chạy (Sổ Hợp Tác › Cài đặt › Quy trình duyệt) — dựng CÙNG đồ thị với trang quản trị:
// cạnh từ `stepEdges` (tiến, Đúng/Sai của Nếu, rẽ nhánh), "nhảy bước" (`next_step`), node Bắt đầu → các bước đầu, node Kết thúc là điểm cuối.
// Hàm thuần (chỉ import KIỂU của xyflow). Vị trí do ELK (`useFlowLayout`, hướng DOWN) tính ở host; ở đây chỉ ghép node/cạnh.
import { type Edge, MarkerType, type Node } from "@xyflow/react";
import { toEdge } from "../edges/toEdge";
import { collapseDefModules, type DefExit, exitEdges } from "./def-modules";
import type { FlowEdgeIn, FlowNodeIn } from "./elk";
import { NODE_H, NODE_W } from "./geometry";
import { type GraphStage, type LayoutEdge, stepEdges } from "./graph";

/** Id node Bắt đầu (nguồn của cạnh tới mọi bước đầu). */
export const DEF_TRIGGER_ID = "trigger";

/** Stage của sơ đồ chỉ xem: phần dựng cạnh + chữ đã dịch sẵn (hàm thuần không gọi i18n). */
export type DefViewStage = GraphStage & {
  /** Bước có "Sau đó đi tiếp" khác bước kế (nhảy tới bước `nextStep`, 0-based). */
  nextStep: number | null;
  title: string;
  /** Dòng phụ (phòng duyệt / cách ký…); null ⇒ ẩn. */
  sub: string | null;
  /** Nhãn loại bước (Duyệt, Gửi đối tác…); null ⇒ ẩn. */
  badge: string | null;
  /** Node Kết thúc (hình riêng); chờ sự kiện cũng là điểm cuối nhưng vẽ như bước. */
  end: boolean;
  /** CR-182 · bước có vai (Duyệt / Ký). */
  role?: DefRoleView | null;
  /** CR-185 · mã node module + loại executor + nhánh chờ (để gộp cụm như admin); vắng ⇒ không gộp. */
  node?: string | null;
  exec?: string | null;
  waitBranches?: readonly { on: string; step: number | null }[];
  /** CR-185 · đầu ra của ô module sau khi gộp (do `collapseDefModules` gắn). */
  exits?: readonly DefExit[];
};
/** CR-182 · vai của bước + người được giao (chữ đã dịch sẵn); `who` null ⇒ chưa giao. */
export type DefRoleView = {
  /** «Vai · <nhãn>». */
  line: string;
  /** «Tên nhóm · n người» hoặc tên người; null ⇒ chưa giao. */
  who: string | null;
  /** Chữ cảnh báo khi chưa giao («⚠ Chưa giao người»). */
  warn: string;
  kind: "group" | "user" | null;
};
export type DefViewTrigger = { label: string; summary: string };

type JumpStage = {
  uid: string;
  step: number;
  isIf: boolean;
  nextStep: number | null | undefined;
  terminal: boolean;
};

/** Bước đứng một mình trong cột có `next_step` nhảy xa hơn bước kế ⇒ cạnh tới bước đó THAY cạnh tới bước kế (cùng luật editor admin). */
export function applyJumps(
  stages: readonly JumpStage[],
  edges: readonly LayoutEdge[],
): LayoutEdge[] {
  const col = (step: number) => stages.filter((s) => s.step === step);
  const jumps = stages.filter(
    (s) =>
      !s.isIf &&
      !s.terminal &&
      s.nextStep != null &&
      s.nextStep > s.step &&
      s.nextStep !== s.step + 1 &&
      col(s.step).length === 1 &&
      col(s.nextStep).length > 0,
  );
  if (jumps.length === 0) return [...edges];
  const from = new Set(jumps.map((s) => s.uid));
  const kept = edges.filter((e) => !(from.has(e.source) && e.kind === "forward"));
  const added = jumps.flatMap((s) =>
    col(s.nextStep as number).map(
      (t): LayoutEdge => ({
        id: `${s.uid}>${t.uid}`,
        source: s.uid,
        target: t.uid,
        kind: "forward",
      }),
    ),
  );
  return [...kept, ...added];
}

/** Cạnh của sơ đồ: không vẽ cạnh quay lại khi có node Bắt đầu (như trang quản trị). */
export function defEdges(stages: readonly DefViewStage[], trigger: boolean): LayoutEdge[] {
  const lay = stepEdges(stages, { back: !trigger });
  const jumped = applyJumps(
    stages.map((s) => ({
      uid: s.uid,
      step: s.step,
      isIf: s.ifs != null,
      nextStep: s.nextStep,
      terminal: s.terminal === true,
    })),
    lay,
  );
  const start = trigger
    ? stages
        .filter((s) => s.step === 0)
        .map(
          (s): LayoutEdge => ({
            id: `${DEF_TRIGGER_ID}>${s.uid}`,
            source: DEF_TRIGGER_ID,
            target: s.uid,
            kind: "forward",
          }),
        )
    : [];
  return [...start, ...jumped, ...exitEdges(stages)];
}

const portsOf = (s: DefViewStage): string[] | undefined => (s.ifs ? ["yes", "no"] : undefined);

/** Đầu vào ELK: Bắt đầu ở tầng đầu, điểm cuối (Kết thúc / chờ) ở tầng cuối, node Nếu có hai cổng ra Đúng / Sai. */
export function defLayoutInput(
  stages: readonly DefViewStage[],
  edges: readonly LayoutEdge[],
  trigger: boolean,
): { nodes: FlowNodeIn[]; edges: FlowEdgeIn[] } {
  return {
    nodes: [
      ...(trigger ? [{ id: DEF_TRIGGER_ID, layer: "first" as const }] : []),
      ...stages.map((s) => ({
        id: s.uid,
        ports: portsOf(s),
        ...(s.terminal ? { layer: "last" as const } : {}),
      })),
    ],
    edges: edges
      .filter((e) => e.kind !== "back")
      .map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.side ?? null,
      })),
  };
}

export type DefNodeType = "defTrigger" | "defStage" | "defIf" | "defEnd";
export type DefNodeData = {
  title: string;
  sub: string | null;
  badge: string | null;
  /** Số thứ tự (1-based) của bước thường; điểm đầu/cuối/Nếu ⇒ 0. */
  index: number;
  role?: DefRoleView | null;
  /** Bước đang được chọn ở khung giao việc. */
  selected?: boolean;
};

/** Cạnh đầu ra có tên của ô module: nét đứt cảnh báo + nhãn (cùng kiểu trang quản trị). */
const exitStyle = (e: Edge, label: string | undefined): Edge => ({
  ...e,
  ...(label
    ? {
        label,
        labelStyle: { fill: "var(--color-warning)", fontSize: 12 },
        labelBgStyle: { fill: "var(--color-card)" },
      }
    : {}),
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-warning)" },
  style: { stroke: "var(--color-warning)", strokeDasharray: "5 4" },
});

/** Ghép node + cạnh xyflow từ stage và toạ độ ELK (`auto`; chưa có ⇒ rỗng, host chờ). `lang` chọn nhãn đầu ra (vi/en). */
export function buildDefViewGraph(
  rawStages: readonly DefViewStage[],
  trigger: DefViewTrigger | null,
  auto: ReadonlyMap<string, { x: number; y: number }> | null,
  selectedId?: string | null,
  lang = "vi",
): { nodes: Node<DefNodeData>[]; edges: Edge[]; layout: ReturnType<typeof defLayoutInput> } {
  const stages = collapseDefModules(rawStages, lang);
  const edges = defEdges(stages, trigger !== null);
  const layout = defLayoutInput(stages, edges, trigger !== null);
  const base = {
    width: NODE_W,
    height: NODE_H,
    measured: { width: NODE_W, height: NODE_H },
    draggable: false,
    connectable: false,
    deletable: false,
    selectable: false,
    focusable: false,
  } as const;
  let n = 0;
  const nodes: Node<DefNodeData>[] = [];
  const put = (id: string, type: DefNodeType, data: DefNodeData) => {
    const at = auto?.get(id);
    if (at) nodes.push({ id, type, position: at, data, ...base });
  };
  if (trigger)
    put(DEF_TRIGGER_ID, "defTrigger", {
      title: trigger.label,
      sub: trigger.summary,
      badge: null,
      index: 0,
    });
  for (const s of stages) {
    const type: DefNodeType = s.ifs ? "defIf" : s.end ? "defEnd" : "defStage";
    const index = type === "defStage" ? ++n : 0;
    put(s.uid, type, {
      title: s.title,
      sub: s.sub,
      badge: s.badge,
      index,
      role: s.role ?? null,
      selected: s.uid === selectedId,
    });
  }
  const have = new Set(nodes.map((x) => x.id));
  const rf = edges
    .filter((e) => have.has(e.source) && have.has(e.target))
    .map((e): Edge => {
      const out = e.exit ? exitStyle(toEdge(e), e.label) : toEdge(e);
      return out.type === undefined ? { ...out, type: "routed" } : out;
    });
  return { nodes, edges: rf, layout };
}
