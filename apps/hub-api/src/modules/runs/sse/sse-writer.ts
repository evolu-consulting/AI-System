// HUB-FR-41 · HUB-FR-42 · HUB-NFR-02 · H1-R12 · P9, P11, P12 · Hub là bên ghi duy nhất `sse:<run_id>`, id tường minh
// `<seq>-0` (CR-030, plan §5.2). Fencing: XADD bị Redis từ chối vì id ≤ đỉnh ⇒ bên khác đã ghi/kết thúc → dừng.
// Kết thúc chỉ khi `UPDATE runs … WHERE status='running' AND owner=$me` trả 1 dòng; 0 dòng → không XADD.
import type { Ask, ChatEventName, ChatRunErrorCode } from "@ai/contracts/chat";
import { RUN_EVENTS_RETENTION_S, TERMINAL_EVENTS } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import { bindRunOutputs } from "../../attachments/run-files";
import { cancelJobs } from "../close/cancel.repo";
import { runErrorTextFor } from "../run-errors";
import * as repo from "../runs.repo";

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

/**
 * `agentId`: `undefined` = giữ `flows.agent_id`; `ask` + `agentId` ⇒ `flows.pending_ask`. Run lỗi: tin assistant = nối
 * các `delta` writer đã XADD (C1 luật lưu, như huỷ/sweeper).
 */
export type RunOutcome =
  | { kind: "finished"; content: string; ask?: Ask | null; agentId?: string | null }
  | {
      kind: "failed";
      code: ChatRunErrorCode;
      agentId?: string | null;
      /** H2b P15 · `reason` của `job.failed` (vd `refused` ⇒ hint F4); vắng = như H1. */
      reason?: string | null;
    };

/** Lỗi run (mã + câu theo locale; P15 `reason` ⇒ hint F4); `finished` ⇒ null. */
function runErrorOf(o: RunOutcome, locale: repo.Locale) {
  if (o.kind !== "failed") return null;
  return { code: o.code, ...runErrorTextFor(o.code, locale, o.reason ?? null) };
}

export class RunFencedError extends Error {
  constructor(runId: string) {
    super(`run ${runId} fenced`);
    this.name = "RunFencedError";
  }
}

const isIdTooSmall = (err: unknown): boolean =>
  err instanceof Error && /equal or smaller/i.test(err.message);

export type SseWriterDeps = {
  db: Db;
  redis: Redis;
  owner: string;
  log: Logger;
  /** X2b · gọi sau COMMIT tx1 kết thúc run (chỉ khi writer còn là chủ), sau XADD kết thúc; lỗi chỉ log. */
  onClosed?: (runId: string) => void;
};

/** X2b · gọi hook `onClosed` không ném (lỗi đồng bộ → log). */
export function notifyClosed(
  d: { onClosed?: (runId: string) => void; log: Logger },
  runId: string,
): void {
  if (!d.onClosed) return;
  try {
    d.onClosed(runId);
  } catch (err) {
    d.log.error("run-on-closed-failed", { run_id: runId, ...safeErrorFields(err) });
  }
}

/**
 * Chỉ instance chủ (`runs.owner`) tạo writer. `seq` sống trong bộ nhớ, bắt đầu từ `runs.last_seq`.
 * `signal` abort khi bị chặn (fencing) hoặc khi `abort()` (huỷ B9 / mất lease B10) — vòng chạy run phải dừng theo.
 */
