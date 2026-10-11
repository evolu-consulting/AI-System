// HUB-FR-122 · PB-R05/R18 · C12 · `POST /internal/jobs/:job_id/sources-resolved`: Runtime báo kết quả resolve (Bearer
// job-token). Sai token/job ⇒ 401 cùng thân (PB-R18); `source_id ∉ job.items` ⇒ 422 (không pin). Check (process_run_id
// null) ⇒ ghi `last_pin` + đánh thức `CheckWaiters`. (Đường run S3 bổ sung pin vào process_runs.)
import { SourceResolveJobSchema } from "@ai/contracts/hub";
import type { SourcesResolvedRequest } from "@ai/contracts/hub-internal";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { hashJobToken } from "../../lib/job-token";
import { bearerJobToken } from "../internal/credential.service";
import type { CheckWaiters, ResolveOutcome } from "./check.waiters";
import * as repo from "./sources.repo";

export type ResolvedResult = { kind: "ok" } | { kind: "unauthorized" } | { kind: "invalid" };

function toOutcome(body: SourcesResolvedRequest): ResolveOutcome {
  const err = body.results.find((r) => r.status === "error");
  if (err && err.status === "error") return { kind: "error", code: err.code };
  const ok = body.results[0];
  if (ok && ok.status === "ok")
    return { kind: "ok", pin: ok.pin, files: ok.files, bytes: ok.bytes };
  return { kind: "error", code: "SOURCE_UNRESOLVABLE" };
}

export class SourcesResolvedService {
  constructor(
    private readonly db: Db,
    private readonly waiters: CheckWaiters,
  ) {}

  async resolved(
    authorization: string | undefined,
    jobId: string,
    body: SourcesResolvedRequest,
  ): Promise<ResolvedResult> {
    const token = bearerJobToken(authorization);
    if (!token) return { kind: "unauthorized" };
    const outcome = await withHubScope(this.db, { kind: "system" }, async (tx) => {
      const job = await repo.resolveJobByTokenHash(tx, hashJobToken(token));
      if (!job || job.id !== jobId || job.type !== "source.resolve")
        return { kind: "unauthorized" } as const;
      const parsed = SourceResolveJobSchema.safeParse(job.payload);
      if (!parsed.success) return { kind: "unauthorized" } as const;
      const itemIds = new Set(parsed.data.items.map((i) => i.source_id));
      if (body.results.some((r) => !itemIds.has(r.source_id))) return { kind: "invalid" } as const;
      // Check: ghi last_pin cho mọi kết quả ok (pin đầy đủ; strip theo quyền lúc đọc).
      for (const r of body.results)
        if (r.status === "ok") await repo.setLastPin(tx, r.source_id, job.tenantId, r.pin);
      return { kind: "settle", outcome: toOutcome(body) } as const;
    });
    if (outcome.kind === "settle") {
      this.waiters.settle(jobId, outcome.outcome);
      return { kind: "ok" };
    }
    return outcome;
  }

  /**
   * C15/PB-R18 · `/internal/jobs/:id/attachments/:id` chỉ phục vụ job `agent.cli` đang chạy (H2c). Trả true ⇒ nhường H2c;
   * false ⇒ route trả 401 (token resolve / job đã kết thúc / không có — resolve KHÔNG tải được attachment, cross-tenant 401).
   */
  async delegateToH2c(authorization: string | undefined, jobId: string): Promise<boolean> {
    const token = bearerJobToken(authorization);
    if (!token) return false;
    const job = await withHubScope(this.db, { kind: "system" }, (tx) =>
      repo.resolveJobByTokenHash(tx, hashJobToken(token)),
    );
    return !!job && job.id === jobId && job.type === "agent.cli";
  }
}
