// CR-122 · N2 · FLOW2-FR-26 · luật THUẦN (không AI, không I/O) kiểm các CẠNH của flow: mỗi cạnh = stage trước → stage sau theo đường
// đi của engine (bước kế, `next_step`, nhánh Nếu, `after.branch`, rẽ `wait_event`, Từ chối/Trả lại của Duyệt). Đầu ra của stage trước =
// `outputs` của node bảng + `output.fields`; đầu vào của stage sau = `inputs` của node bảng (stage không có `node` ⇒ không đòi gì).
// Node điều khiển (Nếu, Chờ, Gửi thông báo, Duyệt) KHÔNG đổi dữ liệu ⇒ trong suốt: đầu ra của nó gồm cả đầu ra của bước đứng trước.
// Cạnh từ node Bắt đầu khi (sự kiện) không xét ở đây. `insertBridgeStage` chèn một stage cầu nối vào đúng một cạnh (dịch số bước).
// Không import `./processes` (file đó import `FlowEdgeWarningSchema` ở đây) ⇒ không vòng import.
import { z } from "zod";
import { defStartOutputs } from "../app-manifest/index";
import {
  APP_FACT_TYPES,
  type AppFactType,
  type AppNodeDecl,
  type AppNodeIo,
  ioLabel,
} from "../app-manifest/manifest";
import { edgeIssues } from "../app-manifest/nodes.rules";
import { PROCESS_STAGES_MAX } from "../chat/processes";
import { resolveSteps } from "./process-steps";

/** Hình tối thiểu của stage mà luật cần (bản nháp FE / def đã parse đều khớp). */
export type EdgeStage = {
  key: string;
  name?: string;
  step?: number;
  next_step?: number;
  outcome?: string;
  node?: string;
  executor: {
    kind: string;
    then_step?: number;
    else_step?: number | null;
    reject_step?: number | null;
    return_step?: number | null;
    branches?: readonly { goto_step: number }[];
    /** Node `set`: các khoá được ghi. */
    values?: readonly { key: string }[];
  };
  after: {
    kind?: string;
    branch?: readonly { goto_step: number }[];
    back_to_steps?: readonly number[];
  };
  output?: { fields?: readonly { key: string; type: string }[] };
};
export type EdgePaletteNode = Pick<AppNodeDecl, "key" | "inputs" | "outputs">;

export const FlowEdgeWarningSchema = z.strictObject({
  from: z.string().max(64),
  to: z.string().max(64),
  /** Đầu vào BẮT BUỘC của bước sau mà bước trước không có ⇒ chặn lưu (`FLOW_EDGE_MISSING`). */
  missing: z.array(z.string().max(64)).max(20),
  /** Cùng khoá, khác kiểu ⇒ chỉ cảnh báo. */
  typeMismatch: z
    .array(
      z.strictObject({
        key: z.string().max(64),
        expected: z.enum(APP_FACT_TYPES),
        got: z.enum(APP_FACT_TYPES),
      }),
    )
    .max(20),
  /** CR-122 · A · tên bước trước / sau (UI ghi "Bước «Gửi ký số» cần «Hợp đồng»"); vắng ⇒ khoá. */
  from_name: z.string().max(200).optional(),
  to_name: z.string().max(200).optional(),
  /** Nhãn vi/en của mỗi trường trong `missing`/`typeMismatch` (vắng nhãn ⇒ khoá). */
  labels: z
    .array(
      z.strictObject({ key: z.string().max(64), vi: z.string().max(200), en: z.string().max(200) }),
    )
    .max(40)
    .optional(),
});
/** Một cạnh lệch giao diện (`from`/`to` = khoá stage). Rỗng cả hai mảng ⇒ không có trong kết quả. */
export type FlowEdgeIssue = z.infer<typeof FlowEdgeWarningSchema>;

/** Node không đổi dữ liệu: cho dữ liệu của bước trước đi qua. */
const PASS_KINDS: ReadonlySet<string> = new Set([
  "if",
  "wait_for",
  "wait_until",
  "wait_event",
  "notify",
  "approve",
]);
const FACT_TYPES: ReadonlySet<string> = new Set(APP_FACT_TYPES);

/** Các bước mà stage `s` (ở bước `own`) có thể đi tới — chỉ đích tiến về sau; node Kết thúc không đi tiếp. */
function targetSteps(s: EdgeStage, own: number): number[] {
  if (s.outcome !== undefined) return [];
  const e = s.executor;
  const t =
    e.kind === "if"
      ? [e.then_step ?? own + 1, e.else_step ?? own + 1]
      : [
          s.next_step ?? own + 1,
          ...(s.after.branch ?? []).map((b) => b.goto_step),
          ...(e.branches ?? []).map((b) => b.goto_step),
          ...[e.reject_step, e.return_step].filter((g): g is number => typeof g === "number"),
        ];
  return [...new Set(t)].filter((x) => x > own);
}