export class SseWriter {
  readonly #ac = new AbortController();
  #seq: number;
  #expirySet = false;
  #done = false;
  /** Nối `delta` đã XADD — nội dung tin assistant khi run kết thúc lỗi. */
  #deltas = "";

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
    const seq = await this.#xadd(ev);
    if (ev.event === "delta") this.#deltas += (ev.data as { text: string }).text;
    return seq;
  }

  /**
   * `finish` không ném: lỗi (DB) → log + `abort()` — writer rời `RunRegistry`, lease hết hạn, sweeper đóng run
   * (H1-R11, H1-R13). Dùng cho lần kết thúc cuối (sau khi đã thử) để run không kẹt `running`/`FLOW_BUSY`.
   */
  async finishOrAbort(o: RunOutcome): Promise<boolean> {
    try {
      return await this.finish(o);
    } catch (err) {
      this.deps.log.error("run-finish-failed", { run_id: this.run.id, ...safeErrorFields(err) });
      this.abort();
      return false;
    }
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
   * Kết thúc run (§5.2): transaction `system` (flows FOR UPDATE → runs P12 → tin assistant → output H2c R26 → flows → jobs
   * khi lỗi) **rồi** XADD `ask?` + sự kiện kết thúc, `EXPIRE sse 600`, `DEL run:<id>`. Trả false khi không còn là chủ.
   */
  async finish(o: RunOutcome): Promise<boolean> {
    if (this.#done) return false;
    const ask = o.kind === "finished" ? (o.ask ?? null) : null;
    const lastSeq = this.#seq + (ask ? 2 : 1);
    const error = runErrorOf(o, this.run.locale);
    const status =
      o.kind === "finished" ? "finished" : o.code === "CANCELLED" ? "cancelled" : "failed";
    const content = o.kind === "finished" ? o.content : this.#deltas;
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
      await this.#insertAnswer(tx, { content, ask, finished: status === "finished" });
      // Chỉ `ask` của agent (need_input, có `agentId`) mới chờ trả lời: Orchestrator tự hỏi thì tin kế phải qua
      // Orchestrator, không route về `flows.agent_id` cũ (plan §6.1, AC-H15).
      await repo.updateFlowAfterRun(tx, {
        flowId: r.flowId,
        agentId: o.agentId,
        pendingAsk: !!ask && typeof o.agentId === "string",
      });
      // Lỗi Hub giữa chừng: job có thể vẫn chạy → huỷ như §5.7 để Runtime nhả slot (sau `messages`, §3.5).
      if (o.kind === "failed") await cancelJobs(tx, { runId: r.id, tenantId: r.tenantId });
      return t;
    });
    this.#done = true;
    if (!times) {
      this.#ac.abort();
      return false;
    }
    const ms = Math.max(0, times.finishedAt.getTime() - times.startedAt.getTime());
    await this.#publishEnd(ask, error ? { ...error } : null, { content, ms });
    // X2b review-1 #2: chỉ run phòng (`runs.room_id` đọc trong câu kết thúc) mới tốn tx2 đăng tin.
    if (times.roomId) notifyClosed(this.deps, this.run.id);
    return true;
  }

  /** Tin assistant (P8: sau `runs`) → H2c R26 (P15): output job gắn vào tin — chỉ khi `finished` (R27 dọn phần còn lại). */
  async #insertAnswer(
    tx: Tx,
    p: { content: string; ask: Ask | null; finished: boolean },
  ): Promise<void> {
    const r = this.run;
    await repo.insertMessage(
      tx,
      { tenantId: r.tenantId, userId: r.userId },
      {
        id: r.answerMessageId,
        conversationId: r.conversationId,
        flowId: r.flowId,
        role: "assistant",
        content: p.content,
        runId: r.id,
        ask: p.ask,
      },
    );
    if (!p.finished) return;
    await bindRunOutputs(tx, {
      runId: r.id,
      messageId: r.answerMessageId,
      conversationId: r.conversationId,
      flowId: r.flowId,
    });
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
 * `seq` = max(id cuối + 1, `minSeq`); lỗi id → đọc lại: đã có sự kiện kết thúc → thôi; chưa → thử lại (tối đa 3 lần)
 * rồi log. `minSeq` (= `runs.last_seq` khi dựng lại): `sse:` mất/dựng từ đầu vẫn không lùi dưới id client đã thấy.
 * Trả `seq` đã ghi, `null` khi không ghi.
 */
export async function appendExternal(
  redis: Redis,
  runId: string,
  ev: SseEventBody,
  o: { log: Logger; minSeq?: number },
): Promise<number | null> {
  for (let attempt = 1; attempt <= EXTERNAL_ATTEMPTS; attempt++) {
    const last = await lastSseEntry(redis, runId);
    if (last.event && isTerminalEvent(last.event)) return null;
    const seq = Math.max(last.seq + 1, o.minSeq ?? 0);
    try {
      await redis.xadd(sseKey(runId), `${seq}-0`, SSE_FIELD, JSON.stringify(ev));
      if (isTerminalEvent(ev.event)) {
        await redis.expire(sseKey(runId), RUN_EVENTS_RETENTION_S);
        await redis.del(runStreamKey(runId));
      }
      return seq;
    } catch (err) {
      if (!isIdTooSmall(err)) throw err;
    }
  }
  o.log.error("sse-external-xadd-failed", { run_id: runId });
  return null;
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
