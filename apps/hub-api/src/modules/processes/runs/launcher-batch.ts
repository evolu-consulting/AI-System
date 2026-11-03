// CR-115 · HUB-FR-105 · HUB-FR-143/144 · D10 · `StageLauncher.kickMany`: kick theo lô cho vòng hẹn giờ `retry` (Luật 4c).
// MỘT lần poll cấu hình + MỘT tx cho cả lô: đọc đầu mọi run một câu (`= any`), rồi mỗi run (sắp theo id ⇒ thứ tự khoá run
// nhất quán giữa các Hub) đặt scope `user` người bắt đầu + SAVEPOINT chạy đúng `plan` của `kick` (khoá run → kiểm quyền →
// tạo `hub.runs` → stage running). Run lỗi ⇒ ROLLBACK savepoint của nó, các run khác vẫn COMMIT; run lỗi + run còn
// `more` ⇒ `kick` từng run SAU COMMIT (đường cũ, idempotent). Sau COMMIT: sự kiện một pipeline, rồi `launch` từng stage.
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
import { launchAfterCommit, plan } from "./launcher";
import type { Head } from "./launcher-prompt";

type Planned = { runId: string; r: KickResult } | { runId: string; error: unknown };

/** Đầu run của cả lô, một câu (scope system). */
async function headsOf(tx: Tx, ids: readonly string[]): Promise<Map<string, Head>> {
  const rows = await tx.execute<Head & { id: string }>(sql`select id, tenant_id, started_by, status,
    current_stage_idx, conversation_id, input, snapshot, pinned_sources, inputs from hub.process_runs
    where id = any(${`{${ids.join(",")}}`}::uuid[])`);
  return new Map([...rows].map((r) => [r.id, r] as const));
}

/** Trong tx của lô: mỗi run một SAVEPOINT dưới scope `user` người bắt đầu (cùng `plan` của `kick`). */
async function planAll(d: LauncherDeps, tx: Tx, ids: readonly string[]): Promise<Planned[]> {
  const heads = await headsOf(tx, ids);
  const out: Planned[] = [];
  for (const runId of ids) {
    const h = heads.get(runId);
    if (!h || isTerminal(h.status as ProcessRunStatus)) continue;
    const u: AuthUser = { userId: h.started_by, tenantId: h.tenant_id, role: "member" };
    try {
      out.push({ runId, r: await tx.transaction((sp) => planAs(d, sp, u, runId)) });
    } catch (error) {
      out.push({ runId, error });
    }
  }
  return out;
}

/**
 * Trong SAVEPOINT: đặt scope `user` (set_config cục bộ tx, ROLLBACK savepoint thì hoàn lại) rồi `plan` — câu scope gửi liền
 * với các câu đầu của `plan` (pipeline, cùng kết nối ⇒ chạy trước chúng): bớt một round-trip mỗi run.
 */
async function planAs(d: LauncherDeps, sp: Tx, u: AuthUser, runId: string): Promise<KickResult> {
  BATCH_TXS.add(sp);
  const scope = setHubScope(sp, { kind: "user", tenantId: u.tenantId, userId: u.userId });
  scope.catch(() => {});
  const r = plan(d, sp, u, runId);
  r.catch(() => {});
  await scope;
  return r;
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
  let planned: Planned[];
  try {
    planned = await withHubScope(d.db, { kind: "system" }, (tx) => planAll(d, tx, ids));
  } catch (error) {
    // Cả tx lô hỏng (không phải lỗi một savepoint) ⇒ không mất kick: mọi run theo đường từng run.
    planned = ids.map((runId) => ({ runId, error }));
  }
  const events = planned.flatMap((p) => ("r" in p && p.r.kind === "events" ? p.r.events : []));
  if (events.length > 0) await publishUserEvents(d.redis, events, d.log);
  for (const p of planned) await afterCommit(d, self, p, kickOne);
}

/** Một run sau COMMIT của lô: thread / launch; lỗi savepoint hoặc còn stage `queued` ⇒ `kick` từng run (đường cũ). */
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
    if (r.kind === "events") await d.postThread(p.runId).catch(() => {});
    else if (r.kind === "launch") {
      if (!(await launchAfterCommit(d, self, r))) return;
    } else return;
    if (r.more === true) await kickOne(p.runId);
  } catch (err) {
    d.log.warn("process-kick-failed", { run_id: p.runId, ...safeErrorFields(err) });
  }
}
