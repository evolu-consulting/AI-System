// HUB-FR-113 · HUB-FR-104 · HUB-FR-118 · P-b2 (plan §3.9): phần view theo bước tách khỏi `view.service.ts` (400 dòng) —
// `StageView` (+ `step`/`round`/`back_to_steps`), hàng stage của task view, `back_rounds/back_limit/back_events`.
// Đọc trong tx scope `user` của người xem (RLS T); mọi truy vấn lọc `process_run_id` + `tenant_id`.
import type {
  BackEvent,
  DecisionOption,
  DecisionReason,
  ExecutorRef,
  OutputRef,
  StageRunStatus,
  StageView,
} from "@ai/contracts/chat";
import { BACK_EVENTS_MAX, STAGE_OUTPUTS_MAX } from "@ai/contracts/chat";
import { resolveSteps } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { pickDecisionStage } from "../core/step.rules";
import { decisionOptionsFor } from "../core/task.rules";
import { openDecisions } from "../gates/gates.repo";
import { idOf, resolveExecutors } from "./executor-ref";

export type SnapStage = {
  key: string;
  name: string;
  step?: number;
  executor: { kind: "agent"; agent_id: string } | { kind: "team"; team_id: string };
  after: { kind: "review"; group_id: string | null; back_to_steps?: number[] } | { kind: "auto" };
  real_action: boolean;
};
export type Snap = { key: string; name: string; stages: SnapStage[] };
export type OutputRow = {
  id: string;
  stage_idx: number;
  version: number;
  attempt: number;
  template_ok: boolean;
  template_missing: string[] | null;
  created_at: string;
};
/** Khoá run tối thiểu để đọc phần bước. */
type RunKey = { id: string; tenant_id: string };

export const iso = (c: string) =>
  sql.raw(`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
export const toOutputRef = (o: OutputRow): OutputRef => ({
  id: o.id,
  version: Number(o.version),
  attempt: Number(o.attempt),
  template_ok: o.template_ok,
  template_missing: o.template_missing ?? [],
  created_at: o.created_at,
});

const UNKNOWN_EXEC: ExecutorRef = { kind: "agent", key: "?", name: { vi: "?", en: "?" } }; // D5 fallback

type StageRunRow = {
  stage_idx: number;
  status: StageRunStatus;
  attempt: number;
  attempt_limit: number;
  asks_count: number;
  ask_limit: number;
  round: number;
  current_output_id: string | null;
  passed_by: string | null;
  passed_by_name: string | null;
  passed_at: string | null;
};

/** `after.back_to_steps` của stage (snapshot cũ không có ⇒ []). */
export const backStepsOf = (s: SnapStage | undefined): number[] =>
  s?.after.kind === "review" ? [...(s.after.back_to_steps ?? [])] : [];

export async function stageViews(tx: Tx, r: RunKey, snap: Snap): Promise<StageView[]> {
  const srs = await tx.execute<StageRunRow>(sql`
    select s.stage_idx, s.status, s.attempt, s.attempt_limit, s.asks_count, s.ask_limit, s.round, s.current_output_id,
      s.passed_by, pu.display_name as passed_by_name, ${iso("s.passed_at")} as passed_at
    from hub.stage_runs s left join admin.users pu on pu.id = s.passed_by and pu.tenant_id = s.tenant_id
    where s.process_run_id = ${r.id} and s.tenant_id = ${r.tenant_id} order by s.stage_idx`);
  const outs = await tx.execute<OutputRow>(sql`
    select id, stage_idx, version, attempt, template_ok, template_missing, ${iso("created_at")} as created_at
    from hub.process_outputs where process_run_id = ${r.id} and tenant_id = ${r.tenant_id} order by stage_idx, version`);
  const execMap = await resolveExecutors(
    tx,
    snap.stages.map((s) => s.executor),
  );
  const steps = resolveSteps(snap.stages);
  return srs.map((sr): StageView => {
    const i = Number(sr.stage_idx);
    const def = snap.stages[i];
    return {
      idx: i,
      key: def?.key ?? `#${i + 1}`,
      name: def?.name ?? `#${i + 1}`,
      executor: (def ? execMap.get(idOf(def.executor)) : undefined) ?? UNKNOWN_EXEC,
      after: def?.after.kind ?? "auto",
      real_action: def?.real_action ?? false,
      status: sr.status,
      attempt: Number(sr.attempt),
      attempt_limit: Number(sr.attempt_limit),
      asks_count: Number(sr.asks_count),
      ask_limit: Number(sr.ask_limit),
      outputs: outs
        .filter((o) => Number(o.stage_idx) === i)
        .map(toOutputRef)
        .slice(0, STAGE_OUTPUTS_MAX),
      current_output_id: sr.current_output_id,
      passed_by: sr.passed_by
        ? { id: sr.passed_by, display_name: sr.passed_by_name ?? sr.passed_by }
        : null,
      passed_at: sr.passed_at,
      step: steps[i] ?? i,
      round: Number(sr.round),
      back_to_steps: backStepsOf(def),
    };
  });
}

