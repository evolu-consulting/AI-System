// HUB-FR-104 · HUB-FR-114 · D18 (plan-seed) · seed quy trình: nhóm agent (`agent_teams` + thành viên), bật nhóm cho tenant,
// mẫu quy trình (`process_defs.tenant_id` null) và bản chép cho tenant. Chạy trong transaction của `runHubSeed` SAU agent +
// entitlement. Idempotent: upsert theo key (không đổi ⇒ giữ `version`); bản chép tenant chỉ thêm khi tenant chưa có key.
import { TEAM_LIMITS_DEFAULT } from "@ai/contracts/chat";
import { processDefStagePaths } from "@ai/contracts/hub-admin";
import { loadTenantIds, type Tx } from "./seed.repo";
import { type SeedSource, SeedValidationError } from "./seed.rules";
import {
  SeedFileSchema,
  type SeedProcessTemplate,
  type SeedTeam,
  type SeedTeamEntitlement,
  type SeedTenantProcess,
} from "./seed.schema";
import type { SeedIssue } from "./seed.types";

export type ProcessSeedPlan = {
  teams: SeedTeam[];
  teamEntitlements: SeedTeamEntitlement[];
  templates: SeedProcessTemplate[];
  tenantProcesses: SeedTenantProcess[];
};

function dupes(issues: SeedIssue[], path: string, keys: readonly string[]): void {
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) issues.push({ path, message: "trùng key", value: k });
    seen.add(k);
  }
}

/** Shape stage cho luật chéo stage của contract (`real_action` cần stage trước có người kiểm). */
const stageShape = (t: SeedProcessTemplate) =>
  t.stages.map((s) => ({
    key: s.key,
    real_action: s.real_action,
    after: s.after === "review" ? { kind: "review" as const } : { kind: "auto" as const },
  })) as unknown as Parameters<typeof processDefStagePaths>[0];

type KeySets = { agentKeys: ReadonlySet<string>; teams: ReadonlySet<string> };
function checkTemplate(t: SeedProcessTemplate, k: KeySets, issues: SeedIssue[]): void {
  for (const s of t.stages) {
    const ok =
      "agent" in s.executor ? k.agentKeys.has(s.executor.agent) : k.teams.has(s.executor.team);
    if (!ok)
      issues.push({
        path: `process_templates.${t.key}.${s.key}.executor`,
        message: "không có trong seed",
      });
  }
  dupes(
    issues,
    `process_templates.${t.key}.stages.key`,
    t.stages.map((s) => s.key),
  );
  for (const path of processDefStagePaths(stageShape(t)))
    issues.push({
      path: `process_templates.${t.key}.${path}`,
      message: "real_action cần stage trước có người kiểm",
    });
}

function checkRefs(p: ProcessSeedPlan, agentKeys: ReadonlySet<string>, issues: SeedIssue[]): void {
  const teams = new Set(p.teams.map((t) => t.key));
  const tpls = new Set(p.templates.map((t) => t.key));
  for (const t of p.teams)
    for (const m of t.members)
      if (!agentKeys.has(m.agent))
        issues.push({
          path: `agent_teams.${t.key}.members`,
          message: "agent không có trong seed",
          value: m.agent,
        });
  for (const e of p.teamEntitlements)
    if (!teams.has(e.team))
      issues.push({ path: "team_entitlements.team", message: "nhóm không có", value: e.team });
  for (const t of p.templates) checkTemplate(t, { agentKeys, teams }, issues);
  for (const x of p.tenantProcesses)
    if (!tpls.has(x.template))
      issues.push({
        path: "tenant_processes.template",
        message: "mẫu không có",
        value: x.template,
      });
}

/** Gộp mục quy trình của mọi file (file đã qua `buildSeedPlan` nên parse chắc chắn thành công) + kiểm tham chiếu. */
export function buildProcessPlan(
  sources: SeedSource[],
  agentKeys: ReadonlySet<string>,
): ProcessSeedPlan {
  const p: ProcessSeedPlan = {
    teams: [],
    teamEntitlements: [],
    templates: [],
    tenantProcesses: [],
  };
  for (const s of sources) {
    const d = SeedFileSchema.parse(s.data ?? {});
    p.teams.push(...d.agent_teams);
    p.teamEntitlements.push(...d.team_entitlements);
    p.templates.push(...d.process_templates);
    p.tenantProcesses.push(...d.tenant_processes);
  }
  const issues: SeedIssue[] = [];
  dupes(
    issues,
    "agent_teams.key",
    p.teams.map((t) => t.key),
  );
  dupes(
    issues,
    "process_templates.key",
    p.templates.map((t) => t.key),
  );
  checkRefs(p, agentKeys, issues);
  if (issues.length) throw new SeedValidationError(issues);
  return p;
}

