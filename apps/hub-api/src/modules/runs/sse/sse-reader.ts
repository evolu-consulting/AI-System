// HUB-FR-42 · HUB-NFR-02 · H1-R12 · P9 · đọc `sse:<run_id>` cho E12/E13 (plan §5.3): XRANGE phần đã có rồi theo dõi
// bằng một kết nối chặn dùng chung (`XREAD BLOCK 1000` multiplex mọi run đang có người xem trên instance), `: ping` 15 s.
import { SSE_HEARTBEAT_S, SSE_PING_FRAME } from "@ai/contracts/chat";
import { safeErrorFields } from "../../../lib/errors";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import { isTerminalEvent, parseEntry, type SseEventBody, sseKey } from "./sse-writer";

export type SseEntry = SseEventBody & { seq: number };
type StreamEntry = [id: string, fields: string[]];
type Sub = { key: string; last: number; push: (e: SseEntry[]) => void };

const BLOCK_MS = 1000;
const RETRY_MS = 500;

function toEntries(rows: StreamEntry[] | null | undefined, after: number): SseEntry[] {
  const out: SseEntry[] = [];
  for (const [id, fields] of rows ?? []) {
    const seq = Number.parseInt(id, 10);
    const ev = parseEntry(fields);
    if (ev && seq > after) out.push({ ...ev, seq });
  }
  return out;
}

/**
 * Trả lời XREAD → cặp `[key, rows]`. RESP2: `[[key, rows], …]`; RESP3 (mặc định ioredis 6, kiểu "legacy"): map phẳng
 * `[key, rows, key, rows, …]`.
 */
export function xreadPairs(res: unknown): [string, StreamEntry[]][] {
  if (!Array.isArray(res) || res.length === 0) return [];
  if (Array.isArray(res[0])) return res as [string, StreamEntry[]][];
  const out: [string, StreamEntry[]][] = [];
  for (let i = 0; i + 1 < res.length; i += 2)
    out.push([String(res[i]), res[i + 1] as StreamEntry[]]);
  return out;
}

/** Một kết nối chặn (`redis.duplicate()`) cho mọi người xem; vòng XREAD chạy khi còn người đăng ký. */
export class SseReader {
  readonly #subs = new Set<Sub>();
  #conn: Redis | null = null;
  #running = false;

  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
    private readonly signal?: AbortSignal,
  ) {
    signal?.addEventListener("abort", () => this.#conn?.disconnect(), { once: true });
  }

  /** Phần đã có của stream, `seq > after`. */
  async range(runId: string, after: number): Promise<SseEntry[]> {
    const rows = (await this.redis.call("XRANGE", sseKey(runId), `(${after}-0`, "+")) as
      | StreamEntry[]
      | null;
    return toEntries(rows, after);
  }

  /** Nhận các entry `seq > after` mới tới; trả hàm huỷ đăng ký. */
  subscribe(runId: string, after: number, push: (e: SseEntry[]) => void): () => void {
    const sub: Sub = { key: sseKey(runId), last: after, push };
    this.#subs.add(sub);
    if (!this.#running) void this.#loop();
    return () => this.#subs.delete(sub);
  }

  async #connection(): Promise<Redis> {
    if (this.#conn) return this.#conn;
    const conn = this.redis.duplicate({ connectionName: "hub-api-sse-reader" });
    conn.on("error", (err) => this.log.warn("sse-reader-conn", safeErrorFields(err)));
    await conn.connect();
    this.#conn = conn;
    return conn;
  }

  async #loop(): Promise<void> {
    this.#running = true;
    try {
      while (this.#subs.size > 0 && !this.signal?.aborted) {
        try {
          await this.#readOnce(await this.#connection());
        } catch (err) {
          if (this.signal?.aborted) break;
          this.log.warn("sse-reader-failed", safeErrorFields(err));
          await Bun.sleep(RETRY_MS);
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #readOnce(conn: Redis): Promise<void> {
    const from = new Map<string, number>();
    for (const s of this.#subs) from.set(s.key, Math.min(from.get(s.key) ?? s.last, s.last));
    const keys = [...from.keys()];
    const ids = keys.map((k) => `${from.get(k)}-0`);
    const res = await conn.call("XREAD", "BLOCK", BLOCK_MS, "STREAMS", ...keys, ...ids);
    for (const [key, rows] of xreadPairs(res)) {
      for (const s of this.#subs) {
        if (s.key !== key) continue;
        const fresh = toEntries(rows, s.last);
        const top = fresh.at(-1);
        if (!top) continue;
        s.last = top.seq;
        s.push(fresh);
      }
    }
  }
}

export const sseFrame = (e: SseEntry): string =>
  `id: ${e.seq}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;

export type RunEventStreamOpts = {
  reader: SseReader;
  runId: string;
  after: number;
  /** Run đã kết thúc trong DB mà stream thiếu sự kiện kết thúc → phát bù ("XADD bên ngoài", §5.3). */
  ensureTerminal: () => Promise<void>;
  log: Logger;
  pingMs?: number;
};

/**
 * Stream SSE của một run: entry `seq > after` rồi theo dõi tới sự kiện kết thúc (đóng stream). Mỗi nhịp ping cũng
 * gọi `ensureTerminal` (chủ chết sau COMMIT trước XADD). Client ngắt → huỷ đăng ký, run vẫn chạy (HUB-FR-42).
 */
export function runEventStream(o: RunEventStreamOpts): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let stop = () => {};
  return new ReadableStream<Uint8Array>({
    start(ctl) {
      let last = o.after;
      let closed = false;
      let unsub = () => {};
      const ping = setInterval(
        () => {
          if (closed) return;
          ctl.enqueue(enc.encode(SSE_PING_FRAME));
          o.ensureTerminal().catch((err) => o.log.warn("sse-ensure-failed", safeErrorFields(err)));
        },
        o.pingMs ?? SSE_HEARTBEAT_S * 1000,
      );
      stop = () => {
        closed = true;
        clearInterval(ping);
        unsub();
      };
      const push = (entries: SseEntry[]) => {
        for (const e of entries) {
          if (closed || e.seq <= last) continue;
          last = e.seq;
          ctl.enqueue(enc.encode(sseFrame(e)));
          if (isTerminalEvent(e.event)) {
            stop();
            ctl.close();
          }
        }
      };
      return (async () => {
        push(await o.reader.range(o.runId, o.after));
        if (closed) return;
        unsub = o.reader.subscribe(o.runId, last, push);
        await o.ensureTerminal();
      })().catch((err) => {
        stop();
        ctl.error(err);
      });
    },
    cancel() {
      stop();
    },
  });
}
