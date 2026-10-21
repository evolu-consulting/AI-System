// Cài AI chung cho MỘT tenant bất kỳ (kể cả nitigroup) — KHÔNG có dữ liệu giả, không đổi tên công ty, không gửi mail/thông báo
// nghiệp vụ. LẶP LẠI ĐƯỢC. Mặc định chạy thử (in kế hoạch); `--apply` mới ghi. Cần DATABASE_URL của chủ migration. Trên máy chủ:
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/tenant-ai-setup.ts --tenant <key> [--apply]
// Việc làm: (1) entitlement agent `assistant`; (2) cấp `assistant` cho ĐÚNG các Group đang có quyền gói contracts; (3) bật gói
// `knowledge` (entitlement knowledge-read/write/admin) + cấp cho cùng các Group như contracts; (4) agent mặc định của tenant =
// `assistant` (on_no_match='answer') — chỉ khi chưa có mặc định hoặc mặc định là orchestrator. Có đổi gì ⇒ tăng + báo cấu hình hub/admin.
import postgres from "postgres";

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;

export const KNOWLEDGE_FEATS = ["knowledge-read", "knowledge-write", "knowledge-admin"];
export const CONTRACTS_FEATS = ["contracts-read", "contracts-write", "contracts-admin"];

export type SetupPlan = {
  /** Agent `assistant` chưa được seed trên hub (không thể áp dụng). */
  agentMissing: boolean;
  /** Chưa có entitlement `assistant` cho tenant. */
  entitlement: boolean;
  /** Số Group có quyền contracts nhưng chưa được cấp `assistant`. */
  agentGrants: number;
  /** Feature knowledge-* chưa bật cho tenant (−1 = gói knowledge chưa cài trên máy chủ). */
  knowledgePack: number;
  /** Số grant contracts-* → knowledge-* còn thiếu theo Group. */
  knowledgeGrants: number;
  /** Cần đặt agent mặc định = assistant. */
  defaultAgent: boolean;
  /** Key agent mặc định hiện tại (null = chưa có). */
  currentDefault: string | null;
};

export type PlanOpts = {
  /** Ghi đè mọi mặc định hiện có (demo). Mặc định chỉ khi chưa có hoặc là orchestrator. */
  forceDefault?: boolean;
};

/** Thuần: có nên đặt agent mặc định = assistant không. */
export function shouldSetDefault(current: string | null, force = false): boolean {
  if (current === "assistant") return false;
  return force || current === null || current === "orchestrator";
}

/** Thuần: kế hoạch → các dòng mô tả để in; rỗng ⇒ không việc gì (no-op). */
export function describePlan(p: SetupPlan): string[] {
  if (p.agentMissing) return ["LỖI: agent `assistant` chưa có trên hub — chạy hub seed trước"];
  const out: string[] = [];
  if (p.entitlement) out.push("bật entitlement agent assistant");
  if (p.agentGrants > 0) out.push(`cấp assistant cho ${p.agentGrants} Group có quyền contracts`);
  if (p.knowledgePack < 0)
    out.push("BỎ QUA gói knowledge: chưa cài trên máy chủ (thiếu feature knowledge-*)");
  else if (p.knowledgePack > 0) out.push(`bật ${p.knowledgePack} feature knowledge-* cho tenant`);
  if (p.knowledgePack >= 0 && p.knowledgeGrants > 0)
    out.push(`cấp ${p.knowledgeGrants} grant knowledge-* theo Group như contracts`);
  if (p.defaultAgent)
    out.push(
      `đặt agent mặc định = assistant (on_no_match=answer; hiện: ${p.currentDefault ?? "chưa có"})`,
    );
  return out;
}

const agentWork = (p: SetupPlan): boolean =>
  !p.agentMissing && (p.entitlement || p.agentGrants > 0 || p.defaultAgent);
const knowledgeWork = (p: SetupPlan): boolean => p.knowledgePack > 0 || p.knowledgeGrants > 0;
export const hasWork = (p: SetupPlan): boolean => agentWork(p) || knowledgeWork(p);

