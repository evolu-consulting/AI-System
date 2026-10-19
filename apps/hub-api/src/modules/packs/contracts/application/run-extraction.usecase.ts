// HD-FR-21 · HD-FR-22 · HD-FR-23 · HD-FR-24 · HD-FR-25 · HD2 plan "Thiết kế hiệu năng": một lượt trích của một HĐ.
// tx đọc (1 câu + set_config) → agent (ngoài tx) → tra MST các số ứng viên song song (ngoài tx, cache ở adapter) → tx ghi:
// khoá hàng, còn `extracting` mới ghi (đã trích lại/đổi trạng thái ⇒ bỏ), gộp giữ `edited`, cảnh báo, outbox. Không gọi
// mạng trong tx; số câu cố định, không phụ thuộc số dòng hàng.
import type { PackWho } from "../../kit/application/ports";
import { applyExtraction, type RawExtraction } from "../domain/extraction.rules";
import { type ContractFields, fillFields } from "../domain/fields.rules";
import { partyCheck, type TaxLookup } from "../domain/party.rules";
import {
  type DirectionCheck,
  normalizeTaxId,
  type Parties,
  ruleWarnings,
} from "../domain/warnings.rules";
import type { ExtractionAgent, ExtractionUow, TaxRegistry } from "./extraction.ports";

export type RunExtractionDeps = {
  uow: ExtractionUow;
  agent: ExtractionAgent;
  tax: TaxRegistry | null;
};
export type ExtractionOutcome = "needs_review" | "extract_failed" | "skipped";
export type RunExtraction = (who: PackWho, contractId: string) => Promise<ExtractionOutcome>;
export type TaxHits = ReadonlyMap<string, TaxLookup>;

const TAX_KEYS = ["supplier_tax_id", "buyer_tax_id"] as const;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Tra các MST (đã chuẩn hoá, bỏ trùng) song song; không có cổng ⇒ map rỗng (chỉ kiểm định dạng). */
export async function prefetchTax(
  tax: TaxRegistry | null,
  raws: readonly (string | null)[],
  fast: boolean,
): Promise<TaxHits> {
  const ids = [...new Set(raws.map((r) => normalizeTaxId(r)).filter((x): x is string => !!x))];
  if (!tax || ids.length === 0) return new Map();
  const res = await Promise.all(ids.map((id) => tax.lookup(id, { fast })));
  return new Map(ids.map((id, i) => [id, res[i] as TaxLookup]));
}

/** Kết quả Cục Thuế của hai bên theo trường hiện tại (thuần trên map đã tra). */
export function partiesOf(f: ContractFields, hits: TaxHits): Parties {
  const side = (name: unknown, raw: unknown) => {
    const tax = str(raw);
    const id = normalizeTaxId(tax);
    return partyCheck(str(name), tax, id ? (hits.get(id) ?? null) : null);
  };
  return {
    supplier: side(f.supplier_name.value, f.supplier_tax_id.value),
    buyer: side(f.buyer_name.value, f.buyer_tax_id.value),
  };
}

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
    const hits = await prefetchTax(d.tax, candidateTaxIds(reply.raw, src.fields), false);
    // Ghi hỏng (DB từ chối giá trị lạ, mất kết nối) ⇒ `extract_failed SAVE_FAILED`, không để HĐ kẹt `extracting` (S-M1).
    return saveOutcome(d, { who, id, raw: reply.raw, text: src.text, hits }).catch(() =>
      fail(d, who, id, "SAVE_FAILED"),
    );
  };
}

type SaveInput = {
  who: PackWho;
  id: string;
  raw: RawExtraction;
  text: string | null;
  hits: TaxHits;
};

/** tx ghi: khoá hàng, còn `extracting` mới ghi, gộp giữ `edited`, cảnh báo, outbox (4 câu, không theo số dòng). */
function saveOutcome(d: RunExtractionDeps, s: SaveInput): Promise<ExtractionOutcome> {
  const { who, id, hits } = s;
  const reply = { raw: s.raw };
  const src = { text: s.text };
  return d.uow.tenant(who, async (r): Promise<ExtractionOutcome> => {
    const cur = await r.extraction.lock(id);
    if (!cur || cur.status !== "extracting") return "skipped";
    const out = applyExtraction({
      raw: reply.raw,
      source: src.text,
      kind: cur.kind,
      oldFields: cur.fields,
      hasItems: cur.items.length > 0,
    });
    const direction: DirectionCheck = cur.direction ? null : "none_own";
    const items = out.items ?? cur.items;
    const warnings = ruleWarnings(out.fields, items, direction, partiesOf(out.fields, hits));
    await r.extraction.saveResult(id, { ...out, warnings });
    await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
    return "needs_review";
  });
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
