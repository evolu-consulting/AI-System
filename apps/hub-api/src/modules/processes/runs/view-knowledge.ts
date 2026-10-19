// HUB-FR-133 · HUB-FR-134 · K1-AC06 · CR-073 · plan K1 §3.5 "StageView.knowledge", §11 G9 · spec §3.1 `StageKnowledgeSchema`:
// phần tri thức của từng stage — `write_to` từ `snapshot.kh` (chốt lúc start), `queries`/`warning` từ `kh_stage_usage` của
// (attempt, round) HIỆN TẠI, `summary` từ `kh_writes` theo `current_output_id`. Có khi có đích hoặc có hàng usage.
// Đọc trong tx scope người xem (RLS T); mọi query lọc `process_run_id` + `tenant_id`.
import type { KhWarningCode, StageKnowledge } from "@ai/contracts/hub-admin";
import { KH_QUERY_LIMIT, KH_WARNING_CODES } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { writeStatesOfRun } from "../../kh/kh.writes.port";

type KhTarget = { connection_id: string; name: string; project: string } | null;
export type SnapKh = { stages?: KhTarget[] } | undefined;
type RunKey = { id: string; tenant_id: string };
type Usage = { queries: number; warning: KhWarningCode | null };

const SUMMARY_OF: Record<string, StageKnowledge["summary"]> = {
  pending: "pending",
  done: "written",
  failed: "failed",
  skipped: "skipped",
};
const isWarning = (v: unknown): v is KhWarningCode =>
  typeof v === "string" && (KH_WARNING_CODES as readonly string[]).includes(v);

async function usageByIdx(tx: Tx, r: RunKey): Promise<Map<number, Usage>> {
  const rows = await tx.execute<{
    stage_idx: number;
    queries: number;
    last_warning: string | null;
  }>(sql`
    select s.stage_idx, u.queries, u.last_warning from hub.kh_stage_usage u
      join hub.stage_runs s on s.id = u.stage_run_id and s.attempt = u.attempt and s.round = u.round
    where s.process_run_id = ${r.id} and s.tenant_id = ${r.tenant_id} and u.tenant_id = ${r.tenant_id}`);
  return new Map(
    rows.map((x) => [
      Number(x.stage_idx),
      {
        queries: Math.min(KH_QUERY_LIMIT, Math.max(0, Number(x.queries))),
        warning: isWarning(x.last_warning) ? x.last_warning : null,
      },
    ]),
  );
}

export type KnowledgeOf = (
  idx: number,
  currentOutputId: string | null,
) => StageKnowledge | undefined;

/** Dựng hàm tra `knowledge` theo stage (2 query: usage + `kh_writes` khi có `snapshot.kh`). */
export async function stageKnowledge(tx: Tx, r: RunKey, kh: SnapKh): Promise<KnowledgeOf> {
  const targets = Array.isArray(kh?.stages) ? kh.stages : [];
  const usage = await usageByIdx(tx, r);
  const writes =
    targets.length > 0 ? await writeStatesOfRun(tx, r.id, r.tenant_id) : new Map<string, string>();
  return (idx, currentOutputId) => {
    const t = targets[idx] ?? null;
    const u = usage.get(idx);
    if (t === null && !u) return undefined;
    const st = currentOutputId ? writes.get(currentOutputId) : undefined;
    return {
      write_to: t ? { connection: t.name, project: t.project } : null,
      queries: u?.queries ?? 0,
      query_limit: KH_QUERY_LIMIT,
      warning: u?.warning ?? null,
      summary: (st && SUMMARY_OF[st]) || "none",
    };
  };
}
