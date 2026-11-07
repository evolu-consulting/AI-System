// CR-123 · u13 · đồ thị bước của sơ đồ (CẠNH, không có toạ độ): cạnh tiến giữa hai bước liền nhau, Đúng/Sai của node Nếu, luật rẽ nhánh,
// cạnh "Chưa đạt" quay lại. Vị trí do ELK (`layout/elk.ts`) tính — đây là nguồn DUY NHẤT cho cạnh; hàm thuần, không phụ thuộc xyflow.
/** Phần tối thiểu của giai đoạn mà đồ thị cần (khớp `Stepped` của editor admin-web). */
export type Stepped = { uid: string; step: number; backTo: number[]; after: "review" | "auto" };

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

/** `branch`: bước đích (0-based) của từng luật rẽ nhánh; null = chưa chọn. */
export type GraphStage = Pick<Stepped, "uid" | "step" | "backTo" | "after"> & {
  branch?: readonly (number | null)[];
  /** CR-103 · node If: bước đích Đúng / Sai (0-based, null = chưa chọn). */
  ifs?: { yes: number | null; no: number | null } | null;
  /** Bước Kết thúc (có kết quả): không có cạnh đi tiếp. */
  terminal?: boolean;
};

export type GraphOptions = {
  /** Vẽ cạnh "Chưa đạt" quay lại (tới stage đầu của cột đích). Mặc định có. */
  back?: boolean;
};

const edge = (source: string, target: string): LayoutEdge => ({
  id: `${source}>${target}`,
  source,
  target,
  kind: "forward",
});

/** uid các stage của từng cột bước (theo thứ tự mảng). */
function columnsOf(stages: readonly GraphStage[]): string[][] {
  const steps = stages.reduce((m, s) => Math.max(m, s.step + 1), 0);
  const cols: string[][] = Array.from({ length: steps }, () => []);
  for (const s of stages) cols[s.step]?.push(s.uid);
  return cols;
}

/** Node If: ĐÚNG HAI cạnh có nhãn tới stage đầu của bước đích (Đúng → `yes`, Sai → `no`, vắng ⇒ bước kế); đích không hợp lệ ⇒ bỏ cạnh đó. */
function ifEdges(s: GraphStage, cols: string[][]): LayoutEdge[] {
  const f = s.ifs;
  if (!f) return [];
  const mk = (side: "yes" | "no", g: number | null): LayoutEdge[] => {
    const to = g !== null && g > s.step ? cols[g]?.[0] : undefined;
    return to === undefined
      ? []
      : [
          {
            id: `${s.uid}>${to}#${side}`,
            source: s.uid,
            target: to,
            kind: "branch",
            rule: side === "yes" ? 1 : 2,
            side,
          },
        ];
  };
  return [...mk("yes", f.yes), ...mk("no", f.no ?? s.step + 1)];
}

/** P-d2 · luật rẽ nhánh của bước thường: một cạnh nét đứt tới stage đầu của bước đích (đích > bước nguồn, có thật). */
function ruleEdges(s: GraphStage, cols: string[][]): LayoutEdge[] {
  return (s.branch ?? []).flatMap((g, k) => {
    const to = g !== null && g > s.step ? cols[g]?.[0] : undefined;
    return to === undefined
      ? []
      : [
          {
            id: `${s.uid}>${to}#${k}`,
            source: s.uid,
            target: to,
            kind: "branch" as const,
            rule: k + 1,
          },
        ];
  });
}

/** Cạnh "Chưa đạt": bước duyệt → stage đầu của bước `backTo` đứng trước. */
const backEdges = (s: GraphStage, cols: string[][]): LayoutEdge[] =>
  s.after === "review"
    ? s.backTo
        .filter((t) => t < s.step && t >= 0)
        .flatMap((t) => {
          const to = cols[t]?.[0];
          return to === undefined
            ? []
            : [{ id: `${s.uid}<${to}`, source: s.uid, target: to, kind: "back" as const }];
        })
    : [];

/** Cạnh của sơ đồ: tiến thường (mọi stage của cột k → mọi stage của cột k+1; node If tự vẽ Đúng/Sai), rẽ nhánh, quay lại. */
export function stepEdges(stages: readonly GraphStage[], opts: GraphOptions = {}): LayoutEdge[] {
  const cols = columnsOf(stages);
  const isIf = new Set(stages.filter((s) => s.ifs).map((s) => s.uid));
  const ended = new Set(stages.filter((s) => s.terminal).map((s) => s.uid));
  const forward = cols.flatMap((col, k) => {
    const next = cols[k + 1] ?? [];
    return col
      .filter((u) => !isIf.has(u) && !ended.has(u))
      .flatMap((u) => next.map((t) => edge(u, t)));
  });
  return [
    ...forward,
    ...(opts.back === false ? [] : stages.flatMap((s) => backEdges(s, cols))),
    ...stages.flatMap((s) => (s.ifs ? ifEdges(s, cols) : ruleEdges(s, cols))),
  ];
}

/** Số bước (cột) của danh sách stage. */
export const stepCount = (stages: readonly Pick<GraphStage, "step">[]): number =>
  stages.reduce((m, s) => Math.max(m, s.step + 1), 0);
