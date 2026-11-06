// CR-122 · E1 · ADR-0038 · FLOW2-FR-03/19/20 · bộ điều phối sự kiện → lượt chạy. Một lượt (`dispatchOnce`):
//   tx1 (system): nhận lô SKIP LOCKED + giữ chỗ, flow ứng viên, cờ FLOW_TRIGGERS — 3 câu; kế hoạch thuần (`planEvent`);
//   mở lượt cho flow khớp qua `launch` (engine hiện có, mỗi lượt tx riêng; trùng (sự kiện × flow) ⇒ `duplicate`, idempotent);
//   tx2 (system): chốt lô 1 câu (xong / thử lại có lùi / hết lượt thử ⇒ lỗi). Cờ tắt ⇒ bóng: chỉ ghi `would_run`.
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import {
  type CandidateRow,
  type ClaimedEvent,
  candidatesOf,
  claimEvents,
  closeExhausted,
  type EventFinish,
  finishEvents,
} from "./dispatcher.repo";
import { flowTriggerTenants } from "./flags";
import { type EventPlan, FLOW_EVENT_ATTEMPTS_MAX, planEvent, retryDelayMs } from "./match.rules";
import {
  NL_START_FAILED,
  type NotLaunched,
  notifyNotLaunched,
  notLaunchedReason,
} from "./not-launched";

export type LaunchResult = { runId: string } | "duplicate";
/** Lỗi KHÔNG thử lại (cấu hình: flow Thư viện chưa có bản công ty, người gây sự kiện không được chạy…) — ghi `refused`. */
export class FlowLaunchRefused extends Error {}
/** Mở lượt cho MỘT flow khớp (adapter: `flow-launch.ts`). Ném ⇒ sự kiện thử lại. */
export type FlowLaunch = (e: ClaimedEvent, c: CandidateRow, app: string) => Promise<LaunchResult>;

export type DispatcherDeps = {
  db: Db;
  launch: FlowLaunch;
  now?: () => Date;
  batch?: number;
  leaseMs?: number;
};
export type DispatchStats = { claimed: number; launched: number; failed: number };

const SYS = { kind: "system" as const };

/** Sự kiện → app + `decides` theo manifest (một nguồn: `AppManifest.events`). */
const EVENT_INFO = new Map(
  Object.values(APP_MANIFESTS).flatMap((m) =>
    m.events.map((e) => [e.key, { app: m.key, decides: e.decides }] as const),
  ),
);

/** CR-122 · P11 · lỗi SQL bọc (drizzle "Failed query") ⇒ kèm nguyên nhân gốc để `flow_events.error` chẩn đoán được. */
function errText(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return cause ? `${cause} · ${base}` : base;
}

async function runPlan(
  d: DispatcherDeps,
  e: ClaimedEvent,
  app: string,
  plan: EventPlan<CandidateRow>,
) {
  const ran: { companyFlowId: string; runId: string | null }[] = [];
  const refused: { companyFlowId: string; reason: string }[] = [];
  const errors: string[] = [];
  for (const c of plan.run) {
    try {
      const r = await d.launch(e, c, app);
      ran.push({ companyFlowId: c.companyFlowId, runId: r === "duplicate" ? null : r.runId });
    } catch (err) {
      const msg = errText(err);
      if (err instanceof FlowLaunchRefused)
        refused.push({ companyFlowId: c.companyFlowId, reason: msg });
      else errors.push(`${c.defKey}: ${msg}`);
    }
  }
  return { ran, refused, errors };
}

function finishOf(e: ClaimedEvent, now: Date, outcome: Record<string, unknown>, errors: string[]) {
  if (errors.length === 0) return { id: e.id, retryAt: null, error: null, outcome };
  const last = e.attempts >= FLOW_EVENT_ATTEMPTS_MAX;
  return {
    id: e.id,
    retryAt: last ? null : new Date(now.getTime() + retryDelayMs(e.attempts)),
    error: errors.join("; "),
    outcome,
  };
}

