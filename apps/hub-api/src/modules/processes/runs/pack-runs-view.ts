// contract-flow S1a · đọc cho gói (`PackRunsPort.stepsView` + tìm task cho `act`), scope USER người xem (RLS T) + lọc
// `tenant_id` tường minh. stepsView = 2 câu cố định: (1) run × stage × task review gần nhất (+ tên người quyết),
// (2) grant của task mở (chỉ khi có). `can_act` = `canAct` của engine (nguồn duy nhất). Luật trạng thái: `pack-steps.rules`.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type {
  PackActTarget,
  PackOpenTask,
  PackRunCaller,
  PackStepsView,
  PackStepView,
} from "../../packs/kit/application/pack-runs.ports";
import { headGateSql } from "../core/head-gate.sql";
import type { ProcessDeps } from "../core/ports";
import { dueOf, stageMeta, stepStatusOf } from "../domain/runs/pack-steps.rules";
import { canAct, headGate } from "../domain/tasks/task-access.rules";
import type { ProcessRunStatus } from "../domain/types";

type Ts = Date | string;
type StageSnap = Parameters<typeof stageMeta>[0] & {
  after?: {
    kind?: string;
    group_id?: string | null;
    exclude_starter?: boolean;
    head_only?: boolean;
  } | null;
};
type Row = {
  run_status: string;
  started_by: string;
  stage_idx: number;
  stage_status: string;
  round: number;
  stage: StageSnap | string;
  task_id: string | null;
  task_status: "open" | "closed" | null;
  result: string | null;
  feedback: string | null;
  decided_by: string | null;
  decided_name: string | null;
  decided_at: Ts | null;
  assignee_group_id: string | null;
  escalate_at: Ts | null;
  escalated_at: Ts | null;
  escalate_group_id: string | null;
  /** S1b · trưởng phòng của Group assignee task (null = không có). */
  group_head: string | null;
};
type Grant = { task_id: string; user_id: string | null; group_id: string | null; via: string };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const vrole = (r: string): "platform_admin" | "tenant_admin" | "member" =>
  r === "platform_admin" || r === "tenant_admin" ? r : "member";
const iso = (v: Ts | null) => (v === null ? null : new Date(v).toISOString());
const userScope = (u: PackRunCaller) => ({
  kind: "user" as const,
  userId: u.userId,
  tenantId: u.tenantId,
});

const rowsSql = (runId: string, tenantId: string) => sql`
  select r.status as run_status, r.started_by, s.stage_idx, s.status as stage_status, s.round,
    r.snapshot->'stages'->(s.stage_idx::int) as stage,
    t.id as task_id, t.status as task_status, t.result, t.feedback, t.decided_by, t.decided_at,
    coalesce(nullif(du.display_name, ''), du.username) as decided_name,
    t.assignee_group_id, t.escalate_at, t.escalated_at, t.escalate_group_id,
    (select d.head_user_id from admin.departments d where d.group_id = t.assignee_group_id
      and d.tenant_id = r.tenant_id) as group_head
  from hub.process_runs r
  join hub.stage_runs s on s.process_run_id = r.id and s.tenant_id = r.tenant_id
  left join lateral (select t.* from hub.review_tasks t where t.stage_run_id = s.id
    and t.tenant_id = s.tenant_id and t.kind = 'review' order by t.created_at desc, t.id desc limit 1) t on true
  left join admin.users du on du.id = t.decided_by and du.tenant_id = r.tenant_id
  where r.id = ${runId} and r.tenant_id = ${tenantId}
  order by s.stage_idx`;

