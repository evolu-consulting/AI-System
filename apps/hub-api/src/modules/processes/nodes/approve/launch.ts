// CR-122 · E2b · node Duyệt — chạy: như node `form` (đồng bộ trong tx khoá run, KHÔNG `hub.runs`/agent/job). Ghi output "chờ
// duyệt" rồi đi đường hậu-output của cổng kiểm: `waiting_review` + task cho Group của bước (nhắc/chuyển cấp như cổng có sẵn).
// Người quyết qua `POST /review-tasks/:id/decision` (`gates/approve-out.ts` ghi field `decision` + rẽ Từ chối/Trả lại).
import { sql } from "drizzle-orm";
import { stateOf } from "../../adapters/tools/tool-stage.repo";
import * as core from "../../core/core.repo";
import { processUpdated } from "../../core/events";
import { transition } from "../../domain/runs/run-state.rules";
import type { KickResult, LaunchCtx, LauncherDeps, NodeLauncher } from "../../runs/launch-common";
import { stageRowById } from "../../runs/step-persist";
import { effects, headOf, type SnapStage } from "../../runs/team-runner";
import { APPROVE_RESULT_SECTION } from "./node";

type Tx = Parameters<NodeLauncher["launch"]>[1];

export const approvePendingMd = (name: string): string =>
  `# ${name}\n\n## ${APPROVE_RESULT_SECTION}\n_(Chờ duyệt)_\n`;

async function launchApprove(d: LauncherDeps, tx: Tx, c: LaunchCtx): Promise<KickResult> {
  if (c.def.executor.kind !== "approve") return { kind: "skip" };
  const tenantId = c.u.tenantId;
  const head = await headOf(tx, c.runId);
  await tx.execute(sql`update hub.stage_runs set status = 'running', started_at = now(), updated_at = now()
    where id = ${c.stage.id} and tenant_id = ${tenantId}`);
  const stage = await stageRowById(tx, c.runId, c.stage.id, tenantId);
  if (!head || !stage) return { kind: "skip" };
  const def = c.def as unknown as SnapStage;
  const ev = { kind: "stage_output", templateOk: true } as const;
  const t = transition(stateOf(head, stage, def), ev);
  if (!t.ok) return { kind: "skip" };
  const x = {
    runId: c.runId,
    stageRunId: c.stage.id,
    hubRunId: "",
    jobId: null,
    result: { kind: "output" as const, text: approvePendingMd(c.def.name) },
    tokens: 0,
  };
  const ctx = { x, head, stage, def, idx: c.idx, ev, next: t.next, list: t.effects };
  const res = await effects({ ...d, storage: undefined }, tx, ctx);
  if (res.step) {
    const recipients = await core.runRecipients(tx, c.runId, tenantId);
    const u = {
      id: c.runId,
      status: res.step.status,
      stageIdx: res.step.stageIdx,
      step: res.step.step,
    };
    res.events.push(...processUpdated(recipients, u));
  }
  return { kind: "events", events: res.events, ...(res.kick ? { more: true } : {}) };
}

export const approveLauncher: NodeLauncher = { launch: launchApprove };
