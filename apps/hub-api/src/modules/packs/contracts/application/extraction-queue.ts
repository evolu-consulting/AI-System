// HD-FR-24 · D2-01 · D2-02: `ExtractionStarter` thật — thay no-op HD1. `start` chỉ xếp hàng (không chờ AI, upload trả ngay);
// tối đa `concurrency` lượt chạy cùng lúc mỗi instance; HĐ đã trong hàng ⇒ bỏ trùng. Không sleep/poll: lượt xong kéo lượt kế.
// `onSettled` (test) nhận kết cục từng HĐ; `idle()` resolve khi hàng rỗng và không còn lượt chạy.
import type { PackWho } from "../../kit/application/ports";
import type { ExtractionOutcome, RunExtraction } from "./run-extraction.usecase";
import type { ExtractionStarter } from "./upload-contract.ports";

export type ExtractionQueueDeps = {
  run: RunExtraction;
  concurrency?: number;
  /** Trần hàng chờ mỗi instance; vượt ⇒ bỏ + log: HĐ còn `extracting` (TECH-DEBT #218, chờ run engine bền). */
  maxQueued?: number;
  log?: { warn(msg: string, fields?: Record<string, unknown>): void };
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
};
export type ExtractionQueue = ExtractionStarter & { idle(): Promise<void>; size(): number };

type Job = { who: PackWho; id: string };

/** Một lượt; lỗi bất kỳ ⇒ log (không lộ nội dung) + `onSettled("error")`, không ném. */
async function runSafely(d: ExtractionQueueDeps, job: Job): Promise<void> {
  try {
    d.onSettled?.(job.id, await d.run(job.who, job.id));
  } catch (e) {
    d.log?.warn("contract-extraction-failed", {
      contract_id: job.id,
      error: e instanceof Error ? e.name : "unknown",
    });
    d.onSettled?.(job.id, "error");
  }
}

export function createExtractionQueue(d: ExtractionQueueDeps): ExtractionQueue {
  const limit = Math.max(1, d.concurrency ?? 2);
  const maxQueued = d.maxQueued ?? 1000;
  const waiting: Job[] = [];
  const known = new Set<string>();
  let running = 0;
  let idleWaiters: (() => void)[] = [];

  const settleIdle = () => {
    if (running > 0 || waiting.length > 0) return;
    const w = idleWaiters;
    idleWaiters = [];
    for (const f of w) f();
  };
  const pump = () => {
    while (running < limit && waiting.length > 0) {
      const job = waiting.shift() as Job;
      running += 1;
      void runOne(job).finally(() => {
        running -= 1;
        known.delete(job.id);
        pump();
        settleIdle();
      });
    }
  };
  const runOne = (job: Job) => runSafely(d, job);

  return {
    start: async (who, id) => {
      if (known.has(id)) return;
      if (waiting.length >= maxQueued) {
        d.log?.warn("contract-extraction-queue-full", { contract_id: id });
        return;
      }
      known.add(id);
      waiting.push({ who, id });
      pump();
    },
    idle: () =>
      running === 0 && waiting.length === 0
        ? Promise.resolve()
        : new Promise<void>((res) => idleWaiters.push(res)),
    size: () => waiting.length + running,
  };
}