function stepOf(r: Row, canActOf: (r: Row, stage: StageSnap) => boolean): PackStepView {
  const stage: StageSnap = typeof r.stage === "string" ? JSON.parse(r.stage) : r.stage;
  const idx = Number(r.stage_idx);
  const m = stageMeta(stage, idx);
  const task = r.task_id && r.task_status ? { status: r.task_status, result: r.result } : null;
  const escalated = r.escalated_at !== null;
  return {
    idx,
    key: m.key,
    name: m.name,
    status: stepStatusOf({
      stageStatus: r.stage_status,
      round: Number(r.round),
      task,
      auto: stage?.after?.kind === "auto",
    }),
    group_id: r.assignee_group_id ?? m.groupId,
    escalated_group_id: escalated ? r.escalate_group_id : null,
    due_at: task ? dueOf(r.escalate_at) : null,
    escalated,
    result: r.result === "pass" || r.result === "fail" || r.result === "reject" ? r.result : null,
    decided_by: r.decided_by ? { id: r.decided_by, name: r.decided_name ?? r.decided_by } : null,
    decided_at: iso(r.decided_at),
    feedback: r.feedback,
    task:
      r.task_id && r.task_status === "open" ? { id: r.task_id, can_act: canActOf(r, stage) } : null,
  };
}

/** `canAct` của engine cho task review mở (grant user/forward + Group duyệt + Group chuyển cấp + exclude_starter). */
function canActFn(u: PackRunCaller, groupIds: ReadonlySet<string>, grants: readonly Grant[]) {
  const v = { userId: u.userId, tenantId: u.tenantId, role: vrole(u.role), groupIds };
  return (r: Row, stage: StageSnap): boolean => {
    const mine = grants.filter((g) => g.task_id === r.task_id);
    const userIds = new Set(mine.flatMap((g) => (g.user_id ? [g.user_id] : [])));
    const extra = mine.flatMap((g) => (g.via === "escalated" && g.group_id ? [g.group_id] : []));
    const task = {
      kind: "review" as const,
      status: "open" as const,
      reason: null,
      userIds,
      groupId: r.assignee_group_id,
      reviewGroupId: stageMeta(stage, 0).groupId,
      extraGroupIds: extra,
      starterExcluded: stage?.after?.exclude_starter === true,
      headGate: headGate(stage?.after, r.group_head), // S1b
    };
    const inGroup = (g: string | null) => g !== null && groupIds.has(g);
    const assignee =
      userIds.has(u.userId) ||
      inGroup(r.assignee_group_id) ||
      extra.some(inGroup) ||
      task.headGate === u.userId;
    const run = { tenantId: u.tenantId, startedBy: r.started_by, originRoom: "none" as const };
    const status = r.run_status as ProcessRunStatus;
    return canAct(v, task, { ...run, taskAssignee: assignee, status });
  };
}

/** S1a · dòng thời gian stage của run cho người xem; run không thấy (RLS/tenant) ⇒ null. */
export async function stepsView(
  d: ProcessDeps,
  u: PackRunCaller,
  runId: string,
): Promise<PackStepsView | null> {
  if (!UUID.test(runId)) return null;
  const groupIds = (await d.config.user(u.userId))?.groupIds ?? new Set<string>();
  return withHubScope(d.db, userScope(u), async (tx) => {
    const rows = [...(await tx.execute<Row>(rowsSql(runId, u.tenantId)))];
    const head = rows[0];
    if (!head) return null;
    const open = rows.flatMap((r) => (r.task_id && r.task_status === "open" ? [r.task_id] : []));
    const grants =
      open.length === 0
        ? []
        : [
            ...(await tx.execute<Grant>(sql`select a.task_id, a.user_id, a.group_id, a.via
                from hub.review_task_assignees a
                where a.task_id = any(${`{${open.join(",")}}`}::uuid[]) and a.tenant_id = ${u.tenantId}`)),
          ];
    const can = canActFn(u, groupIds, grants);
    return {
      run_id: runId,
      status: head.run_status,
      started_by: head.started_by,
      steps: rows.map((r) => stepOf(r, can)),
    };
  });
}

const OPEN_GATE = headGateSql("x.st", "t.tenant_id");

