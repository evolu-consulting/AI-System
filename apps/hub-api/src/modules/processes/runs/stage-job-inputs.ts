// CR-115 · HUB-FR-106 · P1-25 · PB-R10 · PC-R05/R11 · đầu vào job stage của `stage-driver` (tách cho giới hạn 400 dòng):
// liên kết `hub.runs` → stage + (agent đơn) `timeout_s` + `sources`/`autofix` đọc trong MỘT tx scope system (trước: ba tx).
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { stageJobExtras } from "./autofix.repo";
import type { Link } from "./team-runner";

export type JobInputs = {
  link: Link | null;
  timeoutS: number | null;
  extras: Awaited<ReturnType<typeof stageJobExtras>>;
};

/** §4 · `stage.timeout_s` (60..3600) ⇒ `AgentTask.agent.timeoutS` cho job (P1-25). P-b2 D3 · stage theo `stage_run_id`. */
async function stageTimeout(tx: Tx, link: Link): Promise<number | null> {
  if (!link.process_run_id || !link.stage_run_id) return null;
  const [r] = await tx.execute<{
    t: number | null;
  }>(sql`select (r.snapshot->'stages'->(s.stage_idx::int)->>'timeout_s')::int as t
      from hub.stage_runs s join hub.process_runs r on r.id = s.process_run_id
      where s.id = ${link.stage_run_id} and r.id = ${link.process_run_id}`);
  return r?.t ? Number(r.t) : null;
}

/** Chỉ đọc; thiếu liên kết hoặc không phải agent đơn ⇒ chỉ `link` (người gọi bỏ / chạy nhóm như cũ). */
export function jobInputs(db: Db, hubRunId: string, direct: boolean): Promise<JobInputs> {
  return withHubScope(db, { kind: "system" }, async (tx) => {
    const [link] = await tx.execute<Link>(
      sql`select process_run_id, stage_run_id, tenant_id from hub.runs where id = ${hubRunId}`,
    );
    if (!direct || !link?.process_run_id || !link.stage_run_id)
      return { link: link ?? null, timeoutS: null, extras: {} };
    const timeoutS = await stageTimeout(tx, link);
    return { link, timeoutS, extras: await stageJobExtras(tx, link) };
  });
}
