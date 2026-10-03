// UC-02, UC-04, UC-08, C1-R06 · điều khiển stream của run: gửi (E12), gắn lại (E13 từ 0), gom delta theo khung hình,
// nối lại `Last-Event-ID` (0,5→8 s ×5) rồi `lost`, 410 → làm mới dữ liệu, dừng (E15) KHÔNG abort fetch.
// Không phụ thuộc React/DOM: mọi I/O qua `RunDriverDeps` để unit test dựng stream giả.
import { type ChatEvent, isNewEvent, type SendMessageRequest } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";
import type { SendAccepted } from "./api";
import { reconnectDelay } from "./lib/reconnect";
import {
  createAttachedState,
  createRunState,
  isRunActive,
  type NewRunInput,
  type RunOrigin,
  type RunState,
} from "./lib/reducer";
import type { RunStore } from "./run-store";

type Body = ReadableStream<Uint8Array>;

export type RunDriverDeps = {
  sendMessage(convId: string, req: SendMessageRequest, signal: AbortSignal): Promise<SendAccepted>;
  openEvents(runId: string, lastEventId: number, signal: AbortSignal): Promise<Body>;
  cancelRun(runId: string): Promise<unknown>;
  readEvents(body: Body, onEvent: (e: ChatEvent) => void, signal: AbortSignal): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Hẹn gọi 1 lần ở khung hình kế (`requestAnimationFrame`). */
  requestFrame(cb: () => void): void;
  /** Run vừa kết thúc (finished/asked/failed/cancelled) → làm mới query. */
  onSettled(run: RunState): void;
  /** 410 `EVENTS_EXPIRED` / 404 khi nối lại → làm mới query rồi xoá run. */
  onExpired(run: RunState): void;
  newKey(): string;
};

export type SendInput = Omit<NewRunInput, "key">;
export type SendOutcome = { ok: true; key: string } | { ok: false; error: ApiError };

const isTerminalEvent = (e: ChatEvent) => e.event === "run.finished" || e.event === "run.failed";
const ABORTED = AbortSignal.abort();
const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0, "NETWORK_ERROR", "Network error");
}

/** Gom sự kiện, dispatch tối đa 1 lần/khung hình (spec §6: 500 delta không giật); `flush()` đẩy ngay. */
function createBatcher(store: RunStore, key: string, requestFrame: (cb: () => void) => void) {
  let queue: ChatEvent[] = [];
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (queue.length === 0) return;
    const events = queue;
    queue = [];
    store.dispatch(key, { type: "events", events });
  };
  return {
    flush,
    push(e: ChatEvent) {
      queue.push(e);
      if (!scheduled) {
        scheduled = true;
        requestFrame(flush);
      }
    },
  };
}

