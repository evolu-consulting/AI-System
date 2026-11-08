// CR-115 · HUB-FR-105 · HUB-FR-143/144 · D10 · `StageLauncher.kickMany`: kick theo lô cho vòng hẹn giờ `retry` (Luật 4c).
// MỘT lần poll cấu hình + MỘT tx cho cả lô: khoá + đọc đầu mọi run MỘT câu (`= any`, `FOR UPDATE SKIP LOCKED` — mọi khoá
// run lấy TRƯỚC mọi khoá hội thoại/stage, không chờ run nào ⇒ không chu trình với tx giữ run rồi cần hội thoại), rồi mỗi run
// đã khoá (sắp theo id) đặt scope `user` người bắt đầu (await, trước câu đầu của `plan`) + SAVEPOINT chạy đúng `plan` của
// `kick`. Run lỗi ⇒ ROLLBACK savepoint; run lỗi / bị bỏ qua (khoá đang bị giữ) / `skip` / còn `more` ⇒ `kick` từng run SAU
// COMMIT (đường cũ, idempotent). COMMIT xong mà client thấy lỗi ⇒ dò hub run đã tạo, có ⇒ coi như đã COMMIT (launch tiếp).
import type { ProcessRunStatus } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { setHubScope, withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../../lib/auth.middleware";
import { safeErrorFields } from "../../../lib/errors";
import { publishUserEvents } from "../../../lib/user-stream";
import type { StageLauncher } from "../core/ports";
import { isTerminal } from "../domain/runs/run-state.rules";
import { BATCH_TXS, type KickResult, type LauncherDeps } from "./launch-common";
import { launchAfterCommit, plan } from "./launcher-plan";
import type { Head } from "./launcher-prompt";

type Planned = { runId: string; r: KickResult } | { runId: string; error: unknown };
const SKIP: KickResult = { kind: "skip" };
const SYSTEM = { kind: "system" } as const;
const uuids = (ids: readonly string[]) => `{${ids.join(",")}}`;

/** Khoá + đầu run của cả lô, một câu (scope system). Run đang bị tx khác giữ ⇒ không có trong Map (đi `kick` lẻ sau). */
async function lockHeads(tx: Tx, ids: readonly string[]): Promise<Map<string, Head>> {
  const rows = await tx.execute<Head & { id: string }>(sql`select id, tenant_id, started_by, status,
    current_stage_idx, conversation_id, input, snapshot, pinned_sources, inputs from hub.process_runs
    where id = any(${uuids(ids)}::uuid[]) order by id for update skip locked`);
  return new Map([...rows].map((r) => [r.id, r] as const));
}

/** Trong tx của lô: mỗi run đã khoá một SAVEPOINT dưới scope `user` người bắt đầu (cùng `plan` của `kick`). */
async function planAll(d: LauncherDeps, tx: Tx, ids: readonly string[]): Promise<Planned[]> {
  const heads = await lockHeads(tx, ids);
  const out: Planned[] = [];
  for (const runId of ids) {
    const h = heads.get(runId);
    // Không khoá được (tx khác giữ) / không thấy ⇒ `skip` ⇒ `kick` lẻ sau COMMIT (chờ khoá NGOÀI tx lô).
    if (!h) out.push({ runId, r: SKIP });
    else if (isTerminal(h.status as ProcessRunStatus)) continue;
    else {
      const u: AuthUser = { userId: h.started_by, tenantId: h.tenant_id, role: "member" };
      try {
        out.push({ runId, r: await tx.transaction((sp) => planAs(d, sp, u, runId)) });
      } catch (error) {
        out.push({ runId, error });
      }
    }
  }
  return out;
}

/** Trong SAVEPOINT: đặt scope `user` (cục bộ tx; ROLLBACK savepoint thì hoàn lại) XONG rồi mới `plan` (TB2). */
async function planAs(d: LauncherDeps, sp: Tx, u: AuthUser, runId: string): Promise<KickResult> {
  BATCH_TXS.add(sp);
  await setHubScope(sp, { kind: "user", tenantId: u.tenantId, userId: u.userId });
  return plan(d, sp, u, runId);
}

export async function kickMany(
  d: LauncherDeps,
  self: StageLauncher,
  runIds: readonly string[],
  kickOne: (runId: string) => Promise<void>,
): Promise<void> {
  const ids = [...new Set(runIds)].sort();
  if (ids.length < 2) {
    for (const id of ids) await kickOne(id);
    return;
  }
  // P-R10 · cấu hình mới nhất đã COMMIT — một lần cho cả lô (như `kickOnce`, lỗi poll không chặn).
  await d.config.poll().catch(() => {});
  let last: Planned[] | null = null;
  let planned: Planned[];
  try {
    planned = await withHubScope(d.db, SYSTEM, async (tx) => {
      last = null;
      const p = await planAll(d, tx, ids);
      last = p;
      return p;
    });
  } catch (error) {
    planned = await recover(d, last, ids, error);
  }
  const events = planned.flatMap((p) => ("r" in p && p.r.kind === "events" ? p.r.events : []));
  if (events.length > 0) await publishUserEvents(d.redis, events, d.log);
  for (const p of planned) await afterCommit(d, self, p, kickOne);
}

/**
 * Cả tx lô ném. Lỗi có thể tới SAU COMMIT (mất kết nối lúc trả lời COMMIT — Thấp3): `kick` lẻ khi đó thấy stage đã có hub
 * run ⇒ không bao giờ `launch`. Dò hub run của các hàng `launch` (scope system): thấy ⇒ tx đã COMMIT ⇒ dùng kết quả lô.
 * Không thấy / không có hàng `launch` ⇒ chưa COMMIT ⇒ mọi run theo `kick` từng run (không mất kick).
 */
async function recover(
  d: LauncherDeps,
  last: Planned[] | null,
  ids: readonly string[],
  error: unknown,
): Promise<Planned[]> {
  const fallback = ids.map((runId) => ({ runId, error }));
  const runs = (last ?? []).flatMap((p) =>
    "r" in p && p.r.kind === "launch" ? [p.r.prepared.run.id] : [],
  );
  if (!last || runs.length === 0) return fallback;
  try {
    const found = await withHubScope(d.db, SYSTEM, (tx) =>
      tx.execute<{ id: string }>(
        sql`select id from hub.runs where id = any(${uuids(runs)}::uuid[]) limit 1`,
      ),
    );
    if ([...found].length === 0) return fallback;
    d.log.warn("process-kick-batch-commit-unconfirmed", {
      runs: ids.length,
      ...safeErrorFields(error),
    });
    return last;
  } catch {
    return fallback;
  }
}

/** Một run sau COMMIT của lô: thread / launch; lỗi savepoint, `skip` hoặc còn stage `queued` ⇒ `kick` từng run (đường cũ). */
async function afterCommit(
  d: LauncherDeps,
  self: StageLauncher,
  p: Planned,
  kickOne: (runId: string) => Promise<void>,
): Promise<void> {
  try {
    if ("error" in p) {
      d.log.warn("process-kick-batch-row-failed", { run_id: p.runId, ...safeErrorFields(p.error) });
      return await kickOne(p.runId);
    }
    const { r } = p;
    // TB2/TB3 · `skip` trong lô (run không khoá được, hay lý do bất ngờ) ⇒ không bỏ kick: đường từng run quyết lại.
    if (r.kind === "skip") return await kickOne(p.runId);
    if (r.kind === "events") {
      await d.postThread(p.runId).catch(() => {});
      for (const id of r.kicks ?? []) await self.kick(id); // CR-125 · lượt con vừa mở
    } else if (!(await launchAfterCommit(d, self, r))) return;
    if (r.more === true) await kickOne(p.runId);
  } catch (err) {
    d.log.warn("process-kick-failed", { run_id: p.runId, ...safeErrorFields(err) });
  }
}
