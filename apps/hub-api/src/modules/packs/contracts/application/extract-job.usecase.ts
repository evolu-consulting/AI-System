// HD-FR-24 · HD-FR-32 · #218 · M3-decouple: xử lý MỘT job AI đọc HĐ lấy từ hàng đợi bền — lượt trích HD2 (lời nhắc có rào, parse
// strict, kiểm trích dẫn giữ nguyên) với agent = lời gọi model trực tiếp qua AI client chung; xong ⇒ lượt duyệt `extracting`
// chuyển `level1` (HĐ needs_review) hoặc `failed`. Lỗi bất kỳ ⇒ log (không lộ nội dung), không ném (job được ACK).
// M3c (review B #7): trước lượt đọc đánh dấu lượt "đã bắt đầu" (hết xếp hàng) ⇒ STALE tính từ lúc chạy; lỗi đánh dấu chỉ log.

import type { ApprovalUow } from "./approval.ports";
import type { EngineStart, ExtractJob } from "./approval.usecase";
import type { ExtractionOutcome, RunExtraction } from "./run-extraction.usecase";

type Log = { warn(msg: string, f?: Record<string, unknown>): void };
export type ExtractJobDeps = {
  run: RunExtraction;
  uow: ApprovalUow;
  log?: Log;
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
  /** contract-flow S3a · lượt vào `level1` ⇒ mở run engine (cờ bật); không ném. */
  engine?: EngineStart;
};

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

async function markStarted(d: ExtractJobDeps, job: ExtractJob, aid: string): Promise<void> {
  const who = { tenantId: job.tenantId, userId: job.userId };
  await d.uow
    .tenant(who, (r) => r.approval.markStarted(job.contractId, aid))
    .catch((e: unknown) =>
      d.log?.warn("contract-extraction-start-mark-failed", {
        contract_id: job.contractId,
        error: errName(e),
      }),
    );
}

export function handleExtractJob(d: ExtractJobDeps) {
  return async (job: ExtractJob): Promise<void> => {
    const who = { tenantId: job.tenantId, userId: job.userId };
    const aid = job.approvalId;
    let out: ExtractionOutcome | "error";
    try {
      if (aid) await markStarted(d, job, aid);
      out = await d.run(who, job.contractId);
      const st = aid
        ? await d.uow.tenant(who, (r) => r.approval.afterExtraction(job.contractId, aid))
        : null;
      if (st === "level1" && d.engine) await d.engine(who, job.contractId); // contract-flow S3a
    } catch (e) {
      d.log?.warn("contract-extraction-failed", {
        contract_id: job.contractId,
        error: errName(e),
      });
      out = "error";
    }
    d.onSettled?.(job.contractId, out);
  };
}
