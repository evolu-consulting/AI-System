// HD-FR-24 · #218 · M3-decouple: hàng đợi BỀN lượt AI đọc HĐ trên Redis Streams (thay hàng đợi trong RAM + run engine).
// - `enqueue` = XADD (MAXLEN ~) một entry JSON `{t,u,c,a}`; gọi SAU commit.
// - Worker: consumer group, XREADGROUP BLOCK trên kết nối riêng (`duplicate`, chờ bằng tín hiệu — không poll DB), tối đa
//   `concurrency` job cùng lúc mỗi instance; xong ⇒ XACK + XDEL. Instance chết giữa chừng ⇒ entry còn trong PEL; instance khác
//   lấy lại bằng XAUTOCLAIM sau `claimIdleMs` (≥ hạn giờ một lượt AI). Lượt đọc idempotent (chỉ ghi khi HĐ còn `extracting`).
// - Khoá stream theo DB (`contracts:extract:<db>`) ⇒ nhiều DB test chung một Redis không lấy nhầm job của nhau.
import type { Redis } from "ioredis";
import type { ExtractJob, ExtractJobs } from "../application/approval.usecase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELD = "j";
const MAXLEN = 100_000;

export type ExtractStreamDeps = {
  redis: Redis;
  /** Khoá stream (đọc một lần lúc chạy — vd theo tên DB). */
  key: () => Promise<string>;
  group?: string;
  consumer: string;
  handle: (job: ExtractJob) => Promise<void>;
  concurrency?: number;
  /** Entry treo trong PEL lâu hơn mức này ⇒ instance khác nhận lại. */
  claimIdleMs?: number;
  blockMs?: number;
  log: { warn(msg: string, f?: Record<string, unknown>): void };
  signal?: AbortSignal;
  /** Test: tín hiệu sau khi entry đã ACK + XDEL. */
  onAcked?: (entryId: string) => void;
};
export type ExtractStream = ExtractJobs & {
  /** Bắt đầu worker (không chặn). */
  start(): void;
  /** Lượt nhận lại entry treo (XAUTOCLAIM) — trả số job đã nhận; test gọi thẳng. */
  reclaimOnce(): Promise<number>;
};

type Entry = [id: string, fields: string[]];
const pause = (ms: number) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    (t as { unref?: () => void }).unref?.();
  });

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

export function createExtractStream(d: ExtractStreamDeps): ExtractStream {
  const group = d.group ?? "contracts-extract";
  const limit = Math.max(1, d.concurrency ?? 2);
  const claimIdleMs = d.claimIdleMs ?? 10 * 60_000;
  let key: Promise<string> | null = null;
  const keyOf = () => {
    key ??= d.key();
    return key;
  };
  let running = 0;
  let freed: (() => void) | null = null;
  let groupReady: Promise<void> | null = null;

  const ensureGroup = async (k: string) => {
    groupReady ??= d.redis
      .xgroup("CREATE", k, group, "0", "MKSTREAM")
      .then(() => undefined)
      .catch((e: unknown) => {
        if (!String(e).includes("BUSYGROUP")) {
          groupReady = null;
          throw e;
        }
      });
    return groupReady;
  };

  const runEntry = (k: string, [id, fields]: Entry) => {
    running += 1;
    const job = parseJob(fieldOf(fields));
    const work = job ? d.handle(job) : Promise.resolve();
    void work
      .catch(() => d.log.warn("contract-extract-job-failed", { entry: id }))
      .then(() => d.redis.multi().xack(k, group, id).xdel(k, id).exec())
      .catch(() => d.log.warn("contract-extract-ack-failed", { entry: id }))
      .finally(() => {
        d.onAcked?.(id);
        running -= 1;
        const f = freed;
        freed = null;
        f?.();
      });
  };

  const reclaimOnce = async (): Promise<number> => {
    const k = await keyOf();
    await ensureGroup(k);
    const out = (await d.redis.call(
      "XAUTOCLAIM",
      k,
      group,
      d.consumer,
      String(claimIdleMs),
      "0-0",
      "COUNT",
      String(limit),
    )) as [string, Entry[]] | null;
    const entries = (out?.[1] ?? []).filter((e) => Array.isArray(e?.[1]));
    for (const e of entries) runEntry(k, e);
    return entries.length;
  };

  /** Chờ một job xong (tín hiệu từ `runEntry`), không poll. */
  const slotFreed = () =>
    new Promise<void>((res) => {
      freed = res;
    });

  /** Một lượt XREADGROUP BLOCK; lỗi Redis ⇒ nghỉ 1 s giữa hai lượt thử (không quay vòng nóng). */
  const readOnce = async (blocking: Redis, k: string, alive: () => boolean) => {
    const got = (await blocking
      .xreadgroup(
        "GROUP",
        group,
        d.consumer,
        "COUNT",
        limit - running,
        "BLOCK",
        d.blockMs ?? 2000,
        "STREAMS",
        k,
        ">",
      )
      .catch(() => "error" as const)) as [string, Entry[]][] | null | "error";
    if (got === "error") {
      if (alive()) await pause(1000);
      return;
    }
    for (const e of got?.[0]?.[1] ?? []) runEntry(k, e);
  };

  const loop = async () => {
    const k = await keyOf();
    await ensureGroup(k);
    const blocking = d.redis.duplicate();
    const stop = () => blocking.disconnect();
    d.signal?.addEventListener("abort", stop, { once: true });
    d.redis.once("end", stop);
    await blocking.connect();
    const alive = () => !d.signal?.aborted && (blocking.status as string) !== "end";
    let lastClaim = 0;
    while (alive()) {
      if (running >= limit) await slotFreed();
      else if (Date.now() - lastClaim >= claimIdleMs / 2) {
        lastClaim = Date.now();
        await reclaimOnce().catch(() => 0);
      } else await readOnce(blocking, k, alive);
    }
    stop();
  };

  // Kết nối riêng cho XADD của hàng đợi (tách khỏi client dùng chung: lệnh hàng đợi không chen vào pipeline quota của request).
  let producer: Promise<Redis> | null = null;
  const producerOf = () => {
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

  return {
    async enqueue(job) {
      const k = await keyOf();
      const redis = await producerOf();
      const body = JSON.stringify({
        t: job.tenantId,
        u: job.userId,
        c: job.contractId,
        a: job.approvalId,
      });
      await redis.xadd(k, "MAXLEN", "~", MAXLEN, "*", FIELD, body);
    },
    start() {
      void loop().catch(() => d.log.warn("contract-extract-worker-stopped", {}));
    },
    reclaimOnce,
  };
}
