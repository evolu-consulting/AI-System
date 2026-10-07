// HUB-FR-99, HUB-FR-100, X2a-AC08, X2a-AC12 · client `/me/stream`: một kết nối/tab, `Last-Event-ID` (chuỗi mờ, chỉ bộ nhớ),
// backoff không bỏ cuộc, phát hiện ping-timeout, `stream.reset` xoá id + báo router. Không phụ thuộc React/DOM:
// mọi I/O qua `MeStreamDeps` để unit test dựng stream/đồng hồ giả.
import { type MeStreamEvent, parseMeStreamEvent, type RawSseEvent } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";
import { backoffDelay, DOWN_AFTER_FAILURES, IDLE_TIMEOUT_MS } from "./lib/backoff";
import type { RealtimeStore } from "./realtime-store";

type Body = ReadableStream<Uint8Array>;

export type MeStreamDeps = {
  /** GET /me/stream kèm Bearer (+ refresh 401 một lần) và `Last-Event-ID` nếu có. */
  open(lastEventId: string | null, signal: AbortSignal): Promise<Body>;
  read(
    body: Body,
    onEvent: (e: RawSseEvent) => void,
    onBytes: () => void,
    signal: AbortSignal,
  ): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Hẹn `cb` sau `ms`; trả hàm huỷ. */
  setTimer(cb: () => void, ms: number): () => void;
  /** Sự kiện đã kiểm schema (kể cả `stream.reset`). */
  onEvent(e: MeStreamEvent): void;
};

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

export class MeStreamDriver {
  private master: AbortController | null = null;
  private failures = 0;
  private wake: (() => void) | null = null;

  constructor(
    private readonly store: RealtimeStore,
    private readonly deps: MeStreamDeps,
  ) {}

  get running(): boolean {
    return this.master !== null;
  }

  /** Mở khi đã đăng nhập; gọi lại khi đang chạy là no-op. */
  start(): void {
    if (this.master) return;
    this.master = new AbortController();
    this.failures = 0;
    this.store.setPhase("connecting");
    void this.loop(this.master.signal);
  }

  /** Đăng xuất / hết phiên: đóng hẳn, xoá `lastEventId`. */
  stop(): void {
    this.master?.abort();
    this.master = null;
    this.wake?.();
    this.store.reset();
  }

  /** Nối ngay (nút Thử lại, `online`, tab hiện lại khi `down`) thay vì chờ hết backoff. */
  retry(): void {
    this.wake?.();
  }

  private async loop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const fatal = await this.connectOnce(signal);
      if (fatal || signal.aborted) break;
      this.failures += 1;
      this.store.setPhase(this.failures >= DOWN_AFTER_FAILURES ? "down" : "reconnecting");
      await this.wait(backoffDelay(this.failures), signal);
    }
    if (this.master?.signal === signal) {
      // 401 sau refresh: dừng hẳn (session đã `expired`), không tự nối lại.
      this.master = null;
      this.store.reset();
    }
  }

  /** Ngủ `ms` hoặc tới khi `retry()`/`stop()`. */
  private async wait(ms: number, signal: AbortSignal): Promise<void> {
    const woken = new AbortController();
    this.wake = () => woken.abort();
    await this.deps.sleep(ms, AbortSignal.any([signal, woken.signal])).catch(() => {});
    this.wake = null;
  }

  /** Một lượt kết nối. Trả `true` khi lỗi không thể nối lại (401 sau refresh). */
  private async connectOnce(signal: AbortSignal): Promise<boolean> {
    const conn = new AbortController();
    const link = AbortSignal.any([signal, conn.signal]);
    let cancelIdle = () => {};
    const armIdle = () => {
      cancelIdle();
      cancelIdle = this.deps.setTimer(() => conn.abort(), IDLE_TIMEOUT_MS);
    };
    const onBytes = () => {
      if (this.store.get().phase !== "open") this.store.setPhase("open");
      this.failures = 0;
      armIdle();
    };
    try {
      const body = await this.deps.open(this.store.get().lastEventId, link);
      armIdle();
      await this.deps.read(body, (raw) => this.handle(raw), onBytes, link);
      return false;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return true;
      if (!isAbort(err) && import.meta.env?.DEV) console.warn("[me-stream] đứt", err);
      return false;
    } finally {
      cancelIdle();
      conn.abort();
    }
  }

  private handle(raw: RawSseEvent): void {
    const event = parseMeStreamEvent(raw.event, raw.data);
    if (!event) {
      if (import.meta.env?.DEV) console.warn("[me-stream] bỏ khung không hợp lệ", raw.event);
      return;
    }
    if (event.event === "stream.reset") this.store.setLastEventId(null);
    else if (raw.id) this.store.setLastEventId(raw.id);
    this.deps.onEvent(event);
  }
}
