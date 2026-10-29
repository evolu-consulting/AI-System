// HUB-FR-104 · P-b2 (plan-frontend FB4, ADR-0013 #3) · CR-103 fnr-canvas: bố cục canvas theo cột bước + làn nhánh If — hàm thuần.
// `x` luôn suy từ bước; `y` tự động theo làn, hoặc `y` đã lưu của giai đoạn (`ui.y`, chỉ-UI).
// Trả mô tả node/cạnh trung tính (không phụ thuộc xyflow) để test không cần DOM.
import { PROCESS_STEP_STAGES_MAX } from "@ai/contracts/hub-admin";
import type { Stepped } from "./step-ops";

export const COL_W = 320;
export const ROW_H = 120;
export const NODE_W = 240;
export const NODE_H = 104;
export const HEADER_H = 56;
/** Chiều cao node tiêu đề cột (cố định để xyflow biết kích thước ngay, không ẩn node chờ đo). */
export const HEADER_NODE_H = 40;
export const JOIN_W = 96;
export const JOIN_H = 28;

export type LayoutNode =
  | { id: string; kind: "stage"; x: number; y: number; step: number; index: number }
  | { id: string; kind: "stepHeader"; x: number; y: number; step: number; full: boolean }
  | { id: string; kind: "join"; x: number; y: number; step: number; count: number };
export type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  kind: "forward" | "back" | "branch";
  /** P-d2 · chỉ cạnh `branch`: số thứ tự luật (đếm từ 1). */
  rule?: number;
  /** CR-103 · chỉ cạnh `branch` của node If: cổng ra Đúng / Sai. */
  side?: "yes" | "no";
};
export type Layout = { nodes: LayoutNode[]; edges: LayoutEdge[]; steps: number };

export const headerId = (step: number): string => `h${step}`;
export const joinId = (step: number): string => `j${step}`;

/** `branch`: bước đích (0-based) của từng luật rẽ nhánh; null = chưa chọn. */
type LayoutStage = Pick<Stepped, "uid" | "step" | "backTo" | "after"> & {
  branch?: readonly (number | null)[];
  /** CR-103 · node If: bước đích Đúng / Sai (0-based, null = chưa chọn). */
  ifs?: { yes: number | null; no: number | null } | null;
  /** fnr-canvas · `y` đã lưu (`ui.y`); vắng/null ⇒ tự động. */
  y?: number | null;
};

type Cols = { cols: number[][]; uids: string[] };

/** P-d2 · cạnh nét đứt từ giai đoạn tới tiêu đề bước đích, một cạnh mỗi luật hợp lệ (đích > bước nguồn, có thật). Node If dùng `ifEdges`. */
function branchEdges(stages: readonly LayoutStage[], steps: number, c: Cols): LayoutEdge[] {
  return stages.flatMap((s) =>
    s.ifs
      ? ifEdges(s, steps, c)
      : (s.branch ?? []).flatMap((g, k) =>
          g !== null && g > s.step && g < steps
            ? [
                {
                  id: `${s.uid}>${headerId(g)}#${k}`,
                  source: s.uid,
                  target: headerId(g),
                  kind: "branch" as const,
                  rule: k + 1,
                },
              ]
            : [],
        ),
  );
}

/**
 * CR-103 · node If: ĐÚNG HAI cạnh có nhãn tới giai đoạn đầu của bước đích (không tới tiêu đề, không cạnh tiến thường):
 * Đúng → `then`, Sai → `else` (vắng ⇒ bước kế). Đích không hợp lệ (≤ bước If, ngoài phạm vi, bước rỗng) ⇒ bỏ cạnh đó.
 */
function ifEdges(s: LayoutStage, steps: number, c: Cols): LayoutEdge[] {
  const f = s.ifs;
  if (!f) return [];
  const mk = (side: "yes" | "no", g: number | null): LayoutEdge[] => {
    const to = g !== null && g > s.step && g < steps ? c.cols[g]?.[0] : undefined;
    return to === undefined
      ? []
      : [
          {
            id: `${s.uid}>${c.uids[to]}#${side}`,
            source: s.uid,
            target: c.uids[to] as string,
            kind: "branch",
            rule: side === "yes" ? 1 : 2,
            side,
          },
        ];
  };
  return [...mk("yes", f.yes), ...mk("no", f.no ?? s.step + 1)];
}
/** Cạnh tiến thường giữa hai cột; stage If đứng một mình trong bước tự vẽ hai cạnh Đúng/Sai nên không có cạnh tiến. */
function forwardEdges(cols: number[][], uids: string[], isIf: ReadonlySet<string>): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  cols.forEach((col, k) => {
    const next = cols[k + 1];
    if (!next) return;
    if (col.length > 1) {
      for (const i of col) edges.push(e(uids[i] as string, joinId(k)));
      for (const j of next) edges.push(e(joinId(k), uids[j] as string));
      return;
    }
    const from = uids[col[0] as number] as string;
    if (isIf.has(from)) return;
    for (const j of next) edges.push(e(from, uids[j] as string));
  });
  return edges;
}
const e = (source: string, target: string): LayoutEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  kind: "forward",
});

