// HUB-FR-106 · HUB-FR-146 · HUB-FR-147 · HUB-BR-38(a,e) · P-b2 plan §3.3–3.4 (D2/D4) · P-d2 T19s/T19 (plan-d2 §3, §7, D2-16):
// join bước trên trạng thái SAU ghi — mọi stage của bước done/skipped ⇒ bước kế `queued` (hoặc run `done`); còn lại ⇒
// `process_runs.status = runStatusOf(bước)`. `current_stage_idx` luôn = stage nhỏ nhất của bước hiện tại.
// Chạy TRONG tx đã khoá `process_runs` FOR UPDATE. Số câu: 2 đọc + 1 (wait/finish) hoặc 2 (next_step).
// T19 · PD2-R13/R14 · rẽ nhánh chèn MỘT chỗ (nhánh `next_step`): bước hiện tại có đúng một stage có `after.branch` ⇒ +1 câu
// đọc `fields`; luật khớp (đánh giá trong bộ nhớ) ⇒ +3 câu theo tập (nhảy stage, huỷ hẹn, audit + thread) — không phụ
// thuộc số bước bị nhảy (plan-d2 §9, PD2-P04).
import { evaluateBranch, skippedStages } from "../../domain/branch/branch.rules";
import { evaluateWhen, factKeysOf, ifTarget, missingKeysOf } from "../../domain/if/if.rules";
import { driftedIf, mergeTarget, outcomeOfStep, stagesAfter } from "../../domain/runs/finish.rules";
import {
  firstIdxOfStep,
  runStatusOf,
  stageIdxsOfStep,
  statusForRun,
  stepJoin,
} from "../../domain/runs/step.rules";
import type { ProcessRunStatus } from "../../domain/types";
import type { BranchEvent, Clock, StepJoinLoad, StepRepo } from "../ports";

/** Kết quả sau ghi: `process_runs.status/current_step/current_stage_idx` mới. */
export type StepOutcome = {
  kind: "wait" | "next_step" | "finish";
  status: ProcessRunStatus;
  step: number;
  stageIdx: number;
};
export type StepRepos = { steps: StepRepo; clock: Clock };
/** CR-120 · loại node chờ bằng hẹn giờ `wait_until` (ngày / N giờ / sự kiện + hạn). */
const WAIT_KINDS: ReadonlySet<string> = new Set([
  "wait_until",
  "wait_for",
  "wait_event",
  "subprocess", // CR-125 · chờ lượt con (stage `waiting_timer`, không bao giờ thử lại theo hẹn)
]);

/** CR-103 · node If: Đúng ⇒ luật 1 (`then_step`); Sai + có `else_step` ⇒ luật 2; Sai không `else_step` ⇒ null (bước kế). */
type Target = {
  gotoStep: number;
  rule: number;
  stageIdx: number;
  facts?: NonNullable<BranchEvent["facts"]>;
};

/** CR-122 · P18 · node Nếu thiếu dữ kiện: khoá còn trống (theo thứ tự điều kiện). */
type Missing = { missing: string[]; stageIdx: number };

/** Ngữ cảnh đánh giá node Nếu: fields theo key stage + input run (1 câu) + dữ kiện app HIỆN TẠI (≤ 1 câu, chỉ khi có vế `fact`). */
export async function ifContext(r: StepRepos, runId: string, load: StepJoinLoad, keys: string[]) {
  const facts = await r.steps.ifFacts(runId);
  const byKey: Record<string, Readonly<Record<string, string | number>>> = {};
  (load.stageKeys ?? []).forEach((k, i) => {
    const f = facts.fieldsByIdx[String(i)];
    if (f) byKey[k] = f;
  });
  const app =
    keys.length > 0 && load.pack && r.steps.readFacts
      ? await r.steps.readFacts(load.pack, keys)
      : null;
  return { fieldsByStageKey: byKey, inputs: facts.inputs, facts: app };
}