export async function planAiSetup(tx: Tx, t: string, o: PlanOpts = {}): Promise<SetupPlan> {
  const [r] = await tx<
    {
      agent: boolean;
      ent: boolean;
      grants: number;
      feats: number;
      missing: number;
      kgrants: number;
      cur: string | null;
    }[]
  >`select
    exists (select 1 from hub.agents where key = 'assistant') as agent,
    not exists (select 1 from hub.agent_entitlements e join hub.agents a on a.id = e.agent_id
      where a.key = 'assistant' and e.tenant_id = ${t} and e.revoked_at is null) as ent,
    (select count(distinct g.group_id)::int from admin.feature_grants g join admin.features c on c.id = g.feature_id
      where g.tenant_id = ${t} and g.group_id is not null and c.key = any(${CONTRACTS_FEATS}::text[])
        and not exists (select 1 from hub.agent_grants x join hub.agents a on a.id = x.agent_id and a.key = 'assistant'
          where x.tenant_id = g.tenant_id and x.subject_type = 'group' and x.subject_id = g.group_id)) as grants,
    (select count(*)::int from admin.features where key = any(${KNOWLEDGE_FEATS}::text[])) as feats,
    (select count(*)::int from admin.features f where f.key = any(${KNOWLEDGE_FEATS}::text[])
      and not exists (select 1 from admin.feature_entitlements e where e.feature_id = f.id and e.tenant_id = ${t}
        and e.revoked_at is null)) as missing,
    (select count(*)::int from admin.feature_grants g join admin.features c on c.id = g.feature_id
      join admin.features k on k.key = replace(c.key, 'contracts-', 'knowledge-')
      where g.tenant_id = ${t} and g.group_id is not null and c.key = any(${CONTRACTS_FEATS}::text[])
        and not exists (select 1 from admin.feature_grants x where x.tenant_id = g.tenant_id and x.feature_id = k.id
          and x.group_id = g.group_id)) as kgrants,
    (select a.key from hub.tenant_agent_defaults d join hub.agents a on a.id = d.default_agent_id
      where d.tenant_id = ${t}) as cur`;
  if (!r) throw new Error("tenant-ai-setup: không đọc được hiện trạng");
  return {
    agentMissing: !r.agent,
    entitlement: r.ent,
    agentGrants: r.grants,
    knowledgePack: r.feats < 3 ? -1 : r.missing,
    knowledgeGrants: r.feats < 3 ? 0 : r.kgrants,
    defaultAgent: r.agent && shouldSetDefault(r.cur, o.forceDefault),
    currentDefault: r.cur,
  };
}

/** Mỗi bước một câu SQL theo tập (Luật 4c). Không có việc ⇒ không ghi, không tăng version. Thiếu agent ⇒ chỉ làm phần knowledge. */
export async function applyAiSetup(tx: Tx, t: string, p: SetupPlan): Promise<void> {
  if (agentWork(p)) await applyAgentSide(tx, t, p);
  if (knowledgeWork(p)) await applyKnowledgePack(tx, t);
}

