// HUB-FR-41 · HUB-FR-42 · HUB-NFR-02 · H1-R12 · P9, P11, P12 · Hub là bên ghi duy nhất `sse:<run_id>`, id tường minh
// `<seq>-0` (CR-030, plan §5.2). Fencing: XADD bị Redis từ chối vì id ≤ đỉnh ⇒ bên khác đã ghi/kết thúc → dừng.
// Kết thúc chỉ khi `UPDATE runs … WHERE status='running' AND owner=$me` trả 1 dòng; 0 dòng → không XADD.
import type { Ask, ChatEventName, ChatRunErrorCode } from "@ai/contracts/chat";
import { RUN_EVENTS_RETENTION_S, TERMINAL_EVENTS } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { runErrorText } from "./run-errors";
import * as repo from "./runs.repo";

/** TTL `sse:<id>` khi run còn chạy (HUB-FR-42); sau kết thúc = `RUN_EVENTS_RETENTION_S`. */
export const SSE_LIVE_TTL_S = 86_400;
/** Field duy nhất của mỗi entry: JSON `{event, data}` (CR-030). */
export const SSE_FIELD = "e";
const EXTERNAL_ATTEMPTS = 3;

export const sseKey = (runId: string) => `sse:${runId}`;
export const runStreamKey = (runId: string) => `run:${runId}`;
export const isTerminalEvent = (name: string): boolean =>
  (TERMINAL_EVENTS as readonly string[]).includes(name);

/** Một sự kiện client chưa đánh số. `data` đã đúng contract (người gọi bảo đảm). */
export type SseEventBody = { event: ChatEventName; data: unknown };

export type RunInfo = {
  id: string;
  tenantId: string;
  userId: string;
  conversationId: string;
  flowId: string;
  answerMessageId: string;
  locale: repo.Locale;
};

/** `agentId`: `undefined` = giữ `flows.agent_id`. `content` của run lỗi mặc định "". */
export type RunOutcome =
  | { kind: "finished"; content: string; ask?: Ask | null; agentId?: string | null }
  | { kind: "failed"; code: ChatRunErrorCode; content?: string; agentId?: string | null };

export class RunFencedError extends Error {
  constructor(runId: string) {
    super(`run ${runId} fenced`);
    this.name = "RunFencedError";
  }
}

const isIdTooSmall = (err: unknown): boolean =>
  err instanceof Error && /equal or smaller/i.test(err.message);

export type SseWriterDeps = { db: Db; redis: Redis; owner: string; log: Logger };

/**
 * Chỉ instance chủ (`runs.owner`) tạo writer. `seq` sống trong bộ nhớ, bắt đầu từ `runs.last_seq`.
 * `signal` abort khi bị chặn (fencing) hoặc khi `abort()` (huỷ B9 / mất lease B10) — vòng chạy run phải dừng theo.
 */
export class SseWriter {
  readonly #ac = new AbortController();
  #seq: number;
  #expirySet = false;
  #done = false;

  constructor(
    readonly run: RunInfo,
    private readonly deps: SseWriterDeps,
    lastSeq = 0,
  ) {
    this.#seq = lastSeq;
  }

  get seq(): number {
    return this.#seq;
  }
  get signal(): AbortSignal {
    return this.#ac.signal;
  }
  get done(): boolean {
    return this.#done;
  }

  /** Dừng cục bộ, không ghi gì (bên khác đã/ sẽ kết thúc run). */
  abort(): void {
    this.#done = true;
    this.#ac.abort();
  }

  /** XADD sự kiện kế (`seq + 1`). Ném `RunFencedError` khi đã dừng hoặc Redis từ chối id. */
  async emit(ev: SseEventBody): Promise<number> {
    if (this.#done || isTerminalEvent(ev.event)) throw new RunFencedError(this.run.id);
    return this.#xadd(ev);
  }

  async #xadd(ev: SseEventBody): Promise<number> {
    const seq = this.#seq + 1;
    const key = sseKey(this.run.id);
    try {
      await this.deps.redis.xadd(key, `${seq}-0`, SSE_FIELD, JSON.stringify(ev));
    } catch (err) {
      if (!isIdTooSmall(err)) throw err;
      this.abort();
      throw new RunFencedError(this.run.id);
    }
    this.#seq = seq;
    if (!this.#expirySet) {
      this.#expirySet = true;
      await this.deps.redis.expire(key, SSE_LIVE_TTL_S);
    }
    return seq;
  }

