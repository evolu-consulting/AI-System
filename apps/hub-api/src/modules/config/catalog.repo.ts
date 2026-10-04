// HUB-FR-10, HUB-FR-76 · H2a P14, R23 · đọc catalog Admin + `hub.workflow_flags` cho cache (role hub_api, chỉ SELECT;
// plan H2a §3 "Đọc admin.*"). Bảng catalog toàn hệ thống; RLS `groups`/`feature_grants`/`feature_entitlements` có
// policy `hub_ro USING (true)`. Một transaction REPEATABLE READ: ảnh nhất quán.
import {
  commandNames,
  commands,
  featureCommands,
  featureEntitlements,
  featureGrants,
  features,
  groups,
  tenants,
  workflows,
} from "@ai/db";
import { workflowFlags } from "@ai/db/schema/hub";
import { isNull, sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { CatalogRows } from "./catalog.rules";

type Tx = Parameters<Parameters<Db["db"]["transaction"]>[0]>[0];

/** R23: cột `admin.workflows.side_effect` (CR-034) có thì đọc; không thì null. */
async function readSideEffectColumn(tx: Tx): Promise<CatalogRows["sideEffectColumn"]> {
  const has = await tx.execute<{ n: number }>(sql`select count(*)::int as n
    from information_schema.columns
    where table_schema = 'admin' and table_name = 'workflows' and column_name = 'side_effect'`);
  if ((has[0]?.n ?? 0) === 0) return null;
  const rows = await tx.execute<{ id: string; side_effect: boolean | null }>(
    sql`select id, side_effect from admin.workflows`,
  );
  return rows.map((r) => ({ id: r.id, sideEffect: r.side_effect === true }));
}

async function readWorkflows(tx: Tx): Promise<CatalogRows["workflows"]> {
  return tx
    .select({
      id: workflows.id,
      key: workflows.key,
      name: workflows.name,
      description: workflows.description,
      appType: workflows.appType,
      baseUrl: workflows.baseUrl,
      secretId: workflows.secretId,
      inputSchema: workflows.inputSchema,
      outputField: workflows.outputField,
      enabled: workflows.enabled,
    })
    .from(workflows);
}

async function readCommands(tx: Tx): Promise<CatalogRows["commands"]> {
  return tx
    .select({
      id: commands.id,
      name: commands.name,
      aliases: commands.aliases,
      description: commands.description,
      workflowId: commands.workflowId,
      args: commands.args,
      inputMap: commands.inputMap,
      output: commands.output,
      mode: commands.mode,
      timeoutS: commands.timeoutS,
      enabled: commands.enabled,
    })
    .from(commands);
}

async function readAccessRows(tx: Tx) {
  return {
    features: await tx
      .select({ id: features.id, key: features.key, status: features.status })
      .from(features)
      .orderBy(features.key),
    featureCommands: await tx
      .select({ featureId: featureCommands.featureId, commandId: featureCommands.commandId })
      .from(featureCommands),
    entitlements: await tx
      .select({ featureId: featureEntitlements.featureId, tenantId: featureEntitlements.tenantId })
      .from(featureEntitlements)
      .where(isNull(featureEntitlements.revokedAt)),
    grants: await tx
      .select({
        tenantId: featureGrants.tenantId,
        featureId: featureGrants.featureId,
        groupId: featureGrants.groupId,
        userId: featureGrants.userId,
      })
      .from(featureGrants),
    groups: await tx
      .select({ id: groups.id, tenantId: groups.tenantId, key: groups.key })
      .from(groups),
    tenants: await tx.select({ id: tenants.id, key: tenants.key }).from(tenants),
  };
}

/** Hàng thô của catalog; `adminVersion` do người gọi đọc TRƯỚC (như `ConfigCache.#loadAdmin`). */
export function loadCatalogRows(db: Db, adminVersion: number): Promise<CatalogRows> {
  return db.db.transaction(
    async (tx) => ({
      adminVersion,
      workflows: await readWorkflows(tx),
      sideEffectColumn: await readSideEffectColumn(tx),
      flags: await tx
        .select({ workflowId: workflowFlags.workflowId, sideEffect: workflowFlags.sideEffect })
        .from(workflowFlags),
      commands: await readCommands(tx),
      names: await tx
        .select({ name: commandNames.name, commandId: commandNames.commandId })
        .from(commandNames),
      ...(await readAccessRows(tx)),
    }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
