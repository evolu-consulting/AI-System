// HUB-FR-52 · HUB-FR-87 · H3b-R17, R19 · `GET /runs/:id/trace` (plan H3b §5.4). Thứ tự: (A) scope `user {tid, sub}` tìm
// run của chính mình → đọc trace cùng transaction, không audit · không thấy ⇒ `traceAccess` quyết TRƯỚC khi mở scope
// `system` (tenant_admin/member ⇒ 404 Q-U2) · (B) platform_admin: scope `system` → run vắng ⇒ 404, 0 audit · có ⇒
// audit `view_trace` NGAY sau khi thấy run, trước khi đọc phần còn lại; audit lỗi ⇒ ném ⇒ rollback ⇒ 500, không trace
// (fail-closed R19). Không biết HTTP.
import type { RunTrace } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import { appError } from "../../../lib/errors";
import type { HubAuditWriter } from "../../../lib/hub-audit";
import { toRunTrace } from "./trace.map";
import * as repo from "./trace.repo";
import { traceAccess } from "./trace.rules";

export type TraceDeps = { db: Db; audit: HubAuditWriter };

/** Đọc phần còn lại của trace, mọi câu lọc `tenant_id` của run (K10). */
async function readRest(tx: Tx, run: repo.TraceRunRow, view: "own" | "platform") {
  const t = run.tenantId;
  const steps = await repo.traceSteps(tx, run.id, t);
  const jobs = await repo.traceJobs(tx, run.id, t);
  const usage = await repo.traceUsage(tx, run.id, t);
  const messages = await repo.traceMessages(tx, t, [run.userMessageId, run.answerMessageId]);
  return toRunTrace({ run, steps, jobs, usage, messages }, view);
}

export class TraceService {
  constructor(private readonly d: TraceDeps) {}

  async trace(u: AuthUser, id: string): Promise<RunTrace> {
    const owner = { tenantId: u.tenantId, userId: u.userId };
    const own = await withHubScope(this.d.db, { kind: "user", ...owner }, async (tx) => {
      const run = await repo.traceRun(tx, id, owner);
      return run ? readRest(tx, run, "own") : null;
    });
    if (own) return own;
    if (traceAccess(u, false) !== "platform") throw appError("NOT_FOUND");
    const seen = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      this.#platform(tx, u, id),
    );
    if (!seen) throw appError("NOT_FOUND");
    return seen;
  }

  async #platform(tx: Tx, u: AuthUser, id: string): Promise<RunTrace | null> {
    const run = await repo.traceRun(tx, id, null);
    if (!run) return null;
    await this.d.audit.insert(tx, {
      tenantId: run.tenantId,
      actorId: u.userId,
      actorUsername: await repo.actorUsername(tx, u.userId),
      actorRole: u.role,
      action: "view_trace",
      entity: "run",
      entityId: run.id,
      entityName: "",
      hubConfigVersion: null,
      before: null,
      after: null,
      summary: { run_user_id: run.userId, run_status: run.status },
    });
    return readRest(tx, run, "platform");
  }
}
