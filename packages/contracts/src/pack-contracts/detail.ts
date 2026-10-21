// HD-FR-01 · HD-FR-06 · HD-FR-07 · HD-FR-08 · HD-AC06 · D-13 · HD1 plan §1–§2: Detail, PATCH trường, tải lên gói hợp đồng.
import { z } from "zod";
import { IsoDateTime, VersionSchema } from "../common";
import {
  CONTRACT_APPENDICES_MAX,
  ContractAppendixRefSchema,
  ContractParentRefSchema,
} from "./appendix";
import { AiReadSchema } from "./extract";
import {
  CONTRACT_EVENT_TYPE_RE,
  CONTRACT_FIELD_KEYS,
  CONTRACT_TITLE_MAX,
  type ContractFieldKey,
  ContractFieldsSchema,
  ContractItemSchema,
  ContractKindSchema,
  fieldValueSchema,
  HandledOutcomeSchema,
  IsoDateSchema,
  nfcText,
} from "./fields";
import { ContractListRowSchema } from "./list";
import {
  ContractDealSchema,
  ContractStageSchema,
  MILESTONES_MAX,
  MilestoneSchema,
} from "./milestones";

export const CONTRACT_EVENTS_MAX = 50;
export const CONTRACT_ITEMS_MAX = 500;
export const CONTRACT_SOURCE_MAX = 5_000_000;
export const CONTRACT_ERROR_TEXT_MAX = 2000;

export const ContractEventSchema = z.strictObject({
  id: z.number().int().min(1),
  type: z.string().regex(CONTRACT_EVENT_TYPE_RE),
  actor_user_id: z.uuid().nullable(),
  at: IsoDateTime,
  data: z.record(z.string(), z.unknown()),
});
export type ContractEvent = z.infer<typeof ContractEventSchema>;

/** Tệp gốc (hàng `contracts.files` của kit N1). */
export const ContractFileSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(255),
  mime: z.string().max(128),
  size_bytes: z.number().int().min(0),
});
export type ContractFile = z.infer<typeof ContractFileSchema>;

/** `handled` do HD4 ghi; HD1 chỉ chốt `outcome` (CHECK DB), giữ khoá khác. */
export const ContractHandledSchema = z.looseObject({ outcome: HandledOutcomeSchema });

/** Hàng `contracts` trừ `source_text`/`search_key`/`signer_keys` (D-13) + fields, items, 50 event, file, has_source. */
export const ContractDetailSchema = ContractListRowSchema.omit({ category_ids: true }).extend({
  error: z.string().max(CONTRACT_ERROR_TEXT_MAX).nullable(),
  created_by: z.uuid(),
  created_at: IsoDateTime,
  confirmed_at: IsoDateTime.nullable(),
  confirmed_by: z.uuid().nullable(),
  file_id: z.uuid().nullable(),
  clauses: z.array(z.unknown()),
  warnings: z.array(z.unknown()),
  handled: ContractHandledSchema.nullable(),
  run_id: z.uuid().nullable(),
  fields: ContractFieldsSchema,
  items: z.array(ContractItemSchema).max(CONTRACT_ITEMS_MAX),
  events: z.array(ContractEventSchema).max(CONTRACT_EVENTS_MAX),
  file: ContractFileSchema.nullable(),
  has_source: z.boolean(),
  /** HD5: HĐ gốc (khi `kind = appendix`) và các phụ lục (khi là HĐ gốc). */
  parent: ContractParentRefSchema.nullable(),
  appendices: z.array(ContractAppendixRefSchema).max(CONTRACT_APPENDICES_MAX),
  /** V2-A: loại HĐ, hoa hồng (Giới thiệu), ngày bắt đầu, giai đoạn suy từ mốc, dãy mốc (hạn tăng dần). */
  deal: ContractDealSchema.nullable(),
  commission_pct: z.number().min(0).max(100).nullable(),
  commission_fixed: z.number().int().min(0).nullable(),
  start_date: IsoDateSchema.nullable(),
  stage: ContractStageSchema,
  next_milestone_id: z.uuid().nullable(),
  milestones: z.array(MilestoneSchema).max(MILESTONES_MAX),
  /** V2-G: phần AI đọc (loại đoán, trường chưa chắc, tóm tắt 5 mục, mốc tìm thấy); HĐ nhập tay / chưa đọc ⇒ null. */
  ai: AiReadSchema.nullable(),
});
export type ContractDetail = z.infer<typeof ContractDetailSchema>;

type PatchShape = { [K in ContractFieldKey]: z.ZodOptional<z.ZodNullable<z.ZodType>> };
const PATCH_SHAPE = Object.fromEntries(
  CONTRACT_FIELD_KEYS.map((k) => [k, fieldValueSchema(k).optional()]),
) as PatchShape;

/** Khoá lạ ⇒ route trả 422 `FIELD_UNKNOWN`, sai kiểu ⇒ 422 `FIELD_INVALID` (plan §1). */
export const PatchFieldsRequestSchema = z.strictObject({
  version: VersionSchema,
  fields: z
    .strictObject(PATCH_SHAPE)
    .refine((f) => Object.keys(f).length >= 1, { message: "cần ≥ 1 khoá" }),
});
export type PatchFieldsRequest = z.infer<typeof PatchFieldsRequestSchema>;

export const PatchFieldsResponseSchema = z.strictObject({
  id: z.uuid(),
  version: VersionSchema,
  updated_at: IsoDateTime,
  fields: ContractFieldsSchema,
});
export type PatchFieldsResponse = z.infer<typeof PatchFieldsResponseSchema>;

/** Tải lên (D-09): PDF, DOCX, JPEG, PNG theo magic bytes; Markdown (.md, UTF-8 thuần, Gap #9); ≤ 20 MiB; 30/tenant/ngày, 300/hệ thống/ngày (D-06). */
export const CONTRACT_FILE_TYPES = ["pdf", "docx", "jpeg", "png", "md"] as const;
export type ContractFileType = (typeof CONTRACT_FILE_TYPES)[number];
export const CONTRACT_FILE_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
  md: "text/markdown",
} as const satisfies Record<ContractFileType, string>;
export const CONTRACT_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
export const CONTRACT_UPLOAD_TENANT_DAILY = 30;
export const CONTRACT_UPLOAD_GLOBAL_DAILY = 300;

/** Phần chữ của multipart (ngoài `file`); `appendix` thiếu/sai `parent_id` ⇒ route 422 `PARENT_INVALID`. */
export const UploadContractFormSchema = z.strictObject({
  kind: ContractKindSchema.default("contract"),
  parent_id: z.uuid().optional(),
  title: nfcText(CONTRACT_TITLE_MAX).min(1).optional(),
});
export type UploadContractForm = z.infer<typeof UploadContractFormSchema>;

export const UploadContractResponseSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(["extracting", "extract_failed"]),
  version: VersionSchema,
});
export type UploadContractResponse = z.infer<typeof UploadContractResponseSchema>;
