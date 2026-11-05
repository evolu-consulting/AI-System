// CR-118 · @ai/flow-canvas · bố cục `vertical` (chuyển từ workspace-web `lib/flow-canvas.ts`, giữ nguyên toạ độ/chữ).
// CR-106 · canvas CHỈ ĐỌC của quy trình duyệt đang dùng: hàm thuần dựng node/edge từ `CurrentFlow.steps`
// (Bắt đầu → từng bước theo thứ tự → "Ghi Đã duyệt"). Bố cục dọc, khoảng cách cố định, không dagre.
// Không import runtime của @xyflow (chỉ kiểu) để test bun chạy nhanh, không kéo thư viện vào chunk chính.

import type { FlowCond, FlowCondGroup, FlowWhen } from "@ai/contracts";
import type { Edge, Node } from "@xyflow/react";
import { stepKindSpec } from "../registry";

export type DealKind = "buy" | "sell" | "referral";
/** Bước đầu vào (dạng `CurrentStep` của workspace-web; `kind` là chuỗi: loại lạ/DLC vẽ chung, xem `registry.ts`). */
export type VerticalStepInput = {
  key: string;
  name: string;
  department: string | null;
  kind: string;
  when: FlowWhen | null;
  dueH: number | null;
  remindH: number | null;
  escalateGroup: string | null;
  approverCount: number | null;
  escalateDefault?: boolean;
  escalateMissing?: boolean;
  /** Host muốn hiện huy hiệu loại cho bước duyệt (`review`; mặc định ẩn vì gần như mọi bước là duyệt). Thẻ khe `/apps` bật. */
  showReviewBadge?: boolean;
};
/** Bước đã ghép sẵn chữ điều kiện (host không dùng `FlowWhen`, vd thẻ khe `/apps`). */
export type VerticalStep = Omit<VerticalStepInput, "when"> & { condition: string | null };

export const VERTICAL_NODE_W = 280;
export const GAP_Y = 52; // đủ chỗ cho nhãn điều kiện trên cạnh vào bước
const H_START = 40;
const H_FINAL = 52;
// Khớp FlowCanvasNode: py-2 (16) + dòng tên (24); mỗi dòng thêm = gap-1 (4) + cao dòng. Thiếu ⇒ chữ bị cắt.
const H_BASE = 42;
const H_DEPT = 22;
const H_BADGES = 28;
const H_INFO = 22; // mỗi dòng thông tin bước (hạn/nhắc · số người duyệt · chuyển cấp)
/** Cạnh bỏ qua đi vòng bên phải; lệch nhau theo chỉ số để hai nhánh liền kề không chồng nét. */
const SKIP_OFFSET = 84; // ≥ nửa bề ngang nhãn để nhãn không đè lên node

/** Mã tay nắm bên phải của node để vẽ nhánh bỏ qua (khớp `FlowCanvasNode`). */
export const SKIP_OUT = "skip-out";
export const SKIP_IN = "skip-in";

export type CanvasKind = "start" | "step" | "finalize";
export type StepBadge = "conditional" | "review" | "esign" | "dify";

export type StepInfo = {
  dueH: number | null;
  remindH: number | null;
  approvers: number | null;
  escalate: string | null;
  /** CR-113 · nhóm chuyển cấp là mặc định ⇒ thêm "(mặc định)". */
  escalateDefault?: boolean;
  /** CR-113 (review) · nhóm chuyển cấp đặt tường minh đã bị xoá ⇒ dòng cảnh báo lỗi cấu hình (thay dòng chuyển cấp). */
  escalateMissing?: boolean;
};
const NO_INFO: StepInfo = { dueH: null, remindH: null, approvers: null, escalate: null };
/** Số dòng thông tin sẽ hiện (khớp StepInfoLines). */
export const infoLineCount = (i: StepInfo): number =>
  (i.dueH !== null ? 1 : 0) +
  (i.approvers !== null ? 1 : 0) +
  (i.escalate || i.escalateMissing ? 1 : 0);

