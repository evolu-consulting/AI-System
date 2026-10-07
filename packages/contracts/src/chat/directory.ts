// HUB-FR-102 · danh bạ người dùng cùng tenant (X2a plan §2.2). Đúng 4 trường: không email/role/tenant (R22).
import { z } from "zod";
import { DISPLAY_NAME_MAX, LIST_Q_MAX, UuidSchema } from "../common";

export const DIRECTORY_LIMIT_DEFAULT = 20;
export const DIRECTORY_LIMIT_MAX = 50;

/** Query: khoá lạ bị bỏ qua (như C1 `withoutScopeKeys`). */
export const DirectoryQuerySchema = z.object({
  q: z.string().trim().min(1).max(LIST_Q_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(DIRECTORY_LIMIT_MAX).default(DIRECTORY_LIMIT_DEFAULT),
});
export type DirectoryQuery = z.infer<typeof DirectoryQuerySchema>;

export const DirectoryUserSchema = z.strictObject({
  id: UuidSchema,
  display_name: z.string().min(1).max(DISPLAY_NAME_MAX),
  username: z.string().min(1),
  active: z.boolean(),
});
export type DirectoryUser = z.infer<typeof DirectoryUserSchema>;

export const DirectoryResponseSchema = z.strictObject({
  items: z.array(DirectoryUserSchema).max(DIRECTORY_LIMIT_MAX),
});
export type DirectoryResponse = z.infer<typeof DirectoryResponseSchema>;
