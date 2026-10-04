// WRK-FR-07, HUB-FR-89 · H2a-R17 · Q5, P4 · token job → job đang chạy (plan-db H2a §2 "Token → job", system scope;
// `hub.jobs` không RLS). Một query, index `jobs_token_hash_uq`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type CredentialJob = { id: string; type: string; payload: unknown };

/** plan-db §2 (nguyên văn): job có `token_hash` khớp và `status='running'`; người gọi kiểm `id`/`type`. */
export async function jobByTokenHash(tx: Tx, hash: Buffer): Promise<CredentialJob | undefined> {
  const rows = await tx.execute<{ id: string; type: string; payload: unknown }>(
    sql`SELECT id, tenant_id, user_id, run_id, step_id, agent_id, type, payload FROM hub.jobs
      WHERE token_hash = ${hash} AND status = 'running'`,
  );
  const r = rows[0];
  return r && { id: r.id, type: r.type, payload: r.payload };
}
