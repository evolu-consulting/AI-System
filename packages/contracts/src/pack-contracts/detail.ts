// HD-FR-01 · HD-FR-06 · HD-FR-07 · HD-FR-08 · HD-AC06 · D-13 · HD1 plan §1–§2: Detail, PATCH trường, tải lên gói hợp đồng.
import { z } from "zod";
import { IsoDateTime, VersionSchema } from "../common";
import {
  CONTRACT_APPENDICES_MAX,
  ContractAppendixRefSchema,
  ContractParentRefSchema,
} from "./appendix";
import { DocNumberSchema } from "./doc-number";
import { ContractDocSchema } from "./doc-types";
import { AiReadSchema, PENALTY_TERMS_MAX, PenaltyTermSchema } from "./extract";
import {
  CONTRACT_EVENT_TYPE_RE,
  CONTRACT_FIELD_KEYS,
  CONTRACT_TITLE_MAX,
  type ContractFieldKey,
  ContractFieldsSchema,
  ContractItemSchema,
  ContractKindSchema,
  EffectOutcomeSchema,
  ExtractStateSchema,
  fieldValueSchema,
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
import { SUBMIT_BLOCKS } from "./submit";
import { CONTRACT_VERSIONS_MAX, ContractVersionRefSchema } from "./versions";

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

/** CR-127 K2a-1 · BR-09/44: nút theo trạng thái (+ quyền người gọi); UI hiện lý do khi không bấm được. */
export const ContractCanSchema = z.strictObject({
  submit: z.boolean(),
  withdraw: z.boolean(),
  recreate: z.boolean(),
  new_version: z.boolean(),
  hold: z.boolean(),
  release: z.boolean(),
  /** CR-127 SG1 · BR-68: người gọi quyết được kết cục hiệu lực (Gia hạn / Chấm dứt / Để hết hạn) — HĐ đã duyệt sắp hết hạn, công ty không có quy trình `contract.expiring` khớp. */
  expiry: z.boolean().optional(),
  /** CR-127 · Z8: xoá HĐ — HĐ draft: người tạo / phụ trách / quản trị gói; HĐ khác: quản trị gói. Máy chủ tính (luật `canDeleteContract`), web chỉ đọc. */
  delete: z.boolean().optional(),
});
export type ContractCan = z.infer<typeof ContractCanSchema>;

/** Hàng `contracts` trừ `source_text`/`search_key`/`signer_keys` (D-13) + fields, items, 50 event, file, has_source. */
export const ContractDetailSchema = ContractListRowSchema.omit({
  category_ids: true,
  can_delete: true,
}).extend({
  error: z.string().max(CONTRACT_ERROR_TEXT_MAX).nullable(),
  created_by: z.uuid(),
  created_at: IsoDateTime,
  confirmed_at: IsoDateTime.nullable(),
  confirmed_by: z.uuid().nullable(),
  file_id: z.uuid().nullable(),
  clauses: z.array(z.unknown()),
  warnings: z.array(z.unknown()),
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
  /** CR-127 K7 · BR-56: điều khoản phạt dạng số (nguồn: `contracts.penalty_terms`). */
  penalty_terms: z.array(PenaltyTermSchema).max(PENALTY_TERMS_MAX).optional(),
  /** CR-097 K1 · HD-FR-100: lúc/người khoá (= xác nhận); `locked` (từ ListRow) = `locked_at !== null`. */
  locked_at: IsoDateTime.nullable(),
  locked_by: z.uuid().nullable(),
  /** CR-097 decision 1: HĐ có tệp văn bản gốc (`file_id`); false ⇒ HĐ nhập tay cũ, UI nhãn "Chưa có văn bản". */
  has_document: z.boolean(),
  /** CR-097 K2 · HD-FR-102: chuỗi phiên bản. `root_id` = id v1; `current_id` = bản hiện hành (≠ `id` ⇒ UI "Đã thay thế bởi phiên
   *  bản N" + "Mở bản hiện hành"); `superseded_*` khác null ⇒ bản này chỉ đọc. `versions` = các bản thấy được, tăng dần. */
  root_id: z.uuid(),
  current_id: z.uuid().nullable(),
  superseded_at: IsoDateTime.nullable(),
  superseded_by: z.uuid().nullable(),
  /** CR-127 K2a-1: kết cục Gia hạn/Chấm dứt + lúc ghi; vòng gửi duyệt + người gửi gần nhất; nút nào bấm được (đã tính quyền theo người gọi). */
  effect_outcome: EffectOutcomeSchema.nullable(),
  effect_outcome_at: IsoDateTime.nullable(),
  submit_round: z.number().int().min(0),
  submitted_by: z.uuid().nullable(),
  can: ContractCanSchema,
  /** NF1 · HĐ DRAFT mà Gửi sẽ bị chặn ⇒ lý do (`no_flow` = công ty chưa có quy trình duyệt khớp; khi đó `can.submit = false`); gửi được / không phải DRAFT ⇒ null.
   *  Tính bằng CÙNG hàm "có quy trình khớp" của lệnh Gửi (`submitFlowOpen`). Chỉ chi tiết, không có ở danh sách. */
  submit_block: z.enum(SUBMIT_BLOCKS).nullable().optional(),
  /** CR-127 SG1 · K8: HĐ nhận đang chờ CHÍNH người phụ trách quyết Đồng ý / Trả lại / Từ chối (`partner_inbox.awaiting_decision`); HĐ không phải HĐ nhận ⇒ false. */
  awaiting_decision: z.boolean().optional(),
  /** CR-127 SG1 · U5 · BR-26: lý do người duyệt nhập khi Trả lại (HĐ đang DRAFT sau khi bị trả lại) — chỉ người gửi / người phụ trách / người trong quy trình (`canReadEvidence`); còn lại null. */
  return_reason: z.string().nullable().optional(),
  versions: z.array(ContractVersionRefSchema).max(CONTRACT_VERSIONS_MAX),
  /** CR-101 DOC-model: loại chứng từ, cha (HĐ NT) / con + tổng hợp HĐ NT. Hub luôn trả; optional để fixture cũ còn hợp lệ. */
  doc: ContractDocSchema.optional(),
  /** CR-101 DOC-legal (Câu 8): cảnh báo pháp lý của giao dịch đứng riêng (chỉ cảnh báo, không chặn); không có ⇒ null. */
  legal_warning: z
    .strictObject({ threshold: z.number().int().min(1), reason: z.string() })
    .nullable()
    .optional(),
});
export type ContractDetail = z.infer<typeof ContractDetailSchema>;

type PatchShape = { [K in ContractFieldKey]: z.ZodOptional<z.ZodNullable<z.ZodType>> };
const PATCH_SHAPE = Object.fromEntries(
  CONTRACT_FIELD_KEYS.map((k) => [
    k,
    // CR-122 p12: chỉ khoá `number` được gửi lên (đã đổi) mới bị kiểm định dạng; số cũ có "/" không đụng tới thì không bị chặn.
    k === "number" ? DocNumberSchema.nullable().optional() : fieldValueSchema(k).optional(),
  ]),
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
/** CR-122 p9 (FLOW2-FR-27): thêm WEBP/GIF (ảnh, gửi thẳng AI), tệp chữ (txt/csv/html/rtf/xml/json) và zip-office (xlsx/pptx/odt) lấy chữ. */
export const CONTRACT_FILE_TYPES = [
  "pdf",
  "docx",
  "jpeg",
  "png",
  "md",
  "webp",
  "gif",
  "text",
  "office",
] as const;
export type ContractFileType = (typeof CONTRACT_FILE_TYPES)[number];
export const CONTRACT_FILE_MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  png: "image/png",
  md: "text/markdown",
  webp: "image/webp",
  gif: "image/gif",
  text: "text/plain",
  office: "application/zip",
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
  /** CR-127 K1b: HĐ tải lên luôn vào DRAFT; `extract_state` = AI đang đọc / đọc lỗi / đã điền sẵn. */
  status: z.literal("draft"),
  extract_state: ExtractStateSchema,
  version: VersionSchema,
});
export type UploadContractResponse = z.infer<typeof UploadContractResponseSchema>;
