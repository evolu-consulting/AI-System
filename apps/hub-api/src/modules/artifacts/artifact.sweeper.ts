// CR-114 · hub-agent-handoff · dọn artifact hết hạn (Luật 4c: theo tập). Mỗi lượt MỘT transaction `system` giữ
// `pg_try_advisory_xact_lock(hashtext('hub.artifacts.sweep'))` (Hub khác đang dọn ⇒ `skipped`, 0 việc) rồi tối đa
// `maxBatches` câu DELETE, mỗi câu ≤ `batch` hàng (`expires_at < now` theo index, `FOR UPDATE SKIP LOCKED` — không chặn
// lời ghi gia hạn đang chạy). Số câu SQL mỗi lượt cố định (≤ 1 + maxBatches), không phụ thuộc số hàng. Đồng hồ tiêm.
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";

export const ARTIFACT_SWEEP_BATCH = 1000;
export const ARTIFACT_SWEEP_MAX_BATCHES = 10;

export type ArtifactSweepDeps = {
  db: Db;
  now: Date;
  batch?: number;
  maxBatches?: number;
  log?: Logger;
};
export type ArtifactSweepResult = { deleted: number; skipped: boolean };

async function deleteBatch(tx: Tx, now: Date, batch: number): Promise<number> {
  const rows = await tx.execute<{ k: string }>(sql`DELETE FROM hub.artifacts a
    USING (SELECT tenant_id, key FROM hub.artifacts WHERE expires_at < ${now.toISOString()}::timestamptz
           ORDER BY expires_at LIMIT ${batch} FOR UPDATE SKIP LOCKED) c
    WHERE a.tenant_id = c.tenant_id AND a.key = c.key RETURNING a.key AS k`);
  return rows.length;
}

export async function sweepArtifactsOnce(d: ArtifactSweepDeps): Promise<ArtifactSweepResult> {
  const batch = d.batch ?? ARTIFACT_SWEEP_BATCH;
  const max = d.maxBatches ?? ARTIFACT_SWEEP_MAX_BATCHES;
  const r = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [lock] = await tx.execute<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtext('hub.artifacts.sweep')) AS ok`,
    );
    if (!lock?.ok) return { deleted: 0, skipped: true };
    let deleted = 0;
    for (let i = 0; i < max; i++) {
      const n = await deleteBatch(tx, d.now, batch);
      deleted += n;
      if (n < batch) break;
    }
    return { deleted, skipped: false };
  });
  if (r.deleted > 0) d.log?.info("artifact-sweep", { deleted: r.deleted });
  return r;
}

/** Vòng nền (`lib/loop.ts`): `sweepArtifactsOnce` với `new Date()` mỗi `everyMs`. */
export function startArtifactSweeper(d: {
  db: Db;
  log: Logger;
  everyMs: number;
  signal?: AbortSignal;
}): void {
  startLoop({
    name: "artifact-sweep",
    everyMs: d.everyMs,
    tick: () => sweepArtifactsOnce({ db: d.db, now: new Date(), log: d.log }),
    log: d.log,
    signal: d.signal,
  });
}
