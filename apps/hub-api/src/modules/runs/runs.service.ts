// HUB-FR-41 · HUB-FR-42 · HUB-FR-45 · HUB-BR-04 · E12 tạo run + E13 theo dõi + E14 đọc run (plan H1 §5.1–5.3).
// Mọi đọc/ghi 5 bảng hội thoại qua `withHubScope` (D2): request → `user`, kết thúc run → `system` (SseWriter).
// Vòng chạy run (Orchestrator B8 / runner B7) cắm qua `RunDriver`; không biết HTTP.
import {
  deriveTitle,
  RUN_EVENTS_RETENTION_S,
  type Run,
  type RunError,
  type SendMessageRequest,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError, safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import type { ConfigSnapshot } from "../config/config.rules";
import type { ConfigCache } from "../config/config.service";
import { setFinalSeq } from "./close/cancel.repo";
import * as repo from "./runs.repo";
import { eventsExpired } from "./runs.rules";
import { runEventStream, SseReader } from "./sse/sse-reader";
import {
  appendExternal,
  isTerminalEvent,
  lastSseEntry,
  type RunInfo,
  RunRegistry,
  type SseEventBody,
  SseWriter,
} from "./sse/sse-writer";

/** Ngữ cảnh một run cho vòng chạy: ghi sự kiện qua `writer`, kết thúc bằng `writer.finish`, dừng khi `writer.signal`. */
export type RunContext = {
  writer: SseWriter;
  /** Ảnh cấu hình chụp lúc tạo run (H1-R15, HUB-BR-06). */
  snapshot: ConfigSnapshot;
  content: string;
  log: Logger;
};
/** Chỗ cắm B8 (Orchestrator, dùng runner B7). Không chờ: chạy nền, tự `finish`. */
export interface RunDriver {
  start(ctx: RunContext): void;
}

export type RunServiceDeps = {
  db: Db;
  redis: Redis;
  config: ConfigCache;
  /** = `HUB_INSTANCE_ID`, ghi vào `runs.owner`. */
  owner: string;
  driver: RunDriver;
  log: Logger;
  signal?: AbortSignal;
};

/** Quota thật ở H3 (H1-R10). */
const QUOTA_OK = { state: "ok", pct: 0 } as const;
/** Chủ vừa COMMIT kết thúc sẽ XADD ngay; chỉ dựng lại khi DB đã kết thúc lâu hơn mức này (tránh tranh id). */
const REBUILD_GRACE_MS = 2000;

const ownerOf = (u: AuthUser): repo.Owner => ({ tenantId: u.tenantId, userId: u.userId });

function flowBusy(err: unknown): boolean {
  const e = err as { code?: unknown; constraint_name?: unknown; cause?: unknown } | null;
  const pg = (e?.code === undefined ? e?.cause : e) as typeof e;
  return pg?.code === "23505" && pg.constraint_name === repo.FLOW_RUNNING_UQ;
}

type Created = RunInfo & { userMessageId: string };

/** §5.1 · một transaction `user`, thứ tự khoá §3.5: conversations → flows → runs → messages. */
async function createRunTx(
  tx: Tx,
  o: repo.Owner,
  p: { run: Created; req: SendMessageRequest; configVersion: number; owner: string },
): Promise<void> {
  const r = p.run;
  if (!(await repo.touchConversation(tx, o, r.conversationId))) throw appError("NOT_FOUND");
  if (p.req.flow_id) {
    const ok = await repo.touchFlow(tx, o, { conversationId: r.conversationId, flowId: r.flowId });
    if (!ok) throw appError("NOT_FOUND");
  } else {
    const title = deriveTitle(p.req.content);
    await repo.insertFlow(tx, o, { id: r.flowId, conversationId: r.conversationId, title });
  }
  await repo.insertRun(tx, o, {
    id: r.id,
    conversationId: r.conversationId,
    flowId: r.flowId,
    configVersion: p.configVersion,
    userMessageId: r.userMessageId,
    answerMessageId: r.answerMessageId,
    owner: p.owner,
    locale: r.locale,
  });
  await repo.insertMessage(tx, o, {
    id: r.userMessageId,
    conversationId: r.conversationId,
    flowId: r.flowId,
    role: "user",
    content: p.req.content,
    runId: r.id,
  });
}

/** Sự kiện kết thúc dựng từ cột `runs` + tin assistant (không gọi lại `runErrorText`, plan-errors §Ghi). */
async function terminalFromDb(tx: Tx, o: repo.Owner, r: repo.RunRecord): Promise<SseEventBody> {
  const base = { run_id: r.id, message_id: r.answerMessageId };
  if (r.status !== "finished") {
    return { event: "run.failed", data: { ...base, ...toRunError(r) } };
  }
  const content = (await repo.messageContent(tx, o, r.answerMessageId)) ?? "";
  const ms = Math.max(0, (r.finishedAt?.getTime() ?? 0) - r.startedAt.getTime());
  return { event: "run.finished", data: { ...base, content, ms } };
}

/** `Run` (contract chat) từ dòng `runs`; `lastEventId` do người gọi chọn (E14 · E15). */
export function toRun(r: repo.RunRecord, lastEventId: number): Run {
  return {
    id: r.id,
    conversation_id: r.conversationId,
    flow_id: r.flowId,
    status: r.status,
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    last_event_id: lastEventId,
    error: toRunError(r),
  };
}

function toRunError(r: repo.RunRecord): RunError | null {
  if (!r.errorCode) return null;
  return {
    code: r.errorCode as RunError["code"],
    message: r.errorMessage ?? r.errorCode,
    hint: r.errorHint ?? "",
  };
}

/** E14/E15 · run xong → `runs.last_seq`; đang chạy → id cuối `sse:<id>`. */
export async function lastEventIdOf(redis: Redis, r: repo.RunRecord): Promise<number> {
  return r.status === "running" ? (await lastSseEntry(redis, r.id)).seq : r.lastSeq;
}

export type StartedRun = {
  runId: string;
  flowId: string;
  messageId: string;
  stream: ReadableStream<Uint8Array>;
};
/** E12/E13/E14 + bảng run đang chạy của instance (`registry`, cho B9/B10). */
export class RunService {
  readonly registry = new RunRegistry();
  readonly #reader: SseReader;

  constructor(private readonly d: RunServiceDeps) {
    this.#reader = new SseReader(d.redis, d.log, d.signal);
    d.signal?.addEventListener("abort", () => this.registry.abortAll(), { once: true });
  }

  #scoped<T>(u: AuthUser, fn: (tx: Tx, o: repo.Owner) => Promise<T>): Promise<T> {
    const o = ownerOf(u);
    return withHubScope(this.d.db, { kind: "user", ...o }, (tx) => fn(tx, o));
  }

  async #findOr404(u: AuthUser, id: string): Promise<repo.RunRecord> {
    const run = await this.#scoped(u, (tx, o) => repo.findRun(tx, o, id));
    if (!run) throw appError("NOT_FOUND");
    return run;
  }

  /** E12 · ném 404 (hội thoại/flow), 409 `FLOW_BUSY`. Trả stream đọc từ `sse:<id>` (P9). */
  async start(u: AuthUser, conversationId: string, req: SendMessageRequest): Promise<StartedRun> {
    const snapshot = await this.d.config.snapshot();
    const locale = (await this.d.config.user(u.userId))?.locale ?? "vi";
    const run: Created = {
      id: crypto.randomUUID(),
      ...ownerOf(u),
      conversationId,
      flowId: req.flow_id ?? crypto.randomUUID(),
      answerMessageId: crypto.randomUUID(),
      userMessageId: crypto.randomUUID(),
      locale,
    };
    const { owner } = this.d;
    try {
      await this.#scoped(u, (tx, o) =>
        createRunTx(tx, o, { run, req, configVersion: snapshot.version, owner }),
      );
    } catch (err) {
      if (flowBusy(err)) throw appError("FLOW_BUSY");
      throw err;
    }
    const writer = new SseWriter(run, { ...this.d, owner });
    this.registry.add(writer);
    await this.#announce(writer);
    this.d.driver.start({ writer, snapshot, content: req.content, log: this.d.log });
    const stream = this.#stream(u, run.id, 0);
    return { runId: run.id, flowId: run.flowId, messageId: run.userMessageId, stream };
  }

  /** `run.started` (id 1) ngay sau COMMIT, trước khi gọi vòng chạy (H1-R10). Redis lỗi → kết thúc run lỗi (DB cũng lỗi → `abort`, sweeper đóng) rồi ném. */
  async #announce(writer: SseWriter): Promise<void> {
    const r = writer.run;
    try {
      await writer.emit({
        event: "run.started",
        data: { run_id: r.id, flow_id: r.flowId, quota: QUOTA_OK },
      });
    } catch (err) {
      await writer.finishOrAbort({ kind: "failed", code: "INTERNAL_ERROR" });
      throw err;
    }
  }

  /** E13 · 404 · 410 chỉ khi `eventsExpired`; còn lại phát `seq > after` rồi theo dõi. */
  async events(u: AuthUser, id: string, after: number, now = new Date()) {
    const r = await this.#findOr404(u, id);
    if (eventsExpired(r, now, RUN_EVENTS_RETENTION_S)) throw appError("EVENTS_EXPIRED");
    // Client đã có sự kiện kết thúc (`last_seq` = id của nó) → stream rỗng đóng ngay (HUB-FR-42).
    if (r.status !== "running" && r.lastSeq > 0 && after >= r.lastSeq) return emptyStream();
    return this.#stream(u, id, after);
  }

  /** E14 · `last_event_id`: run xong → `runs.last_seq`; đang chạy → id cuối `sse:<id>`. */
  async get(u: AuthUser, id: string): Promise<Run> {
    const r = await this.#findOr404(u, id);
    return toRun(r, await lastEventIdOf(this.d.redis, r));
  }

  #stream(u: AuthUser, runId: string, after: number): ReadableStream<Uint8Array> {
    return runEventStream({
      reader: this.#reader,
      runId,
      after,
      ensureTerminal: () => this.#ensureTerminal(u, runId),
      log: this.d.log,
      signal: this.d.signal,
    });
  }

  /**
   * §5.3 · id sự kiện kết thúc khi run không còn `running` (null: còn chạy / chưa biết). DB đã kết thúc (> 2 s) mà
   * `sse:<id>` thiếu sự kiện kết thúc → "XADD bên ngoài" với id ≥ `runs.last_seq` rồi ghi `last_seq`. Không ném.
   */
  async #ensureTerminal(u: AuthUser, runId: string): Promise<number | null> {
    const { redis, log } = this.d;
    try {
      const found = await this.#scoped(u, async (tx, o) => {
        const r = await repo.findRun(tx, o, runId);
        if (!r || r.status === "running") return null;
        const seq = await terminalSeqOf(redis, runId);
        if (seq !== null) return { seq };
        const fresh = !r.finishedAt || Date.now() - r.finishedAt.getTime() < REBUILD_GRACE_MS;
        if (fresh) return { seq: r.lastSeq > 0 ? r.lastSeq : null };
        return { seq: null, rebuild: await terminalFromDb(tx, o, r), minSeq: r.lastSeq };
      });
      if (!found?.rebuild) return found?.seq ?? null;
      const seq = await appendExternal(redis, runId, found.rebuild, { log, minSeq: found.minSeq });
      if (seq === null) return terminalSeqOf(redis, runId);
      await withHubScope(this.d.db, { kind: "system" }, (tx) => setFinalSeq(tx, runId, seq));
      return seq;
    } catch (err) {
      log.warn("sse-rebuild-failed", { run_id: runId, ...safeErrorFields(err) });
      return null;
    }
  }
}

/** Id sự kiện kết thúc đang ở cuối `sse:<id>` (null khi chưa có). */
async function terminalSeqOf(redis: Redis, runId: string): Promise<number | null> {
  const last = await lastSseEntry(redis, runId);
  return last.event && isTerminalEvent(last.event) ? last.seq : null;
}

/** Stream SSE rỗng, đóng ngay. */
function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start: (ctl) => ctl.close() });
}
