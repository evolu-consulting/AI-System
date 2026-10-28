// ADM-FR-04, ADM-FR-62, ADM-FR-08 · CR-102a · hàng users → DTO `User`, hàng audit `user`, dịch 23505 (tách khỏi
// users.service để giữ file ≤ 400 dòng khi thêm user ngoài; users.service re-export nên điểm gọi cũ không đổi).
import {
  BETA_GROUP_KEY,
  GROUP_NAME_MAX,
  type GroupRef,
  LocalizedTextSchema,
  type User,
} from "@ai/contracts";
import type { AuditActionValue, AuditInput } from "@ai/db";
import { z } from "zod";
import { auditOf } from "../../lib/audit/audit.write";
import { appError } from "../../lib/errors";
import { uniqueViolation } from "../../lib/pg-errors";
import type { UserRow } from "./users.repo";
import { userStatus } from "./users.rules";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

const GroupsJson = z.array(
  z.object({ id: z.string(), key: z.string(), name: LocalizedTextSchema(GROUP_NAME_MAX) }),
);

/** jsonb từ subquery (users.repo) → GroupRef[] (validate ở biên đọc DB, CONVENTIONS §5). */
function userGroups(raw: unknown): GroupRef[] {
  return GroupsJson.parse(raw).map((g) => ({ ...g, is_beta: g.key === BETA_GROUP_KEY }));
}

export function toUser(u: UserRow): User {
  return {
    id: u.id,
    tenant_id: u.tenantId,
    tenant_key: u.tenantKey,
    username: u.username,
    display_name: u.displayName,
    email: u.email,
    role: u.role,
    locale: u.locale,
    status: userStatus(u),
    active: u.active,
    locked_by_tenant: u.lockedByTenant,
    locked_until: iso(u.lockedUntil),
    must_change_password: u.mustChangePassword,
    last_login_at: iso(u.lastLoginAt),
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
    version: u.version,
    updated_by: u.updatedBy,
    groups: userGroups(u.groups),
    group_count: u.groupCount,
    totp_enabled: u.totpEnabled,
    kind: u.kind,
    external_org_id: u.externalOrgId,
    deactivated_at: iso(u.deactivatedAt),
  };
}

/** Hàng audit `user` (plan M4 §4.2): DTO đầy đủ, allowlist lọc trong `auditOf`; snapshot false. */
export function userAudit(
  action: AuditActionValue,
  before: User | null,
  after: User,
  summary?: Record<string, unknown>,
): AuditInput {
  return auditOf(action, "user", {
    entityId: after.id,
    entityName: after.username,
    tenantId: after.tenant_id,
    before,
    after,
    entityVersion: after.version,
    summary,
  });
}

/** Dịch 23505 theo tên constraint (plan §5): username / email trùng trong tenant. */
export function mapUserConflict(err: unknown): never {
  const c = uniqueViolation(err);
  if (c === "users_tenant_username_uq") throw appError("USERNAME_TAKEN");
  if (c === "users_tenant_email_uq") throw appError("EMAIL_TAKEN");
  throw err;
}
