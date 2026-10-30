// CR-104 · ops-core · lớp 4 module ops-watch: route `/ops/*` (LUÔN mount khi có db — không phụ thuộc module đóng băng) + vòng nền
// tick 60 s (chỉ chạy lượt khi đến hạn theo cấu hình trong DB). Vòng bật khi `watch` (server: `HUB_OPS_WATCH`, mặc định on ngoài
// test); test gọi `runChecksOnce` trực tiếp.
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import type { Redis } from "../../lib/redis";
import { OPS_CHECKS } from "./adapters/checks/registry";
import { opsRepo } from "./adapters/ops.repo";
import { OPS_PREFIX, opsRoutes } from "./adapters/ops.routes";
import type { OpsCheck } from "./application/ops.check";
import { type OpsRoundDeps, runChecksOnce } from "./application/ops.round";

export { OPS_PREFIX };
export const OPS_TICK_MS = 60_000;

export type OpsDeps = {
  /** `true` ⇒ dựng vòng nền. */
  watch?: boolean;
  /** Tiêm registry (test); vắng ⇒ `OPS_CHECKS`. */
  checks?: readonly OpsCheck[];
  /** = `HUB_OPS_STATUS_DIR` (file trạng thái do host ghi, O4). */
  statusDir?: string;
  tickMs?: number;
  timeoutMs?: number;
  now?: () => Date;
};

export type OpsMountDeps = {
  db: Db;
  redis?: Redis;
  ops?: OpsDeps;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  log: Logger;
};

export function opsRoundDeps(d: OpsMountDeps): OpsRoundDeps {
  const o = d.ops ?? {};
  return {
    repo: opsRepo(d.db),
    checks: o.checks ?? OPS_CHECKS,
    checkDeps: {
      db: d.db,
      ...(d.redis ? { redis: d.redis } : {}),
      fetch: d.fetch ?? fetch,
      ...(o.statusDir ? { statusDir: o.statusDir } : {}),
    },
    ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
  };
}

export function mountOps<E extends Env>(app: Hono<E>, d: OpsMountDeps): void {
  const o = d.ops ?? {};
  const deps = opsRoundDeps(d);
  const now = o.now ?? (() => new Date());
  app.route(OPS_PREFIX, opsRoutes({ ...deps, now }));
  if (!o.watch) return;
  startLoop({
    name: "ops-watch",
    everyMs: o.tickMs ?? OPS_TICK_MS,
    tick: () => runChecksOnce(deps, now()),
    log: d.log,
    signal: d.signal,
  });
}