/** Cạnh stage → stage (chỉ số trong `stages`): mỗi stage đi tới MỌI stage của bước đích. */
export function flowEdges(stages: readonly EdgeStage[]): [number, number][] {
  const steps = resolveSteps(stages);
  const byStep = new Map<number, number[]>();
  steps.forEach((st, i) => {
    byStep.set(st, [...(byStep.get(st) ?? []), i]);
  });
  const out: [number, number][] = [];
  stages.forEach((s, i) => {
    for (const t of targetSteps(s, steps[i] as number))
      for (const j of byStep.get(t) ?? []) out.push([i, j]);
  });
  return out;
}

/** Đầu ra CỦA RIÊNG stage (node bảng đã ghi được + `output.fields` + khoá của node Ghi giá trị); đầu ra `pending` (CR-125 m8) không tính. */
export function stageOwnOutputs(s: EdgeStage, node: EdgePaletteNode | undefined): AppNodeIo[] {
  const out: AppNodeIo[] = (node?.outputs ?? []).filter((o) => !o.pending);
  const have = new Set(out.map((o) => o.key));
  for (const f of s.output?.fields ?? [])
    if (!have.has(f.key) && FACT_TYPES.has(f.type) && have.add(f.key))
      out.push({ key: f.key, type: f.type as AppFactType, required: false });
  // CR-122 E4 · node Ghi giá trị: mọi khoá đã ghi là đầu ra (kể cả chưa khai `output.fields` trong bản nháp ⇒ kiểu `string`).
  if (s.executor.kind === "set")
    for (const v of s.executor.values ?? [])
      if (!have.has(v.key) && have.add(v.key))
        out.push({ key: v.key, type: "string", required: false });
  return out;
}

/** Đầu ra mỗi stage (cả dữ liệu đi qua node trong suốt). Cạnh luôn đi từ chỉ số nhỏ → lớn nên duyệt theo chỉ số là đủ. */
function allOutputs(
  stages: readonly EdgeStage[],
  edges: readonly [number, number][],
  nodeOf: (s: EdgeStage) => EdgePaletteNode | undefined,
): AppNodeIo[][] {
  const preds: number[][] = stages.map(() => []);
  for (const [i, j] of edges) preds[j]?.push(i);
  const out: AppNodeIo[][] = [];
  stages.forEach((s, i) => {
    const own = stageOwnOutputs(s, nodeOf(s));
    out.push(
      PASS_KINDS.has(s.executor.kind)
        ? withUpstream(
            own,
            (preds[i] ?? []).flatMap((p) => out[p] ?? []),
          )
        : own,
    );
  });
  return out;
}

/** `own` + các trường của bước trước mà `own` chưa có (khoá trùng: giữ `own`). */
function withUpstream(own: AppNodeIo[], upstream: readonly AppNodeIo[]): AppNodeIo[] {
  const seen = new Set(own.map((o) => o.key));
  const extra = upstream.filter((o) => !seen.has(o.key) && seen.add(o.key));
  return [...own, ...extra];
}

/** Dữ liệu (khoá + kiểu) sẵn có SAU mỗi stage, cùng chỉ số với `def.stages` — cho AI/trình sửa biết "bước trước có gì". */
export function flowStageOutputs(def: EdgeDef, palette: readonly EdgePaletteNode[]): AppNodeIo[][] {
  const byKey = new Map(palette.map((n) => [n.key, n]));
  const start = defStartOutputs(def);
  return allOutputs(def.stages, flowEdges(def.stages), (s) =>
    s.node === undefined ? undefined : byKey.get(s.node),
  ).map((o) => withUpstream(o, start));
}

/** Def tối thiểu cho kiểm cạnh: `app` + `trigger` (nếu có) ⇒ đầu ra Bắt đầu khi có ở mọi bước. */
export type EdgeDef = {
  stages: readonly EdgeStage[];
  app?: string | null;
  trigger?: { event: string } | null;
};

/**
 * Mọi cạnh lệch giao diện của flow, theo thứ tự cạnh. `palette` = bảng node (lõi + app, đã lọc theo tính năng công ty): node không có
 * trong bảng ⇒ không đòi gì. Chỉ cạnh có `missing` hoặc `typeMismatch` mới có trong kết quả.
 */
