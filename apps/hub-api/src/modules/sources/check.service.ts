// HUB-FR-120 · PB-R05 · C13 · "Kiểm tra kết nối": enqueue job `source.resolve` 1 item (process_run_id null), chờ đồng bộ
// (JobFollower qua `CheckWaiters`) tới `sourceCheckTimeoutMs` → 200 `SourceCheckResult` / 422 mã lỗi / 422 SOURCE_UNRESOLVABLE.
import type { SourceResolveJob } from "@ai/contracts/hub";
import {
  type SourceCheckResult,
  type SourceErrorCode,
  sourceConfigOut,
} from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import type { CheckWaiters } from "./check.waiters";
import { isPlatform, publicPin, readTenant } from "./source.rules";
import { sourceError } from "./sources.errors";
import * as repo from "./sources.repo";

export type CheckDeps = { db: Db; waiters: CheckWaiters; timeoutMs: number };

export class SourceCheckService {
  constructor(private readonly d: CheckDeps) {}

  async check(u: AuthUser, key: string, tenantQ: string | undefined): Promise<SourceCheckResult> {
    const tenantId = readTenant(u, tenantQ);
    const platform = isPlatform(u);
    const row = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      repo.readSource(tx, tenantId, key),
    );
    if (!row) throw sourceError("SOURCE_NOT_FOUND");

    const jobId = crypto.randomUUID();
    const timeoutS = Math.min(300, Math.max(10, Math.ceil(this.d.timeoutMs / 1000)));
    const payload: SourceResolveJob = {
      v: 1,
      type: "source.resolve",
      job_id: jobId,
      tenant_id: tenantId,
      process_run_id: null,
      items: [
        {
          source_id: row.id,
          key: row.key,
          kind: row.kind,
          config: sourceConfigOut(row.config),
          allowlist_union: [],
        },
      ],
      timeout_s: timeoutS,
    };
    // Đăng ký chờ TRƯỚC khi enqueue (tránh đua với báo cáo của Runtime).
    const waiting = this.d.waiters.wait(jobId, this.d.timeoutMs);
    await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      repo.enqueueResolveJob(tx, { jobId, tenantId, userId: u.userId, payload }),
    );

    const outcome = await waiting;
    if (outcome.kind === "ok")
      return {
        pin: publicPin(outcome.pin, platform) ?? outcome.pin,
        files: outcome.files,
        bytes: outcome.bytes,
      };
    if (outcome.kind === "error") throw sourceError(outcome.code as SourceErrorCode);
    throw sourceError("SOURCE_UNRESOLVABLE");
  }
}
