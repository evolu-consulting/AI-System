// HUB-FR-20 · HUB-FR-27 · HUB-FR-28 · HUB-FR-29 · CR-025 · driver mặc định của run (plan H1 §6): dựng đầu vào từ ảnh cấu
// hình của run (HUB-BR-06) + flow, chạy `runLoop` qua runner B7, rồi phát `delta` (P6, H1-R09) và kết thúc run.
import type { HistoryItem } from "@ai/contracts/hub";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { accessInput, visibleAgents } from "../agents/public";
import type { ArtifactSink } from "../artifacts/public";
import { artifactHandoffOn, artifactStoreFor } from "../artifacts/public";
import { fileBrief } from "../attachments/public";
import type { UserState } from "../config/public";
import { type AgentRunner, runJob } from "../runner/public";
import type { RunContext, RunDriver, SseWriter } from "../runs/public";
import { chunkDelta, DeltaSink, gapTrace, reconcileTrace } from "../stream/public";
import type { LoopHandoff } from "./orchestrator.handoff";
import { type LoopEnd, type LoopInput, type LoopIo, runLoop } from "./orchestrator.loop";
import * as repo from "./orchestrator.repo";
import { chunkText } from "./orchestrator.rules";

export type OrchestratorDeps = {
  db: Db;
  runner: AgentRunner;
  /** Nhóm của user (grant theo group) từ cache cấu hình. */
  users: { user(id: string): Promise<UserState | undefined> };
  log: Logger;
  /** CR-114 · kho artifact cho bàn giao bằng tham chiếu; vắng ⇒ nguyên văn như cũ. */
  artifacts?: ArtifactSink;
};

/**
 * CR-114 · kho artifact của run. Không quyết ai đọc được `ref`: job delegate mang `byRef`, runner job chọn nó chỉ khi job
 * thực sự nhận `artifact-get` (`artifactToolsGranted`); người đọc khác thấy nguyên văn.
 */
function handoffOf(d: OrchestratorDeps, ctx: RunContext): LoopHandoff | undefined {
  const store = d.artifacts;
  if (!store) return undefined;
  const r = ctx.writer.run;
  const who = { tenantId: r.tenantId, userId: r.userId };
  return {
    put: (body, meta) => store.put(who, body, { ...meta, runId: r.id }),
    // fix114-handoff2 · hỏi runner (cùng đường cấp tool như lúc chạy job) với task delegate thăm dò của run này.
    refAgents: async (agents) => {
      const runner = d.runner;
      if (!runner.artifactAccess) return new Set<string>();
      const probe = (agent: (typeof agents)[number]) =>
        runner
          .artifactAccess?.({
            agent,
            role: "agent",
            prompt: "",
            history: [],
            run: r,
            snapshot: ctx.snapshot,
            files: ctx.files,
          })
          .catch(() => false) ?? Promise.resolve(false);
      const ok = await Promise.all(agents.map(probe));
      return new Set(agents.filter((_, i) => ok[i]).map((a) => a.key));
    },
  };
}

/**
 * Ảnh thiếu Orchestrator (BR-08 đã chặn lúc khởi động) → null. H2b P7: dùng bản đã chọn lúc tạo run
 * (`ctx.orchestrator`, theo tenant — không chọn lại); R09: `ctx.scope` thu hẹp AU + `detail.scope` của step Orchestrator.
 */
async function loadInput(d: OrchestratorDeps, ctx: RunContext): Promise<LoopInput | null> {
  const { snapshot, writer, scope } = ctx;
  const settings = ctx.orchestrator?.config;
  const orchestrator = settings && snapshot.agents.find((a) => a.id === settings.agentId);
  if (!settings || !orchestrator) return null;
  const r = writer.run;
  const us = await d.users.user(r.userId);
  const groupIds = us?.groupIds ?? new Set<string>();
  const who = { tenantId: r.tenantId, userId: r.userId, groupIds, external: us?.external === true };
  const access = accessInput(snapshot, who, scope ? { onlyKeys: scope } : undefined);
  const { flow, win } = await withHubScope(d.db, { kind: "system" }, async (tx) => ({
    flow: await repo.flowState(tx, r),
    // X2b D7 · run phòng: ngữ cảnh phòng thay flow nền (không đọc `hub.messages`).
    win: ctx.roomHistory
      ? { items: ctx.roomHistory, total: null }
      : await repo.flowHistoryWindow(tx, r, settings.historyN),
  }));
  const history = win.items;
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
    // CR-114 · tổng tin của flow ⇒ đường SDK dịch cửa sổ history theo khối (cache ổn định).
    ...(win.total !== null ? { historyTotal: win.total } : {}),
    message: ctx.content,
    locale: r.locale,
    ...(scope ? { stepDetail: { scope: [...scope].sort() } } : {}),
    ...(ctx.noMatch ? { noMatch: ctx.noMatch } : {}),
    ...(ctx.files.length > 0 ? { attachments: ctx.files.map(fileBrief) } : {}),
    stream: true,
  };
}