  /**
   * Kết thúc run (§5.2): transaction `system` (flows FOR UPDATE → runs P12 → tin assistant → flows) **rồi** XADD
   * `ask?` + sự kiện kết thúc, `EXPIRE sse 600`, `DEL run:<id>`. Trả false khi không còn là chủ (không ghi gì).
   */
  async finish(o: RunOutcome): Promise<boolean> {
    if (this.#done) return false;
    const ask = o.kind === "finished" ? (o.ask ?? null) : null;
    const lastSeq = this.#seq + (ask ? 2 : 1);
    const error =
      o.kind === "failed" ? { code: o.code, ...runErrorText(o.code, this.run.locale) } : null;
    const status =
      o.kind === "finished" ? "finished" : o.code === "CANCELLED" ? "cancelled" : "failed";
    const content = o.content ?? "";
    const times = await withHubScope(this.deps.db, { kind: "system" }, async (tx) => {
      const r = this.run;
      const t = await repo.finishRun(tx, {
        runId: r.id,
        flowId: r.flowId,
        owner: this.deps.owner,
        status,
        lastSeq,
        error,
      });
      if (!t) return null;
      const o2 = { tenantId: r.tenantId, userId: r.userId };
      await repo.insertMessage(tx, o2, {
        id: r.answerMessageId,
        conversationId: r.conversationId,
        flowId: r.flowId,
        role: "assistant",
        content,
        runId: r.id,
        ask,
      });
      await repo.updateFlowAfterRun(tx, {
        flowId: r.flowId,
        agentId: o.agentId,
        pendingAsk: !!ask,
      });
      return t;
    });
    this.#done = true;
    if (!times) {
      this.#ac.abort();
      return false;
    }
    const ms = Math.max(0, times.finishedAt.getTime() - times.startedAt.getTime());
    await this.#publishEnd(ask, error ? { ...error } : null, { content, ms });
    return true;
  }

  async #publishEnd(
    ask: Ask | null,
    error: { code: string; message: string; hint: string } | null,
    p: { content: string; ms: number },
  ): Promise<void> {
    const base = { run_id: this.run.id, message_id: this.run.answerMessageId };
    try {
      if (ask) await this.#xadd({ event: "ask", data: ask });
      await this.#xadd(
        error
          ? { event: "run.failed", data: { ...base, ...error } }
          : { event: "run.finished", data: { ...base, content: p.content, ms: p.ms } },
      );
      await this.deps.redis.expire(sseKey(this.run.id), RUN_EVENTS_RETENTION_S);
      await this.deps.redis.del(runStreamKey(this.run.id));
    } catch (err) {
      // DB đã kết thúc: E13 dựng lại sự kiện kết thúc từ DB (§5.3).
      this.deps.log.error("sse-end-failed", { run_id: this.run.id, ...safeErrorFields(err) });
    } finally {
      this.#ac.abort();
    }
  }
}

type StreamEntry = [id: string, fields: string[]];

/** Seq + tên sự kiện của entry cuối `sse:<id>` (0 / null khi rỗng). */
export async function lastSseEntry(
  redis: Redis,
  runId: string,
): Promise<{ seq: number; event: string | null }> {
  const rows = (await redis.call("XREVRANGE", sseKey(runId), "+", "-", "COUNT", "1")) as
    | StreamEntry[]
    | null;
  const top = rows?.[0];
  if (!top) return { seq: 0, event: null };
  return { seq: Number.parseInt(top[0], 10), event: parseEntry(top[1])?.event ?? null };
}

export function parseEntry(fields: string[]): SseEventBody | null {
  const i = fields.indexOf(SSE_FIELD);
  const raw = i >= 0 ? fields[i + 1] : undefined;
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as SseEventBody;
  } catch {
    return null;
  }
}

/**
 * "XADD bên ngoài" (§5.2): bên không phải chủ (huỷ B9, sweeper B10, dựng lại §5.3) phát sự kiện kết thúc sau COMMIT.
 * `seq` = id cuối + 1; lỗi id → đọc lại: đã có sự kiện kết thúc → thôi; chưa → thử lại (tối đa 3 lần) rồi log.
 */
export async function appendExternal(
  redis: Redis,
  runId: string,
  ev: SseEventBody,
  log: Logger,
): Promise<boolean> {
  for (let attempt = 1; attempt <= EXTERNAL_ATTEMPTS; attempt++) {
    const last = await lastSseEntry(redis, runId);
    if (last.event && isTerminalEvent(last.event)) return false;
    try {
      await redis.xadd(sseKey(runId), `${last.seq + 1}-0`, SSE_FIELD, JSON.stringify(ev));
      if (isTerminalEvent(ev.event)) {
        await redis.expire(sseKey(runId), RUN_EVENTS_RETENTION_S);
        await redis.del(runStreamKey(runId));
      }
      return true;
    } catch (err) {
      if (!isIdTooSmall(err)) throw err;
    }
  }
  log.error("sse-external-xadd-failed", { run_id: runId });
  return false;
}

/** Run đang chạy trên instance này (B9 huỷ → `abort()`, B10 lease lấy danh sách id). */
export class RunRegistry {
  readonly #runs = new Map<string, SseWriter>();

  add(w: SseWriter): void {
    this.#runs.set(w.run.id, w);
    w.signal.addEventListener("abort", () => this.#runs.delete(w.run.id), { once: true });
  }
  get(runId: string): SseWriter | undefined {
    return this.#runs.get(runId);
  }
  ids(): string[] {
    return [...this.#runs.keys()];
  }
  abortAll(): void {
    for (const w of this.#runs.values()) w.abort();
  }
}
