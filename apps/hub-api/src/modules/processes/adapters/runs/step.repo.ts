// HUB-FR-106 · HUB-FR-146 · P-d2 T19s (tách từ `runs/step-persist.ts`, không đổi hành vi; plan-d2 §3, §7, D2-16): `StepRepo`
// gắn tx + `tenantId` — SQL join bước nguyên văn như trước tách. `settleStepTx` = vỏ cùng chữ ký cũ cho nơi gọi có `Tx`
// (persistStage, wait-launch, asks). Chạy TRONG tx đã khoá `process_runs` FOR UPDATE (plan §7).
import { resolveSteps } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { StepRepo } from "../../application/ports";
import { type StepOutcome, settleStep } from "../../application/runs/settle-step.usecase";
import type { BranchRule } from "../../domain/branch/branch-def.rules";
import type { IfExec } from "../../domain/if/if.rules";
import type { ProcessRunStatus, StageRunStatus } from "../../domain/types";
import { branchWrites } from "./branch.repo";
import { ifFacts } from "./if-facts.repo";

type SnapRule = { field: string; op: BranchRule["op"]; value: string | number; goto_step: number };
type StepHead = {
  current_step: number;
  snapshot: {
    stages?: {
      key?: string;
      step?: number;
      executor?: { kind: string };
      after?: { branch?: SnapRule[] };
    }[];
  } | null;
};

/** Snapshot `after.branch` (snake_case contract) ⇒ luật domain; vắng/hỏng ⇒ `[]`. */
const branchesOf = (stages: NonNullable<StepHead["snapshot"]>["stages"] & {}): BranchRule[][] =>
  stages.map((s) =>
    Array.isArray(s?.after?.branch)
      ? s.after.branch.map((r) => ({
          field: r.field,
          op: r.op,
          value: r.value,
          gotoStep: r.goto_step,
        }))
      : [],
  );

/** CR-103 · snapshot `executor` kind `if` (snake_case) ⇒ domain `IfExec`; stage khác / hỏng ⇒ `null`. */
type SnapIf = {
  kind: string;
  when?: { op: "and" | "or"; conds: SnapCond[] };
  then_step?: number;
  else_step?: number | null;
};
type SnapCond = {
  from: { kind: "field"; stage_key: string; field: string } | { kind: "input"; key: string };
  op: BranchRule["op"];
  value: string | number;
};
const ifOf = (ex: SnapIf | undefined): IfExec | null =>
  ex?.kind === "if" && ex.when && Array.isArray(ex.when.conds)
    ? {
        when: {
          op: ex.when.op,
          conds: ex.when.conds.map((c) => ({
            from:
              c.from.kind === "field"
                ? { kind: "field" as const, stageKey: c.from.stage_key, field: c.from.field }
                : c.from,
            op: c.op,
            value: c.value,
          })),
        },
        thenStep: Number(ex.then_step),
        elseStep: ex.else_step === null || ex.else_step === undefined ? null : Number(ex.else_step),
      }
    : null;

export function stepRepo(tx: Tx, tenantId: string): StepRepo {
  return {
    ...branchWrites(tx, tenantId),
    ifFacts: (runId) => ifFacts(tx, tenantId, runId),
    async loadJoin(runId) {
      // T19-perf · hai câu đọc độc lập gửi liền (pipeline postgres.js, một round-trip); run đã khoá ⇒ cùng ảnh.
      const [[h], rows] = await Promise.all([
        tx.execute<StepHead>(sql`select current_step, snapshot from hub.process_runs
    where id = ${runId} and tenant_id = ${tenantId}`),
        tx.execute<{ stage_idx: number; status: StageRunStatus }>(sql`select stage_idx,
    status from hub.stage_runs where process_run_id = ${runId} and tenant_id = ${tenantId}`),
      ]);
      if (!h) return null;
      const stages = h.snapshot?.stages ?? [];
      return {
        step: Number(h.current_step),
        steps: resolveSteps(stages),
        statuses: new Map(rows.map((r) => [Number(r.stage_idx), r.status] as const)),
        executorKinds: stages.map((s) => s?.executor?.kind),
        branches: branchesOf(stages),
        ifs: stages.map((s) => ifOf(s?.executor as SnapIf | undefined)),
        stageKeys: stages.map((s) => s?.key ?? ""),
      };
    },
    async queueStep(runId, q) {
      const ids = sql.join(
        q.idxs.map((i) => sql`${i}`),
        sql`, `,
      );
      // Pipeline: hai UPDATE độc lập gửi liền theo thứ tự (stage rồi run — run đã khoá FOR UPDATE từ trước, §10).
      await Promise.all([
        tx.execute(sql`update hub.stage_runs set status = 'queued', updated_at = now()
    where process_run_id = ${runId} and tenant_id = ${tenantId} and stage_idx in (${ids})`),
        tx.execute(sql`update hub.process_runs set status = 'running', current_step = ${q.step},
    current_stage_idx = ${q.first}, updated_at = now() where id = ${runId} and tenant_id = ${tenantId}`),
      ]);
    },
    async finish(runId, first) {
      await tx.execute(sql`update hub.process_runs set status = 'done', current_stage_idx = ${first},
      finished_at = now(), updated_at = now() where id = ${runId} and tenant_id = ${tenantId}`);
    },
    async setStatus(runId, status: ProcessRunStatus, first) {
      await tx.execute(sql`update hub.process_runs set status = ${status}, current_stage_idx = ${first},
    updated_at = now() where id = ${runId} and tenant_id = ${tenantId}`);
    },
  };
}

/** D2-16 · vỏ `settleStep` cho nơi gọi đang giữ `Tx` (chữ ký cũ `(tx, runId, tenantId)`). */
export function settleStepTx(tx: Tx, runId: string, tenantId: string): Promise<StepOutcome | null> {
  return settleStep({ steps: stepRepo(tx, tenantId), clock: { now: () => new Date() } }, runId);
}
