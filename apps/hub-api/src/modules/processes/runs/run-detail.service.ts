// CR-121 · R-2 · `GET /process-runs/:id/detail` + `GET /process-runs/:id/stages/:idx/log` (trang chi tiết lượt chạy, admin).
// Vai kiểm Ở ĐÂY (tenant_admin/platform_admin; còn lại 403); mức nhật ký do `logLevelOf(vai)` quyết — KHÔNG đọc tham số client.
// Đọc dưới scope `user` (RLS T + lọc `tenant_id` tường minh): tenant khác ⇒ 404. platform_admin chọn tenant qua `?tenant_id`.
// Debug (CHỈ platform_admin) ghi audit `view` rồi đọc `hub.runs`/`hub.jobs`/`kh_stage_usage` bằng scope `system`
// (RLS các bảng đó theo chủ run) SAU khi vai + tenant + bước đã kiểm.
import type { RunDetail, RunStageLog } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import { appError } from "../../../lib/errors";
import { clipEntityName, dbHubAudit } from "../../../lib/hub-audit";
import { processError } from "../core/errors";
import { canViewRunDetail, logLevelOf } from "../domain/runs/run-log-text.rules";
import { toRunDetail, toStageLog } from "./run-detail.map";
import * as repo from "./run-detail.repo";

export type RunDetailDeps = { db: Db };

const notFound = () => processError("PROCESS_NOT_FOUND", { suggestions: [] });

/** platform_admin + `?tenant_id` ⇒ tenant đích; vai khác luôn tenant của chính mình. */
const scopeOf = (u: AuthUser, tenantIdQ?: string) => ({
  kind: "user" as const,
  userId: u.userId,
  tenantId: u.role === "platform_admin" && tenantIdQ ? tenantIdQ : u.tenantId,
});

export class RunDetailService {
  constructor(private readonly d: RunDetailDeps) {}

  /** Header + bước + dòng thời gian: 3 câu SQL cố định (run · stage_runs · union sự kiện), không theo số bước. */
  async detail(u: AuthUser, runId: string, tenantIdQ?: string): Promise<RunDetail> {
    if (!canViewRunDetail(u.role)) throw appError("FORBIDDEN");
    const scope = scopeOf(u, tenantIdQ);
    return withHubScope(this.d.db, scope, async (tx) => {
      const head = await repo.readHead(tx, runId, scope.tenantId);
      if (!head) throw notFound();
      const [stages, events] = await Promise.all([
        repo.readStages(tx, runId, scope.tenantId),
        repo.readEvents(tx, runId, scope.tenantId),
      ]);
      return toRunDetail(head, stages, events);
    });
  }

  /** Nhật ký một bước: basic 1 câu SQL; debug 3 (đọc · audit `view` · đọc scope system). */
  async stageLog(
    u: AuthUser,
    runId: string,
    stageIdx: number,
    tenantIdQ?: string,
  ): Promise<RunStageLog> {
    if (!canViewRunDetail(u.role)) throw appError("FORBIDDEN");
    const level = logLevelOf(u.role);
    const debug = level === "debug";
    const scope = scopeOf(u, tenantIdQ);
    const row = await withHubScope(this.d.db, scope, async (tx) => {
      const r = await repo.readStageLog(tx, runId, scope.tenantId, stageIdx, debug);
      if (!r) throw notFound();
      if (debug)
        await dbHubAudit.insert(tx, {
          tenantId: r.tenant_id,
          actorId: u.userId,
          actorUsername: null,
          actorRole: u.role,
          action: "view",
          entity: "process_run",
          entityId: runId,
          entityName: clipEntityName(r.stage_def?.name ?? "stage"),
          hubConfigVersion: null,
          before: null,
          after: null,
          summary: {},
        });
      return r;
    });
    if (!debug) return toStageLog(row, level);
    const dbg = await withHubScope(this.d.db, { kind: "system" }, (tx) =>
      repo.readDebug(tx, row.tenant_id, row.stage_run_id, Number(row.attempt), Number(row.round)),
    );
    return toStageLog(row, level, dbg);
  }
}
