// HD-FR-24 · #218 · M3-decouple: hàng đợi BỀN lượt AI đọc HĐ trên Redis Streams (thay hàng đợi trong RAM + run engine).
// - `enqueue` = XADD (MAXLEN ~) một entry JSON `{t,u,c,a}`; gọi SAU commit.
// - Worker: consumer group, XREADGROUP BLOCK trên kết nối riêng (`duplicate`, chờ bằng tín hiệu — không poll DB), tối đa
//   `concurrency` job cùng lúc mỗi instance; xong ⇒ XACK + XDEL. Instance chết giữa chừng ⇒ entry còn trong PEL; instance khác
//   lấy lại bằng XAUTOCLAIM sau `claimIdleMs` (≥ hạn giờ một lượt AI). Lượt đọc idempotent (chỉ ghi khi HĐ còn `extracting`).
// - Khoá stream theo DB (`contracts:extract:<db>`) ⇒ nhiều DB test chung một Redis không lấy nhầm job của nhau.
// - M3c (review B #5/#6/#10): worker tự chạy lại khi `loop()` lỗi (backoff tăng gấp đôi, dừng theo `signal`); Redis mất group
//   (restart không AOF, FLUSH) ⇒ NOGROUP ⇒ tạo lại group rồi đọc tiếp; entry giao quá `maxDeliveries` lần (làm crash/OOM tiến
//   trình) ⇒ bỏ (ACK + XDEL + log) — vòng quét STALE đóng HĐ. Mọi lỗi đều log + đếm (`stats()`), không nuốt im lặng.
import type { Redis } from "ioredis";
import type { ExtractJob, ExtractJobs } from "../application/approval.usecase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "j";
const MAXLEN = 100_000;

type Log = { warn(msg: string, f?: Record<string, unknown>): void };
export type ExtractStreamDeps = {
  redis: Redis;
  /** Khoá stream (đọc một lần lúc chạy — vd theo tên DB; lỗi ⇒ thử lại lần sau). */
  key: () => Promise<string>;
  group?: string;
  consumer: string;
  handle: (job: ExtractJob) => Promise<void>;
  concurrency?: number;
  /** Entry treo trong PEL lâu hơn mức này ⇒ instance khác nhận lại. */
  claimIdleMs?: number;
  blockMs?: number;
  /** Nghỉ trước lần thử lại đầu sau lỗi Redis / worker dừng vì lỗi (ms; gấp đôi mỗi lần tới `maxRetryMs`). */
  retryMs?: number;
  maxRetryMs?: number;
  /** Số lần giao tối đa một entry (XAUTOCLAIM tăng bộ đếm); vượt ⇒ entry độc, bỏ. */
  maxDeliveries?: number;
  log: Log;
  signal?: AbortSignal;
  /** Test: tín hiệu sau khi entry đã ACK + XDEL. */
  onAcked?: (entryId: string) => void;
  /** Test/số đo: tín hiệu mỗi lần worker dừng vì lỗi (trước khi nghỉ rồi chạy lại). */
  onWorkerError?: (attempt: number) => void;
};
export type ExtractStreamStats = { restarts: number; groupRecreated: number; poison: number };
export type ExtractStream = ExtractJobs & {
  /** Bắt đầu worker (không chặn); lỗi ⇒ tự chạy lại có backoff tới khi `signal` huỷ. */
  start(): void;
  /** Lượt nhận lại entry treo (XAUTOCLAIM) — trả số job đã nhận; test gọi thẳng. */
  reclaimOnce(): Promise<number>;
  /** Bộ đếm lỗi (số đo): lần worker chạy lại, lần tạo lại group, entry độc đã bỏ. */
  stats(): ExtractStreamStats;
};

