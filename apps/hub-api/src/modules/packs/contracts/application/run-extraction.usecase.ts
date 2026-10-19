// HD-FR-21 · HD-FR-22 · HD-FR-23 · HD-FR-24 · HD-FR-25 · HD2 plan "Thiết kế hiệu năng" + review Trung 1: một lượt trích của một HĐ.
// tx đọc (1 câu) → agent (ngoài tx, có hạn giờ ở adapter) → kiểm trích dẫn (ngoài tx, văn bản lớn ở Worker) → tra MST (ngoài tx)
// → tx ghi KHÔNG khoá trước: gộp giữ `edited` theo bản vừa đọc rồi ghi có điều kiện `version` ∧ `extracting`; hàng đã đổi (sửa
// tay mới hơn) ⇒ đọc lại, gộp lại (≤ 3 lần). Không gọi mạng/CPU nặng trong tx; số câu cố định, không phụ thuộc số dòng hàng.
// MST chưa tra được vì cổng hẹn giờ (khe 2 s / 429) ⇒ hẹn `refreshParties` (Trung 4). Chiều mua/bán: không cảnh báo khi chưa có
// pháp nhân của mình (khớp mgmt-app `enrich.py:105`, review Thấp 5).
import type { PackWho } from "../../kit/application/ports";
import {
  mergeExtraction,
  type RawExtraction,
  type VerifiedExtraction,
} from "../domain/extraction.rules";
import { fillFields } from "../domain/fields.rules";
import { ruleWarnings } from "../domain/warnings.rules";
import type {
  ExtractionAgent,
  ExtractionSource,
  ExtractionUow,
  ExtractionVerifier,
  TaxRegistry,
} from "./extraction.ports";
import {
  partiesOf,
  prefetchTax,
  retryAtOf,
  type TaxHits,
  type TaxRetryScheduler,
} from "./tax-parties";

export { partiesOf, prefetchTax, type TaxHits } from "./tax-parties";

export type RunExtractionDeps = {
  uow: ExtractionUow;
  agent: ExtractionAgent;
  verifier: ExtractionVerifier;
  tax: TaxRegistry | null;
  scheduleTaxRetry?: TaxRetryScheduler;
};
export type ExtractionOutcome = "needs_review" | "extract_failed" | "skipped";
export type RunExtraction = (who: PackWho, contractId: string) => Promise<ExtractionOutcome>;

const SAVE_ATTEMPTS = 3;
const TAX_KEYS = ["supplier_tax_id", "buyer_tax_id"] as const;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** MST ứng viên: số agent đọc + số người đã sửa tay (trường `edited` thắng khi gộp). */
function candidateTaxIds(raw: RawExtraction, old: unknown): (string | null)[] {
  const f = fillFields(old);
  return TAX_KEYS.flatMap((k) => [str(raw.fields[k]?.value), f[k].edited ? str(f[k].value) : null]);
}

export function createRunExtraction(d: RunExtractionDeps): RunExtraction {
  return async (who, id) => {
    const src = await d.uow.tenant(who, (r) => r.extraction.source(id));
    if (!src || src.status !== "extracting") return "skipped";
    if (!src.text && !src.file) return fail(d, who, id, "NO_SOURCE");
    const reply = await d.agent.extract({
      who,
      contractId: id,
      text: src.text,
      file: src.text ? null : src.file,
      parent: src.parent,
    });
    if (!reply.ok) return fail(d, who, id, reply.code);
    // Ghi hỏng (Worker lỗi, DB từ chối, mất kết nối) ⇒ `extract_failed SAVE_FAILED`, không để HĐ kẹt `extracting` (S-M1).
    try {
      const verified = await d.verifier.verify({
        raw: reply.raw,
        source: src.text,
        kind: src.kind,
      });
      const hits = await prefetchTax(d.tax, candidateTaxIds(reply.raw, src.fields), false);
      return await save(d, { who, id, verified, hits, cur: src });
    } catch {
      return fail(d, who, id, "SAVE_FAILED");
    }
  };
}

type SaveInput = {
  who: PackWho;
  id: string;
  verified: VerifiedExtraction;
  hits: TaxHits;
  cur: ExtractionSource;
};

/** Ghi có điều kiện `version`; thua đua với sửa tay ⇒ đọc lại và gộp lại (CPU nặng đã xong, phần này rẻ). */
async function save(d: RunExtractionDeps, s: SaveInput): Promise<ExtractionOutcome> {
  let cur: ExtractionSource | null = s.cur;
  for (let i = 0; i < SAVE_ATTEMPTS && cur?.status === "extracting"; i++) {
    const out = mergeExtraction(s.verified, cur.fields, cur.items.length > 0);
    const items = out.items ?? cur.items;
    const warnings = ruleWarnings(out.fields, items, null, partiesOf(out.fields, s.hits));
    const expected = cur.version;
    const ok = await d.uow.tenant(s.who, async (r) => {
      const saved = await r.extraction.saveResult(s.id, { ...out, warnings, expected });
      if (saved) await r.outbox.enqueue([{ entity: "contract", entity_id: s.id, op: "upsert" }]);
      return saved;
    });
    if (ok) {
      const at = retryAtOf(out.fields, s.hits);
      if (at !== null) d.scheduleTaxRetry?.(s.who, s.id, at, 1);
      return "needs_review";
    }
    cur = await d.uow.tenant(s.who, (r) => r.extraction.source(s.id));
  }
  return cur?.status === "extracting" ? fail(d, s.who, s.id, "SAVE_FAILED") : "skipped";
}

/** Chỉ ghi lỗi khi HĐ còn `extracting` (repo kiểm trong câu UPDATE). */
async function fail(
  d: RunExtractionDeps,
  who: PackWho,
  id: string,
  code: string,
): Promise<ExtractionOutcome> {
  const done = await d.uow.tenant(who, async (r) => {
    const ok = await r.extraction.saveFailure(id, code);
    if (ok) await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
    return ok;
  });
  return done ? "extract_failed" : "skipped";
}
