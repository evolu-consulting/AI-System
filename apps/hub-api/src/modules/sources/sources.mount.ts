// HUB-FR-120…122 · ADM-FR-68 · PB-R05 · mount module nguồn: `/admin/sources*` + `/process-runs/sources` (cần JWT, gắn ở
// app.ts) + `/internal/jobs/:id/sources-resolved` (Bearer job-token, không JWT). Dựng TRƯỚC module quy trình để
// `/process-runs/sources` không bị `/process-runs/:id` nuốt (thứ tự đăng ký Hono).
import type { Env, Hono } from "hono";
import type { Db } from "../../lib/db";
import { SourceCheckService } from "./check.service";
import { CheckWaiters } from "./check.waiters";
import { sourcesResolvedRoutes } from "./resolved.routes";
import { SourcesResolvedService } from "./resolved.service";
import { sourcesRoutes } from "./sources.routes";
import { SourcesService } from "./sources.service";

/** Gốc route nguồn cần JWT (app.ts gắn `requireAuth`). `/process-runs` đã nằm trong PROCESS_PROTECTED_PREFIXES. */
export const SOURCE_PROTECTED_PREFIXES = ["/admin/sources"] as const;

export type SourcesMountDeps = { db: Db; sourceCheckTimeoutMs?: number };

const DEFAULT_CHECK_TIMEOUT_MS = 60_000;

export function mountSources<E extends Env>(app: Hono<E>, d: SourcesMountDeps): void {
  const waiters = new CheckWaiters();
  const svc = new SourcesService(d.db);
  const check = new SourceCheckService({
    db: d.db,
    waiters,
    timeoutMs: d.sourceCheckTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
  });
  const resolved = new SourcesResolvedService(d.db, waiters);
  app.route("/", sourcesRoutes(svc, check));
  app.route("/internal", sourcesResolvedRoutes(resolved));
}
