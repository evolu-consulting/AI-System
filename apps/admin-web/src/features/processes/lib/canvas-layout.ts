// HUB-FR-104 · P-b2 (plan-frontend FB4, ADR-0013 #3): bố cục canvas theo cột bước — hàm thuần, KHÔNG lưu toạ độ.
// Trả mô tả node/cạnh trung tính (không phụ thuộc xyflow) để test không cần DOM.
import { PROCESS_STEP_STAGES_MAX } from "@ai/contracts/hub-admin";
import type { Stepped } from "./step-ops";

export const COL_W = 320;
export const ROW_H = 120;
export const NODE_W = 240;
export const NODE_H = 88;
export const HEADER_H = 56;
export const JOIN_W = 96;
export const JOIN_H = 28;

export type LayoutNode =
  | { id: string; kind: "stage"; x: number; y: number; step: number; index: number }
  | { id: string; kind: "stepHeader"; x: number; y: number; step: number; full: boolean }
  | { id: string; kind: "join"; x: number; y: number; step: number; count: number };
export type LayoutEdge = { id: string; source: string; target: string; kind: "forward" | "back" };
export type Layout = { nodes: LayoutNode[]; edges: LayoutEdge[]; steps: number };

export const headerId = (step: number): string => `h${step}`;
export const joinId = (step: number): string => `j${step}`;

type LayoutStage = Pick<Stepped, "uid" | "step" | "backTo" | "after">;

function forwardEdges(cols: number[][], uids: string[]): LayoutEdge[] {
  const edges: LayoutEdge[] = [];
  cols.forEach((col, k) => {
    const next = cols[k + 1];
    if (!next) return;
    if (col.length > 1) {
      for (const i of col) edges.push(e(uids[i] as string, joinId(k)));
      for (const j of next) edges.push(e(joinId(k), uids[j] as string));
      return;
    }
    for (const j of next) edges.push(e(uids[col[0] as number] as string, uids[j] as string));
  });
  return edges;
}
const e = (source: string, target: string): LayoutEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  kind: "forward",
});

/** Bố cục: cột `x = step × COL_W`, hàng `y = HEADER_H + row × ROW_H`, mỗi cột căn giữa theo cột cao nhất. */
export function layoutSteps(stages: readonly LayoutStage[]): Layout {
  const steps = stages.reduce((m, s) => Math.max(m, s.step + 1), 0);
  const cols: number[][] = Array.from({ length: steps }, () => []);
  for (const [i, s] of stages.entries()) cols[s.step]?.push(i);
  const rows = cols.reduce((m, c) => Math.max(m, c.length), 1);
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
    const off = ((rows - col.length) * ROW_H) / 2;
    for (const [r, i] of col.entries())
      nodes.push({
        id: (stages[i] as LayoutStage).uid,
        kind: "stage",
        x: k * COL_W,
        y: HEADER_H + off + r * ROW_H,
        step: k,
        index: i,
      });
    if (col.length > 1 && cols[k + 1])
      nodes.push({
        id: joinId(k),
        kind: "join",
        x: k * COL_W + NODE_W + (COL_W - NODE_W - JOIN_W) / 2,
        y: HEADER_H + (rows * ROW_H - ROW_H + NODE_H - JOIN_H) / 2,
        step: k,
        count: col.length,
      });
  });
  const uids = stages.map((s) => s.uid);
  const back: LayoutEdge[] = stages.flatMap((s) =>
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
  return { nodes, edges: [...forwardEdges(cols, uids), ...back], steps };
}

/** Bước đích khi thả node có góc trái `x`: cột gần nhất; vượt quá cuối nửa cột ⇒ `steps` (bước mới). */
export function stepFromDropX(x: number, steps: number): number {
  const k = Math.round(x / COL_W);
  return Math.min(Math.max(k, 0), steps);
}