/** CR-103 · node If: Đúng ⇒ luật 1 (`then_step`); Sai + có `else_step` ⇒ luật 2; Sai không `else_step` ⇒ null (bước kế). */
async function ifTargetOf(
  r: StepRepos,
  runId: string,
  load: StepJoinLoad,
  o: { idx: number; ifx: NonNullable<NonNullable<StepJoinLoad["ifs"]>[number]> },
): Promise<Target | Missing | null> {
  const keys = factKeysOf(o.ifx.when);
  const c = await ifContext(r, runId, load, keys);
  // CR-122 · P18 · Luật GỐC 3: dữ kiện/input cần cho điều kiện còn trống ⇒ KHÔNG rẽ (không coi là Sai), dừng "Cần xử lý".
  const missing = missingKeysOf(o.ifx.when, c.inputs, c.facts);
  if (missing.length > 0 && r.steps.missingFact) return { missing, stageIdx: o.idx };
  const { matched, reads } = evaluateWhen(o.ifx.when, c.fieldsByStageKey, c.inputs, c.facts);
  // CR-122 · vế `fact` ⇒ LUÔN ghi lần rẽ (cả Sai đi bước kế): lịch sử giá trị đã đọc + so lại ở Kết thúc (H2).
  const facts = keys.length > 0 ? { matched, reads } : undefined;
  if (!matched && o.ifx.elseStep === null) {
    if (!facts || firstIdxOfStep(load.steps, load.step + 1) < 0) return null;
    return { gotoStep: load.step + 1, rule: 2, stageIdx: o.idx, facts };
  }
  const gotoStep = ifTarget(o.ifx, matched, load.step, Number.MAX_SAFE_INTEGER);
  if (gotoStep <= load.step || firstIdxOfStep(load.steps, gotoStep) < 0) return null;
  return { gotoStep, rule: matched ? 1 : 2, stageIdx: o.idx, ...(facts ? { facts } : {}) };
}

/** PD2-R13 · bước đích nếu stage đứng một mình của `step` có luật rẽ nhánh khớp; ngược lại `null` (đi bước kế). */
async function branchTarget(
  r: StepRepos,
  runId: string,
  load: StepJoinLoad,
): Promise<Target | Missing | null> {
  const idxs = stageIdxsOfStep(load.steps, load.step);
  const idx = idxs[0];
  if (idx === undefined || idxs.length !== 1) return null;
  const ifx = load.ifs?.[idx];
  if (ifx) return ifTargetOf(r, runId, load, { idx, ifx });
  const rules = load.branches[idx] ?? [];
  if (rules.length === 0) return null;
  const hit = evaluateBranch(rules, await r.steps.currentFields(runId, idx));
  // Phòng thủ (luật lưu def đã chặn): đích phải là bước có thật SAU bước hiện tại.
  if (!hit || hit.gotoStep <= load.step || firstIdxOfStep(load.steps, hit.gotoStep) < 0)
    return null;
  return { ...hit, stageIdx: idx };
}

/** Khớp ⇒ stage bước (step, goto) ⇒ `skipped` + huỷ hẹn của chúng + sự kiện `branch`; trả bước đích. */
async function takeBranch(
  r: StepRepos,
  runId: string,
  load: StepJoinLoad,
): Promise<number | Missing | null> {
  const b = await branchTarget(r, runId, load);
  if (!b) return mergeJump(r, runId, load);
  if ("missing" in b) return b;
  const ids = await r.steps.skipStages(runId, skippedStages(load.steps, load.step, b.gotoStep));
  // T19-perf · hai câu ghi độc lập gửi liền (pipeline); Postgres chạy theo thứ tự gửi ⇒ khoá hẹn vẫn trước (plan-d2 §8).
  await Promise.all([
    r.steps.cancelTimers(runId, ids, r.clock.now()),
    r.steps.branchEvent(runId, {
      stageIdx: b.stageIdx,
      fromStep: load.step,
      toStep: b.gotoStep,
      rule: b.rule,
      ...(b.facts ? { facts: b.facts } : {}),
    }),
  ]);
  return b.gotoStep;
}

/** CR-122 · FLOW2-FR-12 · cuối nhánh có `next_step` ⇒ nhảy tới bước gộp; stage giữa (nhánh kia) ⇒ `skipped` + huỷ hẹn (2 câu). */
async function mergeJump(r: StepRepos, runId: string, load: StepJoinLoad): Promise<number | null> {
  const to = mergeTarget(load.nextSteps ?? [], load.steps, load.step);
  if (to === null || to === load.step + 1) return to;
  const ids = await r.steps.skipStages(runId, skippedStages(load.steps, load.step, to));
  await r.steps.cancelTimers(runId, ids, r.clock.now());
  return to;
}

