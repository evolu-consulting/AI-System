// CR-127 · E7 · BR-17 · spec §5.6 · luật THUẦN đi đường của "Chạy thử": từ bước đầu, qua các bước theo dữ kiện HĐ thử (node Nếu =
// `evaluateWhen` + `ifTarget` của engine) và chuỗi quyết định "đóng vai" (Duyệt/Trả lại/Từ chối), tới Kết thúc hoặc dừng chờ người duyệt.
// Không ghi DB / thông báo / chữ ký. Người nhận việc + cảnh báo ở `flow-preview.rules.ts`.
import { type ProcessStageDef, resolveSteps } from "@ai/contracts/hub-admin";
import {
  evaluateWhen,
  type FactValue,
  type IfCond,
  type IfFrom,
  type IfWhen,
  ifTarget,
  missingKeysOf,
} from "../if/if.rules";
import {
  canActAs,
  isReview,
  type PreviewWarning,
  type ReviewInfo,
  type ReviewView,
  resolveReview,
  type World,
} from "./flow-preview.rules";

export type DecisionResult = "approve" | "return" | "reject";
export type Decision = { step_key: string; result: DecisionResult; actor_user_id?: string | null };
export type OutcomeDecl = { key: string; label: string; effect: string };
export type PreviewInput = {
  stages: readonly ProcessStageDef[];
  facts: Readonly<Record<string, FactValue>>;
  starterId: string | null;
  decisions: readonly Decision[];
  at: Date;
  world: World;
  factLabels: ReadonlyMap<string, string>;
  outcomes: readonly OutcomeDecl[];
};

export type PathStep = {
  step_key: string;
  name: string;
  node: string | null;
  kind: "step" | "review" | "if" | "end";
  /** `done` đã qua · `waiting` đang chờ người duyệt (dừng ở đây) · `skipped` không đi qua. */
  status: "done" | "waiting" | "skipped";
  reason: string | null;
  branch?: "then" | "else";
  decision?: DecisionResult;
  actor?: { user_id: string; name: string } | null;
  can_act?: boolean | null;
  review?: ReviewView;
  /** Node Nếu: số thứ tự điều kiện đúng, dữ kiện còn thiếu (P18 — coi như Sai, nói rõ "chưa có dữ liệu"). */
  hits?: number[];
  missing?: string[];
  outcome?: OutcomeDecl | null;
};
export type PreviewResult = {
  path: PathStep[];
  /** `finished` tới Kết thúc · `waiting` chờ quyết định ở bước `waiting_step` · `stopped` dừng không có Kết thúc (Từ chối/Trả lại chưa chọn đích). */
  status: "finished" | "waiting" | "stopped";
  waiting_step: string | null;
  outcome: OutcomeDecl | null;
  skipped: { step_key: string; name: string }[];
  warnings: PreviewWarning[];
};

const OP: Record<string, string> = { eq: "=", ne: "≠", lt: "<", le: "≤", gt: ">", ge: "≥" };
const PATH_MAX = 60;

type Exec = {
  kind: string;
  when?: {
    op: "and" | "or";
    conds: { from: Record<string, string>; op: string; value: IfCond["value"] }[];
  };
  then_step?: number;
  else_step?: number | null;
  reject_step?: number | null;
  return_step?: number | null;
};
const execOf = (s: ProcessStageDef): Exec => s.executor as unknown as Exec;

const fromOf = (f: Record<string, string>): IfFrom =>
  f.kind === "fact"
    ? { kind: "fact", key: f.key as string }
    : f.kind === "input"
      ? { kind: "input", key: f.key as string }
      : { kind: "field", stageKey: f.stage_key as string, field: f.field as string };
const whenOf = (e: Exec): IfWhen => ({
  op: (e.when?.op ?? "and") as "and" | "or",
  conds: (e.when?.conds ?? []).map((c) => ({
    from: fromOf(c.from),
    op: c.op as IfCond["op"],
    value: c.value,
  })),
});

function condText(w: IfWhen, labels: ReadonlyMap<string, string>): string {
  const one = (c: IfCond): string => {
    const k = c.from.kind === "field" ? c.from.field : c.from.key;
    const name = c.from.kind === "fact" ? (labels.get(k) ?? k) : k;
    return `${name} ${OP[c.op] ?? c.op} ${String(c.value)}`;
  };
  return w.conds.map(one).join(w.op === "and" ? " và " : " hoặc ");
}

type Graph = { count: number; byStep: Map<number, number[]> };
function graphOf(stages: readonly ProcessStageDef[]): Graph {
  const steps = resolveSteps(stages);
  const byStep = new Map<number, number[]>();
  steps.forEach((s, i) => {
    byStep.set(s, [...(byStep.get(s) ?? []), i]);
  });
  return { count: steps.length ? Math.max(...steps) + 1 : 0, byStep };
}
const lastOf = (
  g: Graph,
  stages: readonly ProcessStageDef[],
  step: number,
): ProcessStageDef | undefined => stages[(g.byStep.get(step) ?? []).at(-1) ?? -1];
const nextOf = (g: Graph, stages: readonly ProcessStageDef[], step: number): number =>
  lastOf(g, stages, step)?.next_step ?? step + 1;

