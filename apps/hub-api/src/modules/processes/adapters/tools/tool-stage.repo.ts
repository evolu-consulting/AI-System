// HUB-FR-146 · AC-H44 · AC-H47 · D2-15/D2-30 · plan-d2 §3–§4, §8, §10 S2/S9/S10: `ToolStageRepo` gắn tx + tenant của UoW.
// `loadCall` = MỘT câu đọc (stage running của hub run + snapshot + inputs + fields nguồn + công tắc của ĐÚNG tenant run +
// workflow enabled + usable + canRun). `settleOk` đi đường hậu-output của stage agent (`transition` + `effects`: review ⇒
// waiting_review + task; auto ⇒ done + join). Mọi câu lọc `tenant_id`; sự kiện/kick/thread vào outbox (phát sau COMMIT).
import type { ProcessRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Outbox } from "../../application/ports";
import type {
  ToolCallAudit,
  ToolCallLoad,
  ToolStageRepo,
} from "../../application/tools/tool.ports";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import type { ProcessDeps } from "../../core/ports";
import { type RunState, transition } from "../../domain/runs/run-state.rules";
import { stageGateStatus, stepCountOf } from "../../domain/runs/step.rules";
import { type StageRowIdx, stepsOfSnap } from "../../runs/step-persist";
import { effects, headOf, type RunHead, type SnapStage, toDecision } from "../../runs/team-runner";
import { withPackTool } from "./pack-tool-load";
import { loadCallRow, toLoad } from "./tool-stage-load.repo";
import { insertAudit, lockStageWithHead } from "./tool-stage-lock.repo";

type Deps = Omit<ProcessDeps, "launcher" | "start">;

/** D1 · trạng thái "run" dựng từ stage (như `stage-driver.buildState`): bước/tổng bước. */
function stateOf(head: RunHead, stage: StageRowIdx, def: SnapStage): RunState {
  const steps = stepsOfSnap(head.snapshot);
  return {
    status: stageGateStatus(head.status as ProcessRunStatus, stage.status),
    stageIdx: steps[stage.stage_idx] ?? stage.stage_idx,
    stageCount: stepCountOf(steps),
    stage: {
      status: stage.status,
      attempt: Number(stage.attempt),
      attemptLimit: Number(stage.attempt_limit),
      asksCount: Number(stage.asks_count),
      askLimit: Number(stage.ask_limit),
      after: def.after.kind,
      hasOutput: stage.current_output_id !== null,
      realAction: def.real_action === true,
    },
    decisionReason: null,
  };
}

/** Bối cảnh bất biến của repo + hàng stage/đầu run đã khoá ở `lockRunning` (dùng lại, không đọc lại). */
type Cx = { tx: Tx; tenantId: string; outbox: Outbox; d: Deps };
type Lock = { locked: StageRowIdx | null; head: RunHead | null };
type SettleIn = Parameters<ToolStageRepo["settleOk"]>[0];
type DecideIn = Parameters<ToolStageRepo["decide"]>[0];

function emit(outbox: Outbox, runId: string, events: readonly unknown[], kick: boolean): void {
  if (events.length > 0) outbox.emit({ kind: "user_events", events });
  outbox.emit({ kind: "post_thread", runId });
  if (kick) outbox.emit({ kind: "kick", runId });
}

async function emitRetried({ tx, tenantId, outbox }: Cx, s: Lock, runId: string): Promise<void> {
  const idx = s.locked?.stage_idx;
  const h = idx === undefined ? null : await headOf(tx, runId);
  if (!h || idx === undefined) return;
  const recipients = await core.runRecipients(tx, runId, tenantId);
  const step = stepsOfSnap(h.snapshot)[idx] ?? idx;
  const st = { id: runId, status: h.status as ProcessRunStatus, stageIdx: idx, step };
  outbox.emit({ kind: "user_events", events: processUpdated(recipients, st) });
}

/** `false` ⇒ không ghi gì (máy trạng thái từ chối output / thiếu đầu run) — use case quyết `tool_failed` (m-3). */
async function settleOk(c: Cx, s: Lock, x: SettleIn): Promise<boolean> {
  const { tx, tenantId, outbox, d } = c;
  // T18-perf: đầu run đọc CÙNG câu khoá stage (run đã khoá ở `runs.lock` ⇒ ảnh mới nhất), không đọc lại.
  const h = s.head ?? (await headOf(tx, x.runId));
  const stage = s.locked;
  const def = stage && h?.snapshot.stages[stage.stage_idx];
  if (!h || !stage || !def) return false;
  const ev = { kind: "stage_output", templateOk: true } as const;
  const t = transition(stateOf(h, stage, def), ev);
  if (!t.ok) return false;
  const result = { kind: "output" as const, text: x.md };
  const apply = {
    runId: x.runId,
    stageRunId: x.stageRunId,
    hubRunId: x.hubRunId,
    jobId: null,
    result,
    tokens: 0,
  };
  const ctx = {
    x: apply,
    head: h,
    stage,
    def,
    idx: stage.stage_idx,
    ev,
    next: t.next,
    list: t.effects,
  };
  // Không blob/hàng attachment (`outputAttachment` bỏ stage `tool` — không job): .md tool nhỏ, inline như stage Áp.
  const res = await effects({ ...d, storage: undefined }, tx, ctx);
  const st = res.step;
  if (st) {
    const recipients = await core.runRecipients(tx, x.runId, tenantId);
    const u = { id: x.runId, status: st.status, stageIdx: st.stageIdx, step: st.step };
    res.events.push(...processUpdated(recipients, u));
  }
  emit(outbox, x.runId, res.events, res.kick);
  return true;
}

async function decide({ tx, tenantId, outbox, d }: Cx, s: Lock, x: DecideIn): Promise<void> {
  const idx = s.locked?.stage_idx;
  if (idx === undefined) return;
  const p = { runId: x.runId, tenantId, idx, stageRunId: x.stageRunId, reason: x.reason };
  const events = await toDecision(d, tx, p);
  const recipients = await core.runRecipients(tx, x.runId, tenantId);
  const st = { id: x.runId, status: "needs_decision" as const, stageIdx: idx };
  events.push(...processUpdated(recipients, st));
  emit(outbox, x.runId, events, false);
}

export function toolStageRepo(tx: Tx, tenantId: string, outbox: Outbox, d: Deps): ToolStageRepo {
  const c: Cx = { tx, tenantId, outbox, d };
  const s: Lock = { locked: null, head: null };
  return {
    async loadCall(runId, stageRunId, hubRunId): Promise<ToolCallLoad | null> {
      const row = await loadCallRow(tx, { tenantId, runId, stageRunId, hubRunId });
      return row ? withPackTool(toLoad(row), d.packTools, tenantId) : null; // N2-FR-03
    },
    audit: (x) => insertAudit(tx, tenantId, x),
    retried: (runId) => emitRetried(c, s, runId),
    async lockRunning(stageRunId, hubRunId) {
      const row = await lockStageWithHead(tx, tenantId, stageRunId);
      const ok = row?.status === "running" && row.current_run_id === hubRunId;
      s.locked = ok ? row : null;
      s.head = ok ? row.head : null;
      return s.locked !== null;
    },
    settleOk: (x) => settleOk(c, s, x),
    decide: (x) => decide(c, s, x),
  };
}
