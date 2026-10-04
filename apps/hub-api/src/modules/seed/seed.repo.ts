// HUB-FR-60, HUB-FR-61, HUB-FR-62 · ghi seed vào bảng cấu hình Hub (plan H1 §3.1, §3.6): upsert theo `key`, không xoá; hàng
// không đổi giữ nguyên `version`/`updated_at` (`IS DISTINCT FROM`). Chỉ ĐỌC `admin.*` (tenant/user/group, workflows H2a).
import { HUB_CONFIG_CHANNEL, HUB_CONTRACT_VERSION } from "@ai/contracts/hub";
import type postgres from "postgres";
import { parseSubject, type SeedPlan } from "./seed.rules";
import type { ResolvedWorkflows, SeedCatalogWorkflow } from "./seed.workflows";

export type Tx = postgres.TransactionSql;

/** Khoá hàng `config_meta` trước tiên (tuần tự hoá hai lần seed đồng thời) và trả version mới. */
export async function bumpHubConfigVersion(tx: Tx): Promise<number> {
  const [r] = await tx<{ v: number }[]>`update hub.config_meta
    set hub_config_version = hub_config_version + 1 where id = 1 returning hub_config_version as v`;
  if (!r) throw new Error("hub.config_meta thiếu hàng id=1 — chạy migrate Hub trước");
  return r.v;
}

export async function upsertProviders(tx: Tx, rows: SeedPlan["providers"]): Promise<void> {
  for (const p of rows) {
    await tx`insert into hub.providers (key, kind, vendor, base_url, max_concurrency, enabled, dev_only)
      values (${p.key}, ${p.kind}, ${p.vendor}, ${p.base_url}, ${p.max_concurrency}, ${p.enabled}, ${p.dev_only})
      on conflict (key) do update set kind = excluded.kind, vendor = excluded.vendor, base_url = excluded.base_url,
        max_concurrency = excluded.max_concurrency, enabled = excluded.enabled, dev_only = excluded.dev_only,
        updated_at = now()
      where (hub.providers.kind, hub.providers.vendor, hub.providers.base_url, hub.providers.max_concurrency,
             hub.providers.enabled, hub.providers.dev_only)
        is distinct from (excluded.kind, excluded.vendor, excluded.base_url, excluded.max_concurrency,
             excluded.enabled, excluded.dev_only)`;
  }
}

export async function upsertProfiles(tx: Tx, rows: SeedPlan["profiles"]): Promise<void> {
  for (const p of rows) {
    await tx`insert into hub.model_profiles (key, steps) values (${p.key}, ${tx.json(p.steps)})
      on conflict (key) do update set steps = excluded.steps, updated_at = now()
      where hub.model_profiles.steps is distinct from excluded.steps`;
  }
}

export async function upsertAgents(tx: Tx, rows: SeedPlan["agents"]): Promise<void> {
  for (const a of rows) {
    await tx`insert into hub.agents (key, name, description, runtime, profile_id, system_prompt, runtime_options,
        timeout_s, token_budget, enabled)
      select ${a.key}, ${tx.json(a.name)}, ${a.description}, ${a.runtime}, p.id, ${a.system_prompt},
        ${tx.json(a.runtime_options as postgres.JSONValue)}, ${a.timeout_s}, ${a.token_budget}, ${a.enabled}
      from hub.model_profiles p where p.key = ${a.profile}
      on conflict (key) do update set name = excluded.name, description = excluded.description,
        runtime = excluded.runtime, profile_id = excluded.profile_id, system_prompt = excluded.system_prompt,
        runtime_options = excluded.runtime_options, timeout_s = excluded.timeout_s,
        token_budget = excluded.token_budget, enabled = excluded.enabled,
        version = hub.agents.version + 1, updated_at = now()
      where (hub.agents.name, hub.agents.description, hub.agents.runtime, hub.agents.profile_id,
             hub.agents.system_prompt, hub.agents.runtime_options, hub.agents.timeout_s, hub.agents.token_budget,
             hub.agents.enabled)
        is distinct from (excluded.name, excluded.description, excluded.runtime, excluded.profile_id,
             excluded.system_prompt, excluded.runtime_options, excluded.timeout_s, excluded.token_budget,
             excluded.enabled)`;
  }
}

export async function upsertOrchestrator(tx: Tx, o: SeedPlan["orchestrator"]): Promise<void> {
  await tx`insert into hub.orchestrator_settings (id, agent_id, max_steps, token_budget, history_n, on_no_match)
    select 1, a.id, ${o.max_steps}, ${o.token_budget}, ${o.history_n}, ${o.on_no_match}
    from hub.agents a where a.key = ${o.agent}
    on conflict (id) do update set agent_id = excluded.agent_id, max_steps = excluded.max_steps,
      token_budget = excluded.token_budget, history_n = excluded.history_n, on_no_match = excluded.on_no_match,
      version = hub.orchestrator_settings.version + 1, updated_at = now()
    where (hub.orchestrator_settings.agent_id, hub.orchestrator_settings.max_steps,
           hub.orchestrator_settings.token_budget, hub.orchestrator_settings.history_n,
           hub.orchestrator_settings.on_no_match)
      is distinct from (excluded.agent_id, excluded.max_steps, excluded.token_budget, excluded.history_n,
           excluded.on_no_match)`;
}

