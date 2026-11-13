// contract-flow S1a · đọc cho gói (`PackRunsPort.stepsView` + tìm task cho `act`), scope USER người xem (RLS T) + lọc
// `tenant_id` tường minh. stepsView = 2 câu cố định: (1) run × stage × task review gần nhất (+ tên người quyết),
// (2) grant của task mở (chỉ khi có). `can_act` = `canAct` của engine (nguồn duy nhất). Luật trạng thái: `pack-steps.rules`.
import type { FormField } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type {
  PackActTarget,
  PackOpenTask,
  PackRunCaller,
  PackStepsView,
  PackStepView,
} from "../../packs/kit/public";
import { approverSql } from "../core/head-gate.sql";
import type { ProcessDeps } from "../core/ports";
import { delegatedLive } from "../core/task-grants.sql";
import { approverFieldsOf, dueOf, stageMeta, stepStatusOf } from "../domain/runs/pack-steps.rules";
import { alsoGroupsOf, canAct, headGate, overrideOnly } from "../domain/tasks/task-access.rules";
import type { ProcessRunStatus } from "../domain/types";
import { RESOLVE_SLOT_SQL } from "../library/slot-resolve.repo";
import { milestoneFrom } from "./pack-milestone-count.sql";
import { groupsOf, OPEN_GATE, openTasksFrom, UUID } from "./pack-open-tasks.sql";
import {
  CLAIM_COLS,
  type ClaimCols,
  claimOf,
  type Grant,
  grantsOf,
  openTask,
} from "./pack-runs-claim";
import { decisionOf, formOf, nodeKeyOf, stageCode, withFormPrefill } from "./pack-runs-extra";
import { collapseModuleSteps, signerNamesOf, signerRefs } from "./pack-runs-modules";

type Ts = Date | string;
type StageSnap = Parameters<typeof stageMeta>[0] & {
  after?: {
    kind?: string;
    group_id?: string | null;
    exclude_starter?: boolean;
    head_only?: boolean;
    also_group_ids?: string[];
    approver_user_id?: string | null;
    approver_mode?: string;
  } | null;
  executor?: { kind?: string; fields?: FormField[] } | null;
};
type Row = {
  run_id: string;
  run_status: string;
  started_by: string;
  run_decision: unknown;
  record_id: string | null;
  stage_idx: number;
  stage_status: string;
  stage_error: string | null;
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
  group_head_name: string | null;
  consumed_event: string | null; // CR-123 · u6 · sự kiện stage chờ đã tiêu thụ (null = không có)
  /** CR-125 · `process_outputs.fields` của output hiện hành của stage (chỉ dùng cho stage `form`). */
  form_values: unknown;
} & ClaimCols;

const vrole = (r: string): "platform_admin" | "tenant_admin" | "member" =>
  r === "platform_admin" || r === "tenant_admin" ? r : "member";
const iso = (v: Ts | null) => (v === null ? null : new Date(v).toISOString());
const userScope = (u: PackRunCaller) => ({
  kind: "user" as const,
  userId: u.userId,
  tenantId: u.tenantId,
});

const rowsSql = (runIds: readonly string[], tenantId: string, gs = new Set<string>()) => sql`
  select r.id::text as run_id, r.status as run_status, r.started_by, r.decision as run_decision, r.pack_record_id::text as record_id, s.stage_idx, s.status as stage_status, s.last_error_code as stage_error, s.round,
    r.snapshot->'stages'->(s.stage_idx::int) as stage,
    t.id as task_id, t.status as task_status, t.result, t.feedback, t.decided_by, t.decided_at,
    coalesce(nullif(du.display_name, ''), du.username) as decided_name,
    t.assignee_group_id, t.escalate_at, t.escalated_at, t.escalate_group_id, ${CLAIM_COLS},
    (select e.event from hub.process_run_events e where e.consumed_by = s.id and e.tenant_id = r.tenant_id limit 1) as consumed_event,
    o.fields as form_values,
    h.id as group_head, coalesce(nullif(hu.display_name, ''), hu.username) as group_head_name
  from hub.process_runs r
  join hub.stage_runs s on s.process_run_id = r.id and s.tenant_id = r.tenant_id
  left join lateral (select t.* from hub.review_tasks t where t.stage_run_id = s.id and t.tenant_id = s.tenant_id and t.kind = 'review' -- CR-125 cùng duyệt: thẻ mở, của nhóm người xem trước
    order by (t.status = 'open') desc, (t.assignee_group_id = any(${`{${[...gs].filter((x) => UUID.test(x)).join(",")}}`}::uuid[])) desc, t.created_at desc, t.id desc limit 1) t on true
  left join admin.users du on du.id = t.decided_by and du.tenant_id = r.tenant_id
  left join lateral (select coalesce(${approverSql("r.snapshot->'stages'->(s.stage_idx::int)", "r.tenant_id")}, (select d.head_user_id from admin.departments d
    where d.group_id = t.assignee_group_id and d.tenant_id = r.tenant_id)) as id) h on true
  left join admin.users hu on hu.id = h.id and hu.tenant_id = r.tenant_id
  left join hub.process_outputs o on o.id = s.current_output_id and o.tenant_id = s.tenant_id
  where r.id = any(${`{${runIds.join(",")}}`}::uuid[]) and r.tenant_id = ${tenantId}
  order by r.id, s.stage_idx`;

