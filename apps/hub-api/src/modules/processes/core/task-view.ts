// HUB-FR-107 · HUB-FR-110 · HUB-FR-111 · `TaskDetail` dùng chung (plan-step0 §1): PF1 view, PF2 answer/forward, PF3
// `/me/review-tasks` đều trả qua đây — PF không tự dựng. `can_act` = `canAct` (task.rules). Đọc dưới scope `user` của người
// xem (RLS T); quyền xem task do người gọi kiểm trước (run-access).
import {
  DECISION_OPTIONS,
  type DecisionReason,
  type OutputRef,
  type ProcessRunStatus,
  type TaskDetail,
  type TaskKind,
  type TaskResult,
  type TaskStatus,
  type UserRef,
} from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { RunFacts, Viewer } from "../domain/runs/run-access.rules";
import { autofixDecisionOptions, isAutofixReason } from "../runs/autofix.rules";
import { canAct } from "./task.rules";

export type TaskRow = {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  stageIdx: number;
  question: string | null;
  choices: string[] | null;
  excerpt: string | null;
  reason: DecisionReason | null;
  result: TaskResult | null;
  createdAt: Date;
};
export type ForwardRow = { fromUserId: string; toUserId: string; note: string | null; at: Date };
export type ViewerCtx = Viewer & { groupIds: ReadonlySet<string> };

const nameRef = (users: ReadonlyMap<string, UserRef>, id: string): UserRef =>
  users.get(id) ?? { id, display_name: id };

export function toTaskDetail(
  row: TaskRow,
  x: {
    forwards: readonly ForwardRow[];
    users: ReadonlyMap<string, UserRef>;
    output: OutputRef | null;
    hasOutput: boolean;
    stageName: string;
    canAct: boolean;
    /** P-b2 · review MỞ của stage có `back_to_steps` ≠ [] (HUB-FR-118). */
    back?: { steps: number[]; roundsLeft: number };
  },
): TaskDetail {
  const decision = row.kind === "decision";
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    stage_idx: row.stageIdx,
    stage_name: x.stageName,
    ...(x.output && { output: x.output }),
    ...(row.question !== null && { question: row.question }),
    ...(row.choices !== null && { choices: row.choices }),
    ...(row.excerpt !== null && { excerpt: row.excerpt }),
    ...(row.reason !== null && { reason: row.reason }),
    ...(decision && {
      // P-c1 · PC-R10: autofix_* ⇒ [add_attempt, cancel] kể cả có output (TD: lệch FORCE_USE_CURRENT, xem TECH-DEBT).
      options:
        row.reason !== null && isAutofixReason(row.reason)
          ? autofixDecisionOptions(row.reason)
          : DECISION_OPTIONS.filter((o) => o !== "use_current" || x.hasOutput),
      has_output: x.hasOutput,
    }),
    forwards: x.forwards.map((f) => ({
      from: nameRef(x.users, f.fromUserId),
      to: nameRef(x.users, f.toUserId),
      note: f.note,
      at: f.at.toISOString(),
    })),
    ...(row.result !== null && { result: row.result }),
    can_act: x.canAct,
    created_at: row.createdAt.toISOString(),
    ...(x.back && { back_steps: x.back.steps, back_rounds_left: x.back.roundsLeft }),
  };
}

type Ts = Date | string;
const toDate = (v: Ts): Date => (v instanceof Date ? v : new Date(v));

type TaskSql = {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  stage_idx: number;
  question: string | null;
  choices: string[] | null;
  excerpt: string | null;
  reason: DecisionReason | null;
  result: TaskResult | null;
  created_at: Ts;
  group_id: string | null;
  has_output: boolean;
  stage_name: string | null;
  review_group_id: string | null;
  tenant_id: string;
  started_by: string;
  run_status: ProcessRunStatus;
  origin_room: RunFacts["originRoom"];
  o_id: string | null;
  o_version: number | null;
  o_attempt: number | null;
  o_ok: boolean | null;
  o_missing: string[] | null;
  o_at: Ts | null;
  back_steps: number[] | null;
  back_rounds: number;
  back_limit: number;
};
type GrantSql = {
  task_id: string;
  user_id: string | null;
  via: "initial" | "forward";
  from_user_id: string | null;
  note: string | null;
  created_at: Ts;
};