export type FlowNodeData = {
  kind: CanvasKind;
  /** Tên bước (rỗng ở Bắt đầu / Ghi Đã duyệt: nhãn lấy từ i18n khi vẽ). */
  title: string;
  /** Số thứ tự bước, 1-based (0 ở node hệ thống). */
  index: number;
  department: string | null;
  badges: StepBadge[];
  /** Tóm tắt điều kiện ("Giá trị ≥ 100.000.000 và Loại HĐ: Mua"), null = chạy mọi HĐ. */
  condition: string | null;
  /** CR-108 · thông tin mỗi bước (null/0 dòng ⇒ ẩn): hạn + nhắc, số người duyệt, nhóm nhận khi quá hạn. */
  info: StepInfo;
  /** Node hệ thống, không đụng được (Ghi Đã duyệt). */
  locked: boolean;
  /** Bước bị bỏ qua theo dữ liệu "Xem trước đường đi" ⇒ mờ đi. */
  dim: boolean;
};
export type FlowCanvasNode = Node<FlowNodeData, CanvasKind>;

/** Nhãn đã dịch để ghép câu điều kiện (hàm thuần không tự gọi i18n). */
export type CondLabels = {
  value: string;
  deal: string;
  dealNames: Record<DealKind, string>;
  and: string;
  or: string;
  number: (n: number) => string;
  /** Nhãn nhánh bỏ qua (\Không thoả ⇒ bỏ qua\). */
  skip: string;
  /** Màu chữ/nền nhãn trên cạnh (CSS var của host); vắng ⇒ token shadcn. */
  edge?: EdgeLabelStyle;
  /** CR-121 D-0 · nhãn trường mới (host i18n; vắng ⇒ mã trường) + có/không của trường boolean. */
  fields?: Partial<Record<"creator_department" | "new_partner", string>>;
  yes?: string;
  no?: string;
};

export type EdgeLabelStyle = { fill: string; bgFill: string; bgStroke: string };
export const DEFAULT_EDGE_LABEL: EdgeLabelStyle = {
  fill: "var(--muted-foreground)",
  bgFill: "var(--card)",
  bgStroke: "var(--border)",
};

const OPS = { ge: "≥", gt: ">", le: "≤", lt: "<" } as const;

function condText(c: FlowCond | FlowCondGroup, l: CondLabels): string {
  if (!("field" in c)) return `(${groupText(c, l)})`;
  if (c.field === "deal") return `${l.deal}: ${c.in.map((d) => l.dealNames[d]).join(", ")}`;
  if (c.field === "creator_department")
    return `${l.fields?.creator_department ?? c.field}: ${c.in.join(", ")}`;
  if (c.field === "new_partner")
    return `${l.fields?.new_partner ?? c.field}: ${(c.is ? l.yes : l.no) ?? String(c.is)}`;
  return `${l.value} ${OPS[c.op]} ${l.number(c.value)}`;
}
const groupText = (w: FlowWhen | FlowCondGroup, l: CondLabels): string =>
  w.conds.map((c) => condText(c, l)).join(` ${w.op === "or" ? l.or : l.and} `);

/** Điều kiện rỗng / không có ⇒ null. */
export function conditionLabel(when: FlowWhen | null, l: CondLabels): string | null {
  if (!when || when.conds.length === 0) return null;
  return groupText(when, l);
}

function stepHeight(d: FlowNodeData): number {
  return (
    H_BASE +
    (d.department ? H_DEPT : 0) +
    (d.badges.length > 0 ? H_BADGES : 0) +
    infoLineCount(d.info) * H_INFO
  );
}

export function badgesOf(kind: string, conditional: boolean, showReview = false): StepBadge[] {
  const out: StepBadge[] = [];
  if (conditional) out.push("conditional");
  const kindBadge = stepKindSpec(kind).badge;
  if (kindBadge) out.push(kindBadge);
  else if (showReview && kind === "review") out.push("review");
  return out;
}

const SYSTEM: Omit<FlowNodeData, "kind" | "locked"> = {
  title: "",
  index: 0,
  department: null,
  badges: [],
  condition: null,
  info: NO_INFO,
  dim: false,
};

/** Dựng từ bước có `when` (ghép chữ điều kiện bằng `labels`). */
export function buildFlowCanvas(
  steps: readonly VerticalStepInput[],
  labels: CondLabels,
  run?: readonly boolean[],
): { nodes: FlowCanvasNode[]; edges: Edge[] } {
  return buildVerticalGraph(
    steps.map(({ when, ...s }) => ({ ...s, condition: conditionLabel(when, labels) })),
    labels.skip,
    run,
    labels.edge,
  );
}

/**
 * Dựng canvas: Bắt đầu → bước 1..n → Ghi Đã duyệt (khoá). `run` (tuỳ chọn, cùng độ dài `steps`) = kết quả
 * `previewPath`; bước `false` ⇒ `dim`. Node/edge xếp một cột dọc, tâm cùng x.
 */
