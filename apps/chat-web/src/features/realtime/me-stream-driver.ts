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
  /** Cache phòng đã có dữ liệu (lần nối đầu có thể hụt khe giữa fetch và `tail` ⇒ cần nạp lại). */
  hasRoomsData?(): boolean;
};

type Outcome = "fatal" | "failed" | "clean" | "throttled";
/** Phiên sống ≥ ngần này ms mới coi là khoẻ (chu kỳ token D14) và xoá bộ đếm phiên ngắn. */
const CLEAN_MIN_LIFE_MS = 5000;
const CLEAN_MAX_QUICK = 3;

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

export class MeStreamDriver {
  private master: AbortController | null = null;
  private failures = 0;
  private wake: (() => void) | null = null;
  private quickClean = 0;
  /** Đóng sạch chưa có `lastEventId`: phát `stream.reset` khi byte đầu của kết nối kế tới (mốc `tail` an toàn). */
  private resetOnOpen = false;

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
    this.quickClean = 0;
    this.resetOnOpen = false;
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
      const outcome = await this.connectOnce(signal);
      if (outcome === "fatal" || signal.aborted) break;
      if (outcome === "clean") continue; // đóng sạch lúc hết hạn token: nối lại ngay, không banner
      if (outcome === "throttled") {
        // Vòng nóng (đóng sạch quá nhanh liên tiếp): giãn dần, giữ nguyên phase để banner không nháy.
        await this.wait(backoffDelay(this.quickClean - CLEAN_MAX_QUICK), signal);
        continue;
      }
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

  /** Một lượt kết nối: `fatal` = 401 sau refresh; `clean` = đã mở, server đóng sạch (không lỗi, không idle-timeout). */
  private async connectOnce(signal: AbortSignal): Promise<Outcome> {
    const startedAt = Date.now();
    let opened = false;
    let idled = false;
    const conn = new AbortController();
    const link = AbortSignal.any([signal, conn.signal]);
    let cancelIdle = () => {};
    const armIdle = () => {
      cancelIdle();
      cancelIdle = this.deps.setTimer(() => {
        idled = true;
        conn.abort();
      }, IDLE_TIMEOUT_MS);
    };
    const onBytes = () => {
      opened = true;
      this.markOpen();
      this.failures = 0;
      armIdle();
    };
    try {
      const body = await this.deps.open(this.store.get().lastEventId, link);
      armIdle();
      await this.deps.read(body, (raw) => this.handle(raw), onBytes, link);
      if (!opened || idled || signal.aborted) return "failed";
      return this.isCleanClose(startedAt) ? "clean" : "throttled";
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return "fatal";
      if (!isAbort(err) && import.meta.env?.DEV) console.warn("[me-stream] đứt", err);
      return "failed";
    } finally {
      cancelIdle();
      conn.abort();
    }
  }

  /** Đóng sạch liên tiếp quá nhanh (> 3 phiên dưới 5 s) thì false ⇒ giãn dần, tránh vòng lặp nóng. */
  private isCleanClose(startedAt: number): boolean {
    this.quickClean = Date.now() - startedAt >= CLEAN_MIN_LIFE_MS ? 0 : this.quickClean + 1;
    // Chưa có id nào để phát bù ⇒ server nối `tail`: nạp lại cache khi kết nối kế có byte đầu.
    if (this.store.get().lastEventId === null) this.resetOnOpen = true;
    return this.quickClean <= CLEAN_MAX_QUICK;
  }

  /**
   * Có byte đầu: phase `open`. Nối lại sau đứt mà chưa có `lastEventId` (chưa nhận sự kiện có id nào) thì server không
   * phát bù được → coi như `stream.reset` để router nạp lại cache (X2a-AC08: không mất tin lúc đứt).
   */
  private markOpen(): void {
    const { phase, lastEventId } = this.store.get();
    const pending = this.resetOnOpen;
    this.resetOnOpen = false;
    if (phase !== "open") this.store.setPhase("open");
    const gap = phase === "connecting" && this.deps.hasRoomsData?.() === true;
    const reconnected = (phase === "reconnecting" || phase === "down") && lastEventId === null;
    if (pending || gap || reconnected) this.deps.onEvent({ event: "stream.reset", data: {} });
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
