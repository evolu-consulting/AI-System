// HUB-FR-20 · HUB-FR-27 · HUB-FR-28 · HUB-FR-29 · CR-025 · driver mặc định của run (plan H1 §6): dựng đầu vào từ ảnh cấu
// hình của run (HUB-BR-06) + flow, chạy `runLoop` qua runner B7, rồi phát `delta` (P6, H1-R09) và kết thúc run.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { accessInput, visibleAgents } from "../agents/agent-access.rules";
import type { UserState } from "../config/config.rules";
import { type AgentRunner, runJob } from "../runner/job-agent-runner";
import type { RunContext, RunDriver } from "../runs/runs.service";
import type { SseWriter } from "../runs/sse-writer";
import { type LoopEnd, type LoopInput, type LoopIo, runLoop } from "./orchestrator.loop";
import * as repo from "./orchestrator.repo";
import { chunkText } from "./orchestrator.rules";

export type OrchestratorDeps = {
  db: Db;
  runner: AgentRunner;
  /** Nhóm của user (grant theo group) từ cache cấu hình. */
  users: { user(id: string): Promise<UserState | undefined> };
  log: Logger;
};

/** Ảnh thiếu Orchestrator (BR-08 đã chặn lúc khởi động) → null. */
async function loadInput(d: OrchestratorDeps, ctx: RunContext): Promise<LoopInput | null> {
  const { snapshot, writer } = ctx;
  const settings = snapshot.orchestrator;
  const orchestrator = settings && snapshot.agents.find((a) => a.id === settings.agentId);
  if (!settings || !orchestrator) return null;
  const r = writer.run;
  const groupIds = (await d.users.user(r.userId))?.groupIds ?? new Set<string>();
  const access = accessInput(snapshot, { tenantId: r.tenantId, userId: r.userId, groupIds });
  const { flow, history } = await withHubScope(d.db, { kind: "system" }, async (tx) => ({
    flow: await repo.flowState(tx, r),
    history: await repo.flowHistory(tx, r, settings.historyN),
  }));
  const keyOf = (id: string | null) => snapshot.agents.find((a) => a.id === id)?.key ?? null;
  const last = keyOf(flow.agentId);
  return {
    orchestrator,
    agents: snapshot.agents,
    settings,
    access,
    visible: visibleAgents(access),
    hint: { last_agent: last, waiting_for: flow.pendingAsk ? last : null },
    history,
    message: ctx.content,
    locale: r.locale,
  };
}

function loopIo(d: OrchestratorDeps, ctx: RunContext): LoopIo {
  const { writer, snapshot, log } = ctx;
  return {
    job: (j) =>
      runJob(
        d.runner,
        { ...j, run: writer.run, snapshot, emit: (ev) => writer.emit(ev) },
        writer.signal,
        log,
      ),
    skip: (s) =>
      withHubScope(d.db, { kind: "system" }, (tx) =>
        repo.insertSkippedStep(tx, { run: writer.run, ...s }),
      ),
  };
}

/** P6 · H1-R09: cắt `delta` ≤ 40 ký tự; `content` = nối mọi `delta`. */
async function emitText(writer: SseWriter, text: string): Promise<void> {
  for (const part of chunkText(text)) await writer.emit({ event: "delta", data: { text: part } });
}

async function deliver(writer: SseWriter, end: LoopEnd): Promise<void> {
  if (end.kind === "aborted") return;
  if (end.kind === "failed") {
    await writer.finish({ kind: "failed", code: end.code });
    return;
  }
  const text = end.kind === "text" ? end.text : end.ask.question;
  await emitText(writer, text);
  const ask = end.kind === "ask" ? end.ask : null;
  await writer.finish({ kind: "finished", content: text, ask, agentId: end.agentId });
}

/** Log có ngữ cảnh run (HUB-NFR-04), không nội dung tin/câu trả lời. */
export async function driveRun(d: OrchestratorDeps, base: RunContext): Promise<void> {
  const { writer } = base;
  const r = writer.run;
  const log = base.log.child({ run_id: r.id, tenant_id: r.tenantId, user_id: r.userId });
  const ctx = { ...base, log };
  try {
    const input = await loadInput(d, ctx);
    const end: LoopEnd = input
      ? await runLoop(loopIo(d, ctx), input)
      : { kind: "failed", code: "INTERNAL_ERROR" };
    // Log trước khi phát sự kiện kết thúc: client thấy `run.finished` thì dòng log đã có (A52).
    log.info("run-orchestrated", {
      outcome: end.kind,
      code: end.kind === "failed" ? end.code : null,
    });
    await deliver(writer, end);
  } catch (err) {
    if (writer.signal.aborted || writer.done) return;
    log.error("orchestrator-failed", safeErrorFields(err));
    await writer.finish({ kind: "failed", code: "INTERNAL_ERROR" }).catch(() => false);
  }
}

/** `RunDriver` mặc định (B6 chỗ cắm): chạy nền, tự `finish`. */
export function orchestratorDriver(d: OrchestratorDeps): RunDriver {
  return {
    start: (ctx) => {
      void driveRun(d, ctx);
    },
  };
}
