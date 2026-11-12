// HD-FR-21 · HD-FR-23 · HD-FR-24 · HD-FR-26 · HUB-BR-31 · HD2 plan "Contract": đầu ra agent trích (strict — khoá lạ ⇒ hỏng),
// cảnh báo, trích lại, nhập tay. Khoá/kiểu = `R/api/app/contracts/{fields,extract,manual}.py`.
import { z } from "zod";
import { VersionSchema } from "../common";
import { DocNumberSchema } from "./doc-number";
import { DocTypeSchema } from "./doc-types";
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

/** CR-127 K7 · BR-55: "Điều cần lưu ý" — nhóm cố định; mỗi ý kèm điều khoản + trang. */
export const AI_NOTE_GROUPS = [
  "penalty",
  "payment",
  "delivery",
  "warranty",
  "renewal",
  "dispute",
] as const;
export const AI_NOTES_MAX = 40;
const clauseRef = () => pgText(60).nullable().optional();
const pageNo = () => z.number().int().min(1).max(9999).nullable().optional();
export const AiNoteSchema = z.strictObject({
  group: z.enum(AI_NOTE_GROUPS),
  text: pgText(600),
  clause_ref: clauseRef(),
  page: pageNo(),
  party: z.enum(["ours", "partner"]).nullable().optional(),
});
export type AiNote = z.infer<typeof AiNoteSchema>;

/** "Cần chú ý" (R#47): danh sách rủi ro cố định. */
export const AI_RISK_KINDS = [
  "auto_renew",
  "no_suspension_clause",
  "one_sided_penalty",
  "unlimited_liability",
  "short_notice",
  "missing_acceptance",
  "other",
] as const;
export const AI_RISKS_MAX = 20;
export const AiRiskSchema = z.strictObject({
  kind: z.enum(AI_RISK_KINDS),
  text: pgText(600),
  clause_ref: clauseRef(),
});
export type AiRisk = z.infer<typeof AiRiskSchema>;

/** BR-56: phạt dạng số (tỷ lệ, cơ sở tính, trần, trích dẫn điều khoản + trang). `party` = bên PHẠT (ours: mình bị phạt). */
export const PENALTY_TRIGGERS = ["late_delivery", "late_payment", "other"] as const;
export const PENALTY_BASES = ["per_day_of_value", "per_day_of_milestone", "fixed"] as const;
export const PENALTY_TERMS_MAX = 20;
export const PenaltyTermInputSchema = z.strictObject({
  party: z.enum(["ours", "partner"]),
  trigger: z.enum(PENALTY_TRIGGERS),
  rate_pct: z.number().min(0).max(100).nullable(),
  basis: z.enum(PENALTY_BASES),
  cap_pct: z.number().min(0).max(100).nullable().optional(),
  cap_amount: money().nullable().optional(),
  clause_ref: clauseRef(),
  page: pageNo(),
  quote: quote(),
});
export type PenaltyTermInput = z.infer<typeof PenaltyTermInputSchema>;
/** Hàng đã lưu (`contracts.penalty_terms`) trả ở chi tiết. */
export const PenaltyTermSchema = PenaltyTermInputSchema.extend({
  id: z.uuid(),
  source: z.enum(["ai", "manual"]),
});
export type PenaltyTerm = z.infer<typeof PenaltyTermSchema>;

/** Mốc AI tìm thấy trong văn bản (loại BA 7 loại; ngày có thể chưa rõ). */
export const AiMilestoneSchema = z.strictObject({
  kind: MilestoneKindSchema,
  title: pgText(200).nullable(),
  due_date: outDate().nullable(),
  amount: money().nullable(),
  quote: quote(),
  /** CR-127 K7 · BR-43: điều khoản gốc (Điều x, trang y) — tuỳ chọn, bản cũ vẫn hợp lệ. */
  clause_ref: clauseRef(),
  page: pageNo(),
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
  /** CR-101 Câu 9: AI gợi ý loại chứng từ (HĐ kinh tế / HĐ nguyên tắc / giao dịch). */
  doc_type_suggest: DocTypeSchema.nullable().optional(),
  /** CR-127 K7 · BR-55/56 (tuỳ chọn): điều cần lưu ý, rủi ro, phạt dạng số. */
  notes: z.array(AiNoteSchema).max(AI_NOTES_MAX).optional(),
  risks: z.array(AiRiskSchema).max(AI_RISKS_MAX).optional(),
  penalty_terms: z.array(PenaltyTermInputSchema).max(PENALTY_TERMS_MAX).optional(),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

/** V2-G: phần AI đọc lưu cùng HĐ (`contracts.ai_read`) và trả ở chi tiết — loại AI đoán, trường chưa chắc, tóm tắt, mốc tìm thấy
 *  (kèm cờ `verified`: trích dẫn có trong văn bản). */
export const AiReadSchema = z.strictObject({
  deal: ContractDealSchema.nullable(),
  unsure: z.array(z.enum(AI_UNSURE_KEYS)).max(AI_UNSURE_KEYS.length),
  summary: AiSummarySchema.nullable(),
  milestones: z.array(AiMilestoneSchema.extend({ verified: z.boolean() })).max(AI_MILESTONES_MAX),
  /** CR-101 Câu 9: ô "Loại chứng từ" tô vàng "AI" khi có; người dùng chọn lại được. */
  doc_type_suggest: DocTypeSchema.nullable().optional(),
  /** CR-127 K7: thẻ "Điều cần lưu ý" / "Cần chú ý" (vắng ở bản trích cũ). Phạt số ở `ContractDetail.penalty_terms`. */
  notes: z.array(AiNoteSchema).max(AI_NOTES_MAX).optional(),
  risks: z.array(AiRiskSchema).max(AI_RISKS_MAX).optional(),
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
  /** CR-127: trích lại ⇒ HĐ vẫn `draft`, `extract_state = reading`. */
  status: z.literal("draft"),
  extract_state: z.literal("reading"),
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
    number: DocNumberSchema.nullable().optional(),
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
  /** CR-127: tạo tay ⇒ `done` ngay (`created_done`, hiệu lực tính từ ngày) + mốc mặc định. */
  status: z.literal("done"),
  version: VersionSchema,
});
export type ManualContractResponse = z.infer<typeof ManualContractResponseSchema>;
