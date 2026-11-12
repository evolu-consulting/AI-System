// CR-132 · W1: MỘT kết nối `/me/stream` mỗi tab, dùng chung cho thẻ duyệt, ký số, cờ tính năng, tin nhắn (`msg.*`).
// Đăng ký theo tên sự kiện; kết nối mở khi có người nghe đầu tiên, đóng khi người nghe cuối huỷ. Đứt ⇒ nối lại giãn dần
// 1→30 s (không poll); 4xx trừ 408/429 ⇒ dừng (người nghe mới sau đó mở lại). Không import zod: nằm trong bundle đầu.
import { createSseParser } from "@ai/contracts/chat";
import { ApiError, apiResponse } from "@ai/web-kit/http";

export const RECONNECT_FIRST_MS = 1000;
export const RECONNECT_CAP_MS = 30_000;
export const reconnectDelay = (n: number): number =>
  Math.min(RECONNECT_FIRST_MS * 2 ** n, RECONNECT_CAP_MS);

/** 4xx (trừ 408/429) = nối lại cũng vô ích (401 sau refresh, 403 bị chặn, 404 hub cũ) ⇒ dừng; mạng/5xx/408/429 ⇒ nối lại. */
export const isFatalStreamError = (err: unknown): boolean =>
  err instanceof ApiError &&
  err.status >= 400 &&
  err.status < 500 &&
  err.status !== 408 &&
  err.status !== 429;

/** Khung SSE thô; người nghe tự parse `data` bằng schema của mình (module này không biết kiểu sự kiện). */
export type StreamFrame = { event: string; data: string };
export type FrameHandler = (frame: StreamFrame) => void;
/** Mở một kết nối, gọi `onOpen` khi nhận phản hồi, `onFrame` mỗi khung; trả về khi stream đóng / huỷ. */
export type StreamTransport = (
  signal: AbortSignal,
  onOpen: () => void,
  onFrame: FrameHandler,
) => Promise<void>;
export type Wait = (ms: number, signal: AbortSignal) => Promise<void>;

export type MeStream = {
  /** `onReconnected`: gọi khi kết nối LẠI sau đứt (có thể lỡ sự kiện ⇒ tải lại một lần). Trả hàm huỷ (idempotent). */
  subscribe(event: string, handler: FrameHandler, onReconnected?: () => void): () => void;
  /** Số kết nối đang mở/đang nối lại (0 hoặc 1) — cho test/đo. */
  active(): number;
};

export const fetchTransport: StreamTransport = async (signal, onOpen, onFrame) => {
  const res = await apiResponse("/me/stream", { headers: { Accept: "text/event-stream" }, signal });
  if (!res.body) throw new ApiError(res.status, "HTTP_ERROR", "Empty event stream");
  onOpen();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const feed = createSseParser((raw) => onFrame({ event: raw.event, data: raw.data }));
  signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
  for (;;) {
    const { done, value } = await reader.read();
    if (done || signal.aborted) return;
    feed(decoder.decode(value, { stream: true }));
  }
};

const timerWait: Wait = (ms, signal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export function createMeStream(deps: { transport?: StreamTransport; wait?: Wait } = {}): MeStream {
  const transport = deps.transport ?? fetchTransport;
  const wait = deps.wait ?? timerWait;
  const handlers = new Map<string, Set<FrameHandler>>();
  const reconnects = new Set<() => void>();
  let total = 0;
  let conn: AbortController | null = null;
  /** Dừng do lỗi 4xx ⇒ người nghe cũ có thể đã lỡ sự kiện; lần mở kế tiếp (kể cả do người nghe MỚI) phải báo `onReconnected` cho TẤT CẢ. */
  let needResync = false;

  const dispatch: FrameHandler = (f) => {
    for (const h of [...(handlers.get(f.event) ?? [])]) h(f);
  };

  async function loop(ac: AbortController): Promise<void> {
    const { signal } = ac;
    let failures = 0;
    let wasOpen = false;
    const onOpen = () => {
      if (wasOpen || needResync) {
        needResync = false;
        for (const r of [...reconnects]) r();
      }
      wasOpen = true;
      failures = 0;
    };
    while (!signal.aborted) {
      try {
        await transport(signal, onOpen, dispatch);
      } catch (err) {
        if (isFatalStreamError(err)) {
          needResync = true;
          break;
        }
      }
      if (signal.aborted) break;
      await wait(reconnectDelay(failures++), signal);
    }
    if (conn === ac) conn = null; // dừng do lỗi cuối cùng ⇒ người nghe mới mở lại được
  }

  function unsubscribeOne(event: string, handler: FrameHandler, r?: () => void): void {
    const set = handlers.get(event);
    if (!set?.delete(handler)) return;
    if (set.size === 0) handlers.delete(event);
    if (r) reconnects.delete(r);
    total--;
    if (total === 0 && conn) {
      conn.abort();
      conn = null;
    }
  }

  return {
    subscribe(event, handler, onReconnected) {
      // Bọc để cùng một hàm đăng ký hai lần vẫn là hai người nghe độc lập.
      const h: FrameHandler = (f) => handler(f);
      const r = onReconnected ? () => onReconnected() : undefined;
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(h);
      if (r) reconnects.add(r);
      total++;
      if (!conn) {
        conn = new AbortController();
        void loop(conn);
      }
      return () => unsubscribeOne(event, h, r);
    },
    active: () => (conn ? 1 : 0),
  };
}

/** Bộ phát duy nhất của tab. */
export const meStream: MeStream = createMeStream();

/**
 * Dạng "vòng nghe tới khi `signal` huỷ" cho code cũ: gom nhiều sự kiện, resolve khi huỷ.
 * `events` = tên sự kiện cần nghe; `onFrame` nhận khung thô.
 */
export function listenFrames(
  events: readonly string[],
  signal: AbortSignal,
  onFrame: FrameHandler,
  onReconnected: () => void,
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const offs = events.map((e, i) =>
      meStream.subscribe(e, onFrame, i === 0 ? onReconnected : undefined),
    );
    signal.addEventListener(
      "abort",
      () => {
        for (const off of offs) off();
        resolve();
      },
      { once: true },
    );
  });
}
