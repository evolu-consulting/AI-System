// HUB-FR-77 · HUB-FR-78 · CR-054 · contract `/agent-settings` (Evolu Control → Agents): agent mặc định ở Hỏi AI, agent
// bật cho công ty (entitlement — chỉ platform_admin đổi), model đang dùng. Không import `../hub` (chạy ở trình duyệt Admin).
import { z } from "zod";
import { UuidSchema } from "../common";
import { HUB_AGENT_DESC_MAX, HubAgentRefSchema, HubConfigVersionSchema } from "./agent-grants";

/** Khi Orchestrator mặc định không thấy agent nào khớp. */
export const ON_NO_MATCH_VALUES = ["fallback", "answer", "ask"] as const;
export const OnNoMatchSchema = z.enum(ON_NO_MATCH_VALUES);
export type OnNoMatch = z.infer<typeof OnNoMatchSchema>;

/** Body PUT `/agent-settings/default` = bản đọc. `fallback` ⇒ `fallback_agent_id` bắt buộc. */
export const AgentDefaultsSchema = z
  .strictObject({
    default_agent_id: UuidSchema,
    fallback_agent_id: UuidSchema.nullable(),
    on_no_match: OnNoMatchSchema,
  })
  .refine((d) => d.on_no_match !== "fallback" || d.fallback_agent_id !== null, {
    message: "fallback_agent_id required when on_no_match is fallback",
    path: ["fallback_agent_id"],
  });
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;

/** Model đang dùng: `value` = model của agent (alias/id) hoặc của profile; `display_name` từ danh mục Runtime nếu có. */
export const AgentModelSchema = z.strictObject({
  value: z.string().min(1).max(100).nullable(),
  display_name: z.string().min(1).max(100).nullable(),
});
export type AgentModel = z.infer<typeof AgentModelSchema>;

export const AgentSettingsItemSchema = z.strictObject({
  agent: HubAgentRefSchema,
  description: z.string().max(HUB_AGENT_DESC_MAX),
  runtime: z.string().min(1).max(40),
  model: AgentModelSchema,
  /** Agent bật toàn hệ thống (Agent Forge). */
  enabled: z.boolean(),
  /** Bật cho công ty này (entitlement chưa thu hồi). */
  entitled: z.boolean(),
  /** Là Orchestrator (dùng được = cả công ty khi đã bật; không cấp quyền riêng). */
  is_orchestrator: z.boolean(),
});
export type AgentSettingsItem = z.infer<typeof AgentSettingsItemSchema>;

export const AgentSettingsResponseSchema = z.strictObject({
  /** null = công ty chưa cấu hình (tin không tag → Orchestrator như trước). */
  defaults: AgentDefaultsSchema.nullable(),
  agents: z.array(AgentSettingsItemSchema).max(200),
  hub_config_version: HubConfigVersionSchema,
});
export type AgentSettingsResponse = z.infer<typeof AgentSettingsResponseSchema>;

/** PUT `/agent-settings/entitlements` — platform_admin bật/tắt agent cho công ty. */
export const AgentEntitlementPutSchema = z.strictObject({
  agent_id: UuidSchema,
  entitled: z.boolean(),
});
export type AgentEntitlementPut = z.infer<typeof AgentEntitlementPutSchema>;

export const AgentSettingsWriteResponseSchema = z.strictObject({
  hub_config_version: HubConfigVersionSchema,
});
export type AgentSettingsWriteResponse = z.infer<typeof AgentSettingsWriteResponseSchema>;

/** Lỗi riêng CR-054 (hằng riêng — không đổi `HUB_ADMIN_ERRORS` đã khoá). */
export const HUB_ADMIN_AGENT_ERRORS = {
  /** Tắt / đặt dự phòng sai cho agent đang là mặc định hoặc dự phòng. */
  AGENT_IS_DEFAULT: 409,
} as const satisfies Record<string, 409>;
export type HubAdminAgentErrorCode = keyof typeof HUB_ADMIN_AGENT_ERRORS;