/** Hàng stage của task view (`idx/name/status/step/round`). */
export async function taskStages(tx: Tx, r: RunKey, snap: Snap) {
  const srs = await tx.execute<{ stage_idx: number; status: StageRunStatus; round: number }>(sql`
    select stage_idx, status, round from hub.stage_runs where process_run_id = ${r.id} and tenant_id = ${r.tenant_id}
    order by stage_idx`);
  const steps = resolveSteps(snap.stages);
  return srs.map((s) => {
    const i = Number(s.stage_idx);
    return {
      idx: i,
      name: snap.stages[i]?.name ?? `#${i + 1}`,
      status: s.status,
      step: steps[i] ?? i,
      round: Number(s.round),
    };
  });
}

type BackEventRow = {
  at: string;
  task_id: string | null;
  from_stage_idx: number;
  from_step: number;
  to_step: number;
  round_after: number;
  feedback: string;
  by_id: string;
  by_name: string | null;
};

/** `back_rounds/back_limit` + ≤ 20 sự kiện quay lại MỚI nhất, trả theo thời gian tăng dần (index `process_back_events_run_idx`). */
export async function backFields(
  tx: Tx,
  r: RunKey & { back_rounds: number; back_limit: number },
): Promise<{ back_rounds: number; back_limit: number; back_events: BackEvent[] }> {
  const rows = await tx.execute<BackEventRow>(sql`
    select ${iso("e.created_at")} as at, e.task_id, e.from_stage_idx, e.from_step, e.to_step, e.round_after,
      e.feedback, e.decided_by as by_id, u.display_name as by_name
    from hub.process_back_events e left join admin.users u on u.id = e.decided_by and u.tenant_id = e.tenant_id
    where e.process_run_id = ${r.id} and e.tenant_id = ${r.tenant_id}
    order by e.created_at desc, e.id desc limit ${BACK_EVENTS_MAX}`);
  const back_events = rows.reverse().map(
    (e): BackEvent => ({
      at: e.at,
      task_id: e.task_id,
      from_stage_idx: Number(e.from_stage_idx),
      from_step: Number(e.from_step),
      to_step: Number(e.to_step),
      round: Number(e.round_after),
      feedback: e.feedback,
      by: { id: e.by_id, display_name: e.by_name ?? e.by_id },
    }),
  );
  return { back_rounds: Number(r.back_rounds), back_limit: Number(r.back_limit), back_events };
}

export type DecisionPick = { reason: DecisionReason; stage_idx: number; options: DecisionOption[] };
type DecisionJson = { reason: DecisionReason; stage_idx: number; options: DecisionOption[] } | null;

/**
 * D9 · `view.decision` = task `decision` mở CŨ nhất (song song có thể nhiều; `pickDecisionStage`). `process_runs.decision`
 * jsonb chỉ dùng khi khớp (stage, lý do) — lấy đúng `options` đã chụp — hoặc khi không có task mở (run cũ / dữ liệu tay).
 */
export async function viewDecision(
  tx: Tx,
  r: RunKey & { status: string; decision: unknown },
  stages: readonly StageView[],
): Promise<DecisionPick | null> {
  if (r.status !== "needs_decision") return null;
  const dec = r.decision as DecisionJson;
  const fromJson = (d: NonNullable<DecisionJson>): DecisionPick => ({
    reason: d.reason,
    stage_idx: Number(d.stage_idx),
    options: d.options,
  });
  const open = await openDecisions(tx, r.id, r.tenant_id);
  const idx = pickDecisionStage(open);
  if (idx === null) return dec ? fromJson(dec) : null;
  const reason = open.find((o) => o.stageIdx === idx)?.reason ?? dec?.reason ?? "interrupted";
  if (dec && Number(dec.stage_idx) === idx && dec.reason === reason) return fromJson(dec);
  const hasOutput = stages.some((s) => s.idx === idx && s.current_output_id !== null);
  return { reason, stage_idx: idx, options: decisionOptionsFor(hasOutput, reason) };
}
