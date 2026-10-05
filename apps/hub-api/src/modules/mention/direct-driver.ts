// HUB-FR-91 · H2b-R06–R08, R10 · `RunDriver` của run `direct` (plan §5.2, P10): **một** job vai `agent` (job `agent.cli`
// qua `RoutingRunner` hoặc `DifyAgentRunner` như delegate H1/H2a), không job/step Orchestrator. `prompt` = nội dung R04,
// `history` = `history_n` của Orchestrator đã chọn lúc tạo run (`ctx.orchestrator`, P7 — không ghi `orchestrator_tenant_id`),
// `stream=true`. `done` → nội dung; `partial` → `directText`; `need_input` → `ask` (`pending_ask`); lỗi job → `run.failed`.
// Mọi kết thúc `finished` ghi `flows.agent_id` = agent (tin kế không tag → Orchestrator với `last_agent`).
// H2b P11–P13: `job.delta{done|partial}` → SSE `delta` ngay (DeltaSink); hết job đối chiếu `reconcileStream` (R23).
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { AgentResult } from "@ai/contracts/hub";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { chunkText } from "../orchestrator/orchestrator.rules";
import { deltaEmit, flowHistoryOf } from "../orchestrator/orchestrator.service";
import { type AgentRunner, type JobOutcome, runJob } from "../runner/job/job-agent-runner";
import type { RunContext, RunDriver } from "../runs/runs.service";
import type { RunOutcome, SseWriter } from "../runs/sse/sse-writer";
import { chunkDelta, type Reconciled, reconcileStream } from "../stream/delta.rules";
import { deltaSinkFor } from "../stream/delta-sink";
import { gapTrace, reconcileTrace } from "../stream/stream-trace";
import { directText } from "./mention.rules";
import type { DirectRunStart } from "./mention.service";

export type DirectDriverDeps = {
  db: Db;
  runner: AgentRunner;
  log: Logger;
};

/** `history_n` khi không có Orchestrator hợp lệ nào (ảnh thiếu — BR-08 đã chặn lúc khởi động): mặc định H1. */
const FALLBACK_HISTORY_N = 10;

/** P12 · job đã phát S: `content` bắt đầu bằng `streamed`; `trace` R23 cho step `stepId`. */
type DirectStream = {
  streamed: string;
  stepId: string;
  trace: Reconciled["trace"];
  finalLen: number;
};
type Ended = (RunOutcome & { stream?: DirectStream }) | { kind: "aborted" };

/** F (R23) của kết quả agent: `need_input` không có S (Runtime không phát) ⇒ "" (lệch nếu có). */
function finalOf(r: AgentResult, locale: "vi" | "en"): string {
  if (r.status === "need_input") return "";
  return r.status === "partial" ? directText(r, locale) : r.text;
}

/** P12 · đã phát: kết thúc với `reconcileStream(S, F)` (F null = kết quả cuối hỏng → S + `stream_unparsed`). */
function streamedEnd(
  o: Exclude<JobOutcome, { kind: "aborted" }>,
  final: string | null,
  agentId: string,
): Ended {
  const r = reconcileStream(o.streamed, final);
  const stream = {
    streamed: o.streamed,
    stepId: o.stepId,
    trace: r.trace,
    finalLen: final?.length ?? 0,
  };
  return { kind: "finished", content: r.content, agentId, stream };
}

/** P10 · kết quả job agent → kết thúc run (R07). `agent_result` sai loại → `UPSTREAM_ERROR` như delegate H1. */
export function directOutcome(o: JobOutcome, agentId: string, locale: "vi" | "en"): Ended {
  if (o.kind === "aborted") return o;
  if (o.kind === "failed") {
    const unparsed = o.streamed !== "" && o.reason === "invalid_output";
    if (unparsed) return streamedEnd(o, null, agentId);
    return { kind: "failed", code: o.code, reason: o.reason };
  }
  const r = o.output.kind === "agent_result" ? o.output.result : null;
  if (o.streamed) return streamedEnd(o, r ? finalOf(r, locale) : null, agentId);
  if (!r) return { kind: "failed", code: "UPSTREAM_ERROR" };
  if (r.status === "need_input") {
    const ask = { question: r.question, choices: r.choices };
    return { kind: "finished", content: r.question, ask, agentId };
  }
  return { kind: "finished", content: finalOf(r, locale), agentId };
}

/** P6 H1 · `delta` ≤ 40 ký tự rồi kết thúc; `content` = nối mọi `delta`. Đã phát S → trace + chỉ phần còn lại. */
async function deliver(d: DirectDriverDeps, ctx: RunContext, end: Ended): Promise<void> {
  const { writer } = ctx;
  if (end.kind === "aborted") return;
  if (end.kind === "finished" && end.stream) {
    const s = end.stream;
    await reconcileTrace({ db: d.db, log: ctx.log, runId: writer.run.id, stepId: s.stepId }, s);
    for (const part of chunkDelta(end.content.slice(s.streamed.length)))
      await writer.emit({ event: "delta", data: { text: part } });
  } else if (end.kind === "finished") {
    for (const part of chunkText(end.content))
      await writer.emit({ event: "delta", data: { text: part } });
  }
  const { stream: _s, ...outcome } = end;
  await writer.finish(outcome);
}

async function runDirect(d: DirectDriverDeps, ctx: RunContext, plan: DirectRunStart) {
  const { writer, snapshot } = ctx;
  const historyN = ctx.orchestrator?.config.historyN ?? FALLBACK_HISTORY_N;
  const history = await flowHistoryOf(d.db, writer.run, historyN);
  const task = {
    run: writer.run,
    snapshot,
    agent: plan.agent,
    role: "agent" as const,
    prompt: plan.content,
    history,
    stream: deltaSinkFor(
      { role: "agent", runKind: "direct", firstDelegate: false },
      deltaEmit(writer),
    ),
    emit: (ev: Parameters<SseWriter["emit"]>[0]) => writer.emit(ev),
  };
  const o = await runJob(d.runner, task, writer.signal, ctx.log);
  if (o.kind !== "aborted") await gapTrace({ db: d.db, log: ctx.log, runId: writer.run.id }, o);
  return directOutcome(o, plan.agent.id, writer.run.locale);
}

const codeOf = (e: Ended): ChatRunErrorCode | null => (e.kind === "failed" ? e.code : null);

/** Log có ngữ cảnh run (HUB-NFR-04), không nội dung tin/câu trả lời. */
export async function driveDirect(d: DirectDriverDeps, base: RunContext): Promise<void> {
  const { writer } = base;
  const r = writer.run;
  const log = base.log.child({ run_id: r.id, tenant_id: r.tenantId, user_id: r.userId });
  const ctx = { ...base, log };
  try {
    const end: Ended = base.direct
      ? await runDirect(d, ctx, base.direct)
      : { kind: "failed", code: "INTERNAL_ERROR" };
    log.info("run-direct", { outcome: end.kind, code: codeOf(end) });
    await deliver(d, ctx, end);
  } catch (err) {
    if (writer.signal.aborted || writer.done) return;
    log.error("direct-run-failed", safeErrorFields(err));
    await writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" });
  } finally {
    if (!writer.done) writer.abort();
  }
}

/** `RunDriver` của run `direct`: chạy nền, tự `finish`. */
export function directDriver(d: DirectDriverDeps): RunDriver {
  return {
    start: (ctx) => {
      void driveDirect(d, ctx);
    },
  };
}