async function taskRows(tx: Tx, v: ViewerCtx, ids: readonly string[]): Promise<TaskSql[]> {
  return tx.execute<TaskSql>(sql`
    select t.id, t.kind, t.status, s.stage_idx, t.question, t.choices, t.excerpt, t.reason, t.result, t.created_at,
      t.assignee_group_id as group_id, s.current_output_id is not null as has_output,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name,
      pr.snapshot->'stages'->(s.stage_idx::int)->'after'->>'group_id' as review_group_id,
      pr.tenant_id, pr.started_by, pr.status as run_status, pr.back_rounds, pr.back_limit,
      pr.snapshot->'stages'->(s.stage_idx::int)->'after'->'back_to_steps' as back_steps,
      case when pr.origin_kind <> 'room' then 'none'
        when rm.id is null or rm.deleted_at is not null then 'deleted'
        when exists (select 1 from hub.room_members m where m.room_id = rm.id and m.user_id = ${v.userId}
          and m.left_at is null) then 'member'
        else 'outside' end as origin_room,
      o.id as o_id, o.version as o_version, o.attempt as o_attempt, o.template_ok as o_ok,
      o.template_missing as o_missing, o.created_at as o_at
    from hub.review_tasks t
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    left join hub.rooms rm on rm.id = pr.origin_room_id
    left join hub.process_outputs o on o.id = t.output_id and o.tenant_id = t.tenant_id
    where t.id = any(${`{${ids.join(",")}}`}::uuid[]) and t.tenant_id = ${v.tenantId}
    order by t.created_at, t.id`);
}

async function grantRows(tx: Tx, v: ViewerCtx, ids: readonly string[]) {
  const grants = await tx.execute<GrantSql>(sql`
    select a.task_id, a.user_id, a.via, a.from_user_id, a.note, a.created_at
    from hub.review_task_assignees a
    where a.task_id = any(${`{${ids.join(",")}}`}::uuid[]) and a.tenant_id = ${v.tenantId}
    order by a.created_at, a.id`);
  const userIds = [
    ...new Set(grants.flatMap((g) => [g.user_id, g.from_user_id]).filter((x) => x !== null)),
  ];
  const users = await tx.execute<{ id: string; display_name: string | null; username: string }>(sql`
    select id, display_name, username from admin.users
    where id = any(${`{${userIds.join(",")}}`}::uuid[]) and tenant_id = ${v.tenantId}`);
  const names = new Map<string, UserRef>(
    users.map((u) => [u.id, { id: u.id, display_name: u.display_name || u.username }]),
  );
  return { grants, names };
}

/** P-b2 · `back_steps/back_rounds_left` chỉ cho review MỞ của stage có `back_to_steps` ≠ [] (= `backRoundsLeft`). */
const backOf = (r: TaskSql): { steps: number[]; roundsLeft: number } | undefined => {
  const steps = (r.back_steps ?? []).map(Number);
  if (r.kind !== "review" || r.status !== "open" || steps.length === 0) return undefined;
  return { steps, roundsLeft: Math.max(0, Number(r.back_limit) - Number(r.back_rounds)) };
};

const outputOf = (r: TaskSql): OutputRef | null =>
  r.o_id === null || r.o_at === null
    ? null
    : {
        id: r.o_id,
        version: Number(r.o_version),
        attempt: Number(r.o_attempt),
        template_ok: r.o_ok ?? false,
        template_missing: r.o_missing ?? [],
        created_at: toDate(r.o_at).toISOString(),
      };

function detailOf(v: ViewerCtx, r: TaskSql, mine: GrantSql[], names: Map<string, UserRef>) {
  const userIds = new Set(mine.flatMap((g) => (g.user_id ? [g.user_id] : [])));
  const facts = { kind: r.kind, status: r.status, reason: r.reason, userIds, groupId: r.group_id };
  const task = { ...facts, reviewGroupId: r.review_group_id };
  const assignee = userIds.has(v.userId) || (r.group_id !== null && v.groupIds.has(r.group_id));
  const run = { tenantId: r.tenant_id, startedBy: r.started_by, originRoom: r.origin_room };
  const forwards = mine
    .filter((g) => g.via === "forward" && g.from_user_id && g.user_id)
    .map((g) => ({
      fromUserId: g.from_user_id as string,
      toUserId: g.user_id as string,
      note: g.note,
      at: toDate(g.created_at),
    }));
  const row: TaskRow = { ...r, stageIdx: Number(r.stage_idx), createdAt: toDate(r.created_at) };
  return toTaskDetail(row, {
    forwards,
    users: names,
    output: outputOf(r),
    hasOutput: r.has_output,
    stageName: r.stage_name ?? `#${Number(r.stage_idx) + 1}`,
    canAct: canAct(v, task, { ...run, taskAssignee: assignee, status: r.run_status }),
    back: backOf(r),
  });
}

/** Task theo thứ tự tạo; id không thấy (RLS/tenant) bị bỏ. 3 truy vấn cố định (task, grant, tên) bất kể số task. */
export async function loadTaskDetails(
  tx: Tx,
  v: ViewerCtx,
  taskIds: readonly string[],
): Promise<TaskDetail[]> {
  if (taskIds.length === 0) return [];
  const rows = await taskRows(tx, v, taskIds);
  const { grants, names } = await grantRows(tx, v, taskIds);
  return rows.map((r) =>
    detailOf(
      v,
      r,
      grants.filter((g) => g.task_id === r.id),
      names,
    ),
  );
}