type ActOf = (r: Row, stage: StageSnap) => Parameters<typeof openTask>[1];
function stepOf(r: Row, canActOf: ActOf): PackStepView {
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
    task: r.task_id && r.task_status === "open" ? openTask(r.task_id, canActOf(r, stage)) : null,
    task_ref: r.task_id,
    back_to_steps: m.backTo,
    ...approverFieldsOf(stage?.after, r.group_head, r.group_head_name, r.assignee_group_id),
    ...formOf(stage, r),
  };
}

/** `canAct` của engine cho task review mở (grant user/forward + Group duyệt + Group chuyển cấp + exclude_starter). CR-113 ·
 *  `override` = quyết được chỉ nhờ Group "cũng quyết" (`also_group_ids`) — không qua grant, Group duyệt/cửa, Group chuyển cấp. */
function canActFn(
  u: PackRunCaller,
  groupIds: ReadonlySet<string>,
  grants: readonly Grant[],
): ActOf {
  const v = { userId: u.userId, tenantId: u.tenantId, role: vrole(u.role), groupIds };
  return (r: Row, stage: StageSnap) => {
    const mine = grants.filter((g) => g.task_id === r.task_id);
    const userIds = new Set(mine.flatMap((g) => (g.user_id ? [g.user_id] : [])));
    const escalated = mine.flatMap((g) =>
      g.via === "escalated" && g.group_id ? [g.group_id] : [],
    );
    const also = alsoGroupsOf(stage?.after); // prod-fix2 · Group "cũng quyết" của stage
    const extra = [...escalated, ...also];
    const task = {
      kind: "review" as const,
      status: "open" as const,
      reason: null,
      userIds,
      groupId: r.assignee_group_id,
      reviewGroupId: stageMeta(stage, 0).groupId,
      extraGroupIds: extra,
      starterExcluded: stage?.after?.exclude_starter === true,
      headGate: headGate(stage?.after, r.group_head, r.assignee_group_id), // S1b
      // CR-127 · FIX-OV · CỐ Ý không truyền need/claimedBy: thẻ cần `can_act=true` + `claim.state='other'` để hiện dải «X đang xử lý»
      // và khoá nút (ClaimBar); `can_act=false` ẩn cả khung việc (hồi quy j11). Quyết thử vẫn 409 `TASK_CLAIMED` ở máy chủ.
    };
    const inGroup = (g: string | null) => g !== null && groupIds.has(g);
    const t = { userIds, groupId: r.assignee_group_id, gate: task.headGate, escalated, also };
    const assignee =
      userIds.has(u.userId) ||
      inGroup(r.assignee_group_id) ||
      extra.some(inGroup) ||
      task.headGate === u.userId;
    const run = { tenantId: u.tenantId, startedBy: r.started_by, originRoom: "none" as const };
    const status = r.run_status as ProcessRunStatus;
    const can = canAct(v, task, { ...run, taskAssignee: assignee, status });
    return {
      can,
      override: can && overrideOnly(u.userId, groupIds, t),
      claim: claimOf(r, v, stage, mine),
    };
  };
}

