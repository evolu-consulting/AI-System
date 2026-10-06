// HUB-FR-60 · HUB-FR-61 · HUB-FR-72 · H4a plan §2.2 — schema + hằng dùng chung Studio (FE + Hub). Không I/O.
import { z } from "zod";
import { UuidSchema } from "../common";

export const LocalizedNameSchema = z.strictObject({
  vi: z.string().trim().min(1).max(100),
  en: z.string().trim().min(1).max(100),
});
export type LocalizedName = z.infer<typeof LocalizedNameSchema>;

export const AGENT_RUNTIMES = [
  "llm",
  "agentic-cli",
  "dify-workflow",
  "dify-agent",
  "python",
] as const;
export const AgentRuntimeSchema = z.enum(AGENT_RUNTIMES);
export type AgentRuntime = z.infer<typeof AgentRuntimeSchema>;

/** Runtime được làm Orchestrator (K2/QB1, P9/U2). B6 `config.rules.ts` import lại hằng này. */
export const ORCHESTRATOR_RUNTIMES = ["agentic-cli"] as const;

export const CLI_KINDS = ["claude", "codex", "gemini"] as const;
/** ⊇ `ALLOWED_TOOLS` (hub); Runtime chỉ chạy phần giao (QB7). */
export const STUDIO_CLI_TOOLS = ["Read", "Grep", "Glob", "Write", "Edit", "Bash"] as const;
export const CWD_MODES = ["job"] as const;
export const ON_NO_MATCH_VALUES = ["answer", "ask"] as const;

export const MeSchema = z.strictObject({
  user_id: UuidSchema,
  tenant_id: UuidSchema,
  tenant_key: z.string(),
  username: z.string(),
  display_name: z.string(),
  role: z.literal("platform_admin"),
  hub_config_version: z.number().int().min(0),
});
export type Me = z.infer<typeof MeSchema>;

export const HubConfigVersionSchema = z.number().int().min(0);

/** Mọi list Studio: `{items, total, truncated, hub_config_version}`. */
export function listMetaSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({
    items: z.array(item),
    total: z.number().int().min(0),
    truncated: z.boolean(),
    hub_config_version: HubConfigVersionSchema,
  });
}
