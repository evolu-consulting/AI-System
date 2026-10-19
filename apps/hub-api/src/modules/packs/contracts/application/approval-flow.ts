// HD-FR-31 · #218 · D3-01: chế độ flow (không seam transport) — tải lên / nhập tay / trích lại MỞ RUN duyệt thay vì xếp hàng
// trong tiến trình. Không mở được ⇒ HĐ đang `extracting` về `extract_failed` (`RUN_LIMIT` / `FLOW_UNAVAILABLE`), không kẹt.
// Lớp 2: chỉ cổng.
import type { PackWho } from "../../kit/application/ports";
import type { ApprovalUow } from "./approval.ports";
import type { StartApproval } from "./approval.usecase";
import type { CreateManual } from "./create-manual.usecase";
import type { ExtractionUow, RequestExtractOutcome } from "./extraction.ports";
import type { RequestExtract } from "./request-extract.usecase";
import type { ExtractionStarter } from "./upload-contract.ports";

const asCaller = (w: PackWho) => ({ ...w, role: "member" });
const isRunLimit = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { status?: number }).status === 429;

type FlowDeps = {
  start: StartApproval;
  uow: ExtractionUow;
  log: { warn(msg: string, f?: Record<string, unknown>): void };
};

/** Tải lên: mở run sau COMMIT; lỗi ⇒ `extract_failed` (chỉ khi HĐ còn `extracting`). Không ném (tải lên đã 201). */
export function flowStarter(d: FlowDeps): ExtractionStarter {
  const fail = (who: PackWho, id: string, code: string) =>
    d.uow.tenant(who, (r) => r.extraction.saveFailure(id, code)).then(() => undefined);
  return {
    async start(who, id) {
      try {
        const r = await d.start(asCaller(who), id);
        if (r.kind === "ok" || r.kind === "has_run") return;
        await fail(who, id, "FLOW_UNAVAILABLE");
      } catch (e) {
        d.log.warn("contract-approval-start-failed", { contract_id: id, limit: isRunLimit(e) });
        await fail(who, id, isRunLimit(e) ? "RUN_LIMIT" : "FLOW_UNAVAILABLE").catch(
          () => undefined,
        );
      }
    },
  };
}

/** Trích lại = mở run duyệt mới (run cũ đã kết thúc); run còn sống ⇒ `busy`. Lỗi engine (429…) ném lên route. */
export function flowRequestExtract(d: { start: StartApproval; uow: ApprovalUow }): RequestExtract {
  return async (who, id): Promise<RequestExtractOutcome> => {
    const r = await d.start(asCaller(who), id);
    if (r.kind === "has_run") return { kind: "busy" };
    if (r.kind === "not_found" || r.kind === "not_allowed") return { kind: r.kind };
    if (r.kind !== "ok") return { kind: "unavailable" };
    const cur = await d.uow.tenant(who, (x) => x.approval.runOf(id));
    return { kind: "ok", version: cur?.version ?? 1 };
  };
}

/** Nhập tay: tạo HĐ như HD2 rồi mở run duyệt (tool trích bỏ qua vì không có nguồn). */
export function flowCreateManual(create: CreateManual, starter: ExtractionStarter): CreateManual {
  return async (who, input) => {
    const out = await create(who, input);
    await starter.start(who, out.id);
    return out;
  };
}
