// ADM-FR-53 · payload NOTIFY `config_changed` — contract với Hub (spec M3 §3 "NOTIFY", M3-R15/R16, plan §4).
// Thuần, không I/O: admin-api dựng payload, Hub parse cùng schema.
import { z } from "zod";
import { UuidSchema } from "./common";

export const CONFIG_CHANNEL = "config_changed";
/** Postgres giới hạn payload NOTIFY 8.000 byte. */
export const CONFIG_PAYLOAD_MAX_BYTES = 8000;
export const CONFIG_ENTITIES = [
  "tenant",
  "user",
  "group",
  "grant",
  "feature",
  "entitlement",
  "workflow",
  "command",
  "secret",
  "quota",
  "batch",
] as const;
export type ConfigEntity = (typeof CONFIG_ENTITIES)[number];

/** Một thay đổi trong transaction; `tenantId` null = toàn hệ thống (catalog, secret). */
export type ConfigEvent = { entity: Exclude<ConfigEntity, "batch">; tenantId: string | null };

/** Không bao giờ chứa tên, username, giá trị secret, mật khẩu. */
export const ConfigChangedPayloadSchema = z.strictObject({
  v: z.number().int().min(1),
  entity: z.enum(CONFIG_ENTITIES),
  tenant_id: UuidSchema.optional(),
});
export type ConfigChangedPayload = z.infer<typeof ConfigChangedPayloadSchema>;

/**
 * entity = mọi event cùng entity ? entity đó : "batch"; tenant_id = mọi event cùng tenantId ≠ null ? tenantId : vắng.
 * Ném khi `events` rỗng (transaction không đổi gì thì không được gọi) hoặc `v` < 1.
 */
export function configChangedPayload(
  v: number,
  events: readonly ConfigEvent[],
): ConfigChangedPayload {
  const [first, ...rest] = events;
  if (!first) throw new Error("configChangedPayload: events rỗng");
  if (!Number.isInteger(v) || v < 1)
    throw new Error("configChangedPayload: v phải là số nguyên ≥ 1");
  const entity = rest.every((e) => e.entity === first.entity) ? first.entity : "batch";
  const tid = first.tenantId;
  const oneTenant = tid !== null && rest.every((e) => e.tenantId === tid);
  return oneTenant ? { v, entity, tenant_id: tid } : { v, entity };
}
