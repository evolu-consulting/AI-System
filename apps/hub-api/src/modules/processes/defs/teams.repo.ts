// HUB-FR-114 · ADM-FR-65 · nhóm agent bật cho tenant (`GET /agent-teams`) + tập tham chiếu hợp lệ cho `validateProcessDef`
// (plan-contract §6). `tenantId` null = phạm vi mẫu (platform_admin): mọi agent/nhóm đang bật, không Group/user nào.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { DefRefs } from "./def.rules";

type Name = { vi: string; en: string };
export type TeamRow = {
  id: string;
  key: string;
  name: Name;
  description: string;
  mode: "sequential" | "lead_plan" | "parallel_merge";
};
export type MemberRow = {
  team_id: string;
  agent_id: string;
  agent_key: string;
  agent_name: Name;
  role: string;
  sections: string[];
};

const teamEntitled = (tenantId: string | null) =>
  tenantId === null
    ? sql`true`
    : sql`exists (select 1 from hub.agent_team_entitlements e
        where e.team_id = t.id and e.tenant_id = ${tenantId} and e.revoked_at is null)`;

/** ≤ 200 nhóm (cấu hình platform, nhỏ); thành viên theo `position`. */
export async function listTeams(
  tx: Tx,
  tenantId: string | null,
): Promise<{ teams: TeamRow[]; members: MemberRow[] }> {
  const teams = await tx.execute<TeamRow>(sql`select t.id, t.key, t.name, t.description, t.mode
    from hub.agent_teams t where t.enabled and ${teamEntitled(tenantId)} order by t.key limit 200`);
  if (!teams.length) return { teams: [], members: [] };
  const ids = teams.map((t) => t.id);
  const members = await tx.execute<MemberRow>(sql`select m.team_id, m.agent_id, a.key as agent_key,
      a.name as agent_name, m.role, m.sections
    from hub.agent_team_members m join hub.agents a on a.id = m.agent_id
    where m.team_id in (${sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    )})
    order by m.team_id, m.position limit 4000`);
  return { teams: [...teams], members: [...members] };
}

const idSet = (rows: readonly { id: string }[]): Set<string> => new Set(rows.map((r) => r.id));

export async function loadDefRefs(tx: Tx, tenantId: string | null): Promise<DefRefs> {
  if (tenantId === null) {
    const agents = await tx.execute<{ id: string }>(sql`select id from hub.agents where enabled`);
    const teams = await tx.execute<{ id: string }>(
      sql`select id from hub.agent_teams where enabled`,
    );
    return {
      agentIds: idSet(agents),
      teamIds: idSet(teams),
      groupIds: new Set(),
      userIds: new Set(),
    };
  }
  const agents = await tx.execute<{ id: string }>(sql`select a.id from hub.agent_entitlements e
    join hub.agents a on a.id = e.agent_id
    where e.tenant_id = ${tenantId} and e.revoked_at is null and a.enabled`);
  const teams = await tx.execute<{ id: string }>(sql`select t.id from hub.agent_teams t
    where t.enabled and ${teamEntitled(tenantId)}`);
  const groups = await tx.execute<{ id: string }>(
    sql`select id from admin.groups where tenant_id = ${tenantId}`,
  );
  const users = await tx.execute<{ id: string }>(
    sql`select id from admin.users where tenant_id = ${tenantId} and active`,
  );
  return {
    agentIds: idSet(agents),
    teamIds: idSet(teams),
    groupIds: idSet(groups),
    userIds: idSet(users),
  };
}
