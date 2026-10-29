// CR-103 · R1 · node `tool` — chạy (P-d2): `hub.runs` không agent; quyền + công tắc kiểm ngay trước gọi (driver, S2/S10).
// Chuyển nguyên văn `launchTool` từ `runs/launcher.ts`.
import type { Tx } from "@ai/db";
import { launchToolStage } from "../../adapters/tools/tool-launch";
import { driverKindOf } from "../../runs/driver-choice";
import {
  type KickResult,
  type LaunchCtx,
  type LauncherDeps,
  lostPermission,
  markStageRunning,
  type NodeLauncher,
} from "../../runs/launch-common";
import { realActionPre } from "../../runs/launcher-step";

/**
 * P-d2 · stage `tool`: thiếu `toolDriver` ⇒ quyết `tool_failed` (m2, không tạo `hub.runs`). R-1 · D2-49 · `real_action` ⇒
 * `realActionPre` (người Đạt bước trước); null ⇒ `tool_failed` (không gọi tool, không audit); có ⇒ audit
 * `authorize_real_action` (agent_id null như Áp) cùng tx lúc đánh dấu `running` → `launchToolStage`.
 */
async function launchTool(d: LauncherDeps, tx: Tx, c: LaunchCtx): Promise<KickResult> {
  const { runId, stage, def, u } = c;
  if (def.executor.kind !== "tool") return { kind: "skip" };
  const failed = () =>
    lostPermission(d, tx, {
      runId,
      tenantId: u.tenantId,
      idx: c.idx,
      stageRunId: stage.id,
      reason: "tool_failed",
    });
  if (driverKindOf(true, d.toolDriver !== undefined) === "missing") return failed();
  const stages = c.head.snapshot.stages;
  const real = await realActionPre(d, tx, { ...c, tenantId: u.tenantId, stages });
  if (def.real_action && !real) return failed();
  const t = { runId, stageId: stage.id, toolKey: def.executor.tool_key, name: def.name };
  const markRunning = (hubRunId: string) => markStageRunning(tx, { c, runId: hubRunId, real });
  const conversationId = c.head.conversation_id;
  return launchToolStage(d, tx, u, { ...t, conversationId, markRunning });
}

export const toolLauncher: NodeLauncher = { launch: launchTool };
