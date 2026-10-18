// HUB-FR-143 · CA-R06/R07 · K1/K2 · spec-ca §4 · plan §3 · plan-addendum A7 Q4, A11: `UnitOfWork` trên `withHubScope`.
// `tenant` ⇒ scope user (RLS); `system(tenantId)` ⇒ scope system, repo gắn `tenantId` (mọi câu lọc `tenant_id`);
// `systemBatch` ⇒ scope system, repo lô — hàng mang `tenant_id` của hàng nguồn (chỉ vòng nền theo tập). Outbox: gom trong
// tx, mỗi lần chạy lại 40P01/40001 bắt đầu mảng rỗng; `publish` gọi SAU COMMIT, một lần, chỉ khi có sự kiện; fn ném ⇒ 0.
// Repo lô bọc nguyên SQL theo tập sẵn có (`notify/batch.repo.ts`, `runs/expire.ts`) — T9s/T10 chỉ dời file.
import type { Db, Tx } from "@ai/db";
import { type HubScope, withHubScope } from "@ai/db/hub-scope";
import type {
  BatchRepos,
  Clock,
  Outbox,
  OutboxEvent,
  SystemUow,
  TenantUow,
  TxRepos,
  UnitOfWork,
} from "../application/ports";
import type { ProcessNotifier } from "../core/ports";
import { DomainError } from "../domain/errors";
import { claimDueReminders, writeNotices } from "../notify/batch.repo";
import { createNotifier } from "../notify/notifier";
import { claimExpired, insertRunEnds } from "../runs/expire";
import { retryRepo } from "./runs/retry.repo";
import { runRepo } from "./runs/run.repo";
import { sideEffectProbe } from "./runs/side-effect.repo";
import { teamRunRepo } from "./runs/team-run.repo";
import { type RunFinishedNotifier, stageTimerRepo } from "./timers/stage-timer.repo";
import { timerRepo } from "./timers/timers.repo";

export type HubUowDeps = {
  /** Q4 (chữ ký khoá): repo nhận `now` từ use case, UoW không tự đọc giờ. */
  clock: Clock;
  /** Phát sự kiện SAU COMMIT (mount: `makeOutboxPublisher`). Lỗi phát không rollback (đã COMMIT). */
  publish: (events: readonly OutboxEvent[]) => Promise<void>;
  /** Vắng ⇒ `createNotifier()` (notice `run_finished` theo lô; một run khi bắn `wait_until` kết thúc run — T8b). */
  notifier?: Pick<ProcessNotifier, "runsFinished" | "runFinished">;
};

function collector(): { outbox: Outbox; events: OutboxEvent[] } {
  const events: OutboxEvent[] = [];
  return { outbox: { emit: (e) => void events.push(e) }, events };
}

function txRepos(
  tx: Tx,
  tenantId: string,
  outbox: Outbox,
  notifier: RunFinishedNotifier = createNotifier(),
): TxRepos {
  return {
    tenantId,
    runs: runRepo(tx, tenantId),
    timers: timerRepo(tx, tenantId),
    stageTimers: stageTimerRepo(tx, tenantId, outbox, notifier),
    retry: retryRepo(tx, tenantId),
    sideEffect: sideEffectProbe(tx, tenantId),
    team: teamRunRepo(tx, tenantId),
    outbox,
    kicker: { kick: (runId) => outbox.emit({ kind: "kick", runId }) },
    notifier: {
      postThread: (runId) => outbox.emit({ kind: "post_thread", runId }),
      userEvents: (events) => outbox.emit({ kind: "user_events", events }),
    },
  };
}

function batchRepos(tx: Tx, outbox: Outbox, notifier: HubUowDeps["notifier"]): BatchRepos {
  const n = notifier ?? createNotifier();
  return {
    reviewTasks: { claimDueReminders: (limit, now) => claimDueReminders(tx, now, limit) },
    notices: { insertMany: (kind, rows) => writeNotices(tx, kind, rows) },
    runs: { claimExpired: (limit, now) => claimExpired(tx, now, limit) },
    threads: { insertRunEnds: (runs) => insertRunEnds(tx, runs) },
    notifier: {
      runsFinished: async (runs) => {
        const events = await n.runsFinished(tx, runs);
        if (events.length > 0) outbox.emit({ kind: "user_events", events });
      },
    },
    outbox,
  };
}

/**
 * K2 · cho code cũ ĐANG ở trong tx của nó (launcher, stage-driver, gates): `tenantId` lấy từ hàng đã khoá, không từ input
 * người dùng; người gọi tự phát `events()` sau COMMIT của mình.
 */
export function bindTx(
  tx: Tx,
  tenantId: string,
): { repos: TxRepos; events(): readonly OutboxEvent[] } {
  const c = collector();
  return { repos: txRepos(tx, tenantId, c.outbox), events: () => [...c.events] };
}

export function createHubUow(db: Db, deps: HubUowDeps): UnitOfWork {
  async function run<R, T>(
    scope: HubScope,
    make: (tx: Tx, outbox: Outbox) => R,
    fn: (r: R) => Promise<T>,
  ): Promise<T> {
    let events: OutboxEvent[] = [];
    const out = await withHubScope(db, scope, (tx) => {
      const c = collector();
      events = c.events;
      return fn(make(tx, c.outbox));
    });
    if (events.length > 0) await deps.publish(events);
    return out;
  }
  return {
    tenant: async (who, fn) => {
      assertTenantId(who.tenantId);
      return run(
        { kind: "user", tenantId: who.tenantId, userId: who.userId },
        (tx, o) => txRepos(tx, who.tenantId, o, deps.notifier),
        fn,
      );
    },
    system: async (tenantId, fn) => {
      assertTenantId(tenantId);
      return run({ kind: "system" }, (tx, o) => txRepos(tx, tenantId, o, deps.notifier), fn);
    },
    systemBatch: (fn) => run({ kind: "system" }, (tx, o) => batchRepos(tx, o, deps.notifier), fn),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** T6c · tenant rỗng/sai dạng ⇒ lỗi domain TRƯỚC khi mở tx (không để Postgres ném 22P02 giữa tx). */
function assertTenantId(tenantId: unknown): void {
  if (typeof tenantId !== "string" || !UUID.test(tenantId)) throw new DomainError("TENANT_INVALID");
}

/** T6c · object riêng CHỈ có `tenant` (route/use case HTTP): ép kiểu cũng không tới được `system`/`systemBatch`. */
export function tenantOnly(u: UnitOfWork): TenantUow {
  return { tenant: u.tenant };
}

/** T6c · object riêng CHỈ có `system`/`systemBatch` (vòng nền + handles qua `ProcessBgDeps`). */
export function systemOnly(u: UnitOfWork): SystemUow {
  return { system: u.system, systemBatch: u.systemBatch };
}