async function applyAgentSide(tx: Tx, t: string, p: SetupPlan): Promise<void> {
  const [v] = await tx<
    { v: number }[]
  >`update hub.config_meta set hub_config_version = hub_config_version + 1
    where id = 1 returning hub_config_version as v`;
  await tx`insert into hub.agent_entitlements (agent_id, tenant_id)
    select id, ${t}::uuid from hub.agents where key = 'assistant'
    on conflict (agent_id, tenant_id) do update set revoked_at = null, granted_at = now()
      where hub.agent_entitlements.revoked_at is not null`;
  await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    select distinct a.id, g.tenant_id, 'group', g.group_id
    from admin.feature_grants g join admin.features c on c.id = g.feature_id, hub.agents a
    where g.tenant_id = ${t} and g.group_id is not null and c.key = any(${CONTRACTS_FEATS}::text[])
      and a.key = 'assistant'
    on conflict (agent_id, tenant_id, subject_type, subject_id) do nothing`;
  if (p.defaultAgent)
    await tx`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, fallback_agent_id, on_no_match)
      select ${t}::uuid, id, null, 'answer' from hub.agents where key = 'assistant'
      on conflict (tenant_id) do update set default_agent_id = excluded.default_agent_id,
        fallback_agent_id = null, on_no_match = 'answer', updated_at = now()`;
  await tx`select pg_notify('hub_config_changed', ${JSON.stringify({ v: 1, version: v?.v })})`;
}

async function applyKnowledgePack(tx: Tx, t: string): Promise<void> {
  await tx`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
    select f.id, ${t}::uuid, (select e.granted_by from admin.feature_entitlements e
      join admin.features c on c.id = e.feature_id where e.tenant_id = ${t} and c.key = 'contracts-read' limit 1)
    from admin.features f where f.key = any(${KNOWLEDGE_FEATS}::text[])
    on conflict (feature_id, tenant_id) do update set revoked_at = null, granted_at = now()
      where admin.feature_entitlements.revoked_at is not null`;
  await tx`insert into admin.feature_grants (tenant_id, feature_id, group_id, granted_by)
    select g.tenant_id, k.id, g.group_id, g.granted_by from admin.feature_grants g
      join admin.features c on c.id = g.feature_id
      join admin.features k on k.key = replace(c.key, 'contracts-', 'knowledge-')
    where g.tenant_id = ${t} and g.group_id is not null and c.key = any(${CONTRACTS_FEATS}::text[])
    on conflict (tenant_id, feature_id, group_id) where group_id is not null do nothing`;
  const [v] = await tx<
    { v: number }[]
  >`insert into admin.config_meta (id, config_version, updated_at)
    values (1, 1, now()) on conflict (id) do update
      set config_version = admin.config_meta.config_version + 1, updated_at = now()
    returning config_version as v`;
  // Hub (ConfigCache) nạp lại quyền gói khi nhận `config_changed` (giao lúc commit)
  await tx`select pg_notify('config_changed', ${JSON.stringify({ v: v?.v, entity: "batch", tenant_id: t })})`;
}

export async function run(
  sql: Sql,
  key: string,
  doApply: boolean,
  o: PlanOpts = {},
): Promise<SetupPlan> {
  return sql.begin(async (tx) => {
    const [t] = await tx<{ id: string }[]>`select id from admin.tenants where key = ${key}`;
    if (!t) throw new Error(`tenant-ai-setup: không có tenant "${key}"`);
    const p = await planAiSetup(tx, t.id, o);
    if (doApply && p.agentMissing)
      throw new Error("tenant-ai-setup: agent `assistant` chưa có trên hub — chạy hub seed trước");
    if (doApply) await applyAiSetup(tx, t.id, p);
    return p;
  });
}

async function main(argv: readonly string[]): Promise<void> {
  const i = argv.indexOf("--tenant");
  const key = i >= 0 ? argv[i + 1] : undefined;
  if (!key || key.startsWith("--")) throw new Error("tenant-ai-setup: cần --tenant <key>");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("tenant-ai-setup: cần DATABASE_URL (chủ migration)");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [r] = await sql<
      { su: boolean }[]
    >`select rolsuper as su from pg_roles where rolname = current_user`;
    if (!r?.su) throw new Error("tenant-ai-setup: cần vai siêu người dùng (chủ migration)");
    const apply = argv.includes("--apply");
    const p = await run(sql, key, apply);
    const steps = describePlan(p);
    console.log(
      `tenant-ai-setup[${key}]: ${apply ? "ĐÃ ÁP DỤNG" : "chạy thử (thêm --apply để ghi)"} — ${steps.length ? "kế hoạch:" : "không có việc cần làm"}`,
    );
    for (const s of steps) console.log(`  - ${s}`);
    if (p.agentMissing) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