export function flowEdgeIssues(def: EdgeDef, palette: readonly EdgePaletteNode[]): FlowEdgeIssue[] {
  const byKey = new Map(palette.map((n) => [n.key, n]));
  const nodeOf = (s: EdgeStage) => (s.node === undefined ? undefined : byKey.get(s.node));
  const edges = flowEdges(def.stages);
  const outs = allOutputs(def.stages, edges, nodeOf);
  const start = defStartOutputs(def);
  const found: FlowEdgeIssue[] = [];
  for (const [i, j] of edges) {
    const from = def.stages[i] as EdgeStage;
    const to = def.stages[j] as EdgeStage;
    const inputs = nodeOf(to)?.inputs ?? [];
    if (inputs.length === 0) continue;
    // CR-122 · A · đầu ra Bắt đầu khi (bản ghi + dữ kiện) có ở MỌI cạnh phía sau.
    const r = edgeIssues(withUpstream([...(outs[i] ?? [])], start), inputs);
    if (r.length === 0) continue;
    const missing = r.flatMap((x) => (x.rule === "missing" ? [x.key] : []));
    const typeMismatch = r.flatMap((x) =>
      x.rule === "type" ? [{ key: x.key, expected: x.expected, got: x.got }] : [],
    );
    const labels = r.map((x) => {
      const io = inputs.find((n) => n.key === x.key);
      return { key: x.key, ...ioLabel(io ?? { key: x.key }) };
    });
    found.push({
      from: from.key,
      to: to.key,
      missing,
      typeMismatch,
      from_name: from.name ?? from.key,
      to_name: to.name ?? to.key,
      labels,
    });
  }
  return found;
}

/** Cạnh có thiếu trường BẮT BUỘC ⇒ chặn lưu. */
export const blockingEdgeIssues = (issues: readonly FlowEdgeIssue[]): FlowEdgeIssue[] =>
  issues.filter((x) => x.missing.length > 0);

const bump = (n: number, at: number): number => (n > at ? n + 1 : n);
const bumpOpt = <V extends number | null | undefined>(n: V, at: number): V =>
  (typeof n === "number" ? bump(n, at) : n) as V;

function shifted<T extends EdgeStage>(s: T, own: number, at: number): T {
  const e = s.executor;
  const executor = {
    ...e,
    ...(e.then_step === undefined ? {} : { then_step: bump(e.then_step, at) }),
    ...(e.else_step === undefined ? {} : { else_step: bumpOpt(e.else_step, at) }),
    ...(e.reject_step === undefined ? {} : { reject_step: bumpOpt(e.reject_step, at) }),
    ...(e.return_step === undefined ? {} : { return_step: bumpOpt(e.return_step, at) }),
    ...(e.branches === undefined
      ? {}
      : { branches: e.branches.map((b) => ({ ...b, goto_step: bump(b.goto_step, at) })) }),
  };
  const a = s.after;
  const after = {
    ...a,
    ...(a.branch === undefined
      ? {}
      : { branch: a.branch.map((b) => ({ ...b, goto_step: bump(b.goto_step, at) })) }),
    ...(a.back_to_steps === undefined
      ? {}
      : { back_to_steps: a.back_to_steps.map((n) => bump(n, at)) }),
  };
  return {
    ...s,
    step: own >= at ? own + 1 : own,
    ...(s.next_step === undefined ? {} : { next_step: bump(s.next_step, at) }),
    executor,
    after,
  };
}

/**
 * Chèn `bridge` vào cạnh `fromKey` → `toKey`: bước mới (một mình) ngay trước bước của `toKey`; mọi bước ≥ bước đó dời +1 và mọi chỗ
 * tham chiếu bước (next_step, Nếu, nhánh, rẽ chờ, Duyệt, quay lại) được cập nhật; mọi lối đi vào bước đó giờ đi qua cầu nối.
 * Trả `null` khi không có cạnh đó / trùng khoá / hết chỗ (≤ `PROCESS_STAGES_MAX` stage). Không đổi `stages` gốc.
 */
export function insertBridgeStage<T extends EdgeStage>(
  stages: readonly T[],
  fromKey: string,
  toKey: string,
  bridge: T,
): { stages: T[]; step: number } | null {
  const f = stages.findIndex((s) => s.key === fromKey);
  const t = stages.findIndex((s) => s.key === toKey);
  if (f < 0 || t < 0 || stages.length >= PROCESS_STAGES_MAX) return null;
  if (stages.some((s) => s.key === bridge.key)) return null;
  if (!flowEdges(stages).some(([a, b]) => a === f && b === t)) return null;
  const steps = resolveSteps(stages);
  const at = steps[t] as number;
  const moved = stages.map((s, i) => shifted(s, steps[i] as number, at));
  const pos = steps.findIndex((st) => st >= at);
  const out = [...moved.slice(0, pos), { ...bridge, step: at }, ...moved.slice(pos)];
  return { stages: out, step: at };
}
