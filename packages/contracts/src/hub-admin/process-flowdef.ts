// CR-122 · ADR-0038 · FLOW2-FR-01/02/12/15 · flow-model.md mục A: MỘT định dạng `FlowDef` cho Thư viện, bản công ty, mẫu chạy thử.
// `stages` = định dạng stage engine hiện có (`ProcessStageDefSchema`, + `next_step`, `outcome`); thêm `trigger {event, when?}`.
// `parseFlowDef` nhận cả def/snapshot CŨ (không `trigger`) ⇒ hợp lệ để chạy nốt lượt cũ (`legacy: true`, không áp luật mới).
// Không import vào `./processes` (file này import nó) ⇒ không vòng import; export qua `hub-admin/index.ts`.
import { z } from "zod";
import { APP_KEY_RE } from "../app-catalog";
import type { AppEventDecl, AppFactType } from "../app-manifest/manifest";
import { PROCESS_NAME_MAX, PROCESS_STAGES_MAX, ProcessKeySchema } from "../chat/processes";

import { resolveSteps } from "./process-steps";
import {
  type FactCond,
  type FactWhen,
  type FlowTrigger,
  FlowTriggerSchema,
} from "./process-trigger";
import { type ProcessStageDef, ProcessStageDefSchema } from "./processes";

/** Trần số BƯỚC (không phải stage — một bước có ≤ 3 stage song song) của một flow. */
export const FLOW_STEPS_MAX = 20;
export const FLOW_OWNERS = ["library", "company"] as const;
export type FlowOwner = (typeof FLOW_OWNERS)[number];
/** Chỉ bản công ty: bản Thư viện đã sao (= `source_ref` + `source_rel_version` hiện có). */
export const FlowSourceSchema = z.strictObject({
  flow_key: ProcessKeySchema,
  version: z.number().int().min(1),
});

export const FlowDefBaseSchema = z.strictObject({
  key: ProcessKeySchema,
  name: z.string().trim().min(1).max(PROCESS_NAME_MAX),
  app: z.string().regex(APP_KEY_RE),
  owner: z.enum(FLOW_OWNERS),
  trigger: FlowTriggerSchema,
  stages: z.array(ProcessStageDefSchema).min(1).max(PROCESS_STAGES_MAX),
  source: FlowSourceSchema.nullable().default(null),
  /** Số bản xuất bản; nháp ⇒ null. */
  version: z.number().int().min(1).nullable().default(null),
});
type FlowDefParsed = z.infer<typeof FlowDefBaseSchema>;
export type FlowDef = Omit<FlowDefParsed, "stages"> & { stages: ProcessStageDef[] };

export const FLOW_DEF_RULES = [
  "FLOW_TOO_MANY_STEPS",
  "FLOW_NO_FINISH",
  "FLOW_FINISH_NEXT",
  "FLOW_NEXT_STEP_INVALID",
  "FLOW_SOURCE_OWNER",
  "FLOW_EVENT_UNKNOWN",
  "FLOW_OUTCOME_UNKNOWN",
  "FLOW_WHEN_INVALID",
] as const;
export type FlowDefRule = (typeof FLOW_DEF_RULES)[number];
export type FlowDefIssue = { path: string; rule: FlowDefRule };
const ISSUES_MAX = 20;

type FlowDefShape = {
  owner: FlowOwner;
  trigger: FlowTrigger;
  source?: unknown;
  stages: readonly {
    step?: number;
    next_step?: number;
    outcome?: string;
    executor?: {
      kind: string;
      when?: { conds?: readonly IfCondShape[] };
      values?: readonly { from: object }[];
    };
  }[];
};
type IfCondShape = { from: { kind: string; key?: string }; op: string; value: unknown };

function stageIssues(d: FlowDefShape, add: (p: string, r: FlowDefRule) => void): void {
  const steps = resolveSteps(d.stages);
  const count = steps.length === 0 ? 0 : Math.max(...steps) + 1;
  if (new Set(steps).size > FLOW_STEPS_MAX) add("stages", "FLOW_TOO_MANY_STEPS");
  if (!d.stages.some((s) => s.outcome !== undefined)) add("stages", "FLOW_NO_FINISH");
  d.stages.forEach((s, i) => {
    if (s.outcome !== undefined && s.next_step !== undefined)
      add(`stages.${i}.next_step`, "FLOW_FINISH_NEXT");
    const n = s.next_step;
    if (n !== undefined && (n <= (steps[i] as number) || n >= count))
      add(`stages.${i}.next_step`, "FLOW_NEXT_STEP_INVALID");
  });
}

const ORDER_OPS: ReadonlySet<string> = new Set(["lt", "le", "gt", "ge"]);
/** Vế điều kiện khớp kiểu dữ kiện app khai (null ⇒ hợp lệ). */
function condOk(c: FactCond, type: AppFactType): boolean {
  const v = c.value;
  if (c.op === "in") return Array.isArray(v) && (type === "enum" || type === "department");
  if (Array.isArray(v)) return false;
  if (ORDER_OPS.has(c.op))
    return type === "number" ? typeof v === "number" : type === "date" && typeof v === "string";
  if (type === "number") return typeof v === "number";
  if (type === "boolean") return typeof v === "boolean";
  return typeof v === "string";
}

