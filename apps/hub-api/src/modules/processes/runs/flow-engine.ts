// CR-127 K3 · spec §3 (#3, #4, #8) · cổng engine cho gói: `FlowAvailability` ("có quy trình khớp?" — CÙNG `candidatesOf` + `planEvent`
// của bộ điều phối, chỉ `company_flows` đang bật) và `FlowRunControl` (Rút về: xem bước hiện tại + huỷ lượt như "Dừng" + báo người đã nhận
// việc qua notice `task_released` của E2). Chạy scope `system` riêng (role gói không đọc bảng hub).
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { publishUserEvents, type UserEvent } from "../../../lib/user-stream";
import type { FlowEngine, FlowRunStep } from "../../packs/kit/public";
import { notifyMany } from "../adapters/notify/notice-batch";
import type { OutboxEvent } from "../application/ports";
import type { ProcessDeps } from "../core/ports";
import { RunControlService } from "../gates/run-control.service";
import { outlineOfRun } from "../library/flow-outline.service";
import { type ClaimedEvent, candidatesOf } from "../triggers/dispatcher.repo";
import { planEvent } from "../triggers/match.rules";

const SYS = { kind: "system" } as const;
const DECIDES = new Map(
  Object.values(APP_MANIFESTS).flatMap((m) =>
    m.events.map((e) => [e.key, e.decides === true] as const),
  ),
);

/** Bước hiện tại: quyết định đã có (task đóng có kết quả / phiếu "Cần: tất cả") + người đang giữ việc mở. MỘT câu. */
async function inspect(
  d: ProcessDeps,
  tenantId: string,
  runId: string,
): Promise<FlowRunStep | null> {
  const [r] = await withHubScope(d.db, SYS, (tx) =>
    tx.execute<{
      status: string;
      idx: number;
      decided_by: string | null;
      decided: boolean;
      claimers: string[] | null;
    }>(sql`
      select r.status, r.current_stage_idx as idx,
        (select t.decided_by from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
          where t.tenant_id = r.tenant_id and t.process_run_id = r.id and s.stage_idx = r.current_stage_idx
            and t.status <> 'open' and t.result is not null limit 1) as decided_by,
        exists (select 1 from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
          where t.tenant_id = r.tenant_id and t.process_run_id = r.id and s.stage_idx = r.current_stage_idx
            and ((t.status <> 'open' and t.result is not null)
              or exists (select 1 from hub.review_task_votes v where v.task_id = t.id and v.tenant_id = t.tenant_id))) as decided,
        (select array_agg(distinct t.claimed_by) from hub.review_tasks t
          where t.tenant_id = r.tenant_id and t.process_run_id = r.id and t.status = 'open' and t.claimed_by is not null) as claimers
      from hub.process_runs r where r.id = ${runId}::uuid and r.tenant_id = ${tenantId}::uuid`),
  );
  if (!r) return null;
  return {
    open: !["done", "cancelled", "failed", "expired", "rejected"].includes(r.status),
    decided: r.decided ? { by: r.decided_by, stageIdx: Number(r.idx) } : null,
    claimers: r.claimers ?? [],
  };
}

/** Báo người đã nhận việc: lượt bị Rút về (notice `task_released`, payload lý do) — một câu chèn theo lô + phát sau COMMIT. */
async function notifyWithdrawn(
  d: ProcessDeps,
  tenantId: string,
  runId: string,
  users: readonly string[],
) {
  if (users.length === 0) return;
  const events: OutboxEvent[] = [];
  await withHubScope(d.db, SYS, async (tx) => {
    const [h] = await tx.execute<{
      name: string | null;
    }>(sql`select snapshot->>'name' as name from hub.process_runs
      where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid`);
    await notifyMany(
      tx,
      { emit: (e) => void events.push(e) },
      "task_released",
      users.map((userId) => ({
        tenantId,
        userId,
        processRunId: runId,
        taskId: null,
        payload: { process_name: h?.name ?? "", reason: "withdrawn" },
        processName: h?.name ?? "",
        stageName: null,
      })) as never,
    );
  });
  for (const e of events)
    if (e.kind === "user_events") await publishUserEvents(d.redis, e.events as UserEvent[], d.log);
}

/** Quy trình SẼ chạy cho sự kiện (MỘT nguồn cho `hasFlowFor` và `outline`): flow đang bật khớp điều kiện, đã sắp theo `position`. */
async function runPlanOf(d: ProcessDeps, q: { tenantId: string; event: string; facts: unknown }) {
  const cands = await withHubScope(d.db, SYS, (tx) =>
    candidatesOf(tx, [{ tenant_id: q.tenantId, event: q.event } as ClaimedEvent]),
  );
  const mine = cands.filter((c) => c.tenantId === q.tenantId && c.event === q.event);
  return planEvent(mine, q.facts as never, DECIDES.get(q.event) ?? false).run;
}

export function flowEngineOf(d: ProcessDeps): FlowEngine {
  const ctl = new RunControlService(d);
  return {
    availability: {
      async hasFlowFor(_tx, q) {
        return (await runPlanOf(d, q)).length > 0;
      },
      // CR-127 · M4 · các bước sẽ đi qua (CÙNG `runPlanOf`); chưa có quy trình khớp ⇒ null.
      async outline(q, o) {
        return outlineOfRun(d.db, q, await runPlanOf(d, q), o.starterId);
      },
    },
    runControl: {
      inspect: (q) => inspect(d, q.tenantId, q.runId),
      async cancel(q) {
        const u = { userId: q.actorId, tenantId: q.tenantId, role: "tenant_admin" } as AuthUser;
        try {
          await ctl.stop(u, q.runId, "other");
        } catch (e) {
          d.log.warn("flow-run-cancel-failed", {
            error: e instanceof Error ? e.message.slice(0, 200) : "unknown",
          });
          return false;
        }
        await notifyWithdrawn(d, q.tenantId, q.runId, q.notify);
        return true;
      },
    },
  };
}
