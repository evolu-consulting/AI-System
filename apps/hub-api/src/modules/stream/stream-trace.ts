// WRK-FR-03 · P11–P13 · plan-errors §3: trace stream vào `run_steps.detail` của step đã stream + log `warn` (không nội
// dung tin/câu trả lời, HUB-NFR-04). Lỗi ghi trace chỉ log (không đổi kết quả run).
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { DeltaGap } from "./delta-sink";
import * as repo from "./stream.repo";

export type StreamTrace =
  | { stream: "delta_gap"; jobId: string; gap: DeltaGap }
  | { stream: "delta_mismatch"; streamedLen: number; finalLen: number }
  | { stream: "stream_unparsed" };

type Where = { db: Db; log: Logger; runId: string; stepId: string };

function patchOf(t: StreamTrace): Record<string, unknown> {
  if (t.stream === "delta_gap")
    return { stream: t.stream, seq_expected: t.gap.expected, seq_seen: t.gap.seen };
  if (t.stream === "delta_mismatch")
    return { stream: t.stream, streamed_len: t.streamedLen, final_len: t.finalLen };
  return { stream: t.stream };
}

function logTrace(w: Where, t: StreamTrace): void {
  if (t.stream === "delta_gap") {
    w.log.warn("run-delta-gap", { run_id: w.runId, job_id: t.jobId });
    return;
  }
  const msg = t.stream === "delta_mismatch" ? "run-delta-mismatch" : "run-stream-unparsed";
  w.log.warn(msg, { run_id: w.runId, step_id: w.stepId });
}

export async function recordStreamTrace(w: Where, t: StreamTrace): Promise<void> {
  logTrace(w, t);
  try {
    await withHubScope(w.db, { kind: "system" }, (tx) =>
      repo.mergeStepDetail(tx, { stepId: w.stepId, runId: w.runId, patch: patchOf(t) }),
    );
  } catch (err) {
    w.log.warn("stream-trace-failed", { run_id: w.runId, ...safeErrorFields(err) });
  }
}

/** P12 · trace R23 (nếu có) của job đã phát, theo kết quả `reconcileStream`. */
export function reconcileTrace(
  w: Where,
  s: { trace: null | "delta_mismatch" | "stream_unparsed"; streamed: string; finalLen: number },
): Promise<void> {
  if (s.trace === null) return Promise.resolve();
  if (s.trace === "stream_unparsed") return recordStreamTrace(w, { stream: s.trace });
  const t = { stream: s.trace, streamedLen: s.streamed.length, finalLen: s.finalLen } as const;
  return recordStreamTrace(w, t);
}

/** P11 · `seq` hở trong job (nếu có). */
export function gapTrace(
  w: Omit<Where, "stepId">,
  o: { gap: DeltaGap | null; stepId: string; jobId: string },
): Promise<void> {
  if (!o.gap) return Promise.resolve();
  return recordStreamTrace(
    { ...w, stepId: o.stepId },
    { stream: "delta_gap", jobId: o.jobId, gap: o.gap },
  );
}