/** P11 · SSE `delta` của sink (chữ đã cắt ≤ 40). */
export const deltaEmit = (writer: SseWriter) => (text: string) =>
  writer.emit({ event: "delta", data: { text } });

function loopIo(d: OrchestratorDeps, ctx: RunContext): LoopIo {
  const { writer, snapshot, log } = ctx;
  const handoff = handoffOf(d, ctx);
  return {
    job: async ({ stream, ...j }) => {
      const sink = stream ? new DeltaSink(stream, deltaEmit(writer)) : undefined;
      const task = {
        ...j,
        run: writer.run,
        snapshot,
        stream: sink,
        emit: writer.emit.bind(writer),
        // H2c P9 · job agent (delegate) mang tập file của run; Orchestrator chỉ thấy khối `<attachments>` (P11).
        ...(j.role === "agent" ? { files: ctx.files } : {}),
      };
      const o = await runJob(d.runner, task, writer.signal, log);
      if (o.kind !== "aborted") await gapTrace({ db: d.db, log, runId: writer.run.id }, o);
      return o;
    },
    skip: (s) =>
      withHubScope(d.db, { kind: "system" }, (tx) =>
        repo.insertSkippedStep(tx, { run: writer.run, ...s }),
      ),
    ...(handoff ? { handoff } : {}),
  };
}

/** P6 · H1-R09: cắt `delta` ≤ 40 ký tự; `content` = nối mọi `delta`. */
async function emitText(writer: SseWriter, text: string): Promise<void> {
  for (const part of chunkText(text)) await writer.emit({ event: "delta", data: { text: part } });
}

/** P12 · đã phát S: trace R23 rồi chỉ phát phần còn lại (`text` luôn bắt đầu bằng S). */
async function emitRest(d: OrchestratorDeps, ctx: RunContext, end: LoopEnd): Promise<void> {
  if (end.kind !== "text" || !end.stream?.streamed) return;
  const { writer } = ctx;
  const s = end.stream;
  await reconcileTrace({ db: d.db, log: ctx.log, runId: writer.run.id, stepId: s.stepId }, s);
  for (const part of chunkDelta(end.text.slice(s.streamed.length)))
    await writer.emit({ event: "delta", data: { text: part } });
}

async function deliver(d: OrchestratorDeps, ctx: RunContext, end: LoopEnd): Promise<void> {
  const { writer } = ctx;
  if (end.kind === "aborted") return;
  if (end.kind === "failed") {
    await writer.finish({ kind: "failed", code: end.code, reason: end.reason ?? null });
    return;
  }
  const text = end.kind === "text" ? end.text : end.ask.question;
  if (end.kind === "text" && end.stream?.streamed) await emitRest(d, ctx, end);
  else await emitText(writer, text);
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
    await deliver(d, ctx, end);
  } catch (err) {
    if (writer.signal.aborted || writer.done) return;
    log.error("orchestrator-failed", safeErrorFields(err));
    await writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" });
  } finally {
    // Vòng chạy hết mà run chưa kết thúc (vd job không INSERT vì run đã bị đóng) → rời registry, lease hết hạn.
    if (!writer.done) writer.abort();
  }
}

/** `RunDriver` mặc định (B6 chỗ cắm): chạy nền, tự `finish`. */
export function orchestratorDriver(base: OrchestratorDeps): RunDriver {
  // CR-114 · cờ `HUB_ARTIFACT_HANDOFF=1` ⇒ kho artifact dùng chung theo `db` (không đi qua app.runner).
  const env = process.env;
  const d: OrchestratorDeps =
    base.artifacts || !artifactHandoffOn(env)
      ? base
      : {
          ...base,
          artifacts: artifactStoreFor(base.db, env),
        };
  return {
    start: (ctx) => {
      void driveRun(d, ctx);
    },
  };
}

/** H2b P10 · `history_n` tin gần nhất của flow cho run `direct` (cùng câu với vòng Orchestrator, không nhánh SQL mới). */
export function flowHistoryOf(db: Db, run: repo.RunKey, historyN: number): Promise<HistoryItem[]> {
  return withHubScope(db, { kind: "system" }, (tx) => repo.flowHistory(tx, run, historyN));
}

/** CR-114 · như `flowHistoryOf` + tổng tin của flow (cùng một câu). */
export function flowHistoryWindowOf(
  db: Db,
  run: repo.RunKey,
  historyN: number,
): Promise<{ items: HistoryItem[]; total: number }> {
  return withHubScope(db, { kind: "system" }, (tx) => repo.flowHistoryWindow(tx, run, historyN));
}