async function tenantIds(tx: Tx, plan: SeedPlan): Promise<Map<string, string>> {
  const keys = [...new Set([...plan.entitlements, ...plan.grants].map((x) => x.tenant_key))];
  if (!keys.length) return new Map();
  const rows = await tx<
    { id: string; key: string }[]
  >`select id, key from admin.tenants where key in ${tx(keys)}`;
  return new Map(rows.map((r) => [r.key, r.id]));
}

/** Entitlement: thêm nếu chưa có; KHÔNG bỏ `revoked_at` đã đặt (seed không ghi đè thu hồi). */
async function insertEntitlements(
  tx: Tx,
  plan: SeedPlan,
  tenants: Map<string, string>,
  warn: string[],
): Promise<void> {
  for (const e of plan.entitlements) {
    const tid = tenants.get(e.tenant_key);
    if (!tid) {
      warn.push(`seed: bỏ entitlement ${e.agent} → tenant ${e.tenant_key}: tenant không tồn tại`);
      continue;
    }
    await tx`insert into hub.agent_entitlements (agent_id, tenant_id)
      select a.id, ${tid}::uuid from hub.agents a where a.key = ${e.agent}
      on conflict (agent_id, tenant_id) do nothing`;
  }
}

async function subjectId(tx: Tx, tid: string, subject: string): Promise<string | undefined> {
  const s = parseSubject(subject);
  const rows =
    s.type === "user"
      ? await tx<
          { id: string }[]
        >`select id from admin.users where tenant_id = ${tid} and username = ${s.name}`
      : await tx<
          { id: string }[]
        >`select id from admin.groups where tenant_id = ${tid} and key = ${s.name}`;
  return rows[0]?.id;
}

/** Grant: tenant/user/group thiếu → bỏ grant đó + cảnh báo, phần còn lại vẫn ghi (Q8, A45). */
async function insertGrants(
  tx: Tx,
  plan: SeedPlan,
  tenants: Map<string, string>,
  warn: string[],
): Promise<void> {
  for (const g of plan.grants) {
    const tid = tenants.get(g.tenant_key);
    const sid = tid ? await subjectId(tx, tid, g.subject) : undefined;
    if (!tid || !sid) {
      warn.push(`seed: bỏ grant ${g.agent} → ${g.subject} (tenant ${g.tenant_key}): không tồn tại`);
      continue;
    }
    await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      select a.id, ${tid}::uuid, ${parseSubject(g.subject).type}, ${sid}::uuid from hub.agents a where a.key = ${g.agent}
      on conflict (agent_id, tenant_id, subject_type, subject_id) do nothing`;
  }
}

/** Ghi entitlement + grant; trả danh sách cảnh báo (log sau commit). */
export async function writeAccess(tx: Tx, plan: SeedPlan): Promise<string[]> {
  const warn: string[] = [];
  const tenants = await tenantIds(tx, plan);
  await insertEntitlements(tx, plan, tenants, warn);
  await insertGrants(tx, plan, tenants, warn);
  return warn;
}

/** H2a plan-db §4: chỉ ĐỌC `admin.workflows` theo key seed tham chiếu. */
export async function loadCatalogWorkflows(tx: Tx, keys: string[]): Promise<SeedCatalogWorkflow[]> {
  if (!keys.length) return [];
  return tx<
    SeedCatalogWorkflow[]
  >`select id, key, app_type as "appType", input_schema as "inputSchema"
    from admin.workflows where key in ${tx(keys)}`;
}

/** `agent_workflows`: thêm nếu chưa có, không xoá (agent đã bị bỏ → 0 dòng). */
export async function insertAgentWorkflows(
  tx: Tx,
  rows: ResolvedWorkflows["agentWorkflows"],
): Promise<void> {
  for (const r of rows)
    await tx`insert into hub.agent_workflows (agent_id, workflow_id)
      select a.id, ${r.workflowId}::uuid from hub.agents a where a.key = ${r.agent}
      on conflict (agent_id, workflow_id) do nothing`;
}

/** `workflow_flags.side_effect = true` (upsert); không tắt cờ workflow vắng trong seed. */
export async function upsertSideEffectFlags(tx: Tx, workflowIds: string[]): Promise<void> {
  for (const id of workflowIds)
    await tx`insert into hub.workflow_flags (workflow_id, side_effect) values (${id}::uuid, true)
      on conflict (workflow_id) do update set side_effect = true, updated_at = now()
      where hub.workflow_flags.side_effect is distinct from true`;
}

/** NOTIFY trong transaction: Postgres chỉ giao khi commit — lỗi thì không ai nhận. */
export async function notifyHubConfigChanged(tx: Tx, version: number): Promise<void> {
  const payload = JSON.stringify({ v: HUB_CONTRACT_VERSION, version });
  await tx`select pg_notify(${HUB_CONFIG_CHANNEL}, ${payload})`;
}
