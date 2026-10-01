// ADM-FR-60, ADM-FR-04 · VERSION_CONFLICT.details = {current, updated_at} (spec M1 §3, M1-R19).
// Tách khỏi common.ts vì nhận tên thực thể ("tenant" | "user") cần import tenants/users → tránh import vòng.
import { z } from "zod";
import { IsoDateTime } from "./common";
import { TenantSchema } from "./tenants";
import { UserSchema } from "./users";

const ENTITY_SCHEMAS = { tenant: TenantSchema, user: UserSchema } as const;
export type VersionedEntity = keyof typeof ENTITY_SCHEMAS;

/**
 * Schema strict `{current: <bản mới nhất>, updated_at: ISO}`; `updated_by` để M4 (audit).
 * Nhận tên thực thể M1 hoặc một schema bất kỳ (thực thể mốc sau).
 */
export function versionConflictDetailsSchema<K extends VersionedEntity>(
  entity: K,
): z.ZodObject<
  { current: (typeof ENTITY_SCHEMAS)[K]; updated_at: typeof IsoDateTime },
  z.core.$strict
>;
export function versionConflictDetailsSchema<T extends z.ZodType>(
  entity: T,
): z.ZodObject<{ current: T; updated_at: typeof IsoDateTime }, z.core.$strict>;
export function versionConflictDetailsSchema(entity: VersionedEntity | z.ZodType) {
  const current = typeof entity === "string" ? ENTITY_SCHEMAS[entity] : entity;
  return z.strictObject({ current, updated_at: IsoDateTime });
}
