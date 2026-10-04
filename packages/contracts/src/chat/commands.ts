// HUB-FR-10 · contract `GET /commands` (menu `/`) — plan H2a §2.1, Q3/P3: chỉ thêm.
// Mã lỗi `CMD_*` + details ở `./errors` (`CHAT_COMMAND_ERRORS`). `context` của E12 (HUB-FR-11) ở `./entities`.
import { z } from "zod";
import { ALIASES_MAX, ARG_NAME_RE, ARGS_MAX, CATALOG_KEY_RE, COMMAND_DESC_MAX } from "../common";

export const COMMAND_MENU_MAX = 500;

const MenuDescSchema = z.strictObject({
  vi: z.string().min(1).max(COMMAND_DESC_MAX),
  en: z.string().min(1).max(COMMAND_DESC_MAX).nullable(),
});

export const CommandMenuArgSchema = z.strictObject({
  name: z.string().regex(ARG_NAME_RE),
  description: MenuDescSchema,
  required: z.boolean(),
  has_fallback: z.boolean(),
  rest: z.boolean(),
});
export type CommandMenuArg = z.infer<typeof CommandMenuArgSchema>;

export const CommandMenuItemSchema = z.strictObject({
  name: z.string().regex(CATALOG_KEY_RE),
  aliases: z.array(z.string().regex(CATALOG_KEY_RE)).max(ALIASES_MAX),
  description: MenuDescSchema,
  args: z.array(CommandMenuArgSchema).max(ARGS_MAX),
});
export type CommandMenuItem = z.infer<typeof CommandMenuItemSchema>;

/** Response `GET /commands`: lệnh user được thấy, Hub sắp theo `name`. */
export const CommandMenuResponseSchema = z.strictObject({
  items: z.array(CommandMenuItemSchema).max(COMMAND_MENU_MAX),
});
export type CommandMenuResponse = z.infer<typeof CommandMenuResponseSchema>;