export function buildVerticalGraph(
  steps: readonly VerticalStep[],
  skipLabel: string,
  run?: readonly boolean[],
  edgeStyle: EdgeLabelStyle = DEFAULT_EDGE_LABEL,
): { nodes: FlowCanvasNode[]; edges: Edge[] } {
  const items: { id: string; data: FlowNodeData; h: number }[] = [
    { id: "start", data: { ...SYSTEM, kind: "start", locked: false }, h: H_START },
  ];
  steps.forEach((s, i) => {
    const condition = s.condition;
    const data: FlowNodeData = {
      kind: "step",
      title: s.name,
      index: i + 1,
      department: s.department && s.department !== s.name ? s.department : null,
      badges: badgesOf(s.kind, condition !== null, s.showReviewBadge === true),
      condition,
      info: {
        dueH: s.dueH,
        remindH: s.dueH !== null ? s.remindH : null,
        approvers: s.approverCount,
        escalate: s.escalateGroup,
        escalateDefault: s.escalateDefault,
        escalateMissing: s.escalateMissing,
      },
      locked: false,
      dim: run ? run[i] === false : false,
    };
    items.push({ id: s.key, data, h: stepHeight(data) });
  });
  items.push({
    id: "finalize",
    data: { ...SYSTEM, kind: "finalize", locked: true },
    h: H_FINAL,
  });

  let y = 0;
  const nodes: FlowCanvasNode[] = items.map((it) => {
    const node: FlowCanvasNode = {
      id: it.id,
      type: it.data.kind,
      position: { x: 0, y },
      data: it.data,
      width: VERTICAL_NODE_W,
      height: it.h,
      draggable: false,
      connectable: false,
      deletable: false,
      selectable: false,
    };
    y += it.h + GAP_Y;
    return node;
  });
  const edges: Edge[] = items.slice(1).map((it, i) => ({
    id: `e-${items[i]?.id}-${it.id}`,
    source: items[i]?.id ?? "",
    target: it.id,
    type: "smoothstep",
    deletable: false,
    selectable: false,
    style: it.data.dim ? { opacity: 0.35 } : undefined,
    // CR-108 · cạnh vào bước có điều kiện ghi rõ điều kiện ("Giá trị ≥ 500.000.000").
    ...(it.data.kind === "step" && it.data.condition
      ? labelProps(it.data.condition, edgeStyle)
      : {}),
  }));
  return { nodes, edges: [...edges, ...skipEdges(items, skipLabel, edgeStyle)] };
}

const labelProps = (label: string, s: EdgeLabelStyle) => ({
  label,
  // Nền nhãn mặc định của xyflow là đen (chỉ có base.css) ⇒ tô theo token giao diện của host để đọc được ở cả sáng/tối.
  labelStyle: { fontSize: 11, fill: s.fill },
  labelBgStyle: { fill: s.bgFill, stroke: s.bgStroke, strokeWidth: 1 },
  labelBgPadding: [6, 3] as [number, number],
  labelBgBorderRadius: 6,
});

/**
 * CR-108 · nhánh bỏ qua: bước có điều kiện (không phải bước đầu) ⇒ cạnh nét đứt đi vòng bên phải từ node liền trước sang node liền sau.
 * Bước bị bỏ qua theo xem trước (`dim`) ⇒ nhánh này sáng lên (đường thật), ngược lại mờ.
 */
function skipEdges(
  items: { id: string; data: FlowNodeData }[],
  label: string,
  edgeStyle: EdgeLabelStyle,
): Edge[] {
  const out: Edge[] = [];
  items.forEach((it, i) => {
    const prev = items[i - 1];
    const next = items[i + 1];
    if (it.data.kind !== "step" || !it.data.condition || !prev || !next) return;
    out.push({
      id: `skip-${it.id}`,
      source: prev.id,
      sourceHandle: SKIP_OUT,
      target: next.id,
      targetHandle: SKIP_IN,
      type: "smoothstep",
      pathOptions: { offset: SKIP_OFFSET + (i % 2) * 16 },
      deletable: false,
      selectable: false,
      style: { strokeDasharray: "6 4", opacity: it.data.dim ? 1 : 0.5 },
      ...labelProps(label, edgeStyle),
    } as Edge);
  });
  return out;
}
