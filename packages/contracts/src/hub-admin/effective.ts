// HUB-FR-79, ADM-FR-37 · contract GET /agent-grants/effective/:user_id (plan H3b §2.3, R12–R15).
// Cùng dạng `EffectiveFeature` M3 (`visible ⇔ missing = []`); `user_inactive`/`tenant_locked` trùng nghĩa `USER_BLOCKERS`.
import { z } from "zod";
import { USER_BLOCKERS } from "../access";
import { UuidSchema } from "../common";
import { GroupRefSchema } from "../groups";
import { AGENT_GRANTS_AGENTS_MAX, HubAgentRefSchema, HubConfigVersionSchema } from "./agent-grants";

/** Thứ tự cố định (R14). */
export const AGENT_MISSING = [
  ...USER_BLOCKERS,
  "agent_disabled",
  "runtime_unavailable",
  "no_entitlement",
  "no_grant",
] as const;
export const AgentMissingSchema = z.enum(AGENT_MISSING);
export type AgentMissing = z.infer<typeof AgentMissingSchema>;

/** `grant_user` trước, rồi `grant_group` theo `group.key`. */
export const AgentAccessReasonSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("grant_user") }),
  z.strictObject({ code: z.literal("grant_group"), group: GroupRefSchema }),
]);
export type AgentAccessReason = z.infer<typeof AgentAccessReasonSchema>;

export const EffectiveAgentSchema = z
  .strictObject({
    agent: HubAgentRefSchema,
    visible: z.boolean(),
    reasons: z.array(AgentAccessReasonSchema),
    missing: z.array(AgentMissingSchema),
  })
  .refine((a) => a.visible === (a.missing.length === 0), {
    message: "visible must equal missing.length === 0",
    path: ["visible"],
  });
export type EffectiveAgent = z.infer<typeof EffectiveAgentSchema>;

/** Tính trên ảnh cache (R12); `agents` sắp `agent.key`. */
export const EffectiveAgentsResponseSchema = z.strictObject({
  user: z.strictObject({ id: UuidSchema, tenant_id: UuidSchema }),
  agents: z.array(EffectiveAgentSchema).max(AGENT_GRANTS_AGENTS_MAX),
  hub_config_version: HubConfigVersionSchema,
});
export type EffectiveAgentsResponse = z.infer<typeof EffectiveAgentsResponseSchema>;
