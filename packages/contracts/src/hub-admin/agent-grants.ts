// HUB-FR-78, ADM-FR-37 · contract /agent-grants (plan H3b §2.2, R04–R11).
// Không import `../hub` (subpath này chạy ở trình duyệt Admin); key agent dùng chung mẫu `AGENT_KEY_PATTERN`.
import { z } from "zod";
import {
  AGENT_KEY_PATTERN,
  CountSchema,
  IsoDateTime,
  UpdatedBySchema,
  UuidSchema,
} from "../common";
import { GrantSubjectSchema } from "../grants";

export const AGENT_GRANTS_AGENTS_MAX = 200;
export const AGENT_GRANTS_PER_AGENT_MAX = 500;
export const HUB_AGENT_NAME_MAX = 100;
export const HUB_AGENT_DESC_MAX = 2000;
export const GRANT_SUBJECT_TYPES = ["group", "user"] as const;

export const GrantSubjectTypeSchema = z.enum(GRANT_SUBJECT_TYPES);
export type GrantSubjectType = z.infer<typeof GrantSubjectTypeSchema>;
export const HubConfigVersionSchema = z.number().int().min(0);

export const AgentGrantTenantQuerySchema = z.strictObject({ tenant_id: UuidSchema.optional() });
export type AgentGrantTenantQuery = z.infer<typeof AgentGrantTenantQuerySchema>;

/** `subject_type` và `subject_id` cùng có hoặc cùng vắng. */
export const AgentGrantListQuerySchema = z
  .strictObject({
    tenant_id: UuidSchema.optional(),
    subject_type: GrantSubjectTypeSchema.optional(),
    subject_id: UuidSchema.optional(),
  })
  .refine((q) => (q.subject_type === undefined) === (q.subject_id === undefined), {
    message: "subject_type and subject_id must be given together",
    path: ["subject_id"],
  });
export type AgentGrantListQuery = z.infer<typeof AgentGrantListQuerySchema>;

/** Body strict — `tenant_id` trong body ⇒ 400 (tenant đích chỉ qua query, R02). */
export const AgentGrantCreateSchema = z.strictObject({
  agent_id: UuidSchema,
  subject_type: GrantSubjectTypeSchema,
  subject_id: UuidSchema,
});
export type AgentGrantCreate = z.infer<typeof AgentGrantCreateSchema>;

export const AgentGrantDeleteQuerySchema = z.strictObject({
  tenant_id: UuidSchema.optional(),
  agent_id: UuidSchema,
  subject_type: GrantSubjectTypeSchema,
  subject_id: UuidSchema,
});
export type AgentGrantDeleteQuery = z.infer<typeof AgentGrantDeleteQuerySchema>;

const hubAgentRefShape = {
  id: UuidSchema,
  key: z.string().regex(AGENT_KEY_PATTERN),
  name: z.strictObject({
    vi: z.string().min(1).max(HUB_AGENT_NAME_MAX),
    en: z.string().min(1).max(HUB_AGENT_NAME_MAX),
  }),
};
export const HubAgentRefSchema = z.strictObject(hubAgentRefShape);
export type HubAgentRef = z.infer<typeof HubAgentRefSchema>;

export const AgentGrantSchema = z.strictObject({
  id: UuidSchema,
  tenant_id: UuidSchema,
  agent: HubAgentRefSchema,
  subject: GrantSubjectSchema,
  granted_by: UpdatedBySchema,
  granted_at: IsoDateTime,
});
export type AgentGrant = z.infer<typeof AgentGrantSchema>;

/** POST: 201 = version sau bump; 200 (trùng) = version hiện tại, không đổi (R06, PL13). */
export const AgentGrantWriteResponseSchema = z.strictObject({
  grant: AgentGrantSchema,
  hub_config_version: HubConfigVersionSchema,
});
export type AgentGrantWriteResponse = z.infer<typeof AgentGrantWriteResponseSchema>;

/** Hàng grant trong danh sách theo agent — không lặp `agent`, `tenant_id`. */
export const AgentGrantRowSchema = z.strictObject({
  id: UuidSchema,
  subject: GrantSubjectSchema,
  granted_by: UpdatedBySchema,
  granted_at: IsoDateTime,
});
export type AgentGrantRow = z.infer<typeof AgentGrantRowSchema>;

/** `runnable` = `RUNNABLE_RUNTIMES.has(runtime)` (Hub tính). */
export const AgentGrantListItemSchema = z.strictObject({
  agent: z.strictObject({
    ...hubAgentRefShape,
    description: z.string().max(HUB_AGENT_DESC_MAX),
    enabled: z.boolean(),
    runnable: z.boolean(),
  }),
  grants: z.array(AgentGrantRowSchema).max(AGENT_GRANTS_PER_AGENT_MAX),
  grants_total: CountSchema,
});
export type AgentGrantListItem = z.infer<typeof AgentGrantListItemSchema>;

/** `items` sắp theo `agent.key`; đọc DB (R11, PL5). */
export const AgentGrantListResponseSchema = z.strictObject({
  tenant_id: UuidSchema,
  items: z.array(AgentGrantListItemSchema).max(AGENT_GRANTS_AGENTS_MAX),
  truncated: z.boolean(),
  hub_config_version: HubConfigVersionSchema,
});
export type AgentGrantListResponse = z.infer<typeof AgentGrantListResponseSchema>;
