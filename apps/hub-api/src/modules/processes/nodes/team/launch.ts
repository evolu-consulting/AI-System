// CR-103 · R1 · node `team` — chạy: C2 kiểm nhóm sẵn sàng + tạo `team_run` (prepare), rồi run `direct` qua `hub.runs`
// với executor team. Chuyển nguyên văn `teamRunFor`/`existingTeamRun` từ `runs/launcher.ts`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  type LauncherDeps,
  launchStage,
  type NodeLauncher,
  type NodePrep,
  type PrepInput,
} from "../../runs/launch-common";
import { createTeamRun } from "../../runs/team-counters";
import { teamReady } from "../../runs/team-load";

/** C2 · nhóm: kiểm entitlement + thành viên bật (`teamReady`) ⇒ tạo `team_run` (gán `runs.team_run_id` lúc INSERT). */
async function teamRunFor(d: LauncherDeps, tx: Tx, p: PrepInput): Promise<NodePrep> {
  if (p.def.executor.kind !== "team") return { ok: true, teamRunId: null };
  // HUB-FR-110 · resume: team_run của (stage, attempt) đã có (đang chạy / chờ trả lời) ⇒ nhóm đã được kiểm sẵn sàng lúc
  // tạo và run đã chụp cấu hình (HUB-BR-06) ⇒ tiếp tục, KHÔNG kiểm `teamReady` lại (tránh fail giả khi snapshot chưa kịp
  // thấy cấu hình nhóm). Fresh (chưa có team_run) ⇒ kiểm C2 như thường (P1-36 permission_lost trước kick).
  const resuming = await existingTeamRun(tx, p.stageId, Number(p.attempt));
  if (resuming) return { ok: true, teamRunId: resuming };
  const ready = await teamReady(tx, await d.config.snapshot(), {
    teamId: p.def.executor.team_id,
    tenantId: p.u.tenantId,
  });
  if (!ready.ok) return { ok: false };
  const teamRunId = await createTeamRun(tx, {
    tenantId: p.u.tenantId,
    procRunId: p.runId,
    stageRunId: p.stageId,
    attempt: Number(p.attempt),
    teamId: p.def.executor.team_id,
    mode: ready.team.mode,
    now: d.now(),
  });
  return { ok: true, teamRunId };
}

/** team_run còn hiệu lực của (stage, attempt) — có ⇒ đang resume (createTeamRun cũng dùng lại chính nó). */
async function existingTeamRun(tx: Tx, stageId: string, attempt: number): Promise<string | null> {
  const [r] = await tx.execute<{ id: string }>(sql`select id from hub.team_runs
    where stage_run_id = ${stageId} and attempt = ${attempt}
      and status in ('running', 'waiting_answer') order by started_at desc limit 1`);
  return r?.id ?? null;
}

export const teamLauncher: NodeLauncher = {
  prepare: teamRunFor,
  launch(d, tx, c) {
    if (c.def.executor.kind !== "team") throw new Error("teamLauncher: executor không phải team");
    return launchStage(d, tx, c, { kind: "team", teamId: c.def.executor.team_id });
  },
};