/**
 * Làn của từng bước (số nguyên, 0 = làn chính). Mỗi node If có hai đích Đúng (Y) / Sai (N, vắng ⇒ bước kế), cùng > bước If:
 * các bước nằm giữa hai đích chỉ chạy qua nhánh có đích nhỏ hơn; sau đích lớn hơn hai nhánh nhập lại.
 * Y < N ⇒ bước [Y, N) (chỉ qua Đúng) lên làn TRÊN (-1); Y > N ⇒ bước [N, Y) (chỉ qua Sai) xuống làn DƯỚI (+1)
 * để nhánh đi thẳng (làn chính) không bị cạnh chéo qua node. If lồng nhau ⇒ cộng dồn.
 */
function stepLanes(stages: readonly LayoutStage[], steps: number): number[] {
  const lane = Array.from({ length: steps }, () => 0);
  for (const s of stages) {
    const f = s.ifs;
    if (!f || f.yes === null) continue;
    const yes = f.yes;
    const no = f.no ?? s.step + 1;
    const ok = (g: number) => g > s.step && g < steps;
    if (!ok(yes) || !ok(no) || yes === no) continue;
    const [from, to, d] = yes < no ? [yes, no, -1] : [no, yes, 1];
    for (let k = from; k < to; k++) lane[k] = (lane[k] as number) + (d as number);
  }
  return lane;
}

/** `y` đầu của từng làn (px, chưa cộng HEADER_H): làn cao theo cột đông nhất trong làn, tối thiểu một hàng. */
function laneTops(
  cols: number[][],
  lane: number[],
): { top: Map<number, number>; height: Map<number, number> } {
  const min = Math.min(0, ...lane);
  const max = Math.max(0, ...lane);
  const height = new Map<number, number>();
  for (let l = min; l <= max; l++) height.set(l, 1);
  cols.forEach((c, k) => {
    const l = lane[k] as number;
    height.set(l, Math.max(height.get(l) as number, c.length));
  });
  const top = new Map<number, number>();
  let acc = 0;
  for (let l = min; l <= max; l++) {
    top.set(l, acc);
    acc += (height.get(l) as number) * ROW_H;
  }
  return { top, height };
}

/**
 * Bố cục: cột `x = step × COL_W`; `y` theo làn (nhánh Đúng của If lên làn trên — xem `stepLanes`), các giai đoạn song song xếp
 * dọc gọn trong làn, căn giữa theo cột cao nhất của làn. `y` đã lưu của giai đoạn (`stage.y`) thắng toạ độ tự động.
 */
export function layoutSteps(stages: readonly LayoutStage[]): Layout {
  const steps = stages.reduce((m, s) => Math.max(m, s.step + 1), 0);
  const cols: number[][] = Array.from({ length: steps }, () => []);
  for (const [i, s] of stages.entries()) cols[s.step]?.push(i);
  const lane = stepLanes(stages, steps);
  const { top, height } = laneTops(cols, lane);
  const nodes: LayoutNode[] = [];
  cols.forEach((col, k) => {
    nodes.push({
      id: headerId(k),
      kind: "stepHeader",
      x: k * COL_W,
      y: 0,
      step: k,
      full: col.length >= PROCESS_STEP_STAGES_MAX,
    });
    const l = lane[k] as number;
    const off = (((height.get(l) as number) - col.length) * ROW_H) / 2;
    const ys: number[] = [];
    for (const [r, i] of col.entries()) {
      const s = stages[i] as LayoutStage;
      const y = s.y ?? HEADER_H + (top.get(l) as number) + off + r * ROW_H;
      ys.push(y);
      nodes.push({ id: s.uid, kind: "stage", x: k * COL_W, y, step: k, index: i });
    }
    if (col.length > 1 && cols[k + 1])
      nodes.push({
        id: joinId(k),
        kind: "join",
        x: k * COL_W + NODE_W + (COL_W - NODE_W - JOIN_W) / 2,
        y: ys.reduce((a, b) => a + b, 0) / ys.length + (NODE_H - JOIN_H) / 2,
        step: k,
        count: col.length,
      });
  });
  const uids = stages.map((s) => s.uid);
  return {
    nodes,
    edges: [
      ...forwardEdges(cols, uids, new Set(stages.filter((s) => s.ifs).map((s) => s.uid))),
      ...backEdges(stages),
      ...branchEdges(stages, steps, { cols, uids }),
    ],
    steps,
  };
}

/** Cạnh "Chưa đạt" quay lại: stage `review` → header của bước đích `backTo` (< bước hiện tại). */
const backEdges = (stages: readonly LayoutStage[]): LayoutEdge[] =>
  stages.flatMap((s) =>
    s.after === "review"
      ? s.backTo
          .filter((t) => t < s.step && t >= 0)
          .map((t) => ({
            id: `${s.uid}<${headerId(t)}`,
            source: s.uid,
            target: headerId(t),
            kind: "back" as const,
          }))
      : [],
  );

/** Bước đích khi thả node có góc trái `x`: cột gần nhất; vượt quá cuối nửa cột ⇒ `steps` (bước mới). */
export function stepFromDropX(x: number, steps: number): number {
  const k = Math.round(x / COL_W);
  return Math.min(Math.max(k, 0), steps);
}