/** S1a · dòng thời gian stage của run cho người xem; run không thấy (RLS/tenant) ⇒ null. */
export async function stepsView(
  d: ProcessDeps,
  u: PackRunCaller,
  runId: string,
  /** CR-125 · request-steps · `system` CHỈ khi người gọi đã qua kiểm quyền xem lượt cha (đọc lượt con); mọi lọc vẫn theo `tenant_id`. */
  scope: "user" | "system" = "user",
): Promise<PackStepsView | null> {
  if (!UUID.test(runId)) return null;
  const groupIds = (await d.config.user(u.userId))?.groupIds ?? new Set<string>();
  const nodes: (string | undefined)[] = [];
  let recordId: string | null = null;
  const view = await withHubScope(
    d.db,
    scope === "system" ? { kind: "system" } : userScope(u),
    async (tx) => {
      const rows = [...(await tx.execute<Row>(rowsSql([runId], u.tenantId, new Set(groupIds))))];
      const head = rows[0];
      if (!head) return null;
      const open = rows.flatMap((r) => (r.task_id && r.task_status === "open" ? [r.task_id] : []));
      const grants = await grantsOf(tx, u.tenantId, open);
      const can = canActFn(u, groupIds, grants);
      const snaps = rows.map(
        (r) => (typeof r.stage === "string" ? JSON.parse(r.stage) : r.stage) ?? {},
      );
      const names = await signerNamesOf(tx, u.tenantId, snaps.flatMap(signerRefs));
      for (const [k, s] of snaps.entries()) nodes[Number(rows[k]?.stage_idx)] = nodeKeyOf(s);
      recordId = head.record_id;
      return {
        run_id: runId,
        status: head.run_status,
        started_by: head.started_by,
        steps: collapseModuleSteps(
          rows.map((r) => stepOf(r, can)),
          snaps,
          rows.map((r) => ({ stageStatus: r.stage_status, consumed: r.consumed_event })),
          names,
        ),
        decision:
          head.run_status === "needs_decision"
            ? { ...decisionOf(head.run_decision), ...stageCode(rows) }
            : null,
      };
    },
  );
  if (!view) return null;
  // CR-126 · ngoài tx engine: resolver gói đọc bằng uow của gói (RLS gói).
  const q = { tenantId: u.tenantId, userId: u.userId, recordId };
  return { ...view, steps: await withFormPrefill(view.steps, (i) => nodes[i], q) };
}

/** CR-123 · u10 · cột "Bước" của danh sách: NHIỀU run, CÙNG `rowsSql`/`stepOf`/`collapseModuleSteps` với `stepsView`; ≤ 2 SQL cố định, không `can_act`. */
export async function stepsViewMany(
  d: ProcessDeps,
  u: PackRunCaller,
  runIds: readonly string[],
): Promise<Map<string, PackStepsView>> {
  const ids = [...new Set(runIds)].filter((x) => UUID.test(x));
  const out = new Map<string, PackStepsView>();
  if (ids.length === 0) return out;
  return withHubScope(d.db, userScope(u), async (tx) => {
    const rows = [...(await tx.execute<Row>(rowsSql(ids, u.tenantId)))];
    const snaps = rows.map(
      (r) => (typeof r.stage === "string" ? JSON.parse(r.stage) : r.stage) ?? {},
    );
    const names = await signerNamesOf(tx, u.tenantId, snaps.flatMap(signerRefs));
    const none: ActOf = () => ({ can: false, override: false });
    for (const id of ids) {
      const at = rows.flatMap((r, i) => (r.run_id === id ? [i] : []));
      const head = rows[at[0] ?? -1];
      if (!head) continue;
      out.set(id, {
        run_id: id,
        status: head.run_status,
        started_by: head.started_by,
        steps: collapseModuleSteps(
          at.map((i) => stepOf(rows[i] as Row, none)),
          at.map((i) => snaps[i]),
          at.map((i) => ({
            stageStatus: (rows[i] as Row).stage_status,
            consumed: (rows[i] as Row).consumed_event,
          })),
          names,
        ),
        decision: null,
      });
    }
    return out;
  });
}

export { UUID };

const PACK_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const SLOT_KEY = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,39}$/;

