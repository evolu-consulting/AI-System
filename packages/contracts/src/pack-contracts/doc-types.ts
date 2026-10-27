// CR-101 DOC-model · R3, R4, R30 API, R36, R42–R46 · Câu 9: loại chứng từ + HĐ nguyên tắc (chứng từ cha).
// `doc_type`: contract (HĐ kinh tế) | framework (HĐ nguyên tắc) | deal (giao dịch, DOC-deals). Con gắn HĐ NT qua `frame_root_id`
// (= `root_id` chuỗi phiên bản HĐ NT). HĐ NT: hạn mức (`credit_limit`, tuỳ chọn), cách đặt hàng (`order_terms`), giá trị = Σ con.
import { z } from "zod";
import { CONTRACT_TOTAL_VALUE_MAX, IsoDateSchema, nfcText } from "./fields";

export const DOC_TYPES = ["contract", "framework", "deal"] as const;
export const DocTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof DocTypeSchema>;
export const ORDER_TERMS_MAX = 4000;
/** Số chứng từ tối đa mỗi lần gắn; số con trả trong chi tiết HĐ NT. */
export const DOC_ATTACH_MAX = 100;
export const FRAME_CHILDREN_MAX = 500;

export const DOC_ERRORS = {
  /** Cha không phải HĐ NT (v1 của chuỗi) / không thấy / con không hợp lệ (HĐ NT, phụ lục). */
  FRAME_INVALID: 422,
  /** R43: con khác đối tác hoặc khác hướng với HĐ NT. */
  FRAME_PARTNER_MISMATCH: 422,
  /** R44: HĐ NT chỉ có mốc nhắc gia hạn / khác. */
  FRAME_MILESTONE_KIND: 422,
  /** HĐ NT còn con ⇒ không đổi loại. */
  FRAME_HAS_CHILDREN: 409,
} as const;
export type DocErrorCode = keyof typeof DOC_ERRORS;

const creditLimit = z.coerce.number().int().min(0).max(CONTRACT_TOTAL_VALUE_MAX);

/** Trường chữ thêm của multipart tải lên (cùng `kind`/`parent_id`/`title`). `credit_limit`/`order_terms` chỉ cho `framework`. */
export const UploadDocFormSchema = z
  .strictObject({
    doc_type: DocTypeSchema.default("contract"),
    frame_root_id: z.uuid().optional(),
    credit_limit: creditLimit.optional(),
    order_terms: nfcText(ORDER_TERMS_MAX).min(1).optional(),
  })
  .refine(
    (v) =>
      v.doc_type === "framework"
        ? v.frame_root_id === undefined
        : v.credit_limit === undefined && v.order_terms === undefined,
    { message: "credit_limit/order_terms chỉ cho HĐ nguyên tắc; HĐ nguyên tắc không có cha" },
  );
export type UploadDocForm = z.infer<typeof UploadDocFormSchema>;

/** `POST /contracts/:id/attach` (`:id` = HĐ NT, bản bất kỳ của chuỗi): gắn chứng từ có sẵn (cùng đối tác + hướng). */
export const AttachDocsRequestSchema = z.strictObject({
  ids: z.array(z.uuid()).min(1).max(DOC_ATTACH_MAX),
});
export type AttachDocsRequest = z.infer<typeof AttachDocsRequestSchema>;
export const AttachDocsResponseSchema = z.strictObject({
  frame_root_id: z.uuid(),
  attached: z.array(z.uuid()).max(DOC_ATTACH_MAX),
});
export type AttachDocsResponse = z.infer<typeof AttachDocsResponseSchema>;
/** `DELETE /contracts/:id/frame` (`:id` = con): gỡ liên kết ⇒ con đứng riêng. */
export const DetachDocResponseSchema = z.strictObject({ id: z.uuid(), detached: z.boolean() });

/** Tham chiếu cha của con: thấy được ⇒ id/tiêu đề/số; RLS không thấy cha ⇒ `{restricted: true}`. */
export const FrameRefSchema = z.union([
  z.strictObject({ id: z.uuid(), title: z.string(), number: z.string().nullable() }),
  z.strictObject({ restricted: z.literal(true) }),
]);
export type FrameRef = z.infer<typeof FrameRefSchema>;

export const FrameStageSchema = z.enum(["not_started", "active", "expired"]);
export const FrameChildSchema = z.strictObject({
  id: z.uuid(),
  doc_type: DocTypeSchema,
  title: z.string(),
  number: z.string().nullable(),
  status: z.string(),
  value: z.number().int().nullable(),
  start_date: IsoDateSchema.nullable(),
  /** R46: ngày bắt đầu con ngoài hiệu lực HĐ NT ⇒ cảnh báo (không chặn). */
  outside_frame: z.boolean(),
});
export type FrameChild = z.infer<typeof FrameChildSchema>;

/** Phần chứng từ của chi tiết HĐ (khoá `doc`). `summary`/`children` chỉ khi là HĐ NT; `frame` chỉ khi là con. */
export const ContractDocSchema = z.strictObject({
  doc_type: DocTypeSchema,
  frame_root_id: z.uuid().nullable(),
  credit_limit: z.number().int().nullable(),
  order_terms: z.string().nullable(),
  frame: FrameRefSchema.nullable(),
  summary: z
    .strictObject({
      stage: FrameStageSchema,
      value: z.number().int(),
      credit_pct: z.number().nullable(),
      children: z.number().int().min(0),
    })
    .nullable(),
  children: z.array(FrameChildSchema).max(FRAME_CHILDREN_MAX),
});
export type ContractDoc = z.infer<typeof ContractDocSchema>;

/** Danh sách (`nest=1` hoặc lọc `doc_type`): thông tin chứng từ theo hàng trang (ListRow giữ 22 khoá) + con của HĐ NT trong trang. */
export const ListDocRefSchema = z.strictObject({
  id: z.uuid(),
  doc_type: DocTypeSchema,
  frame_root_id: z.uuid().nullable(),
  frame_restricted: z.boolean(),
});
export const ListFrameChildSchema = z.strictObject({
  frame_root_id: z.uuid(),
  id: z.uuid(),
  doc_type: DocTypeSchema,
  title: z.string(),
  number: z.string().nullable(),
  status: z.string(),
  value: z.number().int().nullable(),
});
