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

  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
    private readonly signal?: AbortSignal,
  ) {
    signal?.addEventListener("abort", () => this.#conn?.disconnect(), { once: true });
  }

  /**
   * Nhận mọi sự kiện của `run:<runId>` từ đầu stream (đăng ký trước hay sau INSERT job đều không mất sự kiện); người gọi
   * lọc `job_id`. Trả hàm huỷ đăng ký.
   */
  subscribe(runId: string, push: (e: RunEvent) => void): () => void {
    const sub: Sub = { key: runStreamKey(runId), last: "0-0", push };
    this.#subs.add(sub);
    if (!this.#running) void this.#loop();
    return () => this.#subs.delete(sub);
  }

  async #connection(): Promise<Redis> {
    if (this.#conn) return this.#conn;
    const conn = this.redis.duplicate({ connectionName: "hub-api-run-reader" });
    conn.on("error", (err) => this.log.warn("run-reader-conn", safeErrorFields(err)));
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
    const res = await conn.call("XREAD", "BLOCK", BLOCK_MS, "STREAMS", ...keys, ...ids);
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