/**
 * CR-121 C-7 · hộp "Chờ tôi duyệt" cho menu. `count` = số task duyệt mở `u` quyết được + số việc «Xác nhận mốc» mở giao cho `u` (MỘT câu, scope user; mệnh đề duyệt dùng chung với
 * `openTasksOf`). `approver` = `u` có vai duyệt: có việc mở ⇒ đương nhiên true (không hỏi thêm); chưa có việc ⇒ MỘT câu thứ hai
 * (scope system — def/khe là bảng hệ thống) xem `u` có thuộc Group duyệt / "cũng quyết" / là người duyệt cụ thể của quy trình ĐANG
 * GÁN cho `slot` (bản xuất bản hiện hành, cùng `RESOLVE_SLOT_SQL`) không; khe chưa có quy trình ⇒ false. Tối đa 2 câu, cố định.
 */
export async function inboxOf(
  d: ProcessDeps,
  u: PackRunCaller,
  packKey: string,
  slot: string,
): Promise<{ count: number; approver: boolean }> {
  if (!PACK_KEY.test(packKey) || !SLOT_KEY.test(slot) || !UUID.test(u.tenantId))
    return { count: 0, approver: false };
  const groups = await groupsOf(d, u.userId);
  const [c] = await withHubScope(d.db, userScope(u), (tx) =>
    tx.execute<{ n: number | string }>(
      sql`select ((select count(*) ${openTasksFrom(u, packKey, groups)}) + (select count(*) ${milestoneFrom(u, packKey, groups)}))::int as n`,
    ),
  );
  const count = Number(c?.n ?? 0);
  if (count > 0) return { count, approver: true };
  const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
    tx.execute<{ approver: boolean }>(sql`
      with rs as (${RESOLVE_SLOT_SQL(u.tenantId, slot)})
      select exists (select 1 from rs
          join hub.process_defs pd on pd.id = rs.def_id
          left join hub.process_def_releases rel on rel.def_id = rs.def_id and rel.rel_version = rs.rel_version
          cross join lateral jsonb_array_elements(coalesce(rel.stages, pd.stages)) sg
          where sg->'after'->>'kind' = 'review'
            and (sg->'after'->>'group_id' = any(${groups}::text[])
              or sg->'after'->>'approver_user_id' = ${u.userId}
              or coalesce(sg->'after'->'also_group_ids', '[]'::jsonb) ?| ${groups}::text[]
              -- def thư viện lưu Group theo MÃ (group_key / also_group_keys); phân giải sang id theo tenant của người xem
              or exists (select 1 from admin.groups g
                where g.tenant_id = ${u.tenantId}::uuid and g.id = any(${groups}::uuid[])
                  and (g.key = sg->'after'->>'group_key'
                    or coalesce(sg->'after'->'also_group_keys', '[]'::jsonb) ? g.key)))) as approver`),
  );
  return { count: 0, approver: r?.approver === true };
}
export async function openTasksOf(
  d: ProcessDeps,
  u: PackRunCaller,
  packKey: string,
): Promise<PackOpenTask[]> {
  if (!PACK_KEY.test(packKey) || !UUID.test(u.tenantId)) return [];
  const groups = await groupsOf(d, u.userId);
  const rows = await withHubScope(d.db, userScope(u), (tx) =>
    tx.execute<OpenRow>(sql`
      select t.id as task_id, r.id as run_id, r.pack_record_id as record_id, x.st->>'key' as stage_key,
        x.st->>'name' as stage_name, t.escalate_at as due_at, (t.escalated_at is not null) as escalated,
        (select jsonb_build_object('id', a.on_behalf_of, 'name', (select coalesce(nullif(b.display_name, ''), b.username)
            from admin.users b where b.id = a.on_behalf_of and b.tenant_id = a.tenant_id))
          from hub.review_task_assignees a
          where a.task_id = t.id and a.tenant_id = t.tenant_id and a.user_id = ${u.userId}
            and a.via = 'delegated' and ${delegatedLive("a")} limit 1) as behalf
      ${openTasksFrom(u, packKey, groups)}
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
    ...(r.behalf && {
      delegated_from: { id: r.behalf.id, display_name: r.behalf.name || r.behalf.id },
    }),
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
  /** CR-127 · uỷ quyền còn hiệu lực: người xem làm thay `id` (hàng `via='delegated'`). */
  behalf: { id: string; name: string | null } | null;
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
