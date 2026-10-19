// HD-FR-01 · HD-FR-02 · HD-FR-03 · HD-FR-04 · HD-FR-06 · D-04 · D-18 · HD1 plan §1: trường trích, enum, item của gói hợp đồng.
// Khoá/kiểu = `R/api/app/contracts/fields.py`. Không import hub-api (ADR-0023); domain T6 giữ bản sao danh sách khoá.
import { z } from "zod";

/** 23 khoá `fields` và kiểu giá trị (HD-FR-02). */
export const CONTRACT_FIELD_KINDS = {
  number: "text",
  title: "text",
  type: "enum",
  supplier_name: "text",
  supplier_tax_id: "text",
  supplier_address: "text",
  supplier_representative: "text",
  buyer_name: "text",
  buyer_tax_id: "text",
  buyer_representative: "text",
  signed_date: "date",
  start_date: "date",
  end_date: "date",
  effective_date: "date",
  auto_renew: "bool",
  notice_days: "int",
  total_value: "int",
  vat_rate: "float",
  vat_included: "bool",
  payment_terms: "text",
  delivery_terms: "text",
  warranty: "text",
  penalty: "text",
} as const;
export type ContractFieldKey = keyof typeof CONTRACT_FIELD_KINDS;
export type ContractFieldKind = (typeof CONTRACT_FIELD_KINDS)[ContractFieldKey];
export const CONTRACT_FIELD_KEYS = Object.keys(CONTRACT_FIELD_KINDS) as ContractFieldKey[];

export const CONTRACT_TYPES = ["purchase", "service", "framework", "principle"] as const;
export const ContractTypeSchema = z.enum(CONTRACT_TYPES);
export type ContractType = z.infer<typeof ContractTypeSchema>;

/** 8 trạng thái spec + `rejected` ở cuối (D-04); chỉ thêm cuối. */
export const CONTRACT_STATUSES = [
  "extracting",
  "extract_failed",
  "needs_review",
  "active",
  "expiring",
  "expired",
  "renewed",
  "terminated",
  "rejected",
] as const;
export const ContractStatusSchema = z.enum(CONTRACT_STATUSES);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const HANDLED_OUTCOMES = ["renewed", "not_renewed", "negotiating", "replaced"] as const;
export const HandledOutcomeSchema = z.enum(HANDLED_OUTCOMES);
export type HandledOutcome = z.infer<typeof HandledOutcomeSchema>;

export const CONTRACT_KINDS = ["contract", "appendix"] as const;
export const ContractKindSchema = z.enum(CONTRACT_KINDS);
export type ContractKind = z.infer<typeof ContractKindSchema>;

export const CONTRACT_DIRECTIONS = ["sale", "purchase"] as const;
export const ContractDirectionSchema = z.enum(CONTRACT_DIRECTIONS);
export type ContractDirection = z.infer<typeof ContractDirectionSchema>;

/** Loại event (HD-FR-06); DB chỉ CHECK `^[a-z_]{2,40}$` — thêm giá trị ở CUỐI. */
export const CONTRACT_EVENT_TYPES = [
  "uploaded",
  "field_edited",
  "extract_requested",
  "extracted",
  "extract_failed",
  "created_manual",
] as const;
export const ContractEventTypeSchema = z.enum(CONTRACT_EVENT_TYPES);
export type ContractEventType = z.infer<typeof ContractEventTypeSchema>;
export const CONTRACT_EVENT_TYPE_RE = /^[a-z_]{2,40}$/;

/** 11 trường hàng hoá (HD-FR-04, `fields.py:12-15`). */
export const ITEM_KINDS = {
  code: "text",
  name: "text",
  spec: "text",
  unit: "text",
  qty: "float",
  unit_price: "int",
  vat_rate: "float",
  moq: "float",
  lead_time_days: "int",
  valid_from: "date",
  valid_to: "date",
} as const;
export type ContractItemKey = keyof typeof ITEM_KINDS;

