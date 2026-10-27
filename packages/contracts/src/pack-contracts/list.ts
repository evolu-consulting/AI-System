// HD-FR-07 · HD-AC03 · HD-AC05 · D-03 · D-10 · D-18 · HD1 plan §1: ListQuery / ListRow / ListResponse / Facets gói hợp đồng.
import { z } from "zod";
import { CountSchema, IsoDateTime } from "../common";
import { ContractParentRefSchema } from "./appendix";
import { DocTypeSchema, ListDocRefSchema, ListFrameChildSchema } from "./doc-types";
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
import { ContractProgressSchema } from "./milestones";

export const CONTRACT_PAGE_MAX = 1000;
export const CONTRACT_PAGE_SIZE_MAX = 100;
export const CONTRACT_PAGE_SIZE_DEFAULT = 20;
export const CONTRACT_Q_MIN = 2;
export const CONTRACT_Q_MAX = 100;
export const CONTRACT_SORTS = ["updated_at", "value", "end_date", "title"] as const;
export const CONTRACT_SORT_DIRS = ["asc", "desc"] as const;
/** Gap #10: cột ngày lọc được; cửa sổ tương đối: quá hạn (< hôm nay), 30/60/90 ngày tới (hôm nay … +N). */
export const CONTRACT_DATE_FIELDS = ["end_date", "action_deadline"] as const;
export const CONTRACT_DUE_PRESETS = ["overdue", "30", "60", "90"] as const;
/** Gap #8: xuất danh sách ra tệp (cùng bộ lọc, không phân trang), trần số dòng. */
export const CONTRACT_EXPORT_FORMATS = ["xlsx", "csv"] as const;
export const CONTRACT_EXPORT_MAX_ROWS = 50_000;
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
  /** CR-101 DOC-model: lọc loại chứng từ. */
  doc_type: repeated(DocTypeSchema, 3),
  /** CR-101 DOC-model: `nest=1` ⇒ phân trang theo dòng cha (con có cha thấy được không đứng riêng) + `docs` + `children`. */
  nest: z.enum(["0", "1"]).optional(),
  value_min: valueBound(),
  value_max: valueBound(),
  /** Gap #10: lọc theo ngày — cột (`end_date` hiệu lực đến | `action_deadline` hạn chót), cửa sổ tương đối `due` (so với ngày lịch tenant)
   *  hoặc khoảng `date_from`…`date_to` (gồm cả hai đầu). `due` thắng khoảng. */
  date_field: z.enum(CONTRACT_DATE_FIELDS).optional(),
  due: z.enum(CONTRACT_DUE_PRESETS).optional(),
  date_from: IsoDateSchema.optional(),
  date_to: IsoDateSchema.optional(),
  /** V2-A: `include=progress` ⇒ thêm mảng `progress` (giai đoạn + bước hiện tại); vắng ⇒ hình phản hồi HD1 giữ nguyên. */
  include: z.enum(["progress"]).optional(),
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

/** Gap #8: `GET /contracts/export?format=xlsx|csv&…bộ lọc` — như danh sách, bỏ phân trang/include (sắp xếp giữ). */
export const ContractExportQuerySchema = ContractListQuerySchema.omit({
  page: true,
  page_size: true,
  include: true,
  nest: true,
}).extend({ format: z.enum(CONTRACT_EXPORT_FORMATS).default("xlsx") });
export type ContractExportQuery = z.infer<typeof ContractExportQuerySchema>;

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
  /** CR-097 K1 · HD-FR-100: HĐ đã xác nhận ⇒ khoá (trường pháp lý chỉ đọc). */
  locked: z.boolean(),
  /** CR-097 K2 · R18: số thứ tự phiên bản của hàng + số phiên bản của chuỗi (badge "vN" khi > 1). ListRow 22 khoá. */
  version_no: z.number().int().min(1),
  versions_count: z.number().int().min(1),
});
export type ContractListRow = z.infer<typeof ContractListRowSchema>;

export const ContractListResponseSchema = z.strictObject({
  items: z.array(ContractListRowSchema).max(CONTRACT_PAGE_SIZE_MAX),
  total: CountSchema,
  /** HD5: HĐ gốc của các hàng phụ lục trong trang (mỗi HĐ gốc một lần), để hiện "Phụ lục của …" mà không đổi `ContractListRow`. */
  parents: z.array(ContractParentRefSchema).max(CONTRACT_PAGE_SIZE_MAX),
  /** V2-A (chỉ khi `include=progress`): loại HĐ + giai đoạn + bước hiện tại từng HĐ của trang (cùng thứ tự `items`; ListRow
   *  đã khoá giữ 19 khoá). */
  progress: z.array(ContractProgressSchema).max(CONTRACT_PAGE_SIZE_MAX).optional(),
  /** CR-101 DOC-model (chỉ khi `nest=1` hoặc lọc `doc_type`): loại chứng từ từng hàng (cùng thứ tự `items`) + con của HĐ NT
   *  trong trang (chỉ bản hiện hành, thấy được). */
  docs: z.array(ListDocRefSchema).max(CONTRACT_PAGE_SIZE_MAX).optional(),
  children: z
    .array(ListFrameChildSchema)
    .max(CONTRACT_PAGE_SIZE_MAX * 50)
    .optional(),
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
