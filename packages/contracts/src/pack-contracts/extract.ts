// HD-FR-21 · HD-FR-23 · HD-FR-24 · HD-FR-26 · HUB-BR-31 · HD2 plan "Contract": đầu ra agent trích (strict — khoá lạ ⇒ hỏng),
// cảnh báo, trích lại, nhập tay. Khoá/kiểu = `R/api/app/contracts/{fields,extract,manual}.py`.
import { z } from "zod";
import { VersionSchema } from "../common";
import {
  CONTRACT_DAYS_MAX,
  CONTRACT_FIELD_KEYS,
  CONTRACT_FIELD_KINDS,
  CONTRACT_QUOTE_MAX,
  CONTRACT_TEXT_MAX,
  CONTRACT_TITLE_MAX,
  CONTRACT_TOTAL_VALUE_MAX,
  ContractDirectionSchema,
  type ContractFieldKey,
  ContractTypeSchema,
  IsoDateSchema,
  nfcText,
} from "./fields";
import { ContractDealSchema, MilestoneKindSchema } from "./milestones";

export const EXTRACT_ITEMS_MAX = 500;
export const EXTRACT_CLAUSES_MAX = 200;
export const CLAUSE_TOPICS = [
  "payment",
  "delivery",
  "warranty",
  "penalty",
  "termination",
  "renewal",
  "price",
  "confidentiality",
  "dispute",
  "general",
] as const;

/** Ô chuỗi PostgreSQL (`text`/`jsonb`) nhận được: không NUL, không surrogate lẻ (đầu ra agent không tin cậy — review S-M1). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const pgText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !v.includes("\u0000") && !LONE_SURROGATE.test(v), {
      message: "ký tự không hợp lệ",
    });
/** Ngày ISO năm 0001–9999 (cột `date` Postgres từ chối năm 0000). */
const outDate = () => IsoDateSchema.refine((v) => !v.startsWith("0000"), { message: "năm 0000" });
const quote = () => pgText(CONTRACT_QUOTE_MAX);
const money = () => z.number().int().min(0).max(CONTRACT_TOTAL_VALUE_MAX);

function outValue(key: ContractFieldKey): z.ZodType {
  switch (CONTRACT_FIELD_KINDS[key]) {
    case "text":
      return pgText(CONTRACT_TEXT_MAX);
    case "enum":
      return ContractTypeSchema;
    case "date":
      return outDate();
    case "bool":
      return z.boolean();
    case "int":
      return key === "total_value" ? money() : z.number().int().min(0).max(CONTRACT_DAYS_MAX);
    case "float":
      return z.number().min(0).max(100);
  }
}

/** Một trường agent trả: `{value, quote}` (strict). */
const outField = (key: ContractFieldKey) =>
  z.strictObject({ value: outValue(key).nullable(), quote: quote() });

export const ExtractedItemSchema = z.strictObject({
  code: pgText(100).nullable(),
  name: pgText(500).min(1),
  spec: pgText(CONTRACT_TEXT_MAX).nullable(),
  unit: pgText(50).nullable(),
  qty: z.number().min(0).max(1e12).nullable(),
  unit_price: money().nullable(),
  vat_rate: z.number().min(0).max(100).nullable(),
  moq: z.number().min(0).max(1e12).nullable(),
  lead_time_days: z.number().int().min(0).max(CONTRACT_DAYS_MAX).nullable(),
  valid_from: outDate().nullable(),
  valid_to: outDate().nullable(),
  quote: quote(),
});
export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;

export const ExtractedClauseSchema = z.strictObject({
  number: pgText(20).min(1),
  topic: z.enum(CLAUSE_TOPICS),
});

/** V2-G · HD-02/HD-08: trường AI chưa chắc = khoá của `fields` hoặc `deal` (loại HĐ Mua/Bán/Giới thiệu). */
export const AI_UNSURE_KEYS = [...CONTRACT_FIELD_KEYS, "deal"] as const;
export type AiUnsureKey = (typeof AI_UNSURE_KEYS)[number];
export const AI_MILESTONES_MAX = 50;
const SUMMARY_LINES_MAX = 12;
const sumLine = () => pgText(600);
const sumList = () => z.array(sumLine()).max(SUMMARY_LINES_MAX);

/** V2-G · BA §4.2 "Upload và xác nhận": tóm tắt 5 mục (nội dung chính, hạn quan trọng, phạt, thưởng, điều khoản chính). */
export const AiSummarySchema = z.strictObject({
  main: pgText(2000),
  deadlines: sumList(),
  penalties: sumList(),
  bonuses: sumList(),
  clauses: sumList(),
});
export type AiSummary = z.infer<typeof AiSummarySchema>;

/** Mốc AI tìm thấy trong văn bản (loại BA 7 loại; ngày có thể chưa rõ). */
export const AiMilestoneSchema = z.strictObject({
  kind: MilestoneKindSchema,
  title: pgText(200).nullable(),
  due_date: outDate().nullable(),
  amount: money().nullable(),
  quote: quote(),
});
export type AiMilestone = z.infer<typeof AiMilestoneSchema>;

/** Đầu ra agent trích (HD-FR-21). Strict ở mọi tầng: chỉ dẫn chèn trong văn bản không thêm được khoá/hình mới.
 *  V2-G: `deal`, `unsure`, `summary`, `milestones` là phần thêm (tuỳ chọn — bản trích cũ vẫn hợp lệ). */
