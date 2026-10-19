// HD-FR-21 · HD-FR-22 · HD-FR-24 · HD-BR-01: áp bản trích của agent lên HĐ (port `R/api/app/contracts/ingest.py:81-98`):
// kiểm từng trường/dòng, `effective_date` chỉ cho phụ lục, gộp giữ trường `edited`, dòng hàng chỉ ghi khi HĐ chưa có dòng
// nào (D-08: `contract_items` không DELETE ở HD1/HD2), chủ đề điều khoản theo số điều. Thuần.
import { type ContractFieldKey, type ContractFields, mergeFields } from "./fields.rules";
import {
  itemVerified,
  prepareSource,
  type RawField,
  type VerifiedField,
  verifyFields,
} from "./verify.rules";

export type RawItem = {
  code: string | null;
  name: string;
  spec: string | null;
  unit: string | null;
  qty: number | null;
  unit_price: number | null;
  vat_rate: number | null;
  moq: number | null;
  lead_time_days: number | null;
  valid_from: string | null;
  valid_to: string | null;
  quote: string;
};
export type RawClause = { number: string; topic: string };
/** Đầu ra agent đã qua parse strict ở adapter. */
export type RawExtraction = {
  fields: Partial<Record<ContractFieldKey, RawField>>;
  items: readonly RawItem[];
  clauses: readonly RawClause[];
};
export type ExtractedItemRow = RawItem & { ord: number; verified: boolean; edited: false };
export type Clause = { number: string; topic: string };

export type ApplyInput = {
  raw: RawExtraction;
  source: string | null;
  kind: "contract" | "appendix";
  oldFields: unknown;
  /** HĐ đã có dòng hàng ⇒ giữ nguyên (không thay). */
  hasItems: boolean;
};
export type ApplyOutput = {
  fields: ContractFields;
  items: ExtractedItemRow[] | null;
  clauses: Clause[];
};

/** Phần nặng (chuẩn hoá cả văn bản + dò từng quote): chạy NGOÀI tx, văn bản lớn ở Worker (review Trung 1). */
export type VerifiedExtraction = {
  fields: Record<ContractFieldKey, VerifiedField>;
  items: ExtractedItemRow[];
  clauses: Clause[];
};

export function verifyExtraction(i: {
  raw: RawExtraction;
  source: string | null;
  kind: "contract" | "appendix";
}): VerifiedExtraction {
  const src = prepareSource(i.source ?? "");
  const raw = { ...i.raw.fields };
  if (i.kind === "contract") raw.effective_date = { value: null, quote: "" };
  const items = i.raw.items.map((it, ord) => ({
    ...it,
    ord,
    verified: itemVerified(it, src),
    edited: false as const,
  }));
  const seen = new Set<string>();
  const clauses = i.raw.clauses.filter((c) => !seen.has(c.number) && seen.add(c.number));
  return {
    fields: verifyFields(raw, src),
    items,
    clauses: clauses.map((c) => ({ number: c.number, topic: c.topic })),
  };
}

/** Phần rẻ (trong tx ghi): gộp giữ `edited`; HĐ đã có dòng hàng ⇒ giữ dòng cũ. */
export function mergeExtraction(
  v: VerifiedExtraction,
  oldFields: unknown,
  hasItems: boolean,
): ApplyOutput {
  return {
    fields: mergeFields(oldFields, v.fields),
    items: hasItems ? null : v.items,
    clauses: v.clauses,
  };
}

export function applyExtraction(i: ApplyInput): ApplyOutput {
  return mergeExtraction(verifyExtraction(i), i.oldFields, i.hasItems);
}
