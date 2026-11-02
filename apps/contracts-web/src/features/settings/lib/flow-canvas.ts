// CR-106 · canvas CHỈ ĐỌC của quy trình duyệt đang dùng: hàm thuần dựng node/edge từ `CurrentFlow.steps`
// (Bắt đầu → từng bước theo thứ tự → "Ghi Đã duyệt"). Bố cục dọc, khoảng cách cố định, không dagre.
// Không import runtime của @xyflow (chỉ kiểu) để test bun chạy nhanh, không kéo thư viện vào chunk chính.

import type { FlowCond, FlowWhen } from "@ai/contracts";
import type { Edge, Node } from "@xyflow/react";
import type { CurrentStep, DealKind } from "./current-flow";

export const NODE_W = 280;
export const GAP_Y = 36;
const H_START = 40;
const H_FINAL = 52;
// Khớp FlowCanvasNode: py-2 (16) + dòng tên (24); mỗi dòng thêm = gap-1 (4) + cao dòng. Thiếu ⇒ chữ bị cắt.
const H_BASE = 42;
const H_DEPT = 22;
const H_BADGES = 28;
const H_COND = 22;

export type CanvasKind = "start" | "step" | "finalize";
export type StepBadge = "conditional" | "esign" | "dify";

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
};

const OPS = { ge: "≥", gt: ">", le: "≤", lt: "<" } as const;

function condText(c: FlowCond, l: CondLabels): string {
  if (c.field === "deal") return `${l.deal}: ${c.in.map((d) => l.dealNames[d]).join(", ")}`;
  return `${l.value} ${OPS[c.op]} ${l.number(c.value)}`;
}

/** Điều kiện rỗng / không có ⇒ null. */
export function conditionLabel(when: FlowWhen | null, l: CondLabels): string | null {
  if (!when || when.conds.length === 0) return null;
  const sep = ` ${when.op === "or" ? l.or : l.and} `;
  return when.conds.map((c) => condText(c, l)).join(sep);
}

function stepHeight(d: FlowNodeData): number {
  return (
    H_BASE +
    (d.department ? H_DEPT : 0) +
    (d.badges.length > 0 ? H_BADGES : 0) +
    (d.condition ? H_COND : 0)
  );
}

function badgesOf(s: CurrentStep, conditional: boolean): StepBadge[] {
  const out: StepBadge[] = [];
  if (conditional) out.push("conditional");
  if (s.kind === "esign") out.push("esign");
  if (s.kind === "dify") out.push("dify");
  return out;
}

const SYSTEM: Omit<FlowNodeData, "kind" | "locked"> = {
  title: "",
  index: 0,
  department: null,
  badges: [],
  condition: null,
  dim: false,
};

/**
 * Dựng canvas: Bắt đầu → bước 1..n → Ghi Đã duyệt (khoá). `run` (tuỳ chọn, cùng độ dài `steps`) = kết quả
 * `previewPath`; bước `false` ⇒ `dim`. Node/edge xếp một cột dọc, tâm cùng x.
 */
export function buildFlowCanvas(
  steps: readonly CurrentStep[],
  labels: CondLabels,
  run?: readonly boolean[],
): { nodes: FlowCanvasNode[]; edges: Edge[] } {
  const items: { id: string; data: FlowNodeData; h: number }[] = [
    { id: "start", data: { ...SYSTEM, kind: "start", locked: false }, h: H_START },
  ];
  steps.forEach((s, i) => {
    const condition = conditionLabel(s.when, labels);
    const data: FlowNodeData = {
      kind: "step",
      title: s.name,
      index: i + 1,
      department: s.department && s.department !== s.name ? s.department : null,
      badges: badgesOf(s, condition !== null),
      condition,
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
      width: NODE_W,
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
  }));
  return { nodes, edges };
}
