// HD-FR-24 · HD-FR-32 · #218 · M3-decouple: xử lý MỘT job AI đọc HĐ lấy từ hàng đợi bền — lượt trích HD2 (lời nhắc có rào, parse
// strict, kiểm trích dẫn giữ nguyên) với agent = lời gọi model trực tiếp qua AI client chung; xong ⇒ lượt duyệt `extracting`
// chuyển `level1` (HĐ needs_review) hoặc `failed`. Lỗi bất kỳ ⇒ log (không lộ nội dung), không ném (job được ACK).

import type { ApprovalUow } from "./approval.ports";
import type { ExtractJob } from "./approval.usecase";
import type { ExtractionOutcome, RunExtraction } from "./run-extraction.usecase";

export type ExtractJobDeps = {
  run: RunExtraction;
  uow: ApprovalUow;
  log?: { warn(msg: string, f?: Record<string, unknown>): void };
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
};

export function handleExtractJob(d: ExtractJobDeps) {
  return async (job: ExtractJob): Promise<void> => {
    const who = { tenantId: job.tenantId, userId: job.userId };
    let out: ExtractionOutcome | "error";
    try {
      out = await d.run(who, job.contractId);
      const aid = job.approvalId;
      if (aid) await d.uow.tenant(who, (r) => r.approval.afterExtraction(job.contractId, aid));
    } catch (e) {
      d.log?.warn("contract-extraction-failed", {
        contract_id: job.contractId,
        error: e instanceof Error ? e.name : "unknown",
      });
      out = "error";
    }
    d.onSettled?.(job.contractId, out);
  };
}
