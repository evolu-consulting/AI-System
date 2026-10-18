// HUB-FR-146 · AC-H44 · D2-12 · plan-d2 §4 "Driver", §10 S11: driver `hub.runs` của stage `tool` — gọi `runToolStage` (lớp 2)
// rồi đóng `hub.runs` SAU tx quy trình (D11). Dựng ở mount (giữ `SystemUow` trong closure; launcher chỉ nhận factory).
// Bọc `drain` (`handles.settled()`, Luật 4c). Lỗi bất ngờ ⇒ `tool_failed` (không để stage kẹt `running`), không ném tiếp.
import { safeErrorFields } from "../../../../lib/errors";
import type { Logger } from "../../../../lib/logger";
import type { RunContext, RunDriver } from "../../../runs/runs.service";
import type { RunOutcome } from "../../../runs/sse/sse-writer";
import type { MonotonicClock, SystemUow } from "../../application/ports";
import {
  runToolStage,
  type ToolLink,
  type ToolStageOutcome,
} from "../../application/tools/run-tool-stage.usecase";
import type { ToolInvoker } from "../../application/tools/tool.ports";

export type ToolDriverDeps = {
  uow: Pick<SystemUow, "system">;
  invoker: ToolInvoker;
  clock: MonotonicClock;
  log: Logger;
  drain?: { run<T>(fn: () => Promise<T>): Promise<T> };
};
/** Launcher gọi với run/stage/tenant của stage vừa launch; `hubRunId` = `ctx.writer.run.id`. */
export type ToolDriverFactory = (link: Omit<ToolLink, "hubRunId">) => RunDriver;

const outcomeOf = (o: ToolStageOutcome): RunOutcome =>
  o.kind === "ok" ? { kind: "finished", content: o.md } : { kind: "finished", content: "" };

async function failStuck(d: ToolDriverDeps, link: ToolLink): Promise<void> {
  await d.uow.system(link.tenantId, async (r) => {
    if (!(await r.runs.lock(link.runId))) return;
    if (!(await r.tools.lockRunning(link.stageRunId, link.hubRunId))) return;
    await r.tools.decide(
      { runId: link.runId, stageRunId: link.stageRunId, reason: "tool_failed" },
      d.clock.now(),
    );
  });
}

async function drive(d: ToolDriverDeps, ctx: RunContext, link: ToolLink): Promise<void> {
  try {
    const out = await runToolStage(d, link);
    if (!ctx.writer.done) await ctx.writer.finishOrAbort(outcomeOf(out));
  } catch (err) {
    const log = ctx.log.child({ run_id: link.hubRunId });
    log.error("process-tool-stage-failed", safeErrorFields(err));
    if (!ctx.writer.done) ctx.writer.abort();
    await failStuck(d, link).catch((e) =>
      log.error("process-tool-stuck-failed", safeErrorFields(e)),
    );
  }
}

export function toolDriverFactory(d: ToolDriverDeps): ToolDriverFactory {
  const track = (fn: () => Promise<void>) => (d.drain ? d.drain.run(fn) : fn());
  return (link) => ({
    start: (ctx) => void track(() => drive(d, ctx, { ...link, hubRunId: ctx.writer.run.id })),
  });
}
