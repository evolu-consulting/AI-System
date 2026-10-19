// HD-FR-24 · HD-FR-25 · D2-01 · D2-02 · review Trung 4: `ExtractionStarter` thật — thay no-op HD1. `start` chỉ xếp hàng (không
// chờ AI, upload trả ngay); tối đa `concurrency` lượt chạy cùng lúc mỗi instance; HĐ đã trong hàng ⇒ bỏ trùng. Không sleep/poll:
// lượt xong kéo lượt kế. `scheduleTaxRetry` hẹn MỘT bộ hẹn giờ mỗi HĐ tới đúng giờ cổng MST cho phép (khe 2 s / hết nghỉ 429)
// rồi xếp lượt `refresh` vào cùng hàng. `onSettled` (test) nhận kết cục lượt trích; `idle()` resolve khi hàng rỗng.
import type { PackWho } from "../../kit/application/ports";
import type { ExtractionOutcome, RunExtraction } from "./run-extraction.usecase";
import type { RefreshParties, TaxRetryScheduler } from "./tax-parties";
import type { ExtractionStarter } from "./upload-contract.ports";

export type ExtractionQueueDeps = {
  run: RunExtraction;
  /** Lượt tra lại MST (vắng ⇒ hẹn bị bỏ qua). */
  refresh?: RefreshParties;
  concurrency?: number;
  /** Trần hàng chờ mỗi instance; vượt ⇒ bỏ + log: HĐ còn `extracting` (TECH-DEBT #218, chờ run engine bền). */
  maxQueued?: number;
  log?: { warn(msg: string, fields?: Record<string, unknown>): void };
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
  /** Test: đồng hồ + hẹn giờ giả. */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => void;
};
export type ExtractionQueue = ExtractionStarter & {
  scheduleTaxRetry: TaxRetryScheduler;
  idle(): Promise<void>;
  size(): number;
};

type Job = { kind: "extract" | "tax"; who: PackWho; id: string; attempt: number };

/** Một lượt; lỗi bất kỳ ⇒ log (không lộ nội dung) + `onSettled("error")`, không ném. */
async function runSafely(d: ExtractionQueueDeps, job: Job): Promise<void> {
  try {
    if (job.kind === "tax") await d.refresh?.(job.who, job.id, job.attempt);
    else {
      // Gọi `run` TRƯỚC: `d.onSettled?.(id, await run())` sẽ bỏ qua cả `run` khi không có hook (`?.` không tính đối số).
      const out = await d.run(job.who, job.id);
      d.onSettled?.(job.id, out);
    }
  } catch (e) {
    d.log?.warn("contract-extraction-failed", {
      contract_id: job.id,
      error: e instanceof Error ? e.name : "unknown",
    });
    if (job.kind === "extract") d.onSettled?.(job.id, "error");
  }
}

const defaultTimer = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  (t as { unref?: () => void }).unref?.();
};

/** Một bộ hẹn giờ mỗi HĐ tới đúng giờ cổng MST cho phép, rồi xếp lượt `tax` vào hàng (không ngủ chờ, không poll). */
function taxRetryScheduler(d: ExtractionQueueDeps, push: (j: Job) => void): TaxRetryScheduler {
  const now = d.now ?? Date.now;
  const setTimer = d.setTimer ?? defaultTimer;
  const planned = new Set<string>();
  return (who, id, at, attempt) => {
    if (!d.refresh || planned.has(id)) return;
    planned.add(id);
    setTimer(
      () => {
        planned.delete(id);
        push({ kind: "tax", who, id, attempt });
      },
      Math.max(0, at - now()),
    );
  };
}

export function createExtractionQueue(d: ExtractionQueueDeps): ExtractionQueue {
  const limit = Math.max(1, d.concurrency ?? 2);
  const maxQueued = d.maxQueued ?? 1000;
  const waiting: Job[] = [];
  const known = new Set<string>();
  let running = 0;
  let idleWaiters: (() => void)[] = [];
  const keyOf = (j: Pick<Job, "kind" | "id">) => `${j.kind}:${j.id}`;

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
      void runSafely(d, job).finally(() => {
        running -= 1;
        known.delete(keyOf(job));
        pump();
        settleIdle();
      });
    }
  };
  const push = (job: Job) => {
    if (known.has(keyOf(job))) return;
    if (waiting.length >= maxQueued) {
      d.log?.warn("contract-extraction-queue-full", { contract_id: job.id });
      return;
    }
    known.add(keyOf(job));
    waiting.push(job);
    pump();
  };

  return {
    start: async (who, id) => push({ kind: "extract", who, id, attempt: 0 }),
    scheduleTaxRetry: taxRetryScheduler(d, push),
    idle: () =>
      running === 0 && waiting.length === 0
        ? Promise.resolve()
        : new Promise<void>((res) => idleWaiters.push(res)),
    size: () => waiting.length + running,
  };
}
