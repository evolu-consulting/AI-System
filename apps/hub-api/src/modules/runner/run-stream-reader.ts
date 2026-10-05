// HUB-FR-89 · plan H1 §5.6 bước 3, §7 (2 kết nối chặn Redis/instance) · `RunStreamReader`: một kết nối chặn
// (`XREAD BLOCK 1000` multiplex) đọc `run:<run_id>` (Runtime XADD, field `e` = `RunEvent`) cho mọi job đang chờ.
import { RUN_STREAM_FIELD, type RunEvent, RunEventSchema, runStreamKey } from "@ai/contracts/hub";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { xreadPairs } from "../runs/sse/sse-reader";
import { compareStreamId } from "./runner.rules";

type StreamEntry = [id: string, fields: string[]];
type Sub = { key: string; last: string; push: (e: RunEvent) => void };

const BLOCK_MS = 1000;
const RETRY_MS = 500;
/** REVIEW 1 Hub #4: UNBLOCK tới trước khi `XREAD` chặn → thử lại (≤ ~125 ms, trong ngân sách delta đầu 150 ms). */
const UNBLOCK_TRIES = 6;
const UNBLOCK_GAP_MS = 25;

/** Entry sai contract → bỏ qua (log); Runtime chỉ XADD sự kiện đã validate. */
function parseRunEvent(fields: string[], log: Logger): RunEvent | null {
  const i = fields.indexOf(RUN_STREAM_FIELD);
  const raw = i >= 0 ? fields[i + 1] : undefined;
  if (raw === undefined) return null;
  try {
    const r = RunEventSchema.safeParse(JSON.parse(raw));
    if (r.success) return r.data;
  } catch {
    // rơi xuống log
  }
  log.warn("run-event-invalid");
  return null;
}

export class RunStreamReader {
  readonly #subs = new Set<Sub>();
  #conn: Redis | null = null;
  #running = false;
  /** H2b P11 (≤ 150 ms delta): `CLIENT ID` của kết nối chặn + khoá của `XREAD` đang chờ. */
  #connId: number | null = null;
  #reading: ReadonlySet<string> | null = null;
  #unblocking = false;

  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
    private readonly signal?: AbortSignal,
  ) {
    signal?.addEventListener("abort", () => this.#conn?.disconnect(), { once: true });
  }

  /**
   * Nhận sự kiện của `run:<runId>` có id > id cuối hiện có của stream (REVIEW 1 Hub #5: không đọc lại từ `0-0` mọi
   * sự kiện các job trước). Người gọi PHẢI `await` trước khi INSERT job — sự kiện của job mới (Runtime XADD sau khi claim)
   * luôn sau mốc nên không mất; người gọi lọc `job_id`. Đọc mốc lỗi → `0-0` (đúng như cũ, chỉ đọc lại thừa). Trả hàm huỷ.
   */
  async subscribe(runId: string, push: (e: RunEvent) => void): Promise<() => void> {
    const key = runStreamKey(runId);
    const sub: Sub = { key, last: await this.#tail(key), push };
    this.#subs.add(sub);
    if (!this.#running) void this.#loop();
    else void this.#unblock();
    return () => this.#subs.delete(sub);
  }

  /** Id entry cuối của stream (`XREVRANGE … COUNT 1`, kết nối thường); rỗng/lỗi → `0-0`. */
  async #tail(key: string): Promise<string> {
    try {
      const rows = (await this.redis.call("XREVRANGE", key, "+", "-", "COUNT", "1")) as
        | StreamEntry[]
        | null;
      return rows?.[0]?.[0] ?? "0-0";
    } catch (err) {
      this.log.warn("run-reader-tail", safeErrorFields(err));
      return "0-0";
    }
  }

  /** Có sub mà `XREAD` đang chờ không đọc khoá của nó (null `#reading` = không chờ: vòng sau tự lấy). */
  #stale(): boolean {
    const reading = this.#reading;
    if (!reading) return false;
    for (const s of this.#subs) if (!reading.has(s.key)) return true;
    return false;
  }

  /**
   * Khoá mới khi `XREAD BLOCK` đang chờ khoá cũ → `CLIENT UNBLOCK` (kết nối thường) để vòng đọc lấy khoá mới ngay, thay
   * vì chờ hết `BLOCK_MS` (sự kiện đầu của run — vd `job.delta` — trễ tới 1 s). REVIEW 1 Hub #4: `#reading` đặt TRƯỚC
   * khi lệnh `XREAD` tới Redis (hai kết nối khác nhau, không bảo đảm thứ tự) → UNBLOCK có thể tới sớm, trả 0; thử lại
   * ngắn (`UNBLOCK_TRIES` × `UNBLOCK_GAP_MS`) tới khi trả 1 hoặc vòng đọc đã lấy khoá mới. Lỗi chỉ log: còn hạn `BLOCK_MS`.
   */
  async #unblock(): Promise<void> {
    if (this.#unblocking) return;
    this.#unblocking = true;
    try {
      for (let i = 0; i < UNBLOCK_TRIES && this.#stale() && this.#connId !== null; i++) {
        if (i > 0) await Bun.sleep(UNBLOCK_GAP_MS);
        if (!this.#stale() || this.#connId === null) return;
        const n = await this.redis.call("CLIENT", "UNBLOCK", String(this.#connId));
        if (Number(n) === 1) return;
      }
    } catch (err) {
      this.log.warn("run-reader-unblock", safeErrorFields(err));
    } finally {
      this.#unblocking = false;
    }
  }

  /** REVIEW 1 Hub #4: `CLIENT ID` đổi sau mỗi lần ioredis nối lại → lấy lại ở mỗi `ready`; mất kết nối → null. */
  async #refreshId(conn: Redis): Promise<void> {
    const id = Number(await conn.call("CLIENT", "ID").catch(() => Number.NaN));
    if (this.#conn === conn || this.#conn === null) this.#connId = Number.isInteger(id) ? id : null;
  }

  async #connection(): Promise<Redis> {
    if (this.#conn) return this.#conn;
    const conn = this.redis.duplicate({ connectionName: "hub-api-run-reader" });
    conn.on("error", (err) => this.log.warn("run-reader-conn", safeErrorFields(err)));
    conn.on("ready", () => void this.#refreshId(conn));
    conn.on("close", () => {
      if (this.#conn === conn) this.#connId = null;
    });
    try {
      await conn.connect();
    } catch (err) {
      // Không để lại kết nối dở (ioredis tự nối lại) mỗi lần thử của vòng đọc.
      conn.disconnect();
      throw err;
    }
    // `CLIENT ID` lấy ở handler `ready` (cả lần nối đầu: ioredis phát `ready` trước khi `connect()` resolve).
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
          this.log.warn("run-reader-failed", safeErrorFields(err));
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
    const ids = keys.map((k) => from.get(k) ?? "0-0");
    this.#reading = new Set(keys);
    let res: unknown;
    try {
      res = await conn.call("XREAD", "BLOCK", BLOCK_MS, "STREAMS", ...keys, ...ids);
    } finally {
      this.#reading = null;
    }
    for (const [key, rows] of xreadPairs(res)) this.#dispatch(key, rows);
  }

  #dispatch(key: string, rows: StreamEntry[]): void {
    for (const s of this.#subs) {
      if (s.key !== key) continue;
      for (const [id, fields] of rows) {
        if (compareStreamId(id, s.last) <= 0) continue;
        s.last = id;
        const ev = parseRunEvent(fields, this.log);
        if (ev) s.push(ev);
      }
    }
  }
}
