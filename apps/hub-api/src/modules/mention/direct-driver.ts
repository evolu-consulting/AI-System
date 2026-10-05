// HUB-FR-91 · H2b-R06–R08, R10 · `RunDriver` của run `direct` (plan §5.2, P10): **một** job vai `agent` (job `agent.cli`
// qua `RoutingRunner` hoặc `DifyAgentRunner` như delegate H1/H2a), không job/step Orchestrator. `prompt` = nội dung R04,
// `history` = `history_n` của Orchestrator đã chọn lúc tạo run (`ctx.orchestrator`, P7 — không ghi `orchestrator_tenant_id`),
// `stream=true`. `done` → nội dung; `partial` → `directText`; `need_input` → `ask` (`pending_ask`); lỗi job → `run.failed`.
// Mọi kết thúc `finished` ghi `flows.agent_id` = agent (tin kế không tag → Orchestrator với `last_agent`).
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { chunkText } from "../orchestrator/orchestrator.rules";
import { flowHistoryOf } from "../orchestrator/orchestrator.service";
import { type AgentRunner, type JobOutcome, runJob } from "../runner/job/job-agent-runner";
import type { RunContext, RunDriver } from "../runs/runs.service";
import type { RunOutcome, SseWriter } from "../runs/sse/sse-writer";
import { directText } from "./mention.rules";
import type { DirectRunStart } from "./mention.service";

export type DirectDriverDeps = {
  db: Db;
  runner: AgentRunner;
  log: Logger;
};

/** `history_n` khi không có Orchestrator hợp lệ nào (ảnh thiếu — BR-08 đã chặn lúc khởi động): mặc định H1. */
const FALLBACK_HISTORY_N = 10;

type Ended = RunOutcome | { kind: "aborted" };

/** P10 · kết quả job agent → kết thúc run (R07). `agent_result` sai loại → `UPSTREAM_ERROR` như delegate H1. */
export function directOutcome(o: JobOutcome, agentId: string, locale: "vi" | "en"): Ended {
  if (o.kind === "aborted") return o;
  if (o.kind === "failed") return { kind: "failed", code: o.code };
  if (o.output.kind !== "agent_result") return { kind: "failed", code: "UPSTREAM_ERROR" };
  const r = o.output.result;
  if (r.status === "need_input") {
    const ask = { question: r.question, choices: r.choices };
    return { kind: "finished", content: r.question, ask, agentId };
  }
  const content = r.status === "partial" ? directText(r, locale) : r.text;
  return { kind: "finished", content, agentId };
}

/** P6 H1 · `delta` ≤ 40 ký tự rồi kết thúc; `content` = nối mọi `delta`. */
async function deliver(writer: SseWriter, end: Ended): Promise<void> {
  if (end.kind === "aborted") return;
  if (end.kind === "finished") {
    for (const part of chunkText(end.content)) {
      await writer.emit({ event: "delta", data: { text: part } });
    }
  }
  await writer.finish(end);
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
    stream: true,
    emit: (ev: Parameters<SseWriter["emit"]>[0]) => writer.emit(ev),
  };
  const o = await runJob(d.runner, task, writer.signal, ctx.log);
  return directOutcome(o, plan.agent.id, writer.run.locale);
}

const codeOf = (e: Ended): ChatRunErrorCode | null => (e.kind === "failed" ? e.code : null);

/** Log có ngữ cảnh run (HUB-NFR-04), không nội dung tin/câu trả lời. */
export async function driveDirect(d: DirectDriverDeps, base: RunContext): Promise<void> {
  const { writer } = base;
  const r = writer.run;
  const log = base.log.child({ run_id: r.id, tenant_id: r.tenantId, user_id: r.userId });
  try {
    const end: Ended = base.direct
      ? await runDirect(d, { ...base, log }, base.direct)
      : { kind: "failed", code: "INTERNAL_ERROR" };
    log.info("run-direct", { outcome: end.kind, code: codeOf(end) });
    await deliver(writer, end);
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