/**
 * CR-122 · FLOW2-FR-15 · bước vừa xong có node Kết thúc ⇒ (H2) dữ kiện đã đổi khiến một node Nếu rẽ khác ⇒ dừng "Cần xử lý";
 * ngược lại gọi `OutcomeHandler` của app TRONG tx này, bỏ qua mọi nhánh còn lại, chốt lượt `done`. Không phải bước Kết thúc ⇒ null.
 */
async function finishAt(
  r: StepRepos,
  runId: string,
  load: StepJoinLoad,
): Promise<StepOutcome | null> {
  const fin = outcomeOfStep(load.outcomes ?? [], load.steps, load.step);
  if (!fin) return null;
  const first = firstIdxOfStep(load.steps, load.step);
  const decisions = load.pack && r.steps.ifDecisions ? await r.steps.ifDecisions(runId) : [];
  if (decisions.length > 0 && r.steps.needsAction) {
    const keys = [
      ...new Set(decisions.flatMap((d) => factKeysOf(load.ifs?.[d.stageIdx]?.when ?? NO_WHEN))),
    ];
    const ifIdx = driftedIf(decisions, load.ifs ?? [], await ifContext(r, runId, load, keys));
    if (ifIdx !== null) {
      const finishIdxs = stageIdxsOfStep(load.steps, load.step);
      await r.steps.needsAction(runId, { finishIdxs, ifIdx, first });
      return { kind: "wait", status: "needs_decision", step: load.step, stageIdx: first };
    }
  }
  if (load.pack && r.steps.applyOutcome) await r.steps.applyOutcome(runId, load.pack, fin.outcome);
  const rest = stagesAfter(load.steps, load.step);
  if (rest.length > 0) {
    const ids = await r.steps.skipStages(runId, rest);
    await r.steps.cancelTimers(runId, ids, r.clock.now());
  }
  await r.steps.finish(runId, first);
  return { kind: "finish", status: "done", step: load.step, stageIdx: first };
}
const NO_WHEN = { op: "and" as const, conds: [] };

export async function settleStep(r: StepRepos, runId: string): Promise<StepOutcome | null> {
  const load = await r.steps.loadJoin(runId);
  if (!load) return null;
  const { steps, step, statuses } = load;
  const j = stepJoin({ steps, step, statuses });
  if (j.kind !== "wait") {
    const fin = await finishAt(r, runId, load);
    if (fin) return fin;
  }
  if (j.kind === "next_step") {
    const goto = await takeBranch(r, runId, load);
    if (goto !== null && typeof goto === "object") {
      // Stage Nếu ⇒ `needs_decision`; run ⇒ `needs_decision{missing_fact}` tại bước Nếu (Thử lại = chạy lại Nếu, đọc lại dữ kiện).
      await r.steps.missingFact?.(runId, { ifIdx: goto.stageIdx, missing: goto.missing });
      return { kind: "wait", status: "needs_decision", step, stageIdx: goto.stageIdx };
    }
    const to = goto ?? j.step;
    const idxs = goto === null ? j.queue : stageIdxsOfStep(steps, goto);
    const next = firstIdxOfStep(steps, to);
    await r.steps.queueStep(runId, { idxs, step: to, first: next });
    return { kind: "next_step", status: "running", step: to, stageIdx: next };
  }
  const first = firstIdxOfStep(steps, step);
  if (j.kind === "finish") {
    await r.steps.finish(runId, first);
    return { kind: "finish", status: "done", step, stageIdx: first };
  }
  // PD-R15 · loại hẹn suy từ executor (stage `wait_until` không bao giờ thử lại; stage khác không hẹn `wait_until`).
  // CR-120 · `wait_for`/`wait_event` dùng cùng loại hẹn `wait_until` (không bao giờ thử lại).
  const kindOf = (i: number) =>
    WAIT_KINDS.has(load.executorKinds[i] ?? "") ? "wait_until" : "retry";
  const agg = runStatusOf(
    stageIdxsOfStep(steps, step).map((i) => statusForRun(statuses.get(i) ?? "pending", kindOf(i))),
  );
  const status: ProcessRunStatus = agg === "step_done" ? "running" : agg;
  await r.steps.setStatus(runId, status, first);
  // CR-127 K3 · #7b · lượt LỖI gắn bản ghi app ⇒ app đưa bản ghi về nháp cùng tx (hook CAS, không ném).
  if (status === "failed" && load.pack) await r.steps.runFailed?.(runId, load.pack);
  return { kind: "wait", status, step, stageIdx: first };
}