/**
 * contract-flow S1b · "Việc của tôi": task review MỞ của run gói `packKey` mà `u` quyết được — cùng luật `canAct` (grant
 * user/chuyển tiếp ∪ Group duyệt có cửa trưởng phòng ∪ Group chuyển cấp; trừ người bắt đầu ở stage `exclude_starter`; run
 * chưa kết thúc). MỘT câu, scope user (RLS T) + lọc `tenant_id` tường minh; vào qua index một phần `process_runs_pack_ref_idx`.
 */
export async function openTasksOf(
  d: ProcessDeps,
  u: PackRunCaller,
  packKey: string,
): Promise<PackOpenTask[]> {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(packKey) || !UUID.test(u.tenantId)) return [];
  const groupIds = [...((await d.config.user(u.userId))?.groupIds ?? [])].filter((g) =>
    UUID.test(g),
  );
  const groups = `{${groupIds.join(",")}}`;
  const rows = await withHubScope(d.db, userScope(u), (tx) =>
    tx.execute<OpenRow>(sql`
      select t.id as task_id, r.id as run_id, r.pack_record_id as record_id, x.st->>'key' as stage_key,
        x.st->>'name' as stage_name, t.escalate_at as due_at, (t.escalated_at is not null) as escalated
      from hub.process_runs r
      join hub.review_tasks t on t.process_run_id = r.id and t.tenant_id = r.tenant_id
        and t.kind = 'review' and t.status = 'open'
      join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      cross join lateral (select r.snapshot->'stages'->(s.stage_idx::int) as st offset 0) x
      cross join lateral (select ${OPEN_GATE} as gate) hg
      where r.tenant_id = ${u.tenantId} and r.pack_key = ${packKey} and r.pack_record_id is not null
        and r.status not in ('done', 'failed', 'cancelled', 'expired')
        and not (x.st->'after'->>'exclude_starter' = 'true' and r.started_by = ${u.userId})
        and (exists (select 1 from hub.review_task_assignees a where a.task_id = t.id
                and a.tenant_id = t.tenant_id and a.user_id = ${u.userId})
          or (hg.gate is null and t.assignee_group_id = any(${groups}::uuid[]))
          or hg.gate = ${u.userId}::uuid
          or (t.escalated_at is not null and t.escalate_group_id = any(${groups}::uuid[])))
      order by t.created_at, t.id`),
  );
  return [...rows].map((r) => ({
    task_id: r.task_id,
    run_id: r.run_id,
    record_id: r.record_id,
    stage_key: r.stage_key ?? "",
    stage_name: r.stage_name ?? "",
    due_at: iso(r.due_at),
    escalated: r.escalated === true,
  }));
}

type OpenRow = {
  task_id: string;
  run_id: string;
  record_id: string;
  stage_key: string | null;
  stage_name: string | null;
  due_at: Ts | null;
  escalated: boolean;
};

/** S1a · task review MỞ của run khớp đích (id task hoặc khoá stage), scope user người quyết; không có ⇒ null. */
export async function openTaskFor(
  d: ProcessDeps,
  u: PackRunCaller,
  runId: string,
  at: PackActTarget,
): Promise<string | null> {
  if (!UUID.test(runId)) return null;
  if ("task_id" in at && !UUID.test(at.task_id)) return null;
  const match =
    "task_id" in at
      ? sql`t.id = ${at.task_id}`
      : sql`r.snapshot->'stages'->(s.stage_idx::int)->>'key' = ${at.stage}`;
  const [row] = await withHubScope(d.db, userScope(u), (tx) =>
    tx.execute<{ id: string }>(sql`select t.id from hub.review_tasks t
      join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
      join hub.process_runs r on r.id = t.process_run_id and r.tenant_id = t.tenant_id
      where t.process_run_id = ${runId} and t.tenant_id = ${u.tenantId} and t.kind = 'review'
        and t.status = 'open' and ${match}
      order by t.created_at desc limit 1`),
  );
  return row?.id ?? null;
}