export const ExtractionOutputSchema = z.strictObject({
  fields: z.strictObject(
    Object.fromEntries(CONTRACT_FIELD_KEYS.map((k) => [k, outField(k)])) as {
      [K in ContractFieldKey]: ReturnType<typeof outField>;
    },
  ),
  items: z.array(ExtractedItemSchema).max(EXTRACT_ITEMS_MAX),
  clauses: z.array(ExtractedClauseSchema).max(EXTRACT_CLAUSES_MAX),
  deal: ContractDealSchema.nullable().optional(),
  unsure: z.array(z.enum(AI_UNSURE_KEYS)).max(AI_UNSURE_KEYS.length).optional(),
  summary: AiSummarySchema.nullable().optional(),
  milestones: z.array(AiMilestoneSchema).max(AI_MILESTONES_MAX).optional(),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

/** V2-G: phần AI đọc lưu cùng HĐ (`contracts.ai_read`) và trả ở chi tiết — loại AI đoán, trường chưa chắc, tóm tắt, mốc tìm thấy
 *  (kèm cờ `verified`: trích dẫn có trong văn bản). */
export const AiReadSchema = z.strictObject({
  deal: ContractDealSchema.nullable(),
  unsure: z.array(z.enum(AI_UNSURE_KEYS)).max(AI_UNSURE_KEYS.length),
  summary: AiSummarySchema.nullable(),
  milestones: z.array(AiMilestoneSchema.extend({ verified: z.boolean() })).max(AI_MILESTONES_MAX),
});
export type AiRead = z.infer<typeof AiReadSchema>;

export const CONTRACT_WARNING_CODES = [
  "dates_order",
  "total_mismatch",
  "tax_id_format",
  "vat_unknown",
  "notice_missing",
  "direction_unknown",
  "direction_internal",
  "tax_not_found",
  "tax_missing",
  "company_inactive",
  "name_mismatch",
] as const;
export const ContractWarningSchema = z.strictObject({
  field: z.string().max(40).nullable(),
  code: z.enum(CONTRACT_WARNING_CODES),
  message: z.string().max(500),
});
export type ContractWarning = z.infer<typeof ContractWarningSchema>;

/** `POST /pack/contracts/contracts/:id/extract` (trích lại) ⇒ 202. */
export const ExtractResponseSchema = z.strictObject({
  id: z.uuid(),
  status: z.literal("extracting"),
  version: VersionSchema,
});
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

const optText = (max: number) => nfcText(max).nullable().optional();

export const ManualItemSchema = z
  .strictObject({
    name: nfcText(500).min(1),
    unit: optText(50),
    qty: z.number().min(0).max(1e12).nullable().optional(),
    unit_price: money().nullable().optional(),
    /** V2-F · 5.5a: SP trong danh mục (V2-B) + thành phần đã chọn; thành phần chỉ khi có SP. */
    product_id: z.uuid().nullable().optional(),
    component_ids: z.array(z.uuid()).min(1).max(20).nullable().optional(),
  })
  .refine((i) => !i.component_ids?.length || !!i.product_id, {
    message: "thành phần cần có sản phẩm",
    path: ["component_ids"],
  });

/** `POST /pack/contracts/contracts/manual` — hình `NewContractPage.tsx:60-66` (Q15). */
/** V2-A · % hoa hồng 0…100, tối đa 2 chữ số thập phân (= `numeric(5,2)`). */
const pct = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.round(v * 100) === v * 100, "tối đa 2 chữ số thập phân");

/** HD-FR-26 + V2-A HD-01: `deal` (Mua/Bán/Giới thiệu) hoặc `direction` cũ (ít nhất một, khớp nhau); hoa hồng (% HOẶC cố định)
 *  chỉ cho Giới thiệu. */
export const ManualContractRequestSchema = z
  .strictObject({
    deal: ContractDealSchema.optional(),
    commission_pct: pct.nullable().optional(),
    commission_fixed: money().nullable().optional(),
    direction: ContractDirectionSchema.optional(),
    number: optText(CONTRACT_TEXT_MAX),
    title: nfcText(CONTRACT_TITLE_MAX).min(1),
    partner_name: nfcText(CONTRACT_TEXT_MAX).min(1),
    partner_tax_id: optText(20),
    partner_signer: optText(CONTRACT_TEXT_MAX),
    our_signer: optText(CONTRACT_TEXT_MAX),
    start_date: IsoDateSchema.nullable().optional(),
    end_date: IsoDateSchema.nullable().optional(),
    notice_days: z.number().int().min(0).max(CONTRACT_DAYS_MAX).nullable().optional(),
    total_value: money().nullable().optional(),
    payment_terms: optText(CONTRACT_TEXT_MAX),
    items: z.array(ManualItemSchema).max(EXTRACT_ITEMS_MAX).default([]),
  })
  .refine((b) => b.deal !== undefined || b.direction !== undefined, {
    message: "cần deal hoặc direction",
    path: ["deal"],
  })
  .refine(
    (b) =>
      b.deal === undefined ||
      b.direction === undefined ||
      (b.deal === "buy") === (b.direction === "purchase"),
    { message: "deal và direction lệch nhau", path: ["direction"] },
  )
  .refine(
    (b) =>
      b.deal === "referral" ||
      ((b.commission_pct ?? null) === null && (b.commission_fixed ?? null) === null),
    { message: "hoa hồng chỉ cho HĐ Giới thiệu", path: ["commission_pct"] },
  )
  .refine((b) => (b.commission_pct ?? null) === null || (b.commission_fixed ?? null) === null, {
    message: "chọn % hoặc số tiền cố định",
    path: ["commission_fixed"],
  });
export type ManualContractRequest = z.infer<typeof ManualContractRequestSchema>;

export const ManualContractResponseSchema = z.strictObject({
  id: z.uuid(),
  /** V2-A: tenant tắt duyệt (C3) ⇒ HĐ lưu là có hiệu lực (`active`) + mốc mặc định. */
  status: z.enum(["needs_review", "active"]),
  version: VersionSchema,
});
export type ManualContractResponse = z.infer<typeof ManualContractResponseSchema>;
