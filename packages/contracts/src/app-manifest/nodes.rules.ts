// CR-122 · FLOW2-FR-25/26 · luật THUẦN của node bảng: kiểm khai báo `nodes[]` (`check:app-events`), chọn node cho bảng theo tính
// năng đang bật, và `edgeIssues` (nối hai node lệch giao diện — N2 + trình sửa dùng chung).
import { CORE_NODES } from "./core.nodes";
import {
  APP_FACT_TYPES,
  APP_NODE_KEY_RE,
  type AppFactType,
  type AppManifest,
  type AppNodeDecl,
  type AppNodeIo,
  FACT_KEY_RE,
  NODE_EXECUTORS,
  NODE_GROUPS,
  NODE_IO_MAX,
  NODE_STAGES_MAX,
} from "./manifest";

export type EdgeIssue =
  | { key: string; rule: "missing" }
  | { key: string; rule: "type"; expected: AppFactType; got: AppFactType };

/**
 * Nối node trước → node sau: mỗi đầu vào `required` của node sau phải có đầu ra cùng khoá ở node trước; cùng khoá mà khác kiểu ⇒
 * lệch kiểu (kể cả đầu vào không bắt buộc). Rỗng ⇒ nối được. N2 dùng để gợi ý chèn node Ghi giá trị làm cầu nối.
 */
/** CR-122 · một khái niệm, một khoá: `contract-id` (flow cũ) ≡ `contract_id` (manifest) — lúc chạy hub so khớp y như vậy. */
export const ioKeyOf = (key: string): string => key.replaceAll("-", "_");

export function edgeIssues(
  prevOutputs: readonly AppNodeIo[],
  nextInputs: readonly AppNodeIo[],
): EdgeIssue[] {
  const out = new Map(prevOutputs.map((o) => [ioKeyOf(o.key), o.type]));
  const issues: EdgeIssue[] = [];
  for (const i of nextInputs) {
    const got = out.get(ioKeyOf(i.key));
    if (got === undefined) {
      if (i.required) issues.push({ key: i.key, rule: "missing" });
    } else if (got !== i.type) issues.push({ key: i.key, rule: "type", expected: i.type, got });
  }
  return issues;
}

export type AppNodeIssue = { app: string; node?: string; rule: string };

const TYPES: ReadonlySet<string> = new Set(APP_FACT_TYPES);
const EXECS: ReadonlySet<string> = new Set(NODE_EXECUTORS);
const GROUPS: ReadonlySet<string> = new Set(NODE_GROUPS);
const ioBad = (xs: readonly AppNodeIo[]) =>
  xs.length > NODE_IO_MAX ||
  new Set(xs.map((x) => x.key)).size !== xs.length ||
  xs.some((x) => !FACT_KEY_RE.test(x.key) || !TYPES.has(x.type));

function nodeRules(owner: string, n: AppNodeDecl, outcomes: ReadonlySet<string>): string[] {
  const keyOk = APP_NODE_KEY_RE.test(n.key);
  const checks: [string, boolean][] = [
    ["node_key_format", !keyOk],
    ["node_key_prefix", keyOk && n.key.split(".")[0] !== owner],
    ["node_label", !n.label.vi.trim() || !n.label.en.trim()],
    ["node_group", !GROUPS.has(n.group)],
    ["node_stages", n.stages.length === 0 || n.stages.length > NODE_STAGES_MAX],
    ["node_executor", n.stages.some((s) => !EXECS.has(s.executor.kind))],
    ["node_outcome", n.stages.some((s) => s.outcome !== undefined && !outcomes.has(s.outcome))],
    ["node_io", ioBad(n.inputs) || ioBad(n.outputs)],
    ["node_feature", n.feature !== undefined && !n.feature.trim()],
    [
      "node_config",
      n.config !== undefined &&
        (!Number.isInteger(n.config.stage) ||
          n.config.stage < 0 ||
          n.config.stage >= n.stages.length ||
          n.stages[n.config.stage]?.executor.kind !== "tool" ||
          !n.config.options_path.startsWith(`/pack/${owner}/`)),
    ],
  ];
  return checks.filter(([, bad]) => bad).map(([r]) => r);
}

/** Vi phạm khai báo node của node lõi + mọi app (khoá trùng xét trên toàn tập). Rỗng ⇒ hợp lệ. */
export function appNodeIssues(
  manifests: readonly AppManifest[],
  core: readonly AppNodeDecl[] = CORE_NODES,
): AppNodeIssue[] {
  const out: AppNodeIssue[] = [];
  const seen = new Set<string>();
  const groups: [string, readonly AppNodeDecl[], ReadonlySet<string>][] = [
    ["core", core, new Set()],
    ...manifests.map(
      (m) =>
        [m.key, m.nodes, new Set(m.events.flatMap((e) => e.outcomes.map((o) => o.key)))] as [
          string,
          readonly AppNodeDecl[],
          ReadonlySet<string>,
        ],
    ),
  ];
  for (const [owner, nodes, outcomes] of groups)
    for (const n of nodes) {
      const rules = nodeRules(owner, n, outcomes);
      if (seen.has(n.key)) rules.push("node_key_duplicate");
      seen.add(n.key);
      for (const rule of rules) out.push({ app: owner, node: n.key, rule });
    }
  return out;
}

/** Node lõi + node của app (theo key), mỗi node kèm `feature` để bên gọi lọc theo tính năng đang bật. */
export function nodesFor(manifests: readonly AppManifest[], app?: string): readonly AppNodeDecl[] {
  const own = manifests.filter((m) => app === undefined || m.key === app).flatMap((m) => m.nodes);
  return [...CORE_NODES, ...own];
}

/** Tra node theo khoá (lõi + mọi app). */
export function nodeByKey(manifests: readonly AppManifest[], key: string): AppNodeDecl | undefined {
  return nodesFor(manifests).find((n) => n.key === key);
}
