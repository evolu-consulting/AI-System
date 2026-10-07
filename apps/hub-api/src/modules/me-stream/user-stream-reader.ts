// HUB-FR-99 · HUB-BR-22 · đọc `ustream:<user_id>` cho `/me/stream` (X2a plan §7, D11–D12; mẫu `runs/sse/sse-reader.ts`):
// XRANGE phần cần phát lại + một kết nối chặn dùng chung (`XREAD BLOCK 1000` multiplex mọi user đang nối trên instance).
// Entry sai contract ⇒ bỏ + `warn user-event-invalid` (không log nội dung, R24). Không pub/sub bộ nhớ ⇒ đúng nhiều instance.
import { type MeStreamEvent, parseMeStreamEvent } from "@ai/contracts/chat";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { USER_STREAM_FIELD, userStreamKey } from "../../lib/user-stream";
import { compareStreamId } from "../runner/runner.rules";
import { xreadPairs } from "../runs/sse/sse-reader";
import type { StreamInfo } from "./me-stream.rules";

/** Một sự kiện đã đánh id Redis Stream (`stream.reset` không bao giờ đến từ Redis). */
export type UserEntry = { id: string; ev: MeStreamEvent };
type StreamEntry = [id: string, fields: string[]];
type Sub = { key: string; last: string; push: (e: UserEntry[]) => void };

const BLOCK_MS = 1000;
const RETRY_MS = 500;

export class UserStreamReader {
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

  /** `XINFO STREAM`; key không tồn tại ⇒ null. */
  async info(userId: string): Promise<StreamInfo | null> {
    let res: unknown;
    try {
      res = await this.redis.call("XINFO", "STREAM", userStreamKey(userId));
    } catch (err) {
      if (err instanceof Error && /no such key/i.test(err.message)) return null;
      throw err;
    }
    return streamInfoOf(res);
  }

  /** Id cuối hiện có (`0-0` khi rỗng/không có key) — điểm bắt đầu "tail". */
  async lastId(userId: string): Promise<string> {
    const rows = (await this.redis.call(
      "XREVRANGE",
      userStreamKey(userId),
      "+",
      "-",
      "COUNT",
      "1",
    )) as StreamEntry[] | null;
    return rows?.[0]?.[0] ?? "0-0";
  }

  /** Phần đã có, id > `after`. */
  async range(userId: string, after: string): Promise<UserEntry[]> {
    const rows = (await this.redis.call("XRANGE", userStreamKey(userId), `(${after}`, "+")) as
      | StreamEntry[]
      | null;
    return this.#entries(rows, after);
  }

  /** Nhận entry id > `after` mới tới; trả hàm huỷ đăng ký. */
  subscribe(userId: string, after: string, push: (e: UserEntry[]) => void): () => void {
    const sub: Sub = { key: userStreamKey(userId), last: after, push };
    this.#subs.add(sub);
    if (!this.#running) void this.#loop();
    return () => this.#subs.delete(sub);
  }

  #entries(rows: StreamEntry[] | null | undefined, after: string): UserEntry[] {
    const out: UserEntry[] = [];
    for (const [id, fields] of rows ?? []) {
      if (compareStreamId(id, after) <= 0) continue;
      const ev = parseFields(fields);
      if (ev) out.push({ id, ev });
      else this.log.warn("user-event-invalid", { id });
    }
    return out;
  }

  async #connection(): Promise<Redis> {
    if (this.#conn) return this.#conn;
    const conn = this.redis.duplicate({ connectionName: "hub-api-user-reader" });
    conn.on("error", (err) => this.log.warn("user-reader-conn", safeErrorFields(err)));
    try {
      await conn.connect();
    } catch (err) {
      conn.disconnect();
      throw err;
    }
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
          this.log.warn("user-reader-failed", safeErrorFields(err));
          await Bun.sleep(RETRY_MS);
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async #readOnce(conn: Redis): Promise<void> {
    const from = new Map<string, string>();
    for (const s of this.#subs) {
      const cur = from.get(s.key);
      if (cur === undefined || compareStreamId(s.last, cur) < 0) from.set(s.key, s.last);
    }
    const keys = [...from.keys()];
    if (keys.length === 0) return;
    const ids = keys.map((k) => from.get(k) as string);
    const res = await conn.call("XREAD", "BLOCK", BLOCK_MS, "STREAMS", ...keys, ...ids);
    for (const [key, rows] of xreadPairs(res)) {
      for (const s of this.#subs) {
        if (s.key !== key) continue;
        const fresh = this.#entries(rows, s.last);
        const top = fresh.at(-1);
        if (!top) continue;
        s.last = top.id;
        s.push(fresh);
      }
    }
  }
}

/** Field `e` = JSON `{event, data}` → sự kiện đúng contract (trừ `stream.reset`), sai ⇒ null. */
export function parseFields(fields: string[]): MeStreamEvent | null {
  const i = fields.indexOf(USER_STREAM_FIELD);
  const raw = i >= 0 ? fields[i + 1] : undefined;
  if (raw === undefined) return null;
  let body: { event?: unknown; data?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body?.event !== "string" || body.event === "stream.reset") return null;
  return parseMeStreamEvent(body.event, JSON.stringify(body.data ?? null));
}

function toMap(res: unknown): Map<unknown, unknown> {
  if (res instanceof Map) return res;
  if (Array.isArray(res)) {
    const m = new Map<unknown, unknown>();
    for (let i = 0; i + 1 < res.length; i += 2) m.set(String(res[i]), res[i + 1]);
    return m;
  }
  return new Map(res && typeof res === "object" ? Object.entries(res) : []);
}

/**
 * Trả lời `XINFO STREAM` (mảng phẳng RESP2 hoặc map RESP3) → `StreamInfo`. Redis 7.4 KHÔNG cập nhật
 * `max-deleted-entry-id` khi cắt bằng `MAXLEN` (chỉ XDEL — đo thật, plan §16 B7) ⇒ `maxDeleted` hiệu lực = max(XDEL,
 * mốc cắt): đã cắt (`entries-added > length`) thì mọi id < entry đầu còn giữ có thể đã mất (rỗng ⇒ mốc = id cuối).
 */
export function streamInfoOf(res: unknown): StreamInfo {
  const m = toMap(res);
  const get = (name: string): string | undefined => {
    const v = m.get(name);
    return v === undefined || v === null ? undefined : String(v);
  };
  const lastGenerated = get("last-generated-id") ?? "0-0";
  const xdel = get("max-deleted-entry-id") ?? "0-0";
  const length = Number(get("length") ?? 0);
  const added = Number(get("entries-added") ?? length);
  if (added <= length) return { lastGenerated, maxDeleted: xdel };
  const first = length > 0 ? (get("recorded-first-entry-id") ?? firstEntryId(m)) : lastGenerated;
  const cut = first ?? lastGenerated;
  return { lastGenerated, maxDeleted: compareStreamId(cut, xdel) > 0 ? cut : xdel };
}

function firstEntryId(m: Map<unknown, unknown>): string | undefined {
  const e = m.get("first-entry");
  return Array.isArray(e) && typeof e[0] === "string" ? e[0] : undefined;
}