type Edge = { to: number; from: ProcessStageDef | undefined };
/** Các cạnh đi ra của một bước (Nếu: Đúng/Sai · Duyệt: bước kế + Từ chối + Trả lại · còn lại: bước kế); node Kết thúc không có cạnh. */
function edgesOf(g: Graph, stages: readonly ProcessStageDef[], step: number): Edge[] {
  const idxs = g.byStep.get(step) ?? [];
  const s = stages[idxs[0] as number] as ProcessStageDef;
  if (idxs.some((i) => (stages[i] as ProcessStageDef).outcome !== undefined)) return [];
  const e = execOf(s);
  const nxt = nextOf(g, stages, step);
  if (e.kind === "if")
    return [
      { to: e.then_step ?? nxt, from: s },
      { to: e.else_step ?? step + 1, from: s },
    ];
  const last = lastOf(g, stages, step);
  const targets = e.kind === "approve" ? [e.reject_step, e.return_step] : [];
  return [
    { to: nxt, from: last },
    ...targets.filter((t): t is number => typeof t === "number").map((to) => ({ to, from: s })),
  ];
}

/** Mọi đường đều phải tới Kết thúc: bước mà một nhánh đi tiếp ra ngoài cuối quy trình (không có node Kết thúc) ⇒ danh sách mã bước. */
export function stepsWithoutEnd(stages: readonly ProcessStageDef[]): string[] {
  const g = graphOf(stages);
  const bad = new Set<string>();
  const seen = new Set<number>();
  const todo: Edge[] = [{ to: 0, from: undefined }];
  for (let e = todo.pop(); e; e = todo.pop()) {
    if (e.to >= g.count || !g.byStep.has(e.to)) {
      if (e.from) bad.add(e.from.key);
    } else if (!seen.has(e.to)) {
      seen.add(e.to);
      todo.push(...edgesOf(g, stages, e.to));
    }
  }
  return [...bad];
}

const noEndWarnings = (stages: readonly ProcessStageDef[]): PreviewWarning[] =>
  stepsWithoutEnd(stages).map((k) => ({
    code: "path_no_end",
    step_key: k,
    message: `Có nhánh đi tiếp từ «${nameByKey(stages, k)}» mà không tới Kết thúc: thêm Kết thúc cho nhánh đó.`,
  }));

export function walkFlow(i: PreviewInput): PreviewResult {
  const infos = new Map<number, ReviewInfo>();
  i.stages.forEach((s, idx) => {
    if (isReview(s)) infos.set(idx, resolveReview(s, i.world, i.starterId, i.at));
  });
  const warnings: PreviewWarning[] = [
    ...[...infos.values()].flatMap((x) => x.warnings),
    ...noEndWarnings(i.stages),
  ];
  const w = (code: PreviewWarning["code"], key: string | null, message: string) =>
    warnings.push({ code, step_key: key, message });
  const out = new Walker(i, graphOf(i.stages), infos, w).go();
  const seen = new Set(out.path.map((p) => p.step_key));
  const skipped =
    out.status === "waiting"
      ? []
      : i.stages
          .filter((s) => !seen.has(s.key) && s.outcome === undefined)
          .map((s) => ({ step_key: s.key, name: s.name }));
  const dedup = new Map(warnings.map((x) => [`${x.code}|${x.step_key}`, x]));
  return { ...out, skipped, warnings: [...dedup.values()] };
}

const nameByKey = (stages: readonly ProcessStageDef[], key: string): string =>
  stages.find((s) => s.key === key)?.name ?? key;

type Out = Pick<PreviewResult, "path" | "status" | "waiting_step" | "outcome">;

class Walker {
  readonly path: PathStep[] = [];
  private readonly decisions = new Map<string, Decision>();
  constructor(
    private readonly i: PreviewInput,
    private readonly g: Graph,
    private readonly infos: ReadonlyMap<number, ReviewInfo>,
    private readonly w: (code: PreviewWarning["code"], key: string | null, message: string) => void,
  ) {
    for (const d of i.decisions)
      if (!this.decisions.has(d.step_key)) this.decisions.set(d.step_key, d);
  }

  private done(
    status: Out["status"],
    waiting: string | null = null,
    outcome: OutcomeDecl | null = null,
  ): Out {
    return { path: this.path, status, waiting_step: waiting, outcome };
  }

