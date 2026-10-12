// HUB-FR-113 · HUB-BR-25/26 · T8 · U5 · PF1 · `GET /process-runs/:id` (full/task theo người xem) + `/outputs/:oid`
// (plan §5, plan-contract §2–§3). Đọc scope `user` người xem; quyền xem = definer `hub.process_run_viewer` (phân biệt
// phòng xoá/đã rời xuyên RLS, U5), quyền thao tác = `canCancel`/`canDecide`/`canReadThread` thuần (HUB-BR-25).
// Audit `view`: assignee lần đầu mỗi (task, user); người bắt đầu đã rời phòng (U5) + mỗi lần đọc output.
import type {
  DecisionOption,
  DecisionReason,
  ProcessOutput,
  ProcessRunStatus,
  ProcessRunView,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import type { Db } from "../../../lib/db";
import { clipEntityName, dbHubAudit } from "../../../lib/hub-audit";
import type { ConfigCache } from "../../config/config.service";
import { processError } from "../core/errors";
import { isTerminal } from "../core/process-state.rules";
import {
  canCancel,
  canDecide,
  canReadThread,
  type RunAccess,
  type RunFacts,
  type Viewer,
} from "../core/run-access.rules";
import { loadTaskDetails, type ViewerCtx } from "../core/task-view";
import * as repo from "./runs.repo";
import {
  backFields,
  iso,
  type OutputRow,
  type Snap,
  stageViews,
  taskStages,
  toOutputRef,
} from "./view-steps";

export type ViewDeps = { db: Db; config: Pick<ConfigCache, "user"> };

type RunRow = repo.RunSummaryRow & {
  tenant_id: string;
  input: string;
  flow_id: string;
  origin_room: RunFacts["originRoom"];
  back_rounds: number;
  back_limit: number;
};
const idsArr = (ids: readonly string[]) => sql.raw(`'{${ids.join(",")}}'::uuid[]`);
const vrole = (role: AuthUser["role"]): Viewer["role"] =>
  role === "platform_admin" || role === "tenant_admin" ? role : "member";
const viewerOf = (u: AuthUser): Viewer => ({
  userId: u.userId,
  tenantId: u.tenantId,
  role: vrole(u.role),
});
const factsOf = (r: RunRow): RunFacts => ({
  tenantId: r.tenant_id,
  startedBy: r.started_by,
  originRoom: r.origin_room,
  taskAssignee: false,
});

async function viewerCtx(d: ViewDeps, u: AuthUser): Promise<ViewerCtx> {
  const state = await d.config.user(u.userId);
  return { ...viewerOf(u), groupIds: state?.groupIds ?? new Set<string>() };
}

/** Đọc dưới scope `user` của người xem (plan §5, RLS T). platform_admin + `?tenant_id` ⇒ đọc scope tenant đích. */
const scopeOf = (v: ViewerCtx, tenantIdQ?: string) => ({
  kind: "user" as const,
  userId: v.userId,
  tenantId: v.role === "platform_admin" && tenantIdQ ? tenantIdQ : v.tenantId,
});

/** Run + facts phòng cho người xem (scope system; lọc id). */
async function runRow(tx: Tx, runId: string, viewerId: string): Promise<RunRow | null> {
  const [r] = await tx.execute<RunRow>(sql`
    select r.id, r.tenant_id, r.snapshot, r.def_version, r.status, r.current_stage_idx, r.current_step, r.origin_kind,
      r.origin_room_id, r.origin_conversation_id, r.started_by, u.display_name as started_by_name, r.decision,
      r.input, r.flow_id, r.back_rounds, r.back_limit, ${iso("r.started_at")} as started_at, ${iso("r.updated_at")} as updated_at,
      ${iso("r.finished_at")} as finished_at,
      case when r.origin_kind <> 'room' then 'none'
        when rm.id is null or rm.deleted_at is not null then 'deleted'
        when exists (select 1 from hub.room_members m where m.room_id = rm.id and m.user_id = ${viewerId}
          and m.left_at is null) then 'member'
        else 'outside' end as origin_room
    from hub.process_runs r
    left join admin.users u on u.id = r.started_by and u.tenant_id = r.tenant_id
    left join hub.rooms rm on rm.id = r.origin_room_id
    where r.id = ${runId}`);
  return r ?? null;
}

const myTaskIds = (tx: Tx, r: RunRow, v: ViewerCtx): Promise<string[]> =>
  repo.assigneeTaskIds(tx, {
    runId: r.id,
    tenantId: r.tenant_id,
    userId: v.userId,
    groupIds: [...v.groupIds],
  });

async function auditView(
  tx: Tx,
  u: AuthUser,
  o: { entity: "process_run" | "review_task"; tenantId: string; entityId: string; name: string },
): Promise<void> {
  await dbHubAudit.insert(tx, {
    tenantId: o.tenantId,
    actorId: u.userId,
    actorUsername: null,
    actorRole: viewerOf(u).role,
    action: "view",
    entity: o.entity,
    entityId: o.entityId,
    entityName: clipEntityName(o.name),
    hubConfigVersion: null,
    before: null,
    after: null,
    summary: {},
  });
}

type ViewCtx = {
  tx: Tx;
  u: AuthUser;
  v: ViewerCtx;
  r: RunRow;
  snap: Snap;
  myIds: string[];
};

const notFound = () => processError("PROCESS_NOT_FOUND", { suggestions: [] });

/** HUB-BR-25 · U5 · quyền xem qua definer `hub.process_run_viewer` (plan §5): phân biệt phòng đã xoá (người bắt đầu ⇒
 * full) với đã rời phòng (⇒ task) — điều mà truy vấn scope `user` không làm được vì RLS giấu phòng của người đã rời. */
async function runViewer(tx: Tx, runId: string): Promise<RunAccess | null> {
  const [row] = await tx.execute<{ access: RunAccess | null }>(
    sql`select hub.process_run_viewer(${runId}::uuid) as access`,
  );
  return row?.access ?? null;
}

export class ViewService {
  constructor(private readonly d: ViewDeps) {}

  /** `GET /process-runs/:id` (`tenant_id?` cho platform_admin). 404 nếu không thấy / không quyền. */
  async get(u: AuthUser, runId: string, tenantIdQ?: string): Promise<ProcessRunView> {
    const v = await viewerCtx(this.d, u);
    return withHubScope(this.d.db, scopeOf(v, tenantIdQ), async (tx) => {
      const r = await runRow(tx, runId, u.userId);
      if (!r) throw notFound();
      if (tenantIdQ && v.role === "platform_admin" && r.tenant_id !== tenantIdQ) throw notFound();
      const myIds = await myTaskIds(tx, r, v);
      const access = await runViewer(tx, runId);
      if (!access) throw notFound();
      const snap = r.snapshot as unknown as Snap;
      const vc: ViewCtx = { tx, u, v, r, snap, myIds };
      return access === "task" ? this.#task(vc) : this.#full(vc);
    });
  }

  async #full({ tx, v, r, snap, myIds }: ViewCtx): Promise<ProcessRunView> {
    const [stages, open, my, hist, back] = await Promise.all([
      stageViews(tx, r, snap),
      repo.openTaskViews(tx, r.id, r.tenant_id),
      loadTaskDetails(tx, v, myIds),
      repo.loadHistory(tx, r.id, r.tenant_id),
      backFields(tx, r),
    ]);
    const facts = factsOf(r);
    return {
      ...repo.toSummary(r),
      access: "full",
      input: r.input,
      stages,
      history: hist,
      decision: this.#decision(v, r),
      my_tasks: my,
      open_tasks: open,
      thread: canReadThread(v, facts)
        ? { room_id: r.origin_room_id as string, flow_id: r.flow_id }
        : null,
      can_cancel: canCancel(v, facts),
      ...back,
    };
  }

  #decision(v: ViewerCtx, r: RunRow) {
    if (r.status !== "needs_decision" || !r.decision) return null;
    const dec = r.decision as {
      reason: DecisionReason;
      stage_idx: number;
      options: DecisionOption[];
    };
    const snap = r.snapshot as unknown as Snap;
    const after = snap.stages[Number(r.current_stage_idx)]?.after;
    const gid = after?.kind === "review" ? after.group_id : null;
    const reviewGroupMember = gid !== null && gid !== undefined && v.groupIds.has(gid);
    return {
      reason: dec.reason,
      stage_idx: Number(dec.stage_idx),
      options: dec.options,
      can_decide: canDecide(v, { ...factsOf(r), reason: dec.reason, reviewGroupMember }),
    };
  }

  /** Task view (assignee / người bắt đầu đã rời — U5). Audit `view`. */
  async #task({ tx, u, v, r, snap, myIds }: ViewCtx): Promise<ProcessRunView> {
    const starterLeft = v.userId === r.started_by && myIds.length === 0;
    const my = await loadTaskDetails(tx, v, myIds);
    const stages = isTerminal(r.status as ProcessRunStatus) ? [] : await taskStages(tx, r, snap);
    const base = {
      access: "task" as const,
      id: r.id,
      process: { key: snap.key, name: snap.name },
      status: r.status as ProcessRunStatus,
      stages,
      my_tasks: my,
    };
    if (starterLeft) {
      const outs = await tx.execute<OutputRow>(sql`
        select id, stage_idx, version, attempt, template_ok, template_missing, ${iso("created_at")} as created_at
        from hub.process_outputs where process_run_id = ${r.id} and tenant_id = ${r.tenant_id}
        order by stage_idx, version limit ${50}`);
      await auditView(tx, u, {
        entity: "process_run",
        tenantId: r.tenant_id,
        entityId: r.id,
        name: snap.name,
      });
      return { ...base, outputs: outs.map(toOutputRef), can_cancel: canCancel(v, factsOf(r)) };
    }
    for (const id of myIds) await this.#auditFirst({ tx, u, r, snap, v, myIds }, id);
    return base;
  }

  // HUB-BR-25 · U5 · audit `view` (review_task) lần đầu mỗi (task, user); khử trùng bằng `audit_log` (không RLS) nên người kiểm theo group ngoài phòng (không có hàng assignee user) cũng được ghi. `first_viewed_at` chỉ đánh dấu assignee user trực tiếp.
  async #auditFirst({ tx, u, r, snap }: ViewCtx, taskId: string): Promise<void> {
    await tx.execute(sql`update hub.review_task_assignees set first_viewed_at = now()
      where task_id = ${taskId} and tenant_id = ${r.tenant_id} and user_id = ${u.userId}
        and first_viewed_at is null`);
    const [seen] = await tx.execute<{ n: number }>(sql`select 1 as n from hub.audit_log
      where tenant_id = ${r.tenant_id} and actor_id = ${u.userId} and action = 'view'
        and entity = 'review_task' and entity_id = ${taskId} limit 1`);
    if (seen === undefined)
      await auditView(tx, u, {
        entity: "review_task",
        tenantId: r.tenant_id,
        entityId: taskId,
        name: snap.name,
      });
  }

  /** `GET /process-runs/:id/outputs/:oid`. Full ⇒ mọi output; task ⇒ của task mình (U5 starter ⇒ mọi output). */
  async output(
    u: AuthUser,
    runId: string,
    outputId: string,
    tenantIdQ?: string,
  ): Promise<ProcessOutput> {
    const v = await viewerCtx(this.d, u);
    return withHubScope(this.d.db, scopeOf(v, tenantIdQ), async (tx) => {
      const r = await runRow(tx, runId, u.userId);
      if (!r) throw notFound();
      const myIds = await myTaskIds(tx, r, v);
      const access = await runViewer(tx, runId);
      if (!access) throw notFound();
      const [o] = await tx.execute<
        OutputRow & { content: string; fields: Record<string, string | number> | null }
      >(sql`
        select id, stage_idx, version, attempt, template_ok, template_missing, fields, content,
          ${iso("created_at")} as created_at
        from hub.process_outputs where id = ${outputId} and process_run_id = ${runId} and tenant_id = ${r.tenant_id}`);
      if (!o) throw notFound();
      // access `task` + là người bắt đầu ⇒ người bắt đầu đã rời phòng (U5): xem mọi output; phòng xoá/gốc admin ⇒ full.
      const starterLeft = v.userId === r.started_by;
      if (access === "task" && !starterLeft && !(await inMyTask(tx, r.tenant_id, myIds, outputId)))
        throw notFound();
      const snap = r.snapshot as unknown as Snap;
      await auditView(tx, u, {
        entity: "process_run",
        tenantId: r.tenant_id,
        entityId: runId,
        name: snap.name,
      });
      return {
        id: o.id,
        stage_idx: Number(o.stage_idx),
        version: Number(o.version),
        attempt: Number(o.attempt),
        content: o.content,
        fields: o.fields ?? null,
        template_ok: o.template_ok,
        template_missing: o.template_missing ?? [],
        created_at: o.created_at,
      };
    });
  }
}

async function inMyTask(
  tx: Tx,
  tenantId: string,
  myIds: string[],
  outputId: string,
): Promise<boolean> {
  if (myIds.length === 0) return false;
  const [row] = await tx.execute<{ n: number }>(sql`
    select 1 as n from hub.review_tasks where output_id = ${outputId} and tenant_id = ${tenantId}
      and id = any(${idsArr(myIds)}) limit 1`);
  return row !== undefined;
}
