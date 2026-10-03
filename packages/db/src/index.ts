// ADM-NFR-06, ADM-NFR-07, ADM-FR-10 · điểm vào @ai/db.
export {
  type AuditActionValue,
  type AuditEntityValue,
  type AuditInput,
  type AuditMeta,
  insertAuditRows,
} from "./audit-log";
export { createDb, type Db } from "./client";
export {
  bumpConfigVersion,
  type ConfigCommitted,
  type ConfigSink,
  readConfigVersion,
  withConfigWrite,
} from "./config-meta";
export { type AppEnv, type DbEnv, loadDbEnv } from "./env";
export { runMigrations } from "./migrate";
export { hashPassword, PASSWORD_HASH_OPTIONS, verifyPassword } from "./password";
export {
  admin,
  commandNames,
  commands,
  featureCommands,
  featureEntitlements,
  features,
  REVOKE_REASONS,
  refreshTokens,
  secrets,
  tenants,
  users,
  workflows,
} from "./schema/admin";
export { agentGrants, agentWorkflows, hub, usageLogs } from "./schema/hub-readonly";
export {
  AUDIT_ACTION_VALUES,
  AUDIT_ENTITY_VALUES,
  auditLog,
  QUOTA_ALERT_STATUSES,
  quotaAlerts,
  tenantQuotas,
} from "./schema/ops";
export { configMeta, featureGrants, groupMembers, groups } from "./schema/permissions";
export { userBackupCodes, userTotp } from "./schema/totp";
export { type DbScope, NIL_SCOPE, NIL_TENANT_ID, setScope, type Tx, withScope } from "./scope";