  go(): Out {
    let step = 0;
    for (let guard = 0; guard < PATH_MAX; guard++) {
      if (step >= this.g.count) return this.done("finished");
      const r = this.runStep(step);
      if ("status" in r) return r;
      step = r.jump ?? nextOf(this.g, this.i.stages, step);
    }
    this.w("loop", null, "Đường đi quay vòng quá nhiều lần: kiểm tra lại các bước Trả lại.");
    return this.done("stopped");
  }

  /** Chạy các việc của một bước: kết thúc/chờ/dừng ⇒ `Out`; còn đi tiếp ⇒ bước nhảy tới (undefined = bước kế). */
  private runStep(step: number): Out | { jump: number | undefined } {
    const { stages } = this.i;
    const idxs = this.g.byStep.get(step) ?? [];
    if (idxs.length > 1)
      this.w(
        "parallel_steps",
        (stages[idxs[0] as number] as ProcessStageDef).key,
        "Bước này có nhiều việc chạy cùng lúc: Chạy thử đi lần lượt từng việc.",
      );
    for (const idx of idxs) {
      const s = stages[idx] as ProcessStageDef;
      if (s.outcome !== undefined) return this.end(s);
      if (execOf(s).kind === "if") return { jump: this.ifStep(s, step) };
      const r = isReview(s) ? this.review(s, idx, step) : this.plain(s);
      if (r === "wait") return this.done("waiting", s.key);
      if (r === "next") continue;
      if (r.to === null) return this.done("stopped");
      return { jump: r.to };
    }
    return { jump: undefined };
  }

  private end(s: ProcessStageDef): Out {
    const o = this.i.outcomes.find((x) => x.key === s.outcome) ?? {
      key: s.outcome as string,
      label: s.name,
      effect: "",
    };
    this.path.push(this.row(s, "end", "done", null, { outcome: o }));
    return this.done("finished", null, o);
  }

  private plain(s: ProcessStageDef): "next" {
    this.path.push(this.row(s, "step", "done", null));
    return "next";
  }

  private ifStep(s: ProcessStageDef, step: number): number {
    const e = execOf(s);
    const when = whenOf(e);
    const facts = this.i.facts;
    const r = evaluateWhen(when, {}, {}, facts);
    const missing = missingKeysOf(when, {}, facts);
    if (missing.length > 0)
      this.w(
        "facts_missing",
        s.key,
        `Chưa có dữ liệu cho «${missing.join("», «")}» ở bước «${s.name}»: Chạy thử coi như Sai.`,
      );
    const to = ifTarget(
      { when, thenStep: e.then_step ?? step + 1, elseStep: e.else_step ?? null },
      r.matched,
      step,
      this.g.count,
    );
    const text = `${condText(when, this.i.factLabels)} ⇒ ${r.matched ? "Đúng" : "Sai"}`;
    this.path.push(
      this.row(s, "if", "done", text, {
        branch: r.matched ? "then" : "else",
        hits: r.hits,
        ...(missing.length ? { missing } : {}),
      }),
    );
    return to;
  }

  /** Bước Duyệt: chưa có quyết định ⇒ dừng chờ; có ⇒ đi tiếp / Từ chối / Trả lại (đích của node Duyệt; không đích ⇒ dừng). */
  private review(
    s: ProcessStageDef,
    idx: number,
    step: number,
  ): "next" | "wait" | { to: number | null } {
    const info = this.infos.get(idx) as ReviewInfo;
    const d = this.decisions.get(s.key);
    const view = viewOf(info);
    if (!d) {
      this.path.push(this.row(s, "review", "waiting", null, { review: view }));
      return "wait";
    }
    const actorId = d.actor_user_id ?? null;
    const can = actorId ? canActAs(s, info, this.i.world, this.i.starterId, actorId) : null;
    const extra = {
      review: view,
      decision: d.result,
      actor: actorId
        ? { user_id: actorId, name: this.i.world.users.get(actorId)?.name ?? "?" }
        : null,
      can_act: can,
    };
    if (can === false) {
      this.path.push(
        this.row(
          s,
          "review",
          "waiting",
          "Người này không được quyết bước này lúc chạy thật.",
          extra,
        ),
      );
      return "wait";
    }
    this.path.push(this.row(s, "review", "done", null, extra));
    if (d.result === "approve") return "next";
    const e = execOf(s);
    const to = d.result === "reject" ? e.reject_step : e.return_step;
    return typeof to === "number" && to > step ? { to } : { to: null };
  }

  private row(
    s: ProcessStageDef,
    kind: PathStep["kind"],
    status: PathStep["status"],
    reason: string | null,
    more: Partial<PathStep> = {},
  ): PathStep {
    return { step_key: s.key, name: s.name, node: s.node ?? null, kind, status, reason, ...more };
  }
}

const viewOf = (x: ReviewInfo): ReviewView => ({
  need: x.need,
  group_id: x.group_id,
  group_name: x.group_name,
  who: x.who,
  who_total: x.who_total,
  evidence: x.evidence,
  due_h: x.due_h,
  voters_n: x.voters_n,
});
