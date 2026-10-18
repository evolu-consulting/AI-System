// HUB-FR-146 · AC-H44 · plan-d2 §4 "Launch", §8: stage `tool` trong `launcher.plan` (tx scope user người bắt đầu, run đã
// FOR UPDATE, sau `starterUsable`): `prepareProcess` executor `{kind:"tool"}` (không agent/`direct`, như nhóm) ⇒
// `createRunTx` ⇒ stage `running` (người gọi đánh dấu, `markLaunched`) ⇒ `launch` với `toolDriver` của mount. Quyền chạy +
// công tắc KHÔNG kiểm ở đây — kiểm ngay trước gọi (tx1 driver, S2/S10).
import type { Tx } from "@ai/db";
import type { AuthUser } from "../../../../lib/auth.middleware";
import type { ProcessDeps } from "../../core/ports";

type Prepared = Awaited<ReturnType<ProcessDeps["runs"]["prepareProcess"]>>;
export type ToolLaunch = {
  kind: "launch";
  prepared: Prepared;
  files: unknown[];
  useSession: boolean;
  /** Launcher dùng `toolDriver(toolLink)` thay `stageDriver`. */
  toolLink: { runId: string; stageRunId: string; tenantId: string };
};

export async function launchToolStage(
  d: Pick<ProcessDeps, "runs">,
  tx: Tx,
  u: AuthUser,
  c: {
    runId: string;
    stageId: string;
    toolKey: string;
    name: string;
    conversationId: string;
    markRunning: (hubRunId: string) => Promise<unknown>;
  },
): Promise<ToolLaunch> {
  const prepared = await d.runs.prepareProcess(u, {
    conversationId: c.conversationId,
    req: { content: c.name },
    stage: {
      executor: { kind: "tool", toolKey: c.toolKey },
      process: {
        processRunId: c.runId,
        stageRunId: c.stageId,
        teamRunId: null,
        files: [],
      },
    },
  });
  const files = await d.runs.createRunTx(tx, prepared);
  await c.markRunning(prepared.run.id);
  return {
    kind: "launch",
    prepared,
    files,
    useSession: false,
    toolLink: { runId: c.runId, stageRunId: c.stageId, tenantId: u.tenantId },
  };
}
