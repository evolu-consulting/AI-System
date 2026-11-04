// CR-118 · UW-FR-04 · UW-FR-16..19 · ADR-0036 (đề xuất) · ảnh năng lực từ cache cấu hình Hub: `GET /pack/me` (web shell +
// FeatureGate/OpenFeature) và `GET /hub-admin/tenants/:id/capabilities` (tab "Ứng dụng & năng lực"). Read-model, không bảng mới.
// ETag = `"a<config_version>.h<hub_config_version>.<băm nội dung>"`; If-None-Match khớp ⇒ 304. Sự kiện `/me/stream`
// `config.changed` (không id, không qua Redis) báo web refetch.
import { z } from "zod";
import { PackActionSchema } from "./packs";

export const CAPABILITY_LEVELS = ["off", "read", "write", "admin"] as const;
export const CapabilityLevelSchema = z.enum(CAPABILITY_LEVELS);
export type CapabilityLevel = z.infer<typeof CapabilityLevelSchema>;

export const ConfigVersionsSchema = z.object({
  admin: z.number().int(),
  hub: z.number().int(),
});
export type ConfigVersions = z.infer<typeof ConfigVersionsSchema>;

export const ShellBrandSchema = z.object({
  name: z.string().nullable(),
  app_name: z.string().nullable(),
  logo: z.string().nullable(),
  accent: z.string().nullable(),
});
export type ShellBrand = z.infer<typeof ShellBrandSchema>;

export const ShellPackSchema = z.object({
  enabled: z.boolean(),
  level: CapabilityLevelSchema,
  actions: z.array(PackActionSchema).max(3),
});
export type ShellPack = z.infer<typeof ShellPackSchema>;

/** `GET /pack/me` · `flags` phẳng cho provider OpenFeature: `<pack>` / `<pack>.<action>` / khoá add-on → boolean. */
export const ShellMeResponseSchema = z.object({
  versions: ConfigVersionsSchema,
  user: z.object({
    id: z.uuid(),
    tenant_id: z.uuid(),
    role: z.string(),
    kind: z.enum(["internal", "external"]),
  }),
  packs: z.record(z.string(), ShellPackSchema),
  addons: z.array(z.string()),
  flags: z.record(z.string(), z.boolean()),
  brand: ShellBrandSchema.nullable(),
  home: z.string().nullable(),
  /** id manifest module web được hiện (= gói user đọc được). */
  apps: z.array(z.string()),
});
export type ShellMeResponse = z.infer<typeof ShellMeResponseSchema>;

const NamedSchema = z.object({ key: z.string(), name: z.string(), enabled: z.boolean() });

export const CapabilitySlotSchema = z.object({
  slot: z.string(),
  def_id: z.string().nullable(),
  def_name: z.string().nullable(),
  version: z.number().int().nullable(),
  is_default: z.boolean(),
});

export const CapabilityAppSchema = z.object({
  key: z.string(),
  level: CapabilityLevelSchema,
  addons: z.array(z.object({ key: z.string(), on: z.boolean() })),
  slots: z.array(CapabilitySlotSchema),
  agents: z.array(NamedSchema),
  tools: z.array(z.object({ key: z.string(), side_effect: z.boolean(), action: PackActionSchema })),
});
export type CapabilityApp = z.infer<typeof CapabilityAppSchema>;

/** `GET /hub-admin/tenants/:id/capabilities` · chỉ đọc; sửa vẫn qua API hiện có (entitlement, slot-assign, agent-grants…). */
export const TenantCapabilitiesResponseSchema = z.object({
  tenant_id: z.uuid(),
  versions: ConfigVersionsSchema,
  apps: z.array(CapabilityAppSchema),
  shared: z.object({
    agents: z.array(NamedSchema),
    /** Dify = Tool (ADR-0022), chỉ đọc. */
    dify_workflows: z.array(NamedSchema.extend({ used_by: z.array(z.string()) })),
    standalone_flows: z.array(
      z.object({ id: z.string(), name: z.string(), version: z.number().int().nullable() }),
    ),
    default_model: z
      .object({
        default_agent: z.string().nullable(),
        fallback_agent: z.string().nullable(),
        on_no_match: z.string(),
      })
      .nullable(),
  }),
  limits: z.object({
    uploads_day: z.number().int().nullable(),
    actions_day: z.number().int().nullable(),
    ai_tokens_day: z.number().int().nullable(),
  }),
});
export type TenantCapabilitiesResponse = z.infer<typeof TenantCapabilitiesResponseSchema>;

/** Sự kiện `/me/stream` khi ảnh cấu hình đổi (N3): `data` = `ConfigVersions`. */
export const ME_STREAM_CONFIG_CHANGED = "config.changed";
