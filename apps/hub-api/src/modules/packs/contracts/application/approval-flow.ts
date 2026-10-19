// HD-FR-31 · #218 · M3-decouple: chế độ flow (production) — tải lên / trích lại / nhập tay MỞ LƯỢT DUYỆT của gói rồi xếp lượt AI
// đọc vào hàng đợi bền (Redis Streams). Không engine quy trình. Lớp 2: chỉ cổng.
import type { PackUow } from "../../kit/application/ports";
import { LIVE_APPROVAL } from "../domain/approval-machine.rules";
import type { ApprovalTxRepos } from "./approval.ports";
import type { ExtractJobs, startApproval } from "./approval.usecase";
import type { CreateManual } from "./create-manual.usecase";
import type { ExtractionTxRepos, RequestExtractOutcome } from "./extraction.ports";
import type { RequestExtract } from "./request-extract.usecase";
import type { ExtractionStarter } from "./upload-contract.ports";

type Start = ReturnType<typeof startApproval>;

/** Tải lên (HĐ đã `extracting`, sau COMMIT): mở lượt duyệt + xếp lượt đọc. Không ném (tải lên đã 201); lỗi ⇒ vòng quét STALE. */
export function flowStarter(d: {
  start: Start;
  jobs: ExtractJobs;
  log: { warn(msg: string, f?: Record<string, unknown>): void };
}): ExtractionStarter {
  return {
    opensApproval: true,
    async start(who, id, approvalId) {
      try {
        // Tải lên đã mở lượt duyệt trong cùng câu ghi ⇒ chỉ xếp lượt đọc (0 SQL).
        if (approvalId) return await d.jobs.enqueue({ ...who, contractId: id, approvalId });
        const out = await d.start(who, id, "extracting");
        if (out !== "ok") d.log.warn("contract-approval-not-opened", { contract_id: id, out });
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

/** Nhập tay: tạo HĐ như HD2 rồi mở lượt duyệt ở cấp 1 (không có gì cho AI đọc). */
export function flowCreateManual(create: CreateManual, start: Start): CreateManual {
  return async (who, input) => {
    const out = await create(who, input);
    await start(who, out.id, "level1");
    return out;
  };
}
