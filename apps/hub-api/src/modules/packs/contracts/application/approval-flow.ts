// HD-FR-31 · #218 · M3-decouple: chế độ flow (production) — tải lên / trích lại / nhập tay MỞ LƯỢT DUYỆT của gói rồi xếp lượt AI
// đọc vào hàng đợi bền (Redis Streams). Không engine quy trình. Lớp 2: chỉ cổng.
import type { PackUow } from "../../kit/public";
import { LIVE_APPROVAL } from "../domain/approval-run.rules";
import type { ApprovalTxRepos } from "./approval.ports";
import type { ExtractJobs } from "./approval.usecase";
import type { ExtractionTxRepos, RequestExtractOutcome } from "./extraction.ports";
import type { RequestExtract } from "./request-extract.usecase";
import type { ExtractionStarter } from "./upload-contract.ports";

/** Tải lên (sau COMMIT): lượt duyệt đã mở trong CÙNG câu ghi (HĐ `draft` + `extract_state = reading`) ⇒ chỉ xếp lượt đọc (0 SQL). Không có lượt (tệp
 *  không đọc được ⇒ `extract_state = failed`) ⇒ không làm gì; người dùng "Trích lại" sau. Không ném (tải lên đã 201); lỗi ⇒ quét STALE. */
export function flowStarter(d: {
  jobs: ExtractJobs;
  log: { warn(msg: string, f?: Record<string, unknown>): void };
}): ExtractionStarter {
  return {
    opensApproval: true,
    async start(who, id, approvalId) {
      try {
        if (approvalId) await d.jobs.enqueue({ ...who, contractId: id, approvalId });
      } catch {
        d.log.warn("contract-approval-start-failed", { contract_id: id });
      }
    },
  };
}

/** Trích lại: lượt duyệt sống ⇒ `busy` (409); còn lại như HD2 (kiểm trạng thái/nguồn ⇒ `extracting`) + mở lượt mới + xếp đọc,
 *  một tx khoá HĐ. */
export function flowRequestExtract(d: {
  uow: PackUow<ExtractionTxRepos & ApprovalTxRepos>;
  jobs: ExtractJobs;
  /** false ⇒ AI chưa cấu hình: `unavailable` (503) trước mọi SQL, như HD2 D2-01. */
  ready: boolean;
}): RequestExtract {
  return async (who, id): Promise<RequestExtractOutcome> => {
    if (!d.ready) return { kind: "unavailable" };
    const aid = crypto.randomUUID();
    const out = await d.uow.tenant(who, async (r): Promise<RequestExtractOutcome> => {
      const st = await r.approval.state(id, { lock: true });
      if (!st) return { kind: "not_found" };
      if (st.approval && LIVE_APPROVAL.has(st.approval.status)) return { kind: "busy" };
      const o = await r.extraction.requestExtract(id, who.userId);
      if (o.kind !== "ok") return o;
      // Đã kiểm lượt sống dưới khoá HĐ; thua đua hiếm ⇒ ném để ROLLBACK cả `extracting`.
      if ((await r.approval.open(id, aid, who.userId, "extracting")) !== "ok")
        throw new Error("contract-approval-open-raced");
      await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return o;
    });
    if (out.kind === "ok") await d.jobs.enqueue({ ...who, contractId: id, approvalId: aid });
    return out;
  };
}
