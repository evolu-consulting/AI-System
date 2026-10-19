// HD-FR-52…55 · HD5 plan: danh bạ thành viên, loại hàng, phụ lục gắn HĐ gốc (gợi ý + chọn tay) và bảng giá có áp phụ lục.
import { z } from "zod";
import { CountSchema, IsoDateTime, VersionSchema } from "../common";
import {
  CONTRACT_TITLE_MAX,
  ContractItemSchema,
  ContractKindSchema,
  ContractStatusSchema,
  IsoDateSchema,
  nfcText,
} from "./fields";

/** HĐ gốc của một phụ lục (tiêu đề + số để hiện "Phụ lục của …"). */
export const ContractParentRefSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(CONTRACT_TITLE_MAX),
  number: z.string().nullable(),
});
export type ContractParentRef = z.infer<typeof ContractParentRefSchema>;

export const CONTRACT_APPENDICES_MAX = 100;
/** Phụ lục của một HĐ gốc (mới nhất trước). `effective_date` lấy từ trường `effective_date`. */
export const ContractAppendixRefSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(CONTRACT_TITLE_MAX),
  number: z.string().nullable(),
  status: ContractStatusSchema,
  effective_date: IsoDateSchema.nullable(),
});
export type ContractAppendixRef = z.infer<typeof ContractAppendixRefSchema>;

// ---------- danh bạ + loại hàng ----------
export const MEMBERS_MAX = 1000;
export const MembersResponseSchema = z.strictObject({
  items: z
    .array(z.strictObject({ id: z.uuid(), name: z.string().min(1).max(200) }))
    .max(MEMBERS_MAX),
});
export type MembersResponse = z.infer<typeof MembersResponseSchema>;

export const CATEGORY_NAME_MAX = 40;
export const CATEGORIES_MAX = 200;
export const ContractCategorySchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(CATEGORY_NAME_MAX),
});
export type ContractCategory = z.infer<typeof ContractCategorySchema>;
export const CategoriesResponseSchema = z.strictObject({
  items: z.array(ContractCategorySchema).max(CATEGORIES_MAX),
});
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;
export const CreateCategoryRequestSchema = z.strictObject({
  name: nfcText(CATEGORY_NAME_MAX).min(1),
});
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequestSchema>;

// ---------- gắn HĐ gốc ----------
/** `parent_id` = uuid ⇒ HĐ này là phụ lục của HĐ đó; `null` ⇒ gỡ (trở lại HĐ). */
export const AttachParentRequestSchema = z.strictObject({
  version: VersionSchema,
  parent_id: z.uuid().nullable(),
});
export type AttachParentRequest = z.infer<typeof AttachParentRequestSchema>;
export const AttachParentResponseSchema = z.strictObject({
  id: z.uuid(),
  kind: ContractKindSchema,
  parent_id: z.uuid().nullable(),
  version: VersionSchema,
  updated_at: IsoDateTime,
});
export type AttachParentResponse = z.infer<typeof AttachParentResponseSchema>;

export const PARENT_SUGGEST_REASONS = ["cited_number", "same_parties", "same_supplier"] as const;
export const ParentSuggestionSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(CONTRACT_TITLE_MAX),
  number: z.string().nullable(),
  seller: z.string().nullable(),
  buyer: z.string().nullable(),
  reason: z.enum(PARENT_SUGGEST_REASONS),
});
export type ParentSuggestion = z.infer<typeof ParentSuggestionSchema>;
export const PARENT_SUGGESTIONS_MAX = 5;
export const ParentSuggestionsResponseSchema = z.strictObject({
  items: z.array(ParentSuggestionSchema).max(PARENT_SUGGESTIONS_MAX),
});
export type ParentSuggestionsResponse = z.infer<typeof ParentSuggestionsResponseSchema>;

// ---------- bảng giá có áp phụ lục ----------
/** Một dòng hàng của HĐ gốc hoặc phụ lục + hiệu lực sau khi áp phụ lục (D-HD5-01: tính khi đọc, không ghi DB). */
export const PriceLineSchema = z.strictObject({
  item: ContractItemSchema.pick({
    code: true,
    name: true,
    spec: true,
    unit: true,
    qty: true,
    unit_price: true,
    vat_rate: true,
  }),
  source: z.strictObject({
    id: z.uuid(),
    kind: ContractKindSchema,
    title: z.string().min(1).max(CONTRACT_TITLE_MAX),
  }),
  valid_from: IsoDateSchema.nullable(),
  valid_to: IsoDateSchema.nullable(),
  /** Phụ lục đã thay dòng này (chỉ dòng của HĐ gốc / phụ lục cũ hơn). */
  superseded_by: z.uuid().nullable(),
  /** Đang là giá áp dụng vào `as_of`. */
  current: z.boolean(),
});
export type PriceLine = z.infer<typeof PriceLineSchema>;
export const PRICE_LINES_MAX = 2000;
export const ContractPricesResponseSchema = z.strictObject({
  as_of: IsoDateSchema,
  lines: z.array(PriceLineSchema).max(PRICE_LINES_MAX),
  total: CountSchema,
});
export type ContractPricesResponse = z.infer<typeof ContractPricesResponseSchema>;
