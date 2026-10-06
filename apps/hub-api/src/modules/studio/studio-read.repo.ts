// HUB-FR-72 · HUB-FR-90 · H4a-R02, R13 · plan §2.5, §5.4 · câu đọc của Studio (`me` + catalog). Chỉ SELECT, chạy trong
// transaction read only do service mở. R13: KHÔNG chọn `providers.secret_id` (chỉ `secret_id IS NOT NULL`) và KHÔNG chọn
// `provider_state.last_error` — cột không rời DB thì không thể lộ ra response.
import { type Tx, tenants, users, workflows } from "@ai/db";
import {
  agentTypes,
  hubConfigMeta,
  modelProfiles,
  providerState,
  providers,
} from "@ai/db/schema/hub";
import { asc, eq, isNotNull, sql } from "drizzle-orm";

export async function readHubVersion(tx: Tx): Promise<number> {
  const [r] = await tx
    .select({ v: hubConfigMeta.hubConfigVersion })
    .from(hubConfigMeta)
    .where(eq(hubConfigMeta.id, 1));
  return r?.v ?? 0;
}

export type MeRow = { username: string; displayName: string; tenantKey: string };

/** Tên hiển thị không có trong cache cấu hình (chỉ trạng thái) ⇒ một câu join (cột `admin.users` hub_ro được GRANT). */
export async function readMeRow(tx: Tx, userId: string): Promise<MeRow | undefined> {
  const [r] = await tx
    .select({ username: users.username, displayName: users.displayName, tenantKey: tenants.key })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(eq(users.id, userId));
  return r;
}

export function readAgentTypes(tx: Tx) {
  return tx
    .select({
      key: agentTypes.key,
      runtime: agentTypes.runtime,
      description: agentTypes.description,
      configSchema: agentTypes.configSchema,
      version: agentTypes.version,
      available: agentTypes.available,
    })
    .from(agentTypes)
    .orderBy(asc(agentTypes.key));
}

export function readModelProfiles(tx: Tx) {
  return tx
    .select({ id: modelProfiles.id, key: modelProfiles.key, steps: modelProfiles.steps })
    .from(modelProfiles)
    .orderBy(asc(modelProfiles.key));
}

export function readProviders(tx: Tx) {
  return tx
    .select({
      id: providers.id,
      key: providers.key,
      kind: providers.kind,
      vendor: providers.vendor,
      baseUrl: providers.baseUrl,
      hasSecret: isNotNull(providers.secretId).mapWith(Boolean),
      maxConcurrency: providers.maxConcurrency,
      enabled: providers.enabled,
      devOnly: providers.devOnly,
      status: providerState.status,
      cooldownUntil: providerState.cooldownUntil,
      utilization: providerState.utilization,
    })
    .from(providers)
    .leftJoin(providerState, eq(providerState.providerKey, providers.key))
    .orderBy(asc(providers.key));
}

export function readEnabledWorkflows(tx: Tx) {
  return tx
    .select({
      id: workflows.id,
      key: workflows.key,
      name: workflows.name,
      description: workflows.description,
      appType: workflows.appType,
      inputSchema: workflows.inputSchema,
    })
    .from(workflows)
    .where(eq(workflows.enabled, true))
    .orderBy(asc(workflows.key));
}

export function readTenants(tx: Tx) {
  return tx
    .select({
      id: tenants.id,
      key: tenants.key,
      name: tenants.name,
      active: tenants.active,
      // Cột tương quan viết tường minh: drizzle không thêm tên bảng trong select một bảng ⇒ `id` sẽ trỏ nhầm sang subquery.
      hasOrchestrator: sql<boolean>`exists (select 1 from hub.orchestrator_settings o
        where o.tenant_id = "tenants"."id")`.mapWith(Boolean),
    })
    .from(tenants)
    .orderBy(asc(tenants.key));
}
