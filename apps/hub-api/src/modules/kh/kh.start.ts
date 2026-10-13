// HUB-FR-133 · K1-AC07 · Q8 · Q34 · CR-073 · plan K1 §3.5 "Start", D8 · spec §3.4 (đích), §4 `snapshot.kh`: chốt đích
// `## Tóm tắt` lúc start — mỗi stage executor `agent` (agent `agentic-cli`): KH đầu tiên (thứ tự tick, dùng được) có
// `summary_project` ⇒ `snapshot.kh.stages[idx]` + "Tóm tắt" vào `required_sections` của snapshot (def gốc không đổi).
// Một query (`agent_kh` PK tiền tố `agent_id` + PK `kh_connections` + PK `agents`); bảng nền tảng, không RLS.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { HandoffShape } from "../processes/defs/def.rules";
import { type KhAgentConn, khJobConnections, khSummaryTarget } from "./kh.agent.rules";
import type { KhRuntime } from "./kh.mount";
import { khUsableNow } from "./kh.rules";
import { ensureSummary, planKhSnapshot, type SnapshotKhStage } from "./kh.summary.rules";

export type KhSnapshot = { stages: SnapshotKhStage[] };
type StartStage = HandoffShape & { executor: { kind: string; agent_id?: string } };

type Row = {
  agent_id: string;
  id: string;
  name: string;
  base_url: string;
  position: number | string;
  summary_project: string | null;
  check_status: string;
};

const agentIdOf = (s: StartStage): string | null =>
  s.executor.kind === "agent" && typeof s.executor.agent_id === "string"
    ? s.executor.agent_id
    : null;

async function connsByAgent(tx: Tx, ids: readonly string[]): Promise<Map<string, Row[]>> {
  const out = new Map<string, Row[]>();
  if (ids.length === 0) return out;
  const arr = sql`array[${sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  )}]`;
  const rows = await tx.execute<Row>(sql`select a.agent_id, k.id, k.name, k.base_url, a.position,
      k.summary_project, k.check_status
    from hub.agent_kh a join hub.kh_connections k on k.id = a.connection_id
      join hub.agents g on g.id = a.agent_id and g.runtime = 'agentic-cli'
    where a.agent_id = any(${arr}) order by a.agent_id, a.position`);
  for (const r of rows) out.set(r.agent_id, [...(out.get(r.agent_id) ?? []), r]);
  return out;
}

function targetOf(rt: KhRuntime, rows: readonly Row[]): SnapshotKhStage {
  const env = { dev: rt.dev };
  const attached: KhAgentConn[] = rows.map((r) => ({
    connectionId: r.id,
    name: r.name,
    position: Number(r.position),
    summaryProject: r.summary_project,
    usable: khUsableNow(
      { checkStatus: r.check_status, baseUrl: r.base_url },
      rt.cfg.allowedOrigins,
      env,
    ),
  }));
  return khSummaryTarget(khJobConnections(attached));
}

/**
 * Đích của từng stage ⇒ `{stages, kh}`: `kh = null` ⇒ trả nguyên `stages` (snapshot như cũ). Có ⇒ stage có đích thêm
 * "Tóm tắt" vào `output.required_sections` (`ensureSummary`). `rt` vắng ⇒ không KH.
 */
export async function khStartPlan<S>(
  tx: Tx,
  stages: readonly S[],
  rt: KhRuntime | undefined,
): Promise<{ stages: S[]; kh: KhSnapshot | null }> {
  const typed = stages as unknown as readonly StartStage[];
  const ids = [...new Set(typed.flatMap((s) => agentIdOf(s) ?? []))];
  if (!rt || ids.length === 0) return { stages: [...stages], kh: null };
  const byAgent = await connsByAgent(tx, ids);
  const targets = typed.map((s) => {
    const id = agentIdOf(s);
    return id ? targetOf(rt, byAgent.get(id) ?? []) : null;
  });
  const kh = planKhSnapshot(typed, targets);
  if (!kh) return { stages: [...stages], kh: null };
  const out = typed.map((s, i) =>
    kh.stages[i] === null
      ? s
      : {
          ...s,
          output: {
            ...s.output,
            required_sections: ensureSummary(s.output.required_sections, true),
          },
        },
  );
  return { stages: out as unknown as S[], kh };
}
