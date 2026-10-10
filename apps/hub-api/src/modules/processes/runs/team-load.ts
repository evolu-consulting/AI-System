// HUB-FR-114 · HUB-BR-23 · D7 · C2 · PF1 · nạp nhóm + thành viên cho stage nhóm và kiểm sẵn sàng (entitlement nhóm +
// agent thành viên bật, KHÔNG kiểm grant người bắt đầu). Thuần SQL (scope `system`, RLS T); không log nội dung.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { RUNNABLE_RUNTIMES } from "../../agents/agent-access.rules";
import type { ConfigSnapshot } from "../../config/config.rules";
import type { ProcessDeps } from "../core/ports";

/** Phụ thuộc dùng chung cho stage nhóm (không có launcher/start). */
export type TeamDeps = Omit<ProcessDeps, "launcher" | "start">;

export type TeamLimits = {
  max_calls: number;
  max_tokens: number;
  max_active_s: number;
  summary_tokens: number;
  max_plan_steps: number;
};
export type TeamHead = {
  id: string;
  mode: "sequential" | "lead_plan" | "parallel_merge";
  lead_agent_id: string | null;
  enabled: boolean;
  limits: TeamLimits;
};
export type TeamMemberRow = {
  agent_id: string;
  role: string;
  sections: string[];
  position: number;
};

const DEFAULT_LIMITS: TeamLimits = {
  max_calls: 10,
  max_tokens: 200000,
  max_active_s: 600,
  summary_tokens: 200,
  max_plan_steps: 5,
};

export async function loadTeam(tx: Tx, teamId: string): Promise<TeamHead | null> {
  const [r] = await tx.execute<{
    id: string;
    mode: TeamHead["mode"];
    lead_agent_id: string | null;
    enabled: boolean;
    limits: Partial<TeamLimits> | null;
  }>(
    sql`select id, mode, lead_agent_id, enabled, limits from hub.agent_teams where id = ${teamId}`,
  );
  if (!r) return null;
  return {
    id: r.id,
    mode: r.mode,
    lead_agent_id: r.lead_agent_id,
    enabled: r.enabled,
    limits: { ...DEFAULT_LIMITS, ...(r.limits ?? {}) },
  };
}

export async function loadMembers(tx: Tx, teamId: string): Promise<TeamMemberRow[]> {
  const rows = await tx.execute<TeamMemberRow>(sql`select agent_id, role, sections, position
    from hub.agent_team_members where team_id = ${teamId} order by position, agent_id`);
  return [...rows].map((m) => ({ ...m, position: Number(m.position), sections: m.sections ?? [] }));
}

/** Entitlement nhóm của tenant chưa thu hồi. */
export async function teamEntitled(tx: Tx, teamId: string, tenantId: string): Promise<boolean> {
  const [r] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.agent_team_entitlements
    where team_id = ${teamId} and tenant_id = ${tenantId} and revoked_at is null limit 1`);
  return r !== undefined;
}

/** C2 · agent thành viên bật + entitlement tenant (runtime chạy được); KHÔNG kiểm grant (HUB-BR-23). */
export function memberAgentOk(s: ConfigSnapshot, agentId: string, tenantId: string): boolean {
  const a = s.agents.find((g) => g.id === agentId);
  if (!a?.enabled || !RUNNABLE_RUNTIMES.has(a.runtime)) return false;
  return s.entitlements.some(
    (e) => e.agentId === agentId && e.tenantId === tenantId && e.revokedAt === null,
  );
}

/** Nhóm sẵn sàng kick: tồn tại + bật + entitlement nhóm + ≥1 thành viên + mọi agent thành viên OK (C2). */
export async function teamReady(
  tx: Tx,
  s: ConfigSnapshot,
  p: { teamId: string; tenantId: string },
): Promise<{ ok: true; team: TeamHead; members: TeamMemberRow[] } | { ok: false }> {
  const team = await loadTeam(tx, p.teamId);
  if (!team?.enabled) return { ok: false };
  if (!(await teamEntitled(tx, p.teamId, p.tenantId))) return { ok: false };
  const members = await loadMembers(tx, p.teamId);
  if (members.length === 0) return { ok: false };
  if (team.mode === "lead_plan" && !team.lead_agent_id) return { ok: false };
  const leadOk = team.lead_agent_id === null || memberAgentOk(s, team.lead_agent_id, p.tenantId);
  if (!leadOk) return { ok: false };
  if (!members.every((m) => memberAgentOk(s, m.agent_id, p.tenantId))) return { ok: false };
  return { ok: true, team, members };
}
