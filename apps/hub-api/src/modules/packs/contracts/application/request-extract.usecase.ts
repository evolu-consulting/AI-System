// HD-FR-24 · HD-BR-01: trích lại theo yêu cầu người dùng (`POST …/contracts/:id/extract`). Một tx: khoá + kiểm trạng thái
// (`needs_review`/`extract_failed`) + có nguồn ⇒ `extracting`, version+1, event; outbox; SAU commit xếp hàng trích (giữ
// trường `edited` khi ghi kết quả — `mergeFields`). Id tenant khác ⇒ `not_found` (404 như không có).
import type { PackWho } from "../../kit/application/ports";
import type { ExtractionUow, RequestExtractOutcome } from "./extraction.ports";
import type { ExtractionStarter } from "./upload-contract.ports";

export type RequestExtract = (who: PackWho, id: string) => Promise<RequestExtractOutcome>;

export function requestExtract(d: {
  uow: ExtractionUow;
  starter: ExtractionStarter;
  /** false ⇒ chưa có agent (D2-01): trả `unavailable` trước mọi SQL. */
  available: boolean;
}): RequestExtract {
  return async (who, id) => {
    if (!d.available) return { kind: "unavailable" };
    const out = await d.uow.tenant(who, async (r) => {
      const o = await r.extraction.requestExtract(id, who.userId);
      if (o.kind === "ok")
        await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return o;
    });
    if (out.kind === "ok") await d.starter.start(who, id);
    return out;
  };
}
