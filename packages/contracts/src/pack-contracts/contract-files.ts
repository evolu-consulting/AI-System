// CR-133 · «Tài liệu kèm» trên HĐ: `GET /contracts/:id/files` (hai nhóm trong MỘT khối) · `POST /contracts/:id/files` (multipart `file`) ·
// `DELETE /contracts/:id/files/:fileId` · `GET /contracts/:id/files/:fileId/link`. Nhóm 1 = tệp gắn thẳng vào HĐ (thêm/gỡ/tải); nhóm 2 = tệp kèm
// các bước duyệt của HĐ (chỉ đọc, tải qua `GET /attachments/:id/content` của Hub). Không đem đi ký (file chính vẫn theo luật PDF khi bật ký số).
import { z } from "zod";

export const CONTRACT_FILES_ERRORS = {
  /** Đuôi tệp ngoài danh sách nhận (`ATTACH_ALLOWED`). */
  FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  /** Đủ trần tệp kèm của một HĐ. */
  CONTRACT_FILES_FULL: 409,
} as const;

export const ContractOwnFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  added_by: z.uuid(),
  added_at: z.string(),
  /** Người gọi gỡ được tệp này (quyền sửa HĐ hoặc chính người đã gắn). */
  can_remove: z.boolean(),
});
export const ContractStepFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  /** Nguồn liên kết với lượt duyệt: lúc bắt đầu / biểu mẫu của bước / quy trình con. */
  source: z.enum(["start", "form", "subprocess"]),
  added_at: z.string(),
});
export const ContractFilesResponseSchema = z.object({
  files: z.array(ContractOwnFileSchema),
  steps: z.array(ContractStepFileSchema),
  /** Người gọi thêm được tệp vào HĐ này (quyền sửa HĐ). */
  can_add: z.boolean(),
});
export type ContractFilesResponse = z.infer<typeof ContractFilesResponseSchema>;
export type ContractOwnFile = z.infer<typeof ContractOwnFileSchema>;
export type ContractStepFile = z.infer<typeof ContractStepFileSchema>;
