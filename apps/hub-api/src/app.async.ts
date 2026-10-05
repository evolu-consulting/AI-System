// HUB-FR-13, WRK-FR-07 · H2a-R12, R17 · Q5 · nối phần async H2a vào app (plan §4, §5.3): `WorkflowJobRunner` cho lệnh
// `mode=async` và POST `/internal/jobs/:job_id/dify-credential` (không JWT). Tách khỏi `app.ts` để giữ ≤ 250 dòng.
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import type { ConfigCache } from "./modules/config/config.service";
import { CredentialService, loadMasterKey } from "./modules/dify/credential.service";
import { credentialRoutes } from "./modules/internal/credential.routes";
import { DifyCredentialService } from "./modules/internal/credential.service";
import { RunStreamReader } from "./modules/runner/run-stream-reader";
import { WorkflowJobRunner } from "./modules/runner/workflow/workflow-job-runner";

/** = `HUB_JOB_MAX_WAIT_S` mặc định (plan H1 §7). */
export const DEFAULT_JOB_MAX_WAIT_S = 30;

export type WorkflowJobsDeps = {
  db: Db;
  redis?: Redis;
  /** = `HUB_INSTANCE_ID` (`runs.owner`). */
  owner: string;
  /** = `HUB_JOB_MAX_WAIT_S` (vắng → `DEFAULT_JOB_MAX_WAIT_S`). */
  jobMaxWaitS?: number;
  log: Logger;
  signal?: AbortSignal;
};

/**
 * Runner job `workflow.async`; vắng Redis (test khung) → undefined. Đầu đọc `run:<id>` riêng (kết nối chặn chỉ mở khi có
 * lệnh async đang chờ).
 */
export function workflowJobs(d: WorkflowJobsDeps): WorkflowJobRunner | undefined {
  if (!d.redis) return undefined;
  const reader = new RunStreamReader(d.redis, d.log, d.signal);
  return new WorkflowJobRunner({
    db: d.db,
    owner: d.owner,
    reader,
    maxWaitS: d.jobMaxWaitS ?? DEFAULT_JOB_MAX_WAIT_S,
    log: d.log,
  });
}

export type CredentialMountDeps = {
  db: Db;
  config: ConfigCache;
  log: Logger;
  /** = `SECRET_MASTER_KEY`; vắng → 409 `NOT_CONFIGURED`. */
  secretMasterKey?: string;
};

/** POST `/internal/jobs/:job_id/dify-credential` (Q5). Gọi trước `notFound`. */
export function mountDifyCredential<E extends Env>(app: Hono<E>, d: CredentialMountDeps): void {
  const svc = new DifyCredentialService({
    db: d.db,
    catalog: () => d.config.catalog(),
    credentials: new CredentialService({
      db: d.db,
      masterKey: loadMasterKey(d.secretMasterKey),
      log: d.log,
    }),
    log: d.log,
  });
  app.route("/internal", credentialRoutes(svc));
}