async function handle(
  d: DispatcherDeps,
  e: ClaimedEvent,
  cands: readonly CandidateRow[],
  on: boolean,
  now: Date,
): Promise<{ f: EventFinish; launched: number; nl: string | null }> {
  const info = EVENT_INFO.get(e.event);
  if (!info)
    return {
      f: { id: e.id, retryAt: null, error: "unknown_event", outcome: {} },
      launched: 0,
      nl: null,
    };
  const mine = cands.filter((c) => c.tenantId === e.tenant_id && c.event === e.event);
  const plan = planEvent(mine, e.facts, info.decides);
  const base = { skipped: plan.skipped, none: plan.run.length === 0 };
  if (!on) {
    const outcome = { ...base, shadow: true, would_run: plan.run.map((c) => c.companyFlowId) };
    return { f: { id: e.id, retryAt: null, error: null, outcome }, launched: 0, nl: null };
  }
  const planned = plan.run.length;
  if (!e.actor_id && planned > 0) {
    const outcome = { ...base, ran: [] };
    const nl = notLaunchedReason({ ...NONE, planned, noActor: true });
    return { f: { id: e.id, retryAt: null, error: "no_actor", outcome }, launched: 0, nl };
  }
  const { ran, refused, errors } = await runPlan(d, e, info.app, plan);
  const f = finishOf(e, now, { ...base, ran, refused }, errors);
  // CR-122 · P11b · chốt xong mà không có lượt ⇒ báo app (bản ghi không kẹt "đang mở quy trình").
  const nl = notLaunchedReason({
    planned,
    ran: ran.length,
    refused: refused.map((r) => r.reason),
    errors: errors.length,
    retrying: f.retryAt !== null,
    noActor: false,
  });
  return { f, launched: ran.length, nl };
}

const NONE = { planned: 0, ran: 0, refused: [], errors: 0, retrying: false, noActor: false };
const appOf = (event: string) => EVENT_INFO.get(event)?.app;

/** Một lượt điều phối; trả số liệu (test gọi trực tiếp, vòng nền lặp khi còn việc). */
export async function dispatchOnce(d: DispatcherDeps): Promise<DispatchStats> {
  const now = (d.now ?? (() => new Date()))();
  const { evs, cands, on } = await withHubScope(d.db, SYS, async (tx) => {
    const dead = await closeExhausted(tx, now); // soát E1 #1: hết 5 lượt mà Hub chết ⇒ không kẹt mãi
    await notifyNotLaunched(
      tx,
      appOf,
      dead.map((x) => ({
        tenantId: x.tenant_id,
        event: x.event,
        ref: x.ref,
        reason: NL_START_FAILED,
      })),
    );
    const evs = await claimEvents(tx, now, d.batch ?? 50, d.leaseMs ?? 120_000);
    if (evs.length === 0) return { evs, cands: [], on: new Set<string>() };
    const cands = await candidatesOf(tx, evs);
    const on = await flowTriggerTenants(tx, [...new Set(evs.map((e) => e.tenant_id))]);
    return { evs, cands, on };
  });
  if (evs.length === 0) return { claimed: 0, launched: 0, failed: 0 };
  const done: EventFinish[] = [];
  const nls: NotLaunched[] = [];
  let launched = 0;
  for (const e of evs) {
    const r = await handle(d, e, cands, on.has(e.tenant_id), now);
    done.push(r.f);
    launched += r.launched;
    if (r.nl) nls.push({ tenantId: e.tenant_id, event: e.event, ref: e.ref, reason: r.nl });
  }
  await withHubScope(d.db, SYS, async (tx) => {
    await finishEvents(tx, now, done);
    await notifyNotLaunched(tx, appOf, nls);
  });
  return { claimed: evs.length, launched, failed: done.filter((f) => f.error).length };
}

/** Vòng nền: chạy liền khi còn việc; hết việc mới nghỉ `idleMs` (Luật 4c). Lỗi một lượt ⇒ log, nghỉ rồi chạy tiếp. */
export function startFlowDispatcher(
  d: DispatcherDeps & { log?: { warn(msg: string, f?: Record<string, unknown>): void } },
  o: { signal?: AbortSignal; idleMs?: number } = {},
): void {
  const idle = o.idleMs ?? 2_000;
  const loop = async () => {
    while (!o.signal?.aborted) {
      let busy = false;
      try {
        busy = (await dispatchOnce(d)).claimed > 0;
      } catch (err) {
        d.log?.warn("flow-dispatcher-failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (!busy) await new Promise((r) => setTimeout(r, idle));
    }
  };
  void loop();
}