export class RunDriver {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly store: RunStore,
    private readonly deps: RunDriverDeps,
  ) {}

  /** E12. Lỗi trước stream (409 `FLOW_BUSY`, mạng…) → bỏ run, trả lỗi để composer giữ chữ. */
  async send(input: SendInput): Promise<SendOutcome> {
    const key = this.deps.newKey();
    this.store.add(createRunState({ ...input, key }));
    const signal = this.start(key);
    const { content, flowId } = input.request;
    try {
      const res = await this.deps.sendMessage(
        input.convId,
        flowId ? { content, flow_id: flowId } : { content },
        signal,
      );
      this.store.dispatch(key, {
        type: "accepted",
        runId: res.runId,
        flowId: res.flowId,
        messageId: res.messageId,
      });
      if (this.store.get(key)?.cancelling) void this.requestCancel(res.runId);
      void this.pump(key, res.body);
      return { ok: true, key };
    } catch (err) {
      this.drop(key);
      return { ok: false, error: toApiError(err) };
    }
  }

  /** Chạy lại / Thử lại: cùng `content`; ô chính → flow mới, trong khung → cùng flow. */
  retry(run: RunState, flowLastActiveAt?: string): Promise<SendOutcome> {
    const flowId = run.origin === "flow" ? (run.flowId ?? run.request.flowId) : undefined;
    return this.send({
      convId: run.convId,
      origin: run.origin,
      request: flowId ? { content: run.request.content, flowId } : { content: run.request.content },
      flowLastActiveAt,
    });
  }

  /** Mở hội thoại/khung có `active_run_id` mà store chưa theo dõi → E13 từ 0. Trả `key`. */
  attach(run: { convId: string; runId: string; flowId: string; origin: RunOrigin }): string {
    const existing = this.store.getRuns().find((r) => r.runId === run.runId);
    if (existing) return existing.key;
    const key = this.deps.newKey();
    this.store.add(createAttachedState(key, run));
    this.start(key);
    void this.resume(key, false);
    return key;
  }

  /** Nút "Thử lại" của banner `lost`: nối lại từ `lastEventId`. */
  reconnect(key: string): void {
    if (this.store.get(key)?.phase !== "lost") return;
    this.start(key);
    void this.resume(key, true);
  }

  /** ■ / Esc: gửi E15, giữ chữ, chờ `run.failed CANCELLED` trên stream đang mở (không abort). */
  async cancel(key: string): Promise<void> {
    const run = this.store.get(key);
    if (!run || !isRunActive(run) || run.cancelling) return;
    this.store.dispatch(key, { type: "cancelRequested" });
    if (run.runId) await this.requestCancel(run.runId);
  }

  /** Bỏ theo dõi (xoá hội thoại, đăng xuất): huỷ fetch + xoá khỏi store. */
  drop(key: string): void {
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
    this.store.remove(key);
  }

  dropAll(): void {
    for (const key of [...this.controllers.keys()]) this.drop(key);
    this.store.clear();
  }

  private async requestCancel(runId: string): Promise<void> {
    try {
      await this.deps.cancelRun(runId);
    } catch {
      // Hub không nhận → run chạy tiếp và kết thúc bình thường trên stream; không có gì để hoàn tác.
    }
  }

  /** Tạo (hoặc dùng lại) controller khi bắt đầu theo dõi một run. */
  private start(key: string): AbortSignal {
    let c = this.controllers.get(key);
    if (!c || c.signal.aborted) {
      c = new AbortController();
      this.controllers.set(key, c);
    }
    return c.signal;
  }

  /** Run đã bị `drop` / kết thúc → signal đã huỷ, mọi vòng đọc/nối lại dừng. */
  private signalFor(key: string): AbortSignal {
    return this.controllers.get(key)?.signal ?? ABORTED;
  }

  /** Đọc tới sự kiện kết thúc; đứt giữa chừng → nối lại; hết lượt → `lost`. */
  private async pump(key: string, first: Body): Promise<void> {
    let body: Body | null = first;
    while (body) {
      if (await this.consume(key, body)) return this.settle(key);
      if (this.signalFor(key).aborted) return;
      body = await this.reopen(key);
    }
  }

  private async resume(key: string, backoff: boolean): Promise<void> {
    const body = backoff ? await this.reopen(key) : await this.openOnce(key);
    if (body) await this.pump(key, body);
  }

  /** Lần mở đầu khi gắn lại: lỗi mạng → vào vòng backoff như đứt stream. */
  private async openOnce(key: string): Promise<Body | null> {
    const run = this.store.get(key);
    if (!run?.runId) return null;
    try {
      return await this.deps.openEvents(run.runId, run.lastEventId, this.signalFor(key));
    } catch (err) {
      if (this.isGone(key, err)) return null;
      return this.reopen(key);
    }
  }

  /** Trả `true` nếu đã nhận sự kiện kết thúc. */
  private async consume(key: string, body: Body): Promise<boolean> {
    const batch = createBatcher(this.store, key, this.deps.requestFrame);
    let lastId = this.store.get(key)?.lastEventId ?? 0;
    let terminal = false;
    const onEvent = (e: ChatEvent) => {
      if (terminal || !isNewEvent(e.id, lastId)) return;
      lastId = e.id;
      batch.push(e);
      if (isTerminalEvent(e)) {
        terminal = true;
        batch.flush();
      }
    };
    try {
      await this.deps.readEvents(body, onEvent, this.signalFor(key));
    } catch (err) {
      if (!isAbort(err) && import.meta.env?.DEV) console.warn("[run] stream đứt", err);
    } finally {
      batch.flush();
    }
    return terminal;
  }

  /** Backoff 0,5 · 1 · 2 · 4 · 8 s; mỗi lần mở E13 với `Last-Event-ID` = id cuối đã nhận. */
  private async reopen(key: string): Promise<Body | null> {
    const signal = this.signalFor(key);
    for (let attempt = 1; ; attempt++) {
      const delay = reconnectDelay(attempt);
      if (delay === null) break;
      this.store.dispatch(key, { type: "reconnecting", attempt });
      await this.deps.sleep(delay, signal).catch(() => {});
      const run = this.store.get(key);
      if (signal.aborted || !run?.runId) return null;
      try {
        const body = await this.deps.openEvents(run.runId, run.lastEventId, signal);
        this.store.dispatch(key, { type: "resumed" });
        return body;
      } catch (err) {
        if (this.isGone(key, err)) return null;
      }
    }
    this.store.dispatch(key, { type: "lost" });
    return null;
  }

  /** Abort / 410 `EVENTS_EXPIRED` / 404 (run hoặc hội thoại đã mất) → không nối lại nữa. */
  private isGone(key: string, err: unknown): boolean {
    if (isAbort(err) || this.signalFor(key).aborted) return true;
    if (!(err instanceof ApiError) || (err.status !== 410 && err.status !== 404)) return false;
    const run = this.store.get(key);
    this.controllers.delete(key);
    if (run) this.deps.onExpired(run);
    return true;
  }

  private settle(key: string): void {
    this.controllers.delete(key);
    const run = this.store.get(key);
    if (run) this.deps.onSettled(run);
  }
}
