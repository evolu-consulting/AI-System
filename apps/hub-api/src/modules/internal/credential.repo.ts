// WRK-FR-07, HUB-FR-89 · H2a-R17 · Q5, P4 · token job → job đang chạy (plan-db H2a §2 "Token → job", system scope;
// `hub.jobs` không RLS). Một query, index `jobs_token_hash_uq`. H2c B5: + `tenantId/userId/runId`, `jobAttachment`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type CredentialJob = {
  id: string;
  type: string;
  payload: unknown;
  tenantId: string;
  userId: string;
  runId: string;
};

/** plan-db §2 (nguyên văn): job có `token_hash` khớp và `status='running'`; người gọi kiểm `id`/`type`. */
export async function jobByTokenHash(tx: Tx, hash: Buffer): Promise<CredentialJob | undefined> {
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    user_id: string;
    run_id: string;
    type: string;
    payload: unknown;
  }>(
    sql`SELECT id, tenant_id, user_id, run_id, step_id, agent_id, type, payload FROM hub.jobs
      WHERE token_hash = ${hash} AND status = 'running'`,
  );
  const r = rows[0];
  return (
    r && {
      id: r.id,
      type: r.type,
      payload: r.payload,
      tenantId: r.tenant_id,
      userId: r.user_id,
      runId: r.run_id,
    }
  );
}

/** File của job (H2c plan-db §2.5, R17): lọc theo tenant của job — không hàng ⇒ người gọi trả 401. */
export type JobAttachmentRow = {
  id: string;
  storage_key: string;
  size: number;
  sha256: string;
  purged_at: Date | string | null;
};

export async function jobAttachment(
  tx: Tx,
  attId: string,
  tenantId: string,
): Promise<JobAttachmentRow | undefined> {
  const rows = await tx.execute<JobAttachmentRow>(
    sql`SELECT id, storage_key, size::int AS size, sha256, purged_at FROM hub.attachments
      WHERE id = ${attId} AND tenant_id = ${tenantId}`,
  );
  return rows[0];
}
