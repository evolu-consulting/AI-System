// CR-188 · BR-188-5 · `GET /pack/contracts/my-signatures/:sigId/documents?kind=&from=&to=&cursor=` — «Giấy tờ đã ký bằng chữ ký này».
// Chữ ký phải của chính người gọi; quản trị công ty xem được của người khác (BR-188-4). Chỉ giấy tờ người gọi có quyền mở HĐ.
import { z } from "zod";

export const SIG_DOCS_PAGE = 50;
export const SigDocKindSchema = z.enum(["contract", "appendix", "other"]);
export type SigDocKind = z.infer<typeof SigDocKindSchema>;

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const SigDocsQuerySchema = z.object({
  kind: SigDocKindSchema.optional(),
  from: Day.optional(),
  to: Day.optional(),
  cursor: z.string().max(100).optional(),
});
export type SigDocsQuery = z.infer<typeof SigDocsQuerySchema>;

export const SigDocItemSchema = z.object({
  version_id: z.uuid(),
  contract_id: z.uuid(),
  title: z.string(),
  kind: SigDocKindSchema,
  partner: z.string().nullable(),
  file_name: z.string(),
  seq: z.number().int(),
  signed_at: z.string(),
});
export const SigDocsResponseSchema = z.object({
  items: z.array(SigDocItemSchema),
  next_cursor: z.string().nullable(),
});
export type SigDocItem = z.infer<typeof SigDocItemSchema>;
export type SigDocsResponse = z.infer<typeof SigDocsResponseSchema>;