async function idsByKey(tx: Tx, table: "agents" | "agent_teams"): Promise<Map<string, string>> {
  type Row = { id: string; key: string };
  const rows =
    table === "agents"
      ? await tx<Row[]>`select id, key from hub.agents`
      : await tx<Row[]>`select id, key from hub.agent_teams`;
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function upsertTeams(tx: Tx, teams: SeedTeam[], agents: Map<string, string>): Promise<void> {
  for (const t of teams) {
    const [row] = await tx<
      { id: string }[]
    >`insert into hub.agent_teams (key, name, description, mode, limits)
      values (${t.key}, ${tx.json(t.name)}, ${t.description}, ${t.mode}, ${tx.json(TEAM_LIMITS_DEFAULT)})
      on conflict (key) do update set name = excluded.name, description = excluded.description, mode = excluded.mode,
        version = hub.agent_teams.version + 1, updated_at = now()
      where (hub.agent_teams.name, hub.agent_teams.description, hub.agent_teams.mode)
        is distinct from (excluded.name, excluded.description, excluded.mode)
      returning id`;
    const id =
      row?.id ??
      (await tx<{ id: string }[]>`select id from hub.agent_teams where key = ${t.key}`)[0]?.id ??
      null;
    await tx`delete from hub.agent_team_members where team_id = ${id}`;
    for (const [i, m] of t.members.entries())
      await tx`insert into hub.agent_team_members (team_id, agent_id, role, sections, position)
        values (${id}, ${agents.get(m.agent) ?? null}, ${m.role}, ${m.sections}, ${i})`;
  }
}

async function entitleTeams(
  tx: Tx,
  rows: SeedTeamEntitlement[],
  teams: Map<string, string>,
  warn: string[],
) {
  const tenants = await loadTenantIds(
    tx,
    rows.map((r) => r.tenant_key),
  );
  for (const e of rows) {
    const tid = tenants.get(e.tenant_key);
    if (!tid) {
      warn.push(`seed-team-tenant-unknown: tenant_key=${e.tenant_key}`);
      continue;
    }
    await tx`insert into hub.agent_team_entitlements (team_id, tenant_id) values (${teams.get(e.team) ?? null}, ${tid})
      on conflict (team_id, tenant_id) do nothing`;
  }
}

type Ids = { agents: Map<string, string>; teams: Map<string, string> };
const stageJson = (t: SeedProcessTemplate, ids: Ids) =>
  t.stages.map((s) => ({
    key: s.key,
    name: s.name,
    executor:
      "agent" in s.executor
        ? { kind: "agent", agent_id: ids.agents.get(s.executor.agent) }
        : { kind: "team", team_id: ids.teams.get(s.executor.team) },
    instruction: s.instruction,
    output: { ...s.output, fields: [] },
    after: s.after === "review" ? { kind: "review", group_id: null } : { kind: "auto" },
    real_action: s.real_action,
    answerer: { kind: "starter" },
    timeout_s: s.timeout_s,
    token_budget: null,
  }));

async function upsertTemplates(tx: Tx, tpls: SeedProcessTemplate[], ids: Ids): Promise<void> {
  for (const t of tpls) {
    const stages = tx.json(stageJson(t, ids) as unknown as Parameters<typeof tx.json>[0]);
    const [cur] = await tx<{ id: string }[]>`select id from hub.process_defs
      where tenant_id is null and key = ${t.key} and deleted_at is null for update`;
    if (!cur) {
      await tx`insert into hub.process_defs (tenant_id, key, name, description, input_hint, stages, enabled)
        values (null, ${t.key}, ${t.name}, ${t.description}, ${t.input_hint}, ${stages}, false)`;
      continue;
    }
    await tx`update hub.process_defs set name = ${t.name}, description = ${t.description}, input_hint = ${t.input_hint},
        stages = ${stages}, version = version + 1, updated_at = now()
      where id = ${cur.id} and (name, description, input_hint, stages)
        is distinct from (${t.name}::text, ${t.description}::text, ${t.input_hint}::text, ${stages}::jsonb)`;
  }
}

/** Bản chép tenant: Group kiểm theo key; Group vắng ⇒ giữ null + tắt + cảnh báo (bật cần đủ Group — ADM-FR-66). */
async function copyToTenants(tx: Tx, rows: SeedTenantProcess[], warn: string[]): Promise<void> {
  const tenants = await loadTenantIds(
    tx,
    rows.map((r) => r.tenant_key),
  );
  for (const x of rows) {
    const tid = tenants.get(x.tenant_key);
    if (!tid) {
      warn.push(`seed-process-tenant-unknown: tenant_key=${x.tenant_key}`);
      continue;
    }
    const [g] = x.review_group
      ? await tx<
          { id: string }[]
        >`select id from admin.groups where tenant_id = ${tid} and key = ${x.review_group}`
      : [];
    if (x.review_group && !g)
      warn.push(`seed-process-group-unknown: ${x.tenant_key}/${x.review_group}`);
    const enabled = x.enabled && (!x.review_group || Boolean(g));
    await tx`insert into hub.process_defs (tenant_id, key, name, description, input_hint, stages, enabled,
        source_template_id)
      select ${tid}, t.key, t.name, t.description, t.input_hint,
        (select jsonb_agg(case when s->'after'->>'kind' = 'review'
            then jsonb_set(s, '{after,group_id}', coalesce(to_jsonb(${g?.id ?? null}::uuid), 'null'::jsonb)) else s end
          order by i) from jsonb_array_elements(t.stages) with ordinality as e(s, i)),
        ${enabled}, t.id
      from hub.process_defs t
      where t.tenant_id is null and t.key = ${x.template} and t.deleted_at is null
        and not exists (select 1 from hub.process_defs d where d.tenant_id = ${tid} and d.key = t.key
          and d.deleted_at is null)`;
  }
}

/** Ghi toàn bộ phần quy trình; trả cảnh báo (log sau commit). */
export async function writeProcesses(tx: Tx, p: ProcessSeedPlan): Promise<string[]> {
  const warn: string[] = [];
  const agents = await idsByKey(tx, "agents");
  await upsertTeams(tx, p.teams, agents);
  const teams = await idsByKey(tx, "agent_teams");
  await entitleTeams(tx, p.teamEntitlements, teams, warn);
  await upsertTemplates(tx, p.templates, { agents, teams });
  await copyToTenants(tx, p.tenantProcesses, warn);
  return warn;
}
