// HUB-FR-114 · HUB-BR-23 · D7 · C2 · PF1 · nạp nhóm + thành viên cho stage nhóm và kiểm sẵn sàng (entitlement nhóm +
// agent thành viên bật, KHÔNG kiểm grant người bắt đầu). Thuần SQL (scope `system`, RLS T); không log nội dung.
import type { StepRole } from "@ai/contracts/chat";
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

export type OutputStep = {
  role: StepRole;
  member_key: string | null;
  agent: { key: string; name: string };
  model: string | null;
  ms: number | null;
  tokens: number;
};
type StepRow = {
  agent_key: string;
  agent_name: string | null;
  role: StepRole;
  member_key: string | null;
  model: string | null;
  ms: number | null;
  tokens: number;
};
const STEP_COLS = sql`coalesce(rs.agent_id::text, rs.detail->>'member_key') as agent_key,
  coalesce(ag.name->>'vi', rs.detail->>'member_key', rs.agent_id::text) as agent_name,
  coalesce(rs.detail->>'role', 'agent') as role, rs.detail->>'member_key' as member_key,
  max(ul.model) as model, sum(ul.latency_ms)::int as ms,
  coalesce(sum(ul.input_tokens + ul.output_tokens + coalesce(ul.cache_read_tokens, 0)
    + coalesce(ul.cache_write_tokens, 0)), 0)::int as tokens`;
const STEP_GROUP = sql`group by rs.id, rs.agent_id, ag.name, rs.detail->>'role', rs.detail->>'member_key'
  order by min(rs.started_at) limit 10`;
const mapStep = (x: StepRow): OutputStep => ({
  role: x.role,
  member_key: x.member_key,
  agent: { key: x.agent_key, name: (x.agent_name ?? x.agent_key).slice(0, 100) },
  model: x.model,
  ms: x.ms === null ? null : Number(x.ms),
  tokens: Number(x.tokens),
});

/**
 * HUB-FR-114 · HUB-FR-116 · P-a D5 · các bước thành viên của output nhóm (tin thread `output`.steps =
 * `RoomProcessStep`, P1-87): mỗi `run_steps` có `member_key` của team-run stage này (plan §6); token/latency/model =
 * Σ `usage_logs` theo `step_id`. Stage agent đơn ⇒ `outputStepsSingle`. Tên agent nạp từ `hub.agents.name` (vi,
 * catalog không RLS) fallback member_key → id (UAT thấy UUID trước đây).
 */
export async function outputSteps(
  tx: Tx,
  p: { stageRunId: string; tenantId: string; attempt: number },
): Promise<OutputStep[]> {
  const rows = await tx.execute<StepRow>(sql`
    select ${STEP_COLS}
    from hub.runs r
    join hub.run_steps rs on rs.run_id = r.id and rs.tenant_id = r.tenant_id
    left join hub.usage_logs ul on ul.step_id = rs.id and ul.tenant_id = r.tenant_id
    left join hub.agents ag on ag.id = rs.agent_id
    where r.tenant_id = ${p.tenantId} and r.team_run_id in (
      select id from hub.team_runs where stage_run_id = ${p.stageRunId}
        and tenant_id = ${p.tenantId} and attempt = ${p.attempt})
      and rs.detail->>'member_key' is not null
    ${STEP_GROUP}`);
  return [...rows].map(mapStep);
}

/**
 * HUB-FR-113 · HUB-FR-116 · P-a D6a · các bước của output stage agent đơn (tin thread `output`.steps): `run_steps`
 * của chính `hub.runs` lần chạy stage này (`hubRunId`) — không qua team-run. Token/latency/model = Σ `usage_logs`
 * theo `step_id`. Trước đây path agent đơn phát steps rỗng ⇒ thẻ thread hiện "0 bước · 0 token".
 */
export async function outputStepsSingle(
  tx: Tx,
  p: { hubRunId: string; tenantId: string },
): Promise<OutputStep[]> {
  const rows = await tx.execute<StepRow>(sql`
    select ${STEP_COLS}
    from hub.run_steps rs
    left join hub.usage_logs ul on ul.step_id = rs.id and ul.tenant_id = rs.tenant_id
    left join hub.agents ag on ag.id = rs.agent_id
    where rs.run_id = ${p.hubRunId} and rs.tenant_id = ${p.tenantId} and rs.agent_id is not null
    ${STEP_GROUP}`);
  return [...rows].map(mapStep);
}

/**
 * D6a · bước của thẻ output: nhóm ⇒ bước thành viên theo team-run; agent đơn ⇒ `run_steps` của chính lần chạy stage.
 * Stage `tool` (T18-perf): hub run chỉ có bước `tool` `agent_id` NULL mà `outputStepsSingle` bỏ ⇒ luôn rỗng, không đọc.
 */
export function stageOutputSteps(
  tx: Tx,
  p: { kind: string; stageRunId: string; hubRunId: string; tenantId: string; attempt: number },
): Promise<OutputStep[]> {
  if (p.kind === "tool") return Promise.resolve([]);
  if (p.kind === "team") return outputSteps(tx, p);
  return outputStepsSingle(tx, p);
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
