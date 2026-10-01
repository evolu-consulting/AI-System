// ADM-NFR-06, ADM-NFR-07 · điểm vào @ai/db.
export { createDb, type Db } from "./client";
export { type AppEnv, type DbEnv, loadDbEnv } from "./env";
export { runMigrations } from "./migrate";
export { admin, features, REVOKE_REASONS, refreshTokens, tenants, users } from "./schema/admin";
export { agentGrants, agentWorkflows, hub, usageLogs } from "./schema/hub-readonly";
export { type DbScope, NIL_SCOPE, NIL_TENANT_ID, setScope, type Tx, withScope } from "./scope";
