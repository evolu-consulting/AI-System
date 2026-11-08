// CR-125 · cr125-request-steps · cây bước của một «yêu cầu»: bước của lượt + lượt con (Quy trình con, `parent_run_id`) lồng nhau, mỗi lượt
// là một `FlowView` (CÙNG phép chiếu với thẻ HĐ — `flowViewOfRun` của cửa công khai gói contracts). CHỈ gọi SAU khi người xem đã qua
// kiểm quyền xem lượt này (`ViewService.get` ⇒ 404 nếu không): lượt con đọc được vì người xem xem được lượt cha; đọc ở scope system với
// lọc `tenant_id` tường minh. Lượt gốc (`root_run_id`) chỉ báo khi người xem xem được CHÍNH lượt gốc (definer `process_run_viewer`).
import type { RequestStepNode } from "@ai/contracts/hub-admin";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { backTargetOfRun, flowViewOfRun } from "../../packs/contracts/public";
import type { ProcessDeps } from "../core/ports";
import { stepsView } from "./pack-runs-view";

/** Trần lượt con của một trang (Luật 4c: số câu SQL không phụ thuộc số bước; số lượt con nhỏ, mỗi lượt ≤ 2 câu). */
export const REQUEST_CHILD_MAX = 30;
const DEPTH_MAX = 5;

type ChildRow = {
  id: string;
  parent_id: string;
  parent_stage_idx: number | null;
  name: string | null;
};
type Caller = { userId: string; tenantId: string; role: string };

const caller = (u: AuthUser): Caller => ({ userId: u.userId, tenantId: u.tenantId, role: u.role });

/** Lượt con (mọi cấp ≤ 5) của `runId`, theo thứ tự bắt đầu — MỘT câu đệ quy, scope system + lọc tenant. */
async function descendants(d: ProcessDeps, tenantId: string, runId: string): Promise<ChildRow[]> {
  return withHubScope(d.db, { kind: "system" }, async (tx) => {
    const rows = await tx.execute<ChildRow>(sql`
      with recursive down as (
        select c.id, c.parent_run_id, c.parent_stage_run_id, c.started_at, 1 as depth
        from hub.process_runs c where c.parent_run_id = ${runId}::uuid and c.tenant_id = ${tenantId}::uuid
        union all
        select c.id, c.parent_run_id, c.parent_stage_run_id, c.started_at, down.depth + 1
        from hub.process_runs c join down on c.parent_run_id = down.id
        where c.tenant_id = ${tenantId}::uuid and down.depth < ${DEPTH_MAX})
      select down.id::text as id, down.parent_run_id::text as parent_id, s.stage_idx as parent_stage_idx,
        r.snapshot ->> 'name' as name
      from down join hub.process_runs r on r.id = down.id and r.tenant_id = ${tenantId}::uuid
      left join hub.stage_runs s on s.id = down.parent_stage_run_id and s.tenant_id = ${tenantId}::uuid
      order by down.depth, down.started_at, down.id limit ${REQUEST_CHILD_MAX}`);
    return [...rows];
  });
}

async function node(
  d: ProcessDeps,
  u: AuthUser,
  o: { id: string; name: string; parentStageIdx: number | null },
): Promise<Omit<RequestStepNode, "children"> | null> {
  const sv = await stepsView(d, caller(u), o.id, "system");
  if (!sv) return null;
  return {
    run_id: o.id,
    name: o.name,
    status: sv.status,
    parent_stage_idx: o.parentStageIdx,
    back_to_step: backTargetOfRun(sv),
    flow: flowViewOfRun(sv, o.id),
  };
}

/** Cây bước của lượt `runId` (đã kiểm quyền xem ở người gọi). Lượt con không đọc được bước (hiếm) bị bỏ khỏi cây. */
export async function requestSteps(
  d: ProcessDeps,
  u: AuthUser,
  run: { id: string; name: string },
): Promise<RequestStepNode> {
  const [root, kids] = await Promise.all([
    node(d, u, { id: run.id, name: run.name, parentStageIdx: null }),
    descendants(d, u.tenantId, run.id),
  ]);
  const nodes = new Map<string, RequestStepNode>();
  const made = await Promise.all(
    kids.map((k) =>
      node(d, u, { id: k.id, name: k.name ?? "", parentStageIdx: k.parent_stage_idx }),
    ),
  );
  for (const [i, n] of made.entries())
    if (n) nodes.set((kids[i] as ChildRow).id, { ...n, children: [] });
  const top: RequestStepNode = (
    root ? { ...root, children: [] } : emptyNode(run)
  ) as RequestStepNode;
  nodes.set(run.id, top);
  for (const k of kids) {
    const n = nodes.get(k.id);
    if (n) (nodes.get(k.parent_id) ?? top).children.push(n);
  }
  return top;
}

const emptyNode = (run: { id: string; name: string }): RequestStepNode => ({
  run_id: run.id,
  name: run.name,
  status: "unknown",
  parent_stage_idx: null,
  back_to_step: null,
  flow: {
    slot: "processes.request",
    ref: run.id,
    run: null,
    state: "none",
    phase: null,
    note: null,
    attention: null,
    block_reason: null,
    steps: [],
    tasks: [],
  },
  children: [],
});

/**
 * Lượt gốc của chuỗi cha-con khi `runId` là lượt con VÀ người xem xem được lượt gốc (definer `hub.process_run_viewer`, scope user);
 * ngược lại null (không lộ lượt cha cho người chỉ có quyền ở lượt con).
 */
export async function rootRunId(
  d: ProcessDeps,
  u: AuthUser,
  runId: string,
): Promise<string | null> {
  const root = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const [r] = await tx.execute<{ id: string }>(sql`
      with recursive up as (
        select id, parent_run_id, 0 as n from hub.process_runs where id = ${runId}::uuid and tenant_id = ${u.tenantId}::uuid
        union all
        select p.id, p.parent_run_id, up.n + 1 from hub.process_runs p join up on p.id = up.parent_run_id
        where p.tenant_id = ${u.tenantId}::uuid and up.n < ${DEPTH_MAX})
      select id::text as id from up where parent_run_id is null limit 1`);
    return r?.id ?? null;
  });
  if (!root || root === runId) return null;
  const ok = await withHubScope(
    d.db,
    { kind: "user", userId: u.userId, tenantId: u.tenantId },
    async (tx) => {
      const [r] = await tx.execute<{ access: string | null }>(
        sql`select hub.process_run_viewer(${root}::uuid) as access`,
      );
      return r?.access != null;
    },
  );
  return ok ? root : null;
}