type Entry = [id: string, fields: string[]];
/** Nghỉ giữa hai lần thử (vòng nền khi lỗi); `signal` huỷ ⇒ dừng ngay. */
const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => {
    if (signal?.aborted) return res();
    const t = setTimeout(done, ms);
    (t as { unref?: () => void }).unref?.();
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      res();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
/** Group mất: NOGROUP (FLUSH/restart), hoặc khoá stream bị xoá khi đang BLOCK (Redis 7: UNBLOCKED). */
export const groupLost = (e: unknown): boolean => /NOGROUP|no longer exists/i.test(String(e));
const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

export function parseJob(raw: string | undefined): ExtractJob | null {
  try {
    const o = JSON.parse(raw ?? "") as Record<string, unknown>;
    const ok = (v: unknown) => typeof v === "string" && UUID.test(v);
    if (!ok(o.t) || !ok(o.u) || !ok(o.c) || !(o.a === null || ok(o.a))) return null;
    return {
      tenantId: o.t as string,
      userId: o.u as string,
      contractId: o.c as string,
      approvalId: (o.a as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

const fieldOf = (fields: string[]): string | undefined => {
  const i = fields.indexOf(FIELD);
  return i >= 0 ? fields[i + 1] : undefined;
};

type Ctx = {
  d: ExtractStreamDeps;
  group: string;
  limit: number;
  claimIdleMs: number;
  stats: ExtractStreamStats;
  running: number;
  freed: (() => void) | null;
  groupReady: Promise<void> | null;
};

function ensureGroup(c: Ctx, k: string): Promise<void> {
  c.groupReady ??= c.d.redis
    .xgroup("CREATE", k, c.group, "0", "MKSTREAM")
    .then(() => undefined)
    .catch((e: unknown) => {
      if (!String(e).includes("BUSYGROUP")) {
        c.groupReady = null;
        throw e;
      }
    });
  return c.groupReady;
}

/** Chạy `fn` khi group đã có; NOGROUP ⇒ tạo lại group (log + đếm) rồi chạy lại MỘT lần. */
async function withGroup<T>(c: Ctx, k: string, fn: () => Promise<T>): Promise<T> {
  await ensureGroup(c, k);
  try {
    return await fn();
  } catch (e) {
    if (!groupLost(e)) throw e;
    c.groupReady = null;
    c.stats.groupRecreated += 1;
    c.d.log.warn("contract-extract-group-recreated", { group: c.group });
    await ensureGroup(c, k);
    return fn();
  }
}

/** ACK + XDEL rồi báo slot rảnh (tín hiệu cho vòng chờ). */
function ackEntry(c: Ctx, k: string, id: string, work: Promise<unknown>): void {
  void work
    .catch(() => c.d.log.warn("contract-extract-job-failed", { entry: id }))
    .then(() => c.d.redis.multi().xack(k, c.group, id).xdel(k, id).exec())
    .catch(() => c.d.log.warn("contract-extract-ack-failed", { entry: id }))
    .finally(() => {
      c.d.onAcked?.(id);
      c.running -= 1;
      const f = c.freed;
      c.freed = null;
      f?.();
    });
}

function runEntry(c: Ctx, k: string, [id, fields]: Entry): void {
  c.running += 1;
  const job = parseJob(fieldOf(fields));
  ackEntry(c, k, id, job ? c.d.handle(job) : Promise.resolve());
}

/** Số lần giao của các entry vừa nhận (một pipeline XPENDING cho cả lô). */
async function deliveriesOf(c: Ctx, k: string, ids: string[]): Promise<number[]> {
  const p = c.d.redis.pipeline();
  for (const id of ids) p.xpending(k, c.group, id, id, 1);
  const out = (await p.exec()) ?? [];
  return out.map(([, r]) =>
    Number((r as [[string, string, number, number]] | null)?.[0]?.[3] ?? 0),
  );
}

async function reclaim(c: Ctx, k: string): Promise<number> {
  const out = (await withGroup(c, k, () =>
    c.d.redis.call(
      "XAUTOCLAIM",
      k,
      c.group,
      c.d.consumer,
      String(c.claimIdleMs),
      "0-0",
      "COUNT",
      String(c.limit),
    ),
  )) as [string, Entry[]] | null;
  const entries = (out?.[1] ?? []).filter((e) => Array.isArray(e?.[1]));
  if (entries.length === 0) return 0;
  const max = c.d.maxDeliveries ?? 5;
  const counts = await deliveriesOf(
    c,
    k,
    entries.map((e) => e[0]),
  );
  for (const [i, e] of entries.entries()) {
    if ((counts[i] ?? 0) <= max) {
      runEntry(c, k, e);
      continue;
    }
    c.stats.poison += 1;
    c.d.log.warn("contract-extract-poison", { entry: e[0], deliveries: counts[i] });
    c.running += 1;
    ackEntry(c, k, e[0], Promise.resolve());
  }
  return entries.length;
}

/** Một lượt XREADGROUP BLOCK; NOGROUP ⇒ tạo lại group; lỗi Redis khác ⇒ ném (vòng ngoài nghỉ có backoff). */
async function readOnce(c: Ctx, blocking: Redis, k: string): Promise<void> {
  const got = (await withGroup(c, k, () =>
    blocking.xreadgroup(
      "GROUP",
      c.group,
      c.d.consumer,
      "COUNT",
      c.limit - c.running,
      "BLOCK",
      c.d.blockMs ?? 2000,
      "STREAMS",
      k,
      ">",
    ),
  )) as [string, Entry[]][] | null;
  for (const e of got?.[0]?.[1] ?? []) runEntry(c, k, e);
}

/** Chờ một job xong (tín hiệu từ `ackEntry`), không poll. */
const slotFreed = (c: Ctx) =>
  new Promise<void>((res) => {
    c.freed = res;
  });

/** Vòng worker trên một kết nối BLOCK riêng; lỗi Redis ⇒ nghỉ `retry` (backoff) rồi đọc tiếp; trả về khi huỷ/kết nối đóng. */
async function loop(c: Ctx, k: string, onReady: () => void): Promise<void> {
  await ensureGroup(c, k);
  const blocking = c.d.redis.duplicate();
  const stop = () => blocking.disconnect();
  c.d.signal?.addEventListener("abort", stop, { once: true });
  c.d.redis.once("end", stop);
  try {
    await blocking.connect();
    onReady();
    const alive = () => !c.d.signal?.aborted && (blocking.status as string) !== "end";
    let lastClaim = 0;
    let delay = c.d.retryMs ?? 1000;
    while (alive()) {
      try {
        if (c.running >= c.limit) await slotFreed(c);
        else if (Date.now() - lastClaim >= c.claimIdleMs / 2) {
          lastClaim = Date.now();
          await reclaim(c, k);
        } else await readOnce(c, blocking, k);
        delay = c.d.retryMs ?? 1000;
      } catch (e) {
        if (!alive()) break;
        c.d.log.warn("contract-extract-redis-failed", { error: errName(e), retry_ms: delay });
        await pause(delay, c.d.signal);
        delay = Math.min(delay * 2, c.d.maxRetryMs ?? 30_000);
      }
    }
  } finally {
    c.d.signal?.removeEventListener("abort", stop);
    c.d.redis.off("end", stop);
    stop();
  }
}

/** Giám sát: `loop()` lỗi (Redis down lúc khởi động, XGROUP CREATE, đọc khoá) ⇒ log + đếm + nghỉ (backoff) rồi chạy lại. */
async function supervise(c: Ctx, keyOf: () => Promise<string>): Promise<void> {
  const base = c.d.retryMs ?? 1000;
  let delay = base;
  let attempt = 0;
  while (!c.d.signal?.aborted && c.d.redis.status !== "end") {
    try {
      await loop(c, await keyOf(), () => {
        delay = base;
      });
      return;
    } catch (e) {
      attempt += 1;
      c.stats.restarts += 1;
      c.d.log.warn("contract-extract-worker-failed", {
        attempt,
        error: errName(e),
        retry_ms: delay,
      });
      c.d.onWorkerError?.(attempt);
      await pause(delay, c.d.signal);
      delay = Math.min(delay * 2, c.d.maxRetryMs ?? 30_000);
    }
  }
}

/** Kết nối riêng cho XADD của hàng đợi (tách khỏi client dùng chung: lệnh hàng đợi không chen vào pipeline quota). */
function producerOf(d: ExtractStreamDeps) {
  let producer: Promise<Redis> | null = null;
  return () => {
    producer ??= (async () => {
      const p = d.redis.duplicate();
      const close = () => p.disconnect();
      d.signal?.addEventListener("abort", close, { once: true });
      d.redis.once("end", close);
      await p.connect();
      return p;
    })().catch((e: unknown) => {
      producer = null;
      throw e;
    });
    return producer;
  };
}

export function createExtractStream(d: ExtractStreamDeps): ExtractStream {
  const c: Ctx = {
    d,
    group: d.group ?? "contracts-extract",
    limit: Math.max(1, d.concurrency ?? 2),
    claimIdleMs: d.claimIdleMs ?? 10 * 60_000,
    stats: { restarts: 0, groupRecreated: 0, poison: 0 },
    running: 0,
    freed: null,
    groupReady: null,
  };
  let key: Promise<string> | null = null;
  const keyOf = () => {
    key ??= d.key().catch((e: unknown) => {
      key = null;
      throw e;
    });
    return key;
  };
  const producer = producerOf(d);
  return {
    async enqueue(job) {
      const k = await keyOf();
      const redis = await producer();
      const body = JSON.stringify({
        t: job.tenantId,
        u: job.userId,
        c: job.contractId,
        a: job.approvalId,
      });
      await redis.xadd(k, "MAXLEN", "~", MAXLEN, "*", FIELD, body);
    },
    start() {
      void supervise(c, keyOf);
    },
    reclaimOnce: async () => reclaim(c, await keyOf()),
    stats: () => ({ ...c.stats }),
  };
}
