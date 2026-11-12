// CR-127 · E10 · spec §5.9 · BR-31 · việc nhóm «Xác nhận mốc» phía engine.
// (1) `openMilestoneTask`: stage chờ `milestone.confirmed` của run gói ⇒ mở `review_tasks kind='milestone'`, `subject_ref` = bản ghi của
//     run (`pack_record_id` = id mốc của lượt `milestone.due`). Giao (#60): phòng của người phụ trách (= `started_by` của lượt — nguồn E6
//     đặt người phụ trách, vắng thì người tạo HĐ) — nhiều phòng ⇒ phòng đầu tiên theo thứ tự thành viên (`added_at`, rồi id); không phòng
//     ⇒ đích danh. E10a · cấu hình node (Ai làm / Cần / Quá hạn chuyển cho / Nhắc — khối `after` kiểu Duyệt) thắng mặc định. Nhận việc / trả về / uỷ quyền / chuyển cấp dùng nguyên E2/E3 (cùng bảng, `need='one'`).
// (2) `taskSignalBatch`: xử lý `hub.task_signals` (gói chỉ ghi — #54) ở tx RIÊNG: lô `SKIP LOCKED` → mỗi tín hiệu khoá run → task,
//     `closeTask`, bắn sự kiện cho stage chờ (`signalEvent`), đánh `processed_at`. Idempotent: task đã đóng / không còn ⇒ chỉ đánh xử lý.
import type { Db, Tx } from "@ai/db";
import { setHubTenantInTx, withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { signalEvent } from "../application/timers/signal-event.usecase";
import * as core from "../core/core.repo";
import { approverSql, headOf } from "../core/head-gate.sql";
import {
  type MilestoneAfter,
  milestoneGroup,
  milestoneTarget,
  wantsHead,
} from "../domain/tasks/milestone-target.rules";
import { bindTx } from "./hub-uow";

export const MILESTONE_TASK_EVENT = "milestone.confirmed";
export const MILESTONE_TASK_CANCELLED_EVENT = "milestone.task_cancelled";
export const TASK_SIGNAL_BATCH = 50;

const rowsOf = <T>(r: unknown): T[] =>
  Array.isArray(r) ? (r as T[]) : (((r as { rows?: T[] }).rows ?? []) as T[]);

type OpenRow = {
  ref: string | null;
  owner: string;
  after: MilestoneAfter | string | null;
  cfg_group: string | null;
  approver: string | null;
  owner_group: string | null;
};

/** MỘT câu: bản ghi + người phụ trách của run, cấu hình node (snapshot stage), phòng/người cấu hình đã kiểm cùng tenant, phòng #60. */
async function openInputOf(tx: Tx, x: { tenantId: string; runId: string; stageRunId: string }) {
  const st = "pr.snapshot->'stages'->(s.stage_idx::int)";
  return rowsOf<OpenRow>(
    await tx.execute(sql`select pr.pack_record_id::text as ref, pr.started_by::text as owner, x.st->'after' as after,
      (select g.id::text from admin.groups g where g.tenant_id = pr.tenant_id
        and (g.id = nullif(x.st->'after'->>'group_id', '')::uuid or g.key = x.st->'after'->>'group_key')
        order by (g.id = nullif(x.st->'after'->>'group_id', '')::uuid) desc nulls last limit 1) as cfg_group,
      ${approverSql(st, "pr.tenant_id")}::text as approver,
      (select gm.group_id::text from admin.group_members gm where gm.tenant_id = pr.tenant_id
        and gm.user_id = pr.started_by order by gm.added_at, gm.group_id limit 1) as owner_group
    from hub.process_runs pr
    join hub.stage_runs s on s.id = ${x.stageRunId}::uuid and s.tenant_id = pr.tenant_id and s.process_run_id = pr.id
    cross join lateral (select ${sql.raw(st)} as st) x
    where pr.id = ${x.runId}::uuid and pr.tenant_id = ${x.tenantId}::uuid`),
  )[0];
}

/** E10a · đích giao theo cấu hình node (Ai làm / Cần); vắng cấu hình ⇒ mặc định #60. */
async function milestoneAssignee(tx: Tx, tenantId: string, r: OpenRow) {
  const after = (typeof r.after === "string" ? JSON.parse(r.after) : r.after) as MilestoneAfter;
  const c = {
    owner: r.owner,
    approver: r.approver,
    cfgGroup: r.cfg_group,
    ownerGroup: r.owner_group,
  };
  const head = wantsHead(after);
  const g = milestoneGroup(c);
  return milestoneTarget({
    ...c,
    wantsHead: head,
    head: head && g ? await headOf(tx, tenantId, g) : null,
  });
}

/** Mở việc Xác nhận mốc cho stage (gọi trong tx khoá run của launcher). Đã có việc mở của stage ⇒ không mở thêm.
 *  Nhắc / quá hạn chuyển cho chép từ cấu hình node lúc mở (`insertTask` → `reviewTimingOf`). */
export async function openMilestoneTask(
  tx: Tx,
  x: { tenantId: string; runId: string; stageRunId: string; now: Date },
): Promise<string | null> {
  const run = await openInputOf(tx, x);
  if (!run?.ref) return null;
  const open = rowsOf<{ id: string }>(
    await tx.execute(sql`select id from hub.review_tasks where tenant_id = ${x.tenantId}::uuid
      and stage_run_id = ${x.stageRunId}::uuid and kind = 'milestone' and status = 'open' limit 1`),
  )[0];
  if (open) return open.id;
  const who = await milestoneAssignee(tx, x.tenantId, run);
  return core.insertTask(tx, {
    tenantId: x.tenantId,
    runId: x.runId,
    stageRunId: x.stageRunId,
    kind: "milestone",
    subjectRef: run.ref,
    remindAt: new Date(x.now.getTime() + 86_400_000),
    ...who,
  });
}

type Signal = { id: string; tenant_id: string; subject_ref: string; result: "done" | "cancelled" };

/** Một tín hiệu (đã khoá hàng tín hiệu): khoá run → task, đóng, thả stage chờ, đánh xử lý. Trả số task đã đóng. */
async function applySignal(tx: Tx, s: Signal, now: Date): Promise<number> {
  const tasks = rowsOf<{ id: string; run_id: string }>(
    await tx.execute(sql`select id::text, process_run_id::text as run_id from hub.review_tasks
      where tenant_id = ${s.tenant_id}::uuid and kind = 'milestone' and subject_ref = ${s.subject_ref} and status = 'open'
      order by process_run_id, id`),
  );
  let closed = 0;
  for (const t of tasks) {
    const { repos } = bindTx(tx, s.tenant_id);
    // Thứ tự khoá run → task (cùng chiều nhận việc / quyết) — không khoá ngược.
    if (!(await core.lockRun(tx, s.tenant_id, t.run_id))) continue;
    if (!(await core.closeTask(tx, t.id, { result: "pass", at: now }))) continue;
    closed++;
    const event = s.result === "done" ? MILESTONE_TASK_EVENT : MILESTONE_TASK_CANCELLED_EVENT;
    await signalEvent(repos, { runId: t.run_id, event, now });
  }
  await tx.execute(sql`update hub.task_signals set processed_at = ${now.toISOString()}::timestamptz
    where id = ${s.id}::uuid`);
  return closed;
}

/** Một lô tín hiệu chưa xử lý (scope system). Trả `{ n: số tín hiệu, more }`. */
export async function taskSignalBatch(
  db: Db,
  now: Date,
  limit = TASK_SIGNAL_BATCH,
): Promise<{ n: number; more: boolean }> {
  return withHubScope(db, { kind: "system" }, async (tx) => {
    const sigs = rowsOf<Signal>(
      await tx.execute(sql`select id::text, tenant_id::text, subject_ref, result from hub.task_signals
        where processed_at is null order by created_at, id limit ${limit} for update skip locked`),
    );
    for (const s of sigs) {
      await setHubTenantInTx(tx, s.tenant_id);
      await applySignal(tx, s, now);
    }
    return { n: sigs.length, more: sigs.length >= limit };
  });
}
