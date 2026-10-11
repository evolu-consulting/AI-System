// HUB-FR-122 · PB-R05/R18 · C12 · `POST /internal/jobs/:job_id/sources-resolved`: Runtime báo kết quả resolve (Bearer
// job-token). Sai token/job/loại/lease ⇒ 401 cùng thân (PB-R18); `source_id ∉ job.items` / `pin.kind ≠ item.kind` ⇒ 422
// (không ghim). Check (process_run_id null) ⇒ ghi `last_pin` + đánh thức `CheckWaiters`. Run ⇒ qua `ResolveBridge` (engine
// ghim `pinned_sources` / `needs_decision` + kick). [HUB-FR-122]
import { SourceResolveJobSchema } from "@ai/contracts/hub";
import type { SourcesResolvedRequest } from "@ai/contracts/hub-internal";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../lib/db";
import { hashJobToken } from "../../lib/job-token";
import { bearerJobToken } from "../internal/credential.service";
import type { CheckWaiters, ResolveOutcome } from "./check.waiters";
import type { ResolveBridge } from "./resolve.bridge";
import * as repo from "./sources.repo";

export type ResolvedResult = { kind: "ok" } | { kind: "unauthorized" } | { kind: "invalid" };

export type ResolvedDeps = {
  db: Db;
  waiters: CheckWaiters;
  bridge: ResolveBridge;
  /** seam đồng hồ (kiểm lease); mặc định giờ thật. */
  now?: () => Date;
};

/** C12 · items THÔ từ payload jsonb (config có thể "độc", không safeParse): source_id → kind. */
function rawItems(payload: unknown): Map<string, string> {
  const items = (payload as { items?: unknown })?.items;
  const map = new Map<string, string>();
  if (Array.isArray(items))
    for (const it of items) {
      const o = it as { source_id?: unknown; kind?: unknown };
      if (typeof o?.source_id === "string") map.set(o.source_id, String(o.kind ?? ""));
    }
  return map;
}

const rawRunId = (payload: unknown): string | null => {
  const v = (payload as { process_run_id?: unknown })?.process_run_id;
  return typeof v === "string" ? v : null;
};

const rawTimeoutS = (payload: unknown): number => {
  const v = (payload as { timeout_s?: unknown })?.timeout_s;
  return typeof v === "number" && v > 0 ? v : 300;
};

function toOutcome(body: SourcesResolvedRequest): ResolveOutcome {
  const err = body.results.find((r) => r.status === "error");
  if (err && err.status === "error") return { kind: "error", code: err.code };
  const ok = body.results[0];
  if (ok && ok.status === "ok")
    return { kind: "ok", pin: ok.pin, files: ok.files, bytes: ok.bytes };
  return { kind: "error", code: "SOURCE_UNRESOLVABLE" };
}

const LEASE_GRACE_MS = 60_000;

type ResolveJobRow = NonNullable<Awaited<ReturnType<typeof repo.resolveJobByTokenHash>>>;

/** PB-R18 · token không khớp job/loại, hoặc lease quá hạn (seam now) ⇒ 401. */
function jobUnauthorized(job: ResolveJobRow | undefined, jobId: string, now: Date): boolean {
  if (!job || job.id !== jobId || job.type !== "source.resolve") return true;
  const leaseMs = (rawTimeoutS(job.payload) + 60) * 1000;
  return Boolean(
    job.heartbeatAt && now.getTime() - job.heartbeatAt.getTime() > leaseMs + LEASE_GRACE_MS,
  );
}

/** C12/RS-11 · source_id ngoài items, hoặc pin.kind ≠ item.kind ⇒ 422 (không ghim). */
function resultsInvalid(payload: unknown, body: SourcesResolvedRequest): boolean {
  const items = rawItems(payload);
  return body.results.some(
    (r) => !items.has(r.source_id) || (r.status === "ok" && items.get(r.source_id) !== r.pin.kind),
  );
}

export class SourcesResolvedService {
  constructor(private readonly d: ResolvedDeps) {}

  async resolved(
    authorization: string | undefined,
    jobId: string,
    body: SourcesResolvedRequest,
  ): Promise<ResolvedResult> {
    const token = bearerJobToken(authorization);
    if (!token) return { kind: "unauthorized" };
    const now = (this.d.now ?? (() => new Date()))();
    const settled = await withHubScope(this.d.db, { kind: "system" }, async (tx) => {
      const job = await repo.resolveJobByTokenHash(tx, hashJobToken(token));
      if (jobUnauthorized(job, jobId, now) || !job) return { kind: "unauthorized" } as const;
      if (resultsInvalid(job.payload, body)) return { kind: "invalid" } as const;
      const runId = rawRunId(job.payload);
      if (runId === null) {
        for (const r of body.results)
          if (r.status === "ok") await repo.setLastPin(tx, r.source_id, job.tenantId, r.pin);
        return { kind: "check" as const, outcome: toOutcome(body) };
      }
      return { kind: "run" as const, runId, tenantId: job.tenantId };
    });
    if (settled.kind === "unauthorized" || settled.kind === "invalid") return settled;
    if (settled.kind === "check") {
      this.d.waiters.settle(jobId, settled.outcome);
      return { kind: "ok" };
    }
    await this.d.bridge.onReport?.({
      jobId,
      runId: settled.runId,
      tenantId: settled.tenantId,
      results: body.results,
    });
    return { kind: "ok" };
  }

  /**
   * C15/PB-R18 · `/internal/jobs/:id/attachments/:id`: nhường H2c (true) khi (a) job `agent.cli` đang chạy, hoặc (b) job
   * `source.resolve` và `attId` là `document_id` của item library trong job. Khác ⇒ false ⇒ route trả 401.
   */
  async delegateToH2c(
    authorization: string | undefined,
    jobId: string,
    attId: string,
  ): Promise<boolean> {
    const token = bearerJobToken(authorization);
    if (!token) return false;
    const job = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
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
