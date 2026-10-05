// HUB-FR-44, HUB-FR-12 · đính kèm kênh Chat↔Hub (plan H2c §2.1, P2): chỉ thêm, không đổi thực thể C1.
// Không import I/O: chạy được ở trình duyệt, mock và test.
import { z } from "zod";
import { ATTACH_MAX_BYTES, AttachMimeSchema, IsoDateTime, UuidSchema } from "../common";

export { ATTACH_ALLOWED, ATTACH_MAX_BYTES, type AttachMime } from "../common";

export const ATTACH_PER_MESSAGE_MAX = 10;
export const ATTACH_FILENAME_MAX = 200;
export const ATTACH_FILENAME_HEADER_MAX_BYTES = 1024;
/** Header mang tên file khi upload (percent-encode UTF-8). */
export const FILENAME_HEADER = "X-Filename";

const FilenameSchema = z.string().min(1).max(ATTACH_FILENAME_MAX);
const SizeSchema = z.number().int().min(1).max(ATTACH_MAX_BYTES);

/** 201 của `POST /attachments`. */
export const AttachmentSchema = z.strictObject({
  id: UuidSchema,
  filename: FilenameSchema,
  mime: AttachMimeSchema,
  size: SizeSchema,
  created_at: IsoDateTime,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/** `GET /attachments/:id`: `available=false` khi nội dung đã bị xoá. */
export const AttachmentDetailSchema = z.strictObject({
  ...AttachmentSchema.shape,
  available: z.boolean(),
});
export type AttachmentDetail = z.infer<typeof AttachmentDetailSchema>;

/** Phần tử `Message.attachments` (tin user lẫn assistant). */
export const AttachmentRefSchema = z.strictObject({
  id: UuidSchema,
  filename: FilenameSchema,
  mime: AttachMimeSchema,
  size: SizeSchema,
  available: z.boolean(),
});
export type AttachmentRef = z.infer<typeof AttachmentRefSchema>;
