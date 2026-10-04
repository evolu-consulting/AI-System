// HUB-NFR-02 · HUB-NFR-03 · H1-R13 · P12 · sweeper lease (plan H1 §5.8, mọi instance, 10 s): run `running` quá lease
// (chủ chết/treo) → instance này chiếm `owner` và kết thúc `failed INTERNAL_ERROR` (câu theo `runs.locale`, plan-errors
// §Ghi), tin assistant, huỷ job như §5.7; sau COMMIT phát `run.failed` bằng "XADD bên ngoài" (§5.2) — đúng một sự kiện
// kết thúc vì chủ cũ kết thúc sau đó được 0 dòng (P12) và XADD của nó bị chặn bởi id.
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { safeErrorFields } from "../../lib/errors";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import type { Redis } from "../../lib/redis";
import { type CancelWrite, expiredLeaseRuns, failExpiredRun } from "./cancel.repo";
import { announceClosed, deltaContent } from "./cancel.service";
import { runErrorText } from "./run-errors";
import type { RunRegistry } from "./sse-writer";

export const LEASE_SWEEP_MS = 10_000;
/** Ứng viên mỗi lượt (§5.8 `LIMIT 20`); còn sót → lượt sau. */
const SWEEP_BATCH = 20;

export type SweeperDeps = {
  db: Db;
  redis: Redis;
  /** = `HUB_INSTANCE_ID`: chủ mới ghi vào `runs.owner`. */
  owner: string;
  registry: RunRegistry;
  log: Logger;
};

/** Một lượt quét. Trả số run đã kết thúc. Lỗi một run → log, sang run kế. */
export async function sweepExpiredLeases(d: SweeperDeps): Promise<number> {
  const candidates = await withHubScope(d.db, { kind: "system" }, (tx) =>
    expiredLeaseRuns(tx, SWEEP_BATCH),
  );
  let closed = 0;
  for (const { locale, ...target } of candidates) {
    const error: CancelWrite["error"] = {
      code: "INTERNAL_ERROR",
      ...runErrorText("INTERNAL_ERROR", locale),
    };
    try {
      const content = await deltaContent(d.redis, target.runId);
      const w: CancelWrite = { target, owner: d.owner, error, content };
      const ok = await withHubScope(d.db, { kind: "system" }, (tx) => failExpiredRun(tx, w));
      if (!ok) continue;
      closed++;
      d.log.warn("run-lease-expired", { run_id: target.runId, tenant_id: target.tenantId });
      await announceClosed(d, { target, error });
    } catch (err) {
      d.log.error("run-lease-sweep-failed", { run_id: target.runId, ...safeErrorFields(err) });
    }
  }
  return closed;
}

export function startLeaseSweeper(d: SweeperDeps & { signal?: AbortSignal }): void {
  startLoop({
    name: "run-lease-sweep",
    everyMs: LEASE_SWEEP_MS,
    tick: () => sweepExpiredLeases(d),
    log: d.log,
    signal: d.signal,
  });
}
