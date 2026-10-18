// HUB-FR-115 · BR-26 · CR-093 · plan-addendum A10/A11 · run hết hạn (`expires_at ≤ now`) THEO TẬP: mỗi lô 100 run trong
// MỘT tx `system` = 3 câu SQL cố định (khoá + đặt `expired` + huỷ stage + đóng task + cờ còn hàng; tin thread
// `run_end`; notice `run_finished` + unread) — không mở tx/khoá/truy vấn từng run. `FOR UPDATE SKIP LOCKED`: run đang bị tx khác khoá (đang
// duyệt…) để lượt sau. Tin thread KHÔNG đăng trong vòng — `thread-poster` (`THREAD_RECONCILE_MS`) đăng. Sự kiện phát
// SAU COMMIT, một pipeline Redis mỗi lô. Không tự duyệt task.
import { PROCESS_RUN_ACTIVE, RoomProcessPartSchema } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { publishUserEvents } from "../../../lib/user-stream";
import type { FinishedRun, ProcessDeps } from "../core/ports";
import { THREAD_LOCALE } from "../core/thread";
import { threadContent } from "../core/thread.rules";

const EXPIRE_BATCH = 100;
/** Một lượt `sweepOnce` xả hết hạn tối đa chừng này rồi nhường các vòng khác của lượt. */
const DRAIN_BUDGET_MS = 5_000;
const STAGE_OPEN = [
  "pending",
  "queued",
  "running",
  "waiting_review",
  "waiting_answer",
  "needs_decision",
  "waiting_timer",
];

const textArray = (xs: readonly string[]): string => `{${xs.map((x) => `"${x}"`).join(",")}}`;

type Claimed = FinishedRun & { originKind: string; roomId: string | null };

/** Một lượt hết hạn: lặp lô tới khi hết run quá hạn (cờ `more`), lô < 100 hoặc hết ngân sách; trả tổng run `expired`. */
export async function expireRuns(d: ProcessDeps): Promise<number> {
  const t0 = performance.now();
  let total = 0;
  for (;;) {
    const { n, more } = await expireBatch(d, EXPIRE_BATCH);
    total += n;
    if (!more || n < EXPIRE_BATCH || performance.now() - t0 >= DRAIN_BUDGET_MS) return total;
  }
}

async function expireBatch(d: ProcessDeps, limit: number): Promise<{ n: number; more: boolean }> {
  const now = d.now();
  const out = await withHubScope(d.db, { kind: "system" }, async (tx) => {
    const { runs, more } = await claimExpired(tx, now, limit);
    if (runs.length === 0) return { n: 0, more: false, events: [] };
    await insertRunEnds(tx, runs);
    return { n: runs.length, more, events: await d.notifier.runsFinished(tx, runs) };
  });
  await publishUserEvents(d.redis, out.events, d.log);
  return { n: out.n, more: out.more };
}

/**
 * MỘT câu (CTE ghi dữ liệu): khoá run active quá hạn (cũ trước), đặt `expired` + `finished_at`, huỷ stage còn mở, đóng task
 * mở (`expired`), trả hàng nguồn kèm `tenant_id`. Stage/task lọc theo `process_run_id = any(array(select id from r))`
 * (index `*_run_*`, không join theo thống kê — sau chèn hàng loạt thống kê cũ làm planner chọn nested loop 100 × N).
 * Tenant: FK kép `(process_run_id, tenant_id)` bảo đảm hàng con cùng tenant run nguồn, thêm `tenant_id` tường minh (K3 lô).
 */
async function claimExpired(
  tx: Tx,
  now: Date,
  limit: number,
): Promise<{ runs: Claimed[]; more: boolean }> {
  const at = now.toISOString();
  const rows = await tx.execute<{
    id: string;
    tenant_id: string;
    started_by: string;
    origin_kind: string;
    origin_room_id: string | null;
    name: string | null;
    more: boolean;
  }>(sql`
    with c as (
      select id, tenant_id from hub.process_runs
      where status = any(${textArray(PROCESS_RUN_ACTIVE)}::text[]) and expires_at <= ${at}::timestamptz
      order by expires_at asc, id asc
      limit ${limit}
      for update skip locked
    )
    , r as (
      update hub.process_runs r set status = 'expired', finished_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
      from c where r.id = c.id and r.tenant_id = c.tenant_id
      returning r.id, r.tenant_id, r.started_by, r.origin_kind, r.origin_room_id, r.snapshot->>'name' as name
    ), s as (
      update hub.stage_runs set status = 'cancelled', updated_at = ${at}::timestamptz
      where process_run_id = any(array(select id from r)) and tenant_id = any(array(select tenant_id from r))
        and status = any(${textArray(STAGE_OPEN)}::text[])
      returning 1
    ), t as (
      update hub.review_tasks set status = 'closed', result = 'expired', decided_at = ${at}::timestamptz
      where process_run_id = any(array(select id from r)) and tenant_id = any(array(select tenant_id from r))
        and status = 'open'
      returning 1
    )
    select r.*, exists (select 1 from hub.process_runs p
      where p.status = any(${textArray(PROCESS_RUN_ACTIVE)}::text[]) and p.expires_at <= ${at}::timestamptz
        and not exists (select 1 from c where c.id = p.id)) as more
    from r`);
  const runs = rows.map((r) => ({
    id: r.id,
    tenantId: r.tenant_id,
    startedBy: r.started_by,
    processName: r.name ?? "",
    originKind: r.origin_kind,
    roomId: r.origin_room_id,
  }));
  return { runs, more: rows[0]?.more === true };
}

/**
 * MỘT câu cố định (`jsonb_to_recordset`, văn bản SQL không đổi theo số hàng): sự kiện thread `run_end` cho run bắt đầu
 * từ phòng (như `enqueueThread`, không RETURNING). `created_at = clock_timestamp()` theo thứ tự lô (`ordinality`).
 */
async function insertRunEnds(tx: Tx, runs: readonly Claimed[]): Promise<void> {
  const rows = runs
    .filter((r) => r.originKind === "room" && r.roomId)
    .map((r) => {
      const meta = RoomProcessPartSchema.parse({
        kind: "run_end",
        process_run_id: r.id,
        status: "expired",
        actor: null,
      });
      return {
        id: crypto.randomUUID(),
        tenant_id: r.tenantId,
        process_run_id: r.id,
        room_id: r.roomId,
        kind: meta.kind,
        meta,
        content: threadContent(meta, THREAD_LOCALE, { process: r.processName }),
      };
    });
  if (rows.length === 0) return;
  await tx.execute(sql`
    insert into hub.process_thread_events
      (id, tenant_id, process_run_id, room_id, kind, placement, meta, content, created_at)
    select (e.v->>'id')::uuid, (e.v->>'tenant_id')::uuid, (e.v->>'process_run_id')::uuid, (e.v->>'room_id')::uuid,
      e.v->>'kind', 'flow', e.v->'meta', e.v->>'content', clock_timestamp()
    from jsonb_array_elements(${JSON.stringify(rows)}::jsonb) with ordinality as e(v, ord)
    order by e.ord`);
}
