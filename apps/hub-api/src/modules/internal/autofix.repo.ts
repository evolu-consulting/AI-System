// HUB-FR-128 · HUB-FR-130 · PC-R12 · P-c1 · truy vấn kênh báo tự-sửa (plan §6.2). Scope `system` + `tenant_id` tường minh
// (bảng RLS "T"). `hub.jobs` không RLS: tra theo `token_hash` (index `jobs_token_hash_uq`), KHÔNG lọc `status` ở đây — job
// đã kết thúc vẫn nhận ra token để trả 409 `AUTOFIX_NOT_EXPECTED` (E03) thay vì 401.
import type { Tx } from "@ai/db";
import { autofixResults, type NewAutofixResult } from "@ai/db/schema/hub-autofix";
import { sql } from "drizzle-orm";

export type AutofixJob = {
  id: string;
  type: string;
  status: string;
  payload: unknown;
  tenantId: string;
  userId: string;
  processRunId: string | null;
  stageRunId: string | null;
};

/** Token → job (mọi trạng thái) + run stage (`hub.runs`, cùng tenant). Một query, `jobs_token_hash_uq` + PK runs. */
export async function jobByTokenAnyStatus(tx: Tx, hash: Buffer): Promise<AutofixJob | undefined> {
  const rows = await tx.execute<{
    id: string;
    type: string;
    status: string;
    payload: unknown;
    tenant_id: string;
    user_id: string;
    process_run_id: string | null;
    stage_run_id: string | null;
  }>(sql`SELECT j.id, j.type, j.status, j.payload, j.tenant_id, j.user_id, r.process_run_id, r.stage_run_id
    FROM hub.jobs j LEFT JOIN hub.runs r ON r.id = j.run_id AND r.tenant_id = j.tenant_id
    WHERE j.token_hash = ${hash}`);
  const r = rows[0];
  return (
    r && {
      id: r.id,
      type: r.type,
      status: r.status,
      payload: r.payload,
      tenantId: r.tenant_id,
      userId: r.user_id,
      processRunId: r.process_run_id,
      stageRunId: r.stage_run_id,
    }
  );
}

/** Kiểm lại trong tx ghi: job vẫn `running` với đúng token (requeue xoá `token_hash` ⇒ báo cáo claim cũ bị từ chối). */
export async function stillRunning(tx: Tx, jobId: string, hash: Buffer): Promise<boolean> {
  const rows = await tx.execute(sql`SELECT 1 FROM hub.jobs
    WHERE id = ${jobId} AND token_hash = ${hash} AND status = 'running'`);
  return rows.length > 0;
}

export type FileRow = {
  id: string;
  tenantId: string;
  userId: string;
  jobId: string;
  name: string;
  size: number;
  sha256: string;
  storageKey: string;
};

/** Attachment `origin='output'` text/plain của job (PC-R16: KHÔNG qua kiểm hạn mức; vẫn cộng vào dung lượng đã dùng). */
export async function insertOutputFile(tx: Tx, f: FileRow): Promise<void> {
  await tx.execute(sql`INSERT INTO hub.attachments (id, tenant_id, user_id, origin, job_id, filename, safe_name, mime,
      size, sha256, storage_key)
    VALUES (${f.id}, ${f.tenantId}, ${f.userId}, 'output', ${f.jobId}, ${f.name}, ${f.name}, 'text/plain', ${f.size},
      ${f.sha256}, ${f.storageKey})`);
}

export async function insertResult(tx: Tx, row: NewAutofixResult): Promise<string> {
  const [r] = await tx.insert(autofixResults).values(row).returning({ id: autofixResults.id });
  if (!r) throw new Error("autofix_results insert returned no row");
  return r.id;
}

/** 23505 trên `autofix_results_job_uq` (báo lần 2 cùng job) — lỗi pg có thể nằm ở `cause` (DrizzleQueryError). */
export function isResultExists(err: unknown): boolean {
  const e = err as { code?: unknown; constraint_name?: unknown; cause?: unknown } | null;
  const pg = (e?.code === undefined ? e?.cause : e) as typeof e;
  return pg?.code === "23505" && pg.constraint_name === "autofix_results_job_uq";
}
