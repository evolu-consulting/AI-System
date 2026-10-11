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

/** C12 · source_id của items đọc THÔ từ payload jsonb (config có thể "độc", không safeParse). */
function resolveItemIds(payload: unknown): Set<string> {
  const items = (payload as { items?: unknown })?.items;
  const ids = new Set<string>();
  if (Array.isArray(items))
    for (const it of items) {
      const sid = (it as { source_id?: unknown })?.source_id;
      if (typeof sid === "string") ids.add(sid);
    }
  return ids;
}

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
      // Lấy source_id của items THÔ (KHÔNG safeParse: config "độc" SQL-chèn làm fail GitUrl/Branch
      // ⇒ không được từ chối report của chính job — PB-R18 đã khoá bằng token). C12.
      const itemIds = resolveItemIds(job.payload);
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
   * C15/PB-R18 · `/internal/jobs/:id/attachments/:id`: nhường H2c (true) khi (a) job `agent.cli` đang chạy, hoặc (b) job
   * `source.resolve` và `attId` là `document_id` của item library trong job (tải tài liệu library qua token). Cross-tenant
   * để H2c tự trả 404/401 (lọc tenant+origin). Khác ⇒ false ⇒ route trả 401.
   */
  async delegateToH2c(
    authorization: string | undefined,
    jobId: string,
    attId: string,
  ): Promise<boolean> {
    const token = bearerJobToken(authorization);
    if (!token) return false;
    const job = await withHubScope(this.db, { kind: "system" }, (tx) =>
      repo.resolveJobByTokenHash(tx, hashJobToken(token)),
    );
    if (!job || job.id !== jobId) return false;
    if (job.type === "agent.cli") return true;
    if (job.type !== "source.resolve") return false;
    const parsed = SourceResolveJobSchema.safeParse(job.payload);
    return (
      parsed.success &&
      parsed.data.items.some(
        (i) =>
          i.kind === "library" && i.config.kind === "library" && i.config.document_id === attId,
      )
    );
  }
}
