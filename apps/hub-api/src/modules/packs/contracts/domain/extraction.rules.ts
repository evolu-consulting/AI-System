// HD-FR-21 · HD-FR-22 · HD-FR-24 · HD-BR-01: áp bản trích của agent lên HĐ (port `R/api/app/contracts/ingest.py:81-98`):
// kiểm từng trường/dòng, `effective_date` chỉ cho phụ lục, gộp giữ trường `edited`, dòng hàng chỉ ghi khi HĐ chưa có dòng
// nào (D-08: `contract_items` không DELETE ở HD1/HD2), chủ đề điều khoản theo số điều. Thuần.
import { parseDocTypeSuggest } from "./doc-types.rules";
import type { AiMilestone, AiRead, AiSummary, AiUnsureKey } from "./extraction.types";
import { type ContractFieldKey, type ContractFields, mergeFields } from "./fields.rules";
import type { Deal } from "./milestones.rules";
import {
  itemVerified,
  prepareSource,
  quoteFound,
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
  /** V2-G: phần thêm của bản trích v2 (vắng ở bản trích cũ). */
  deal?: Deal | null | undefined;
  unsure?: readonly AiUnsureKey[] | undefined;
  summary?: AiSummary | null | undefined;
  milestones?: readonly AiMilestone[] | undefined;
  /** CR-101 Câu 9: AI gợi ý loại chứng từ (người dùng chọn lại được). */
  doc_type_suggest?: string | null | undefined;
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
  ai: AiRead | null;
};

/** Phần nặng (chuẩn hoá cả văn bản + dò từng quote): chạy NGOÀI tx, văn bản lớn ở Worker (review Trung 1). */
export type VerifiedExtraction = {
  fields: Record<ContractFieldKey, VerifiedField>;
  items: ExtractedItemRow[];
  clauses: Clause[];
  /** V2-G · HD-02/HD-08: loại đoán + trường chưa chắc + tóm tắt + mốc (`null` ⇒ bản trích cũ, không ghi đè phần AI đọc đã có). */
  ai: AiRead | null;
};

/** V2-G: "chưa chắc" = AI tự báo ∪ có giá trị mà trích dẫn không có trong văn bản (chưa kiểm chứng). Loại Mua/Bán luôn chưa chắc
 *  (AI không biết bên nào là của mình); Giới thiệu thì tin AI. Giữ thứ tự khoá của `fields`. */
export function aiReadOf(
  raw: RawExtraction,
  fields: Record<ContractFieldKey, VerifiedField>,
  src: ReturnType<typeof prepareSource>,
): AiRead | null {
  if (
    raw.deal === undefined &&
    !raw.unsure &&
    !raw.summary &&
    !raw.milestones &&
    raw.doc_type_suggest === undefined
  )
    return null;
  const said = new Set<AiUnsureKey>(raw.unsure ?? []);
  const unsure: AiUnsureKey[] = (Object.keys(fields) as ContractFieldKey[]).filter(
    (k) => said.has(k) || (fields[k].value !== null && !fields[k].verified),
  );
  const deal = raw.deal ?? null;
  if (deal !== null && (deal !== "referral" || said.has("deal"))) unsure.push("deal");
  return {
    deal,
    unsure,
    summary: raw.summary ?? null,
    milestones: (raw.milestones ?? []).map((m) => ({
      ...m,
      verified: m.quote.trim() !== "" && quoteFound(m.quote, src),
    })),
    ...(raw.doc_type_suggest !== undefined
      ? { doc_type_suggest: parseDocTypeSuggest(raw.doc_type_suggest) }
      : {}),
  };
}

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
  const fields = verifyFields(raw, src);
  return {
    fields,
    items,
    clauses: clauses.map((c) => ({ number: c.number, topic: c.topic })),
    ai: aiReadOf(i.raw, fields, src),
  };
}

/** Phần rẻ (trong tx ghi): gộp giữ `edited`; HĐ đã có dòng hàng ⇒ giữ dòng cũ. */
export function mergeExtraction(
  v: VerifiedExtraction,
  oldFields: unknown,
  hasItems: boolean,
): ApplyOutput {
  const fields = mergeFields(oldFields, v.fields);
  // Trường người đã sửa tay thì không còn "chưa chắc".
  const ai = v.ai && {
    ...v.ai,
    unsure: v.ai.unsure.filter((k) => k === "deal" || !fields[k].edited),
  };
  return { fields, items: hasItems ? null : v.items, clauses: v.clauses, ai };
}

export function applyExtraction(i: ApplyInput): ApplyOutput {
  return mergeExtraction(verifyExtraction(i), i.oldFields, i.hasItems);
}
