// HUB-FR-133 · HUB-FR-134 · K1-AC05 · K1-AC06 · CR-073 · plan K1 §3.5, D8, §5 `kh_writes` · SQL hàng chờ ghi `## Tóm tắt`:
// enqueue cùng tx `persistStage(done)` (scope của tx gọi; RLS `v_t`), lấy lô tới hạn (`kh_writes_due_idx`, FOR UPDATE SKIP
// LOCKED, scope system), ghi kết quả theo PK, đọc trạng thái cho `StageView.knowledge` (`kh_writes_run_idx`).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { summaryForWorklog, worklogSubject, worklogVectorId } from "./kh.summary.rules";

const PROJECT_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Target = { connection_id: string; project: string };
const isTarget = (v: unknown): v is Target => {
  const t = v as Partial<Target> | null;
  return (
    typeof t?.connection_id === "string" &&
    UUID_RE.test(t.connection_id) &&
    typeof t.project === "string" &&
    PROJECT_RE.test(t.project)
  );
};

type DoneRow = {
  process_run_id: string;
  output_id: string;
  version: number | string;
  content: string | null;
  target: unknown;
  pk: string | null;
  sk: string | null;
};

async function insertWrite(tx: Tx, w: { tenantId: string; stageRunId: string }): Promise<void> {
  const [r] =
    await tx.execute<DoneRow>(sql`select s.process_run_id, o.id as output_id, o.version, o.content,
      pr.snapshot->'kh'->'stages'->(s.stage_idx::int) as target, pr.snapshot->>'key' as pk,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'key' as sk
    from hub.stage_runs s
      join hub.process_runs pr on pr.id = s.process_run_id and pr.tenant_id = s.tenant_id
      join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
    where s.id = ${w.stageRunId} and s.tenant_id = ${w.tenantId} and pr.snapshot->'kh' is not null`);
  if (!r || !isTarget(r.target)) return;
  const text = summaryForWorklog(r.content ?? "");
  if (text === null) return;
  const subject = worklogSubject(r.pk ?? "", r.sk ?? "");
  if (subject === "/" || subject.length === 0) return;
  const vid = worklogVectorId(r.process_run_id, w.stageRunId, Number(r.version));
  await tx.execute(sql`insert into hub.kh_writes (tenant_id, process_run_id, stage_run_id, output_id,
      connection_id, project_id, subject, body, vector_id)
    values (${w.tenantId}, ${r.process_run_id}, ${w.stageRunId}, ${r.output_id}, ${r.target.connection_id}::uuid,
      ${r.target.project}, ${subject}, ${text}, ${vid})
    on conflict (output_id) do nothing`);
}

/**
 * D8 · cuối nhánh `done` của `persistStage` (cùng tx): đích ≠ null ∧ output có `## Tóm tắt` ⇒ một hàng `pending`.
 * Chạy trong SAVEPOINT: lỗi bất kỳ ⇒ warn, không ném (không làm hỏng chuyển stage).
 */
export async function enqueueKhSummary(
  tx: Tx,
  w: { tenantId: string; stageRunId: string },
): Promise<void> {
  try {
    await tx.transaction((sp) => insertWrite(sp, w));
  } catch (err) {
    logger.warn("kh-summary-enqueue-failed", {
      stage_run_id: w.stageRunId,
      ...safeErrorFields(err),
    });
  }
}

export type DueWrite = {
  id: string;
  tenant_id: string;
  process_run_id: string;
  stage_run_id: string;
  connection_id: string;
  project_id: string;
  subject: string;
  body: string;
  vector_id: string;
  attempts: number;
};

/** Lô tới hạn (≤ `limit`) + hẹn lại `next_at = now() + leaseS` để bộ gửi khác không lấy trùng. Scope system. */
export async function claimDue(tx: Tx, limit: number, leaseS: number): Promise<DueWrite[]> {
  const rows = await tx.execute<DueWrite>(sql`update hub.kh_writes w
      set next_at = now() + make_interval(secs => ${leaseS}::double precision), updated_at = now()
    where w.id in (select id from hub.kh_writes where status = 'pending' and next_at <= now()
      order by next_at limit ${limit} for update skip locked)
    returning w.id, w.tenant_id, w.process_run_id, w.stage_run_id, w.connection_id, w.project_id, w.subject,
      w.body, w.vector_id, w.attempts`);
  return rows.map((r) => ({ ...r, attempts: Number(r.attempts) }));
}

export type WriteResult =
  | { status: "done" }
  | { status: "pending"; attempts: number; code: string; backoffMs: number }
  | { status: "failed" | "skipped"; attempts: number; code: string };

/** Ghi kết quả theo PK (chỉ khi hàng còn `pending`). */
export async function saveResult(tx: Tx, id: string, r: WriteResult): Promise<void> {
  if (r.status === "done") {
    await tx.execute(sql`update hub.kh_writes set status = 'done', last_code = null, updated_at = now()
      where id = ${id} and status = 'pending'`);
    return;
  }
  const next =
    r.status === "pending"
      ? sql`now() + make_interval(secs => ${r.backoffMs / 1000}::double precision)`
      : sql`next_at`;
  await tx.execute(sql`update hub.kh_writes set status = ${r.status}, attempts = ${r.attempts},
      last_code = ${r.code.slice(0, 64)}, next_at = ${next}, updated_at = now()
    where id = ${id} and status = 'pending'`);
}

/** `StageView.knowledge.summary` — trạng thái theo `output_id` của run (`kh_writes_run_idx`). */
export async function writeStatesOfRun(
  tx: Tx,
  runId: string,
  tenantId: string,
): Promise<Map<string, string>> {
  const rows = await tx.execute<{ output_id: string; status: string }>(sql`select output_id, status
    from hub.kh_writes where process_run_id = ${runId} and tenant_id = ${tenantId} limit 500`);
  return new Map(rows.map((r) => [r.output_id, r.status] as const));
}