export const CONTRACT_TEXT_MAX = 2000;
export const CONTRACT_QUOTE_MAX = 2000;
export const CONTRACT_TOTAL_VALUE_MAX = 9_000_000_000_000_000;
export const CONTRACT_DAYS_MAX = 3650;
export const CONTRACT_TITLE_MAX = 200;

/** Chuỗi ở biên: cắt khoảng trắng + chuẩn NFC (D-18) + trần độ dài + cấm `\u0000` (Postgres từ chối ⇒ 5xx; review m-07). */
export const nfcText = (max: number) =>
  z
    .string()
    .trim()
    .normalize("NFC")
    .max(max)
    .refine((v) => !v.includes("\u0000"), { message: "NUL không được phép" });
export const IsoDateSchema = z.iso.date();

const percent = () => z.number().min(0).max(100);
const days = () => z.number().int().min(0).max(CONTRACT_DAYS_MAX);

function kindSchema(key: ContractFieldKey): z.ZodType {
  switch (CONTRACT_FIELD_KINDS[key]) {
    case "text":
      return nfcText(CONTRACT_TEXT_MAX);
    case "enum":
      return ContractTypeSchema;
    case "date":
      return IsoDateSchema;
    case "bool":
      return z.boolean();
    case "int":
      return key === "total_value" ? z.number().int().min(0).max(CONTRACT_TOTAL_VALUE_MAX) : days();
    case "float":
      return percent();
  }
}

type FieldValueShape = { [K in ContractFieldKey]: z.ZodNullable<z.ZodType> };
const VALUE_SCHEMAS = Object.fromEntries(
  CONTRACT_FIELD_KEYS.map((k) => [k, kindSchema(k).nullable()]),
) as FieldValueShape;

export const isContractFieldKey = (k: string): k is ContractFieldKey =>
  Object.hasOwn(CONTRACT_FIELD_KINDS, k);

/** Schema `value` theo kiểu của khoá (nullable). Khoá lạ ⇒ ném (không trả schema mở). */
export function fieldValueSchema(key: string): z.ZodNullable<z.ZodType> {
  if (!isContractFieldKey(key)) throw new Error(`unknown contract field: ${key}`);
  return VALUE_SCHEMAS[key];
}

export const ContractFieldValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type ContractFieldValue = z.infer<typeof ContractFieldValueSchema>;

/** Một trường trích: `{value, quote, verified, edited}` (strict). */
export const ContractFieldSchema = z.strictObject({
  value: ContractFieldValueSchema,
  quote: z.string().max(CONTRACT_QUOTE_MAX),
  verified: z.boolean(),
  edited: z.boolean(),
});
export type ContractField = z.infer<typeof ContractFieldSchema>;

/** Đủ 23 khoá (đọc: thiếu ⇒ rỗng, lạ ⇒ bỏ — domain `fillFields`). */
export const ContractFieldsSchema = z.strictObject(
  Object.fromEntries(CONTRACT_FIELD_KEYS.map((k) => [k, ContractFieldSchema])) as {
    [K in ContractFieldKey]: typeof ContractFieldSchema;
  },
);
export type ContractFields = z.infer<typeof ContractFieldsSchema>;

/** Hàng hoá (`contract_items`, plan §3). */
export const ContractItemSchema = z.strictObject({
  id: z.uuid(),
  ord: z.number().int().min(0).max(9999),
  code: z.string().max(100).nullable(),
  name: z.string().min(1).max(500),
  spec: z.string().max(CONTRACT_TEXT_MAX).nullable(),
  unit: z.string().max(50).nullable(),
  qty: z.number().nullable(),
  unit_price: z.number().int().nullable(),
  vat_rate: percent().nullable(),
  moq: z.number().nullable(),
  lead_time_days: days().nullable(),
  valid_from: IsoDateSchema.nullable(),
  valid_to: IsoDateSchema.nullable(),
  category_id: z.uuid().nullable(),
  quote: z.string().max(CONTRACT_QUOTE_MAX).nullable(),
  verified: z.boolean(),
  edited: z.boolean(),
});
export type ContractItem = z.infer<typeof ContractItemSchema>;
