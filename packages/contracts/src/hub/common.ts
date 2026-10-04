// HUB-FR-89 · phần chung của contract Hub ↔ Runtime (plan H1 §2.1).
// Chỉ dùng kiểu biểu diễn được bằng JSON Schema (C2 sinh pydantic) — cấm refine/transform/coerce/default.
import { z } from "zod";

export const HUB_CONTRACT_VERSION = 1;
export const VersionSchema = z.literal(HUB_CONTRACT_VERSION);

/** Key provider/profile/agent/agent_type (`hub.*.key`). */
export const AGENT_KEY_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
export const AgentKeySchema = z.string().regex(AGENT_KEY_PATTERN);
export type AgentKey = z.infer<typeof AgentKeySchema>;

/** H1-R21: agent chỉ đọc. */
export const ALLOWED_TOOLS = ["Read", "Grep", "Glob"] as const;
export const AllowedToolSchema = z.enum(ALLOWED_TOOLS);
export type AllowedTool = z.infer<typeof AllowedToolSchema>;

export const TokenUsageSchema = z.strictObject({
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const HubUuidSchema = z.uuid();
export const HubDateTimeSchema = z.iso.datetime({ offset: true });
