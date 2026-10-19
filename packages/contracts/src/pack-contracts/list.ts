// HD-FR-07 · HD-AC03 · HD-AC05 · D-03 · D-10 · D-18 · HD1 plan §1: ListQuery / ListRow / ListResponse / Facets gói hợp đồng.
import { z } from "zod";
import { CountSchema, IsoDateTime } from "../common";
import {
  CONTRACT_DIRECTIONS,
  CONTRACT_STATUSES,
  CONTRACT_TITLE_MAX,
  CONTRACT_TOTAL_VALUE_MAX,
  ContractDirectionSchema,
  ContractKindSchema,
  ContractStatusSchema,
  ContractTypeSchema,
  IsoDateSchema,
  nfcText,
} from "./fields";

export const CONTRACT_PAGE_MAX = 1000;
export const CONTRACT_PAGE_SIZE_MAX = 100;
export const CONTRACT_PAGE_SIZE_DEFAULT = 20;
export const CONTRACT_Q_MIN = 2;
export const CONTRACT_Q_MAX = 100;
export const CONTRACT_SORTS = ["updated_at", "value", "end_date", "title"] as const;
export const CONTRACT_SORT_DIRS = ["asc", "desc"] as const;
/** Bộ lọc hướng: `unknown` = `direction IS NULL`. */
export const CONTRACT_DIRECTION_FILTERS = [...CONTRACT_DIRECTIONS, "unknown"] as const;
export const ContractDirectionFilterSchema = z.enum(CONTRACT_DIRECTION_FILTERS);

/** Tham số lặp (`?status=a&status=b`) ⇒ mảng; một giá trị ⇒ mảng 1 phần tử. */
const repeated = <T extends z.ZodType>(item: T, max: number) =>
  z
    .preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item).max(max))
    .optional();
const nameText = (max: number) => nfcText(max).min(1);
const valueBound = () => z.coerce.number().int().min(0).max(CONTRACT_TOTAL_VALUE_MAX).optional();

/** `q`: trim + NFC (D-18); rỗng = bỏ; còn lại 2…100 ký tự. */
const QSchema = nfcText(CONTRACT_Q_MAX)
  .refine((v) => v === "" || v.length >= CONTRACT_Q_MIN, { message: "q quá ngắn" })
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const ContractListQuerySchema = z.strictObject({
  q: QSchema,
  status: repeated(ContractStatusSchema, CONTRACT_STATUSES.length),
  owner: repeated(z.uuid(), 50),
  category: repeated(z.uuid(), 50),
  seller: repeated(nameText(300), 50),
  buyer: repeated(nameText(300), 50),
  signer: repeated(nameText(300), 20),
  direction: repeated(ContractDirectionFilterSchema, CONTRACT_DIRECTION_FILTERS.length),
  kind: repeated(ContractKindSchema, 2),
  value_min: valueBound(),
  value_max: valueBound(),
  sort: z.enum(CONTRACT_SORTS).default("updated_at"),
  dir: z.enum(CONTRACT_SORT_DIRS).default("desc"),
  page: z.coerce.number().int().min(1).max(CONTRACT_PAGE_MAX).default(1),
  page_size: z.coerce
    .number()
    .int()
    .min(1)
    .max(CONTRACT_PAGE_SIZE_MAX)
    .default(CONTRACT_PAGE_SIZE_DEFAULT),
});
export type ContractListQuery = z.infer<typeof ContractListQuerySchema>;

/** Dòng tóm tắt = cột màn danh sách S03 (D-02); trống ⇒ null. */
export const ContractListRowSchema = z.strictObject({
  id: z.uuid(),
  kind: ContractKindSchema,
  parent_id: z.uuid().nullable(),
  title: z.string().min(1).max(CONTRACT_TITLE_MAX),
  number: z.string().nullable(),
  type: ContractTypeSchema.nullable(),
  direction: ContractDirectionSchema.nullable(),
  status: ContractStatusSchema,
  seller: z.string().nullable(),
  buyer: z.string().nullable(),
  seller_signer: z.string().nullable(),
  buyer_signer: z.string().nullable(),
  value: z.number().int().nullable(),
  end_date: IsoDateSchema.nullable(),
  action_deadline: IsoDateSchema.nullable(),
  owner_user_id: z.uuid().nullable(),
  category_ids: z.array(z.uuid()).max(50),
  updated_at: IsoDateTime,
  version: z.number().int().min(1),
});
export type ContractListRow = z.infer<typeof ContractListRowSchema>;

export const ContractListResponseSchema = z.strictObject({
  items: z.array(ContractListRowSchema).max(CONTRACT_PAGE_SIZE_MAX),
  total: CountSchema,
  page: z.number().int().min(1),
  page_size: z.number().int().min(1).max(CONTRACT_PAGE_SIZE_MAX),
});
export type ContractListResponse = z.infer<typeof ContractListResponseSchema>;

export const CONTRACT_FACET_TEXT_MAX = 500;
export const CONTRACT_FACET_CATEGORY_MAX = 200;
/** Facet có thể bị cắt ở trần ⇒ tên nằm trong `truncated`. */
export const CONTRACT_TRUNCATABLE_FACETS = [
  "owner",
  "seller",
  "buyer",
  "signer",
  "category",
] as const;

const count = <V extends z.ZodType>(v: V) => z.strictObject({ v, n: CountSchema });
const labelled = <V extends z.ZodType>(v: V) =>
  z.strictObject({ v, label: z.string(), n: CountSchema });

/** Facet trên CẢ tenant (D-10), không theo bộ lọc. `category.n` = số HĐ có ≥ 1 item loại đó; `signer.label` = `min(raw)`. */
export const ContractFacetsSchema = z.strictObject({
  status: z.array(count(ContractStatusSchema)).max(CONTRACT_STATUSES.length),
  direction: z.array(count(ContractDirectionFilterSchema)).max(CONTRACT_DIRECTION_FILTERS.length),
  kind: z.array(count(ContractKindSchema)).max(2),
  owner: z.array(count(z.uuid())).max(CONTRACT_FACET_TEXT_MAX),
  seller: z.array(count(z.string())).max(CONTRACT_FACET_TEXT_MAX),
  buyer: z.array(count(z.string())).max(CONTRACT_FACET_TEXT_MAX),
  signer: z.array(labelled(z.string())).max(CONTRACT_FACET_TEXT_MAX),
  category: z.array(labelled(z.uuid())).max(CONTRACT_FACET_CATEGORY_MAX),
  value: z.strictObject({ min: z.number().int(), max: z.number().int() }).nullable(),
  truncated: z.array(z.enum(CONTRACT_TRUNCATABLE_FACETS)),
});
export type ContractFacets = z.infer<typeof ContractFacetsSchema>;
