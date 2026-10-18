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
  TxRepos,
  UnitOfWork,
} from "../application/ports";
import type { ProcessNotifier } from "../core/ports";
import { claimDueReminders, writeNotices } from "../notify/batch.repo";
import { createNotifier } from "../notify/notifier";
import { claimExpired, insertRunEnds } from "../runs/expire";
import { runRepo } from "./runs/run.repo";
import { timerRepo } from "./timers/timers.repo";

export type HubUowDeps = {
  /** Q4 (chữ ký khoá): repo nhận `now` từ use case, UoW không tự đọc giờ. */
  clock: Clock;
  /** Phát sự kiện SAU COMMIT (mount: `makeOutboxPublisher`). Lỗi phát không rollback (đã COMMIT). */
  publish: (events: readonly OutboxEvent[]) => Promise<void>;
  /** Vắng ⇒ `createNotifier()` (notice `run_finished` theo lô). */
  notifier?: Pick<ProcessNotifier, "runsFinished">;
};

function collector(): { outbox: Outbox; events: OutboxEvent[] } {
  const events: OutboxEvent[] = [];
  return { outbox: { emit: (e) => void events.push(e) }, events };
}

function txRepos(tx: Tx, tenantId: string, outbox: Outbox): TxRepos {
  return {
    tenantId,
    runs: runRepo(tx, tenantId),
    timers: timerRepo(tx, tenantId),
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
    tenant: (who, fn) =>
      run(
        { kind: "user", tenantId: who.tenantId, userId: who.userId },
        (tx, o) => txRepos(tx, who.tenantId, o),
        fn,
      ),
    system: (tenantId, fn) => run({ kind: "system" }, (tx, o) => txRepos(tx, tenantId, o), fn),
    systemBatch: (fn) => run({ kind: "system" }, (tx, o) => batchRepos(tx, o, deps.notifier), fn),
  };
}
