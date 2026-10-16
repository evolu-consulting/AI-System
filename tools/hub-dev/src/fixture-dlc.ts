// DLC-R10 · DLC-R13 · seed dev AI SDLC cho tenant `evolu`: provider `dlc` (api, vendor `evolu`) + profile `dlc-1` + agent
// `dlc` = **AI SDLC Supervisor** (agentic-cli, timeout 3600 s, cấp cho mọi user evolu — vẫn chat được) + đội agent vai trò
// của engine (`fixture-dlc-team.ts`, lấy từ `GET <HUB_DLC_URL>/api/catalog`). Agent Runtime chạy job của provider `dlc`
// bằng HTTP tới engine (`runtimes/dlc`, cần `dlc` ∈ `AGENT_RT_PROVIDERS` + `AGENT_RT_DLC_URL`) — không CLI. Như
// `fixture-agents.ts`: chạy SAU `hub:seed`, owner DB, idempotent, chỉ tăng `hub_config_version` khi có ghi. Seed mặc định
// (`apps/hub-api/seed`) không đổi.
import postgres from "postgres";
import { DEMO_TENANT } from "./fixture";
import {
  DLC_SUPERVISOR,
  ensureDlcTeam,
  ensureDlcWorkflows,
  fetchCatalogAgents,
  roleAgentKey,
} from "./fixture-dlc-team";

export const DLC_PROVIDER = "dlc";
export const DLC_PROFILE = "dlc-1";
export const DLC_AGENT = {
  key: DLC_SUPERVISOR,
  name: { vi: "AI SDLC", en: "AI SDLC" },
  description:
    "Supervisor của dây chuyền AI SDLC: nhận spec Markdown trong chat, giao cho đội agent DLC build/test/triển khai " +
    "(New System, Enhancement, Bug Fix), theo dõi run, hỏi khi cần quyết định, xử lý run lỗi và trả link app.",
  timeout_s: 3600,
};

async function ensureProvider(tx: postgres.TransactionSql): Promise<string> {
  await tx`insert into hub.providers (key, kind, vendor, max_concurrency)
    values (${DLC_PROVIDER}, 'api', 'evolu', 4) on conflict (key) do nothing`;
  const steps = [{ provider_key: DLC_PROVIDER, model: null, on: [] }];
  await tx`insert into hub.model_profiles (key, steps) values (${DLC_PROFILE}, ${tx.json(steps)})
    on conflict (key) do nothing`;
  const [p] = await tx<
    { id: string }[]
  >`select id from hub.model_profiles where key = ${DLC_PROFILE}`;
  if (!p) throw new Error(`profile ${DLC_PROFILE} không tạo được`);
  return p.id;
}

/** Agent `dlc` là supervisor: mô tả + `runtime_options.team` (chỉ ghi khi chưa cấu hình ở Studio — `team` vắng). */
async function ensureSupervisor(
  tx: postgres.TransactionSql,
  profileId: string,
  team: readonly string[],
): Promise<string | null> {
  const a = DLC_AGENT;
  const opts = { role: "supervisor", team };
  await tx`insert into hub.agents (key, name, description, runtime, profile_id, timeout_s, runtime_options)
    values (${a.key}, ${tx.json(a.name)}, ${a.description}, 'agentic-cli', ${profileId}, ${a.timeout_s}, ${tx.json(opts)})
    on conflict (key) do update set description = excluded.description, runtime_options = excluded.runtime_options
    where not (hub.agents.runtime_options ? 'team')`;
  const [agent] = await tx<{ id: string }[]>`select id from hub.agents where key = ${a.key}`;
  return agent?.id ?? null;
}

/** Trả false nếu chưa có tenant `evolu`. */
export async function ensureDlcAgent(ownerUrl: string): Promise<boolean> {
  const catalog = await fetchCatalogAgents(process.env.HUB_DLC_URL);
  const team = catalog.filter((r) => r.role !== "supervisor").map((r) => roleAgentKey(r.role));
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const users = await tx<{ tid: string; id: string }[]>`
        select t.id as tid, u.id from admin.tenants t join admin.users u on u.tenant_id = t.id
        where t.key = ${DEMO_TENANT.key}`;
      const tid = users[0]?.tid;
      if (!tid) return false;
      const agentId = await ensureSupervisor(tx, await ensureProvider(tx), team);
      if (!agentId) return false;
      const ent = await tx`insert into hub.agent_entitlements (agent_id, tenant_id)
        values (${agentId}, ${tid}) on conflict do nothing returning 1`;
      const grants = users.map((u) => ({
        agent_id: agentId,
        tenant_id: tid,
        subject_type: "user",
        subject_id: u.id,
      }));
      const ins =
        await tx`insert into hub.agent_grants ${tx(grants)} on conflict do nothing returning 1`;
      const synced = (await ensureDlcTeam(tx, tid, catalog)) + (await ensureDlcWorkflows(tx));
      if (ent.length + ins.length + synced > 0)
        await tx`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      return true;
    });
  } finally {
    await sql.end();
  }
}