function whenIssues(w: FactWhen, ev: AppEventDecl, add: (p: string, r: FlowDefRule) => void) {
  const types = new Map(ev.facts.map((f) => [f.key, f.type]));
  const check = (c: FactCond, path: string) => {
    const t = types.get(c.fact);
    if (t === undefined || !condOk(c, t)) add(path, "FLOW_WHEN_INVALID");
  };
  w.conds.forEach((c, j) => {
    const base = `trigger.when.conds.${j}`;
    if ("fact" in c) check(c, base);
    else
      c.conds.forEach((g, k) => {
        check(g, `${base}.conds.${k}`);
      });
  });
}

/** CR-122 E2b · vế `fact` của node Nếu: khoá thuộc `AppEventDecl.facts` của sự kiện + phép so/giá trị đúng kiểu dữ kiện. */
function ifFactIssues(
  stages: FlowDefShape["stages"],
  ev: AppEventDecl,
  add: (p: string, r: FlowDefRule) => void,
) {
  const types = new Map(ev.facts.map((f) => [f.key, f.type]));
  stages.forEach((s, i) => {
    // CR-122 E4 · node Ghi giá trị đọc dữ kiện: khoá phải thuộc `AppEventDecl.facts` (kiểu do `as`/field đích kiểm ở luật `set`).
    if (s.executor?.kind === "set")
      (s.executor.values ?? []).forEach((v, j) => {
        const f = v.from as { kind?: unknown; key?: unknown };
        if (f.kind === "fact" && !types.has(String(f.key ?? "")))
          add(`stages.${i}.executor.values.${j}.from`, "FLOW_WHEN_INVALID");
      });
    if (s.executor?.kind !== "if") return;
    (s.executor.when?.conds ?? []).forEach((c, j) => {
      if (c.from.kind !== "fact") return;
      const t = types.get(c.from.key ?? "");
      const cond = { fact: c.from.key ?? "", op: c.op, value: c.value } as FactCond;
      if (t === undefined || !condOk(cond, t))
        add(`stages.${i}.executor.when.conds.${j}`, "FLOW_WHEN_INVALID");
    });
  });
}

/**
 * Luật chéo của FlowDef MỚI (≤ 20 bước, ≥ 1 Kết thúc, `next_step` tiến về sau, Kết thúc không đi tiếp, `source` chỉ ở bản công ty).
 * `events` (sự kiện của app sở hữu flow) có ⇒ kiểm thêm: sự kiện thuộc app, `outcome` thuộc sự kiện, điều kiện đúng dữ kiện + kiểu.
 * Luật từng loại node (If, Form, Chờ…) vẫn ở `processDefStageIssues` — Hub gọi khi lưu như cũ.
 */
export function flowDefIssues(d: FlowDefShape, events?: readonly AppEventDecl[]): FlowDefIssue[] {
  const out: FlowDefIssue[] = [];
  const add = (path: string, rule: FlowDefRule) => out.push({ path, rule });
  stageIssues(d, add);
  if (d.owner === "library" && d.source != null) add("source", "FLOW_SOURCE_OWNER");
  if (events) {
    const ev = events.find((e) => e.key === d.trigger.event);
    if (!ev) add("trigger.event", "FLOW_EVENT_UNKNOWN");
    else {
      const outs = new Set(ev.outcomes.map((o) => o.key));
      d.stages.forEach((s, i) => {
        if (s.outcome !== undefined && !outs.has(s.outcome))
          add(`stages.${i}.outcome`, "FLOW_OUTCOME_UNKNOWN");
      });
      if (d.trigger.when) whenIssues(d.trigger.when, ev, add);
      ifFactIssues(d.stages, ev, add);
    }
  }
  return out.slice(0, ISSUES_MAX);
}

/** Hình + luật chéo (không có danh mục sự kiện — route gọi `flowDefIssues(def, manifest.events)` để kiểm đủ). */
export const FlowDefSchema = FlowDefBaseSchema.superRefine((d, ctx) => {
  for (const it of flowDefIssues(d)) {
    ctx.addIssue({ code: "custom", path: it.path.split("."), message: it.rule });
  }
});

/** Def/snapshot CŨ (trước CR-122): chỉ cần `stages` hợp lệ để engine chạy nốt; trường khác giữ nguyên. */
export const LegacyFlowDefSchema = z.looseObject({
  stages: z.array(ProcessStageDefSchema).min(1).max(PROCESS_STAGES_MAX),
});
export type LegacyFlowDef = z.infer<typeof LegacyFlowDefSchema>;

export type ParsedFlowDef =
  | { ok: true; legacy: false; def: FlowDef }
  | { ok: true; legacy: true; def: LegacyFlowDef }
  | { ok: false; issues: { path: string; message: string }[] };

const zIssues = (e: z.ZodError) =>
  e.issues.slice(0, ISSUES_MAX).map((i) => ({ path: i.path.join("."), message: i.message }));

/**
 * Đọc một def: có `trigger` ⇒ FlowDef mới (đủ luật); không có `trigger` ⇒ def cũ (`legacy`, chỉ kiểm `stages`) — lượt snapshot cũ
 * (`after.branch`, `contracts-route`, `contracts-finalize`) vẫn chạy tới khi đóng (ADR-0038 Hệ quả).
 */
export function parseFlowDef(raw: unknown): ParsedFlowDef {
  const isNew = typeof raw === "object" && raw !== null && "trigger" in raw;
  if (isNew) {
    const r = FlowDefSchema.safeParse(raw);
    return r.success
      ? { ok: true, legacy: false, def: r.data as FlowDef }
      : { ok: false, issues: zIssues(r.error) };
  }
  const r = LegacyFlowDefSchema.safeParse(raw);
  return r.success
    ? { ok: true, legacy: true, def: r.data }
    : { ok: false, issues: zIssues(r.error) };
}
