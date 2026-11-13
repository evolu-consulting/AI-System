// [AUDIT] · «Ai làm gì đều phải có record»: việc trên task duyệt của run GẮN GÓI (nhận / trả / giao lại / tự trả quá giờ / chuyển cấp)
// ⇒ báo gói SAU COMMIT, theo lô: MỘT câu (scope system) tra run + khoá bước của các task, rồi MỘT lần gọi hook mỗi gói. Lỗi ⇒ cảnh báo
// (việc đã xong; lịch sử gói thiếu dòng — không chặn người dùng).
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import type { PackTaskEvent, PackTaskEventIn, ProcessDeps } from "../core/ports";

type Deps = Pick<ProcessDeps, "db" | "log" | "packTaskEvents">;

export async function emitPackTaskEvents(
  d: Deps,
  items: readonly PackTaskEventIn[],
): Promise<void> {
  if (items.length === 0 || !d.packTaskEvents) return;
  try {
    const rows = await withHubScope(d.db, { kind: "system" }, (tx) =>
      tx.execute<{ id: string; tenant_id: string; run: string; pack: string; stage: string }>(sql`
        select t.id::text as id, t.tenant_id::text as tenant_id, t.process_run_id::text as run, pr.pack_key as pack,
          coalesce(pr.snapshot -> 'stages' -> (s.stage_idx::int) ->> 'key', '') as stage
        from jsonb_to_recordset(${JSON.stringify(items.map((x) => ({ id: x.taskId, t: x.tenantId })))}::jsonb)
          as x(id uuid, t uuid)
        join hub.review_tasks t on t.id = x.id and t.tenant_id = x.t
        join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
        join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
        where pr.pack_key is not null`),
    );
    const byTask = new Map([...rows].map((r) => [`${r.tenant_id}:${r.id}`, r]));
    const byPack = new Map<string, PackTaskEvent[]>();
    for (const x of items) {
      const r = byTask.get(`${x.tenantId}:${x.taskId}`);
      if (!r) continue;
      const e = { ...x, runId: r.run, stageKey: r.stage, key: `${x.taskId}:${x.kind}:${x.at}` };
      byPack.set(r.pack, [...(byPack.get(r.pack) ?? []), e]);
    }
    for (const [pack, list] of byPack) await d.packTaskEvents(pack, list);
  } catch (err) {
    d.log.warn("process-pack-task-events-failed", { n: items.length, ...safeErrorFields(err) });
  }
}
