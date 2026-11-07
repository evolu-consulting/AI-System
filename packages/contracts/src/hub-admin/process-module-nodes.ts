// CR-123 · u3a · FLOW3-FR-14 · luật THUẦN (dùng chung FE/BE) về "node module = MỘT cụm stage liên tiếp": node của app nhiều stage (Ký số = gửi + chờ)
// là một ô trên sơ đồ ⇒ các stage mang cùng `node` phải đứng LIÊN TIẾP, đủ và đúng thứ tự như `stages` của manifest. Lưu mà cụm bị tách / thiếu /
// đảo / có stage lạ chen giữa ⇒ 422 `FLOW_NODE_SPLIT` (nói rõ tên bước). Canvas, panel, menu, xoá/sao chép dùng `moduleClusters` / `clusterOf`.
// O(số stage), không I/O. Stage nháp FE (`executor` là chuỗi) và stage Hub (`executor.kind`) đều đọc được.
import type { AppNodeDecl } from "../app-manifest/manifest";
import { MODULES } from "../modules/index.generated";
import { toAppNode } from "../modules/modules.rules";

/** Hình tối thiểu của stage mà luật cần. */
export type ClusterStage = {
  node?: string | undefined;
  executor: string | { kind: string };
};

/** Cụm stage của một node module: `[start, end)` trong mảng stage. */
export type ModuleCluster = { node: string; start: number; end: number };

export const CLUSTER_RULES = ["split", "incomplete", "reordered"] as const;
export type ClusterRule = (typeof CLUSTER_RULES)[number];
export type ClusterIssue = {
  node: string;
  /** Tên nghiệp vụ của node (tiếng Việt), vd "Ký số". */
  label: string;
  rule: ClusterRule;
  /** Chỉ số stage đầu tiên của đoạn sai. */
  index: number;
  path: string;
};

/** Node nhiều stage của mọi app (node một stage không thể bị tách). CR-125 · m1 · đọc thẳng từ sổ `MODULES`. */
const MULTI: readonly AppNodeDecl[] = MODULES.flatMap((m) => m.nodes)
  .filter((n) => n.stages.length > 1)
  .map(toAppNode);

const kindOf = (s: ClusterStage): string =>
  typeof s.executor === "string" ? s.executor : s.executor.kind;

type Scan = { clusters: ModuleCluster[]; issues: ClusterIssue[] };

type Bad = { node: AppNodeDecl; index: number; reordered: boolean };

/** Một đoạn `[i, j)` liên tiếp cùng node: cắt từng nhóm `m` stage; đủ + đúng kind ⇒ cụm, còn lại ⇒ sai. */
function scanRun(stages: readonly ClusterStage[], decl: AppNodeDecl, i: number, j: number): Scan2 {
  const clusters: ModuleCluster[] = [];
  const m = decl.stages.length;
  let p = i;
  while (p + m <= j) {
    const at = p;
    const ok = decl.stages.every(
      (d, q) => kindOf(stages[at + q] as ClusterStage) === d.executor.kind,
    );
    if (!ok) return { clusters, bad: { node: decl, index: p, reordered: true } };
    clusters.push({ node: decl.key, start: p, end: p + m });
    p += m;
  }
  return { clusters, bad: p < j ? { node: decl, index: p, reordered: false } : null };
}
type Scan2 = { clusters: ModuleCluster[]; bad: Bad | null };

function scan(stages: readonly ClusterStage[], nodes: readonly AppNodeDecl[]): Scan {
  const multi = new Map(nodes.filter((n) => n.stages.length > 1).map((n) => [n.key, n]));
  const clusters: ModuleCluster[] = [];
  const bad: Bad[] = [];
  const runs = new Map<string, number>();
  let i = 0;
  while (i < stages.length) {
    const key = stages[i]?.node;
    const decl = key === undefined ? undefined : multi.get(key);
    let j = i + 1;
    if (decl) {
      while (j < stages.length && stages[j]?.node === key) j++;
      runs.set(decl.key, (runs.get(decl.key) ?? 0) + 1);
      const r = scanRun(stages, decl, i, j);
      clusters.push(...r.clusters);
      if (r.bad) bad.push(r.bad);
    }
    i = j;
  }
  const rule = (b: Bad): ClusterRule =>
    b.reordered ? "reordered" : (runs.get(b.node.key) ?? 0) > 1 ? "split" : "incomplete";
  const issues = bad.map(
    (b): ClusterIssue => ({
      node: b.node.key,
      label: b.node.label.vi,
      rule: rule(b),
      index: b.index,
      path: `stages.${b.index}`,
    }),
  );
  return { clusters, issues };
}

/** Các cụm node module hợp lệ, theo thứ tự trong mảng. `nodes` mặc định = node của mọi app. */
export function moduleClusters(
  stages: readonly ClusterStage[],
  nodes: readonly AppNodeDecl[] = MULTI,
): ModuleCluster[] {
  return scan(stages, nodes).clusters;
}

/** Cụm chứa stage `i`; stage không thuộc node nhiều stage (hoặc cụm sai) ⇒ null. */
export function clusterOf(
  stages: readonly ClusterStage[],
  i: number,
  nodes: readonly AppNodeDecl[] = MULTI,
): ModuleCluster | null {
  return moduleClusters(stages, nodes).find((c) => i >= c.start && i < c.end) ?? null;
}

/** Cụm bị tách / thiếu / đảo thứ tự / có stage lạ chen giữa (rỗng ⇒ hợp lệ). */
export function moduleClusterIssues(
  stages: readonly ClusterStage[],
  nodes: readonly AppNodeDecl[] = MULTI,
): ClusterIssue[] {
  return scan(stages, nodes).issues;
}

/** Lỗi lưu def (HTTP 422) khi có `ClusterIssue`; `details.nodes` = danh sách `ClusterIssue`. */
export const FLOW_NODE_SPLIT_ERROR = { code: "FLOW_NODE_SPLIT", status: 422 } as const;

/** Câu lỗi nghiệp vụ cho người dùng (cách sửa kèm theo). */
export const clusterIssueMessage = (i: Pick<ClusterIssue, "label">): string =>
  `Bước ${i.label} bị tách rời — xoá rồi thêm lại bước ${i.label}`;
