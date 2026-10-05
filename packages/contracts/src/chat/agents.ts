// HUB-FR-91 · menu `@agent` kênh chat (H2b plan §2.1, P2): `GET /agents` + key agent dùng cho `responder`.
// Không import `../hub` (subpath chat chạy ở trình duyệt, tách khỏi contract Hub ↔ Runtime).
import { z } from "zod";
import { AGENT_KEY_PATTERN } from "../common";

export const AGENT_MENU_MAX = 500;
export const AGENT_MENU_NAME_MAX = 100;
export const AGENT_MENU_DESC_MIN = 20;
export const AGENT_MENU_DESC_MAX = 400;

/** Key agent ở kênh chat (cùng mẫu `hub.agents.key`). */
export const ChatAgentKeySchema = z.string().regex(AGENT_KEY_PATTERN);
export type ChatAgentKey = z.infer<typeof ChatAgentKeySchema>;

export const AgentMenuItemSchema = z.strictObject({
  key: ChatAgentKeySchema,
  name: z.strictObject({
    vi: z.string().min(1).max(AGENT_MENU_NAME_MAX),
    en: z.string().min(1).max(AGENT_MENU_NAME_MAX),
  }),
  description: z.string().min(AGENT_MENU_DESC_MIN).max(AGENT_MENU_DESC_MAX),
});
export type AgentMenuItem = z.infer<typeof AgentMenuItemSchema>;

/** `GET /agents` · sắp theo `key` (R11). */
export const AgentMenuResponseSchema = z.strictObject({
  items: z.array(AgentMenuItemSchema).max(AGENT_MENU_MAX),
});
export type AgentMenuResponse = z.infer<typeof AgentMenuResponseSchema>;
