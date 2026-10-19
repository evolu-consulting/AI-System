// HD-BR-01 · HD-AC08 · HD-FR-02 · HD-AC12 · D-13 · plan §4: `fillFields` / `mergeFields` / `applyEdits` (ingest.py:63-65, manual.py:16). Thuần.

export const CONTRACT_FIELD_KEYS = [
  "number",
  "title",
  "type",
  "supplier_name",
  "supplier_tax_id",
  "supplier_address",
  "supplier_representative",
  "buyer_name",
  "buyer_tax_id",
  "buyer_representative",
  "signed_date",
  "start_date",
  "end_date",
  "effective_date",
  "auto_renew",
  "notice_days",
  "total_value",
  "vat_rate",
  "vat_included",
  "payment_terms",
  "delivery_terms",
  "warranty",
  "penalty",
] as const;
export type ContractFieldKey = (typeof CONTRACT_FIELD_KEYS)[number];

export type FieldValue = string | number | boolean | null;
export type ContractField = {
  value: FieldValue;
  quote: string;
  verified: boolean;
  edited: boolean;
};
export type ContractFields = Record<ContractFieldKey, ContractField>;
export type FieldChange = { key: ContractFieldKey; old: FieldValue; new: FieldValue };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function fillField(raw: unknown): ContractField {
  const r = isObj(raw) ? raw : {};
  return {
    value: (r.value ?? null) as FieldValue,
    quote: typeof r.quote === "string" ? r.quote : "",
    verified: r.verified === true,
    edited: r.edited === true,
  };
}

/** Đủ 23 khoá; thiếu ⇒ rỗng; khoá lạ bị bỏ khi đọc. */
export function fillFields(raw: unknown): ContractFields {
  const src = isObj(raw) ? raw : {};
  return Object.fromEntries(
    CONTRACT_FIELD_KEYS.map((k) => [k, fillField(src[k])]),
  ) as ContractFields;
}

/** Trích lại: khoá `edited` của old thắng, còn lại lấy next. */
export function mergeFields(old: unknown, next: unknown): ContractFields {
  const [o, n] = [fillFields(old), fillFields(next)];
  return Object.fromEntries(
    CONTRACT_FIELD_KEYS.map((k) => [k, o[k].edited ? o[k] : n[k]]),
  ) as ContractFields;
}

/** Sửa tay: {value mới, quote giữ, verified:true, edited:true}; giá trị y cũ ⇒ không đổi, không vào changes. */
export function applyEdits(
  old: unknown,
  edits: Partial<Record<ContractFieldKey, FieldValue>>,
): { fields: ContractFields; changes: FieldChange[] } {
  const fields = fillFields(old);
  const changes: FieldChange[] = [];
  for (const key of CONTRACT_FIELD_KEYS) {
    const next = edits[key];
    if (next === undefined || next === fields[key].value) continue;
    changes.push({ key, old: fields[key].value, new: next });
    fields[key] = { ...fields[key], value: next, verified: true, edited: true };
  }
  return { fields, changes };
}
