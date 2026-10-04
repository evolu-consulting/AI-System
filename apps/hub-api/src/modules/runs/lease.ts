// HUB-NFR-02 · H1-R13 · P12 · lease run của instance (plan H1 §5.2): mỗi 10 s gia hạn `lease_until = now()+30s` cho
// run trong `RunRegistry`; run không còn `running`/không còn của instance (bị huỷ, sweeper chiếm) → `abort()` writer
// cục bộ, không ghi gì (vòng chạy dừng theo `writer.signal`, B8).
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import * as repo from "./runs.repo";
import type { RunRegistry } from "./sse-writer";

/** Nhịp gia hạn (lease 30 s ⇒ chịu được 2 nhịp hụt). */
export const LEASE_RENEW_MS = 10_000;

export type LeaseDeps = { db: Db; owner: string; registry: RunRegistry };

/** Một lượt gia hạn. Trả id run bị dừng cục bộ vì đã mất. */
export async function renewLeases(d: LeaseDeps): Promise<string[]> {
  const ids = d.registry.ids();
  if (ids.length === 0) return [];
  const lost = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const renewed = new Set(await repo.renewLeases(tx, ids, d.owner));
    const skipped = ids.filter((id) => !renewed.has(id));
    if (skipped.length === 0) return [];
    // Hàng bị SKIP LOCKED: chỉ coi là mất khi trạng thái đã COMMIT nói vậy; còn của mình → gia hạn nhịp sau.
    const alive = new Set(await repo.ownedRunning(tx, skipped, d.owner));
    return skipped.filter((id) => !alive.has(id));
  });
  for (const id of lost) d.registry.get(id)?.abort();
  return lost;
}

export function startLeaseLoop(d: LeaseDeps & { log: Logger; signal?: AbortSignal }): void {
  startLoop({
    name: "run-lease",
    everyMs: LEASE_RENEW_MS,
    tick: () => renewLeases(d),
    log: d.log,
    signal: d.signal,
  });
}
