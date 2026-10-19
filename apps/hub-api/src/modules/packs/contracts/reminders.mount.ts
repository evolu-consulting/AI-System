// HD4-FR-03…06 · HD4-NFR-01 · D4-01 · D4-02 · plan §2–§3 (lớp 4 của gói): nối vòng nhắc hạn (role `contracts_job` tìm tenant +
// `PackSystemUow` role `contracts_rw` xử lý lô) và route ghi kết quả xử lý. Vòng nền chỉ khi `worker`: `drain` chạy tới hết việc rồi
// mới trả ⇒ `startLoop` chỉ "ngủ" giữa các lượt khi không còn HĐ tới hạn (due_at = `remind_at`, không poll từng HĐ).
import { TENANT_TZ_DEFAULT } from "@ai/contracts";
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import { startLoop } from "../../../lib/loop";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { handledRepo } from "./adapters/handled.repo";
import { handledRoutes } from "./adapters/handled.routes";
import { dueTenantFinder, reminderBatchRepo } from "./adapters/reminders.repo";
import { recordHandled } from "./application/record-handled.usecase";
import { createRemindDue } from "./application/remind-due.usecase";

const KEY = "contracts";
export const REMIND_BATCH = 100;
const DEFAULT_EVERY_MS = 60_000;

export type ContractRemindersDeps = {
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
  batchSize?: number;
};
export type ContractReminders = ReturnType<typeof createRemindDue>;

/** Review m3: múi tenant không hợp lệ (Intl ném RangeError ⇒ lô của tenant đó hỏng mãi) ⇒ mặc định + warn (chỉ tenantId). */
export function safeTimeZone(
  timeZoneOf: (tenantId: string) => Promise<string>,
): (tenantId: string) => Promise<string> {
  return async (tid) => {
    const tz = await timeZoneOf(tid);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    } catch {
      logger.warn("contracts-remind-tz-invalid", { tenantId: tid });
      return TENANT_TZ_DEFAULT;
    }
  };
}

export function createContractReminders(db: Db, d: ContractRemindersDeps): ContractReminders {
  const uow = createPackUow(db, KEY, (tx, tid) => ({ reminders: reminderBatchRepo(tx, tid) }));
  return createRemindDue({
    finder: dueTenantFinder(db, KEY),
    uow: { system: (tid, fn) => uow.system(tid, fn) },
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now: d.now ?? (() => new Date()),
    batchSize: d.batchSize ?? REMIND_BATCH,
    log: logger,
  });
}

/** Seam `PacksDeps.contractsRemind`: `worker` ⇒ dựng vòng nền (server); test gọi `createContractReminders` trực tiếp. */
export type ContractsRemindDeps = { worker?: boolean; everyMs?: number };

export function contractsRemindModule(
  db: Db,
  view: PackAccessView,
  d: ContractRemindersDeps & ContractsRemindDeps & { signal?: AbortSignal },
): Hono<PackGuardVars> {
  if (d.worker) {
    const r = createContractReminders(db, d);
    startLoop({
      name: "contracts-remind",
      everyMs: d.everyMs ?? DEFAULT_EVERY_MS,
      tick: () => r.drain(),
      log: logger,
      ...(d.signal ? { signal: d.signal } : {}),
    });
  }
  const uow = packTenantOnly(
    createPackUow(db, KEY, (tx, tid) => ({ handled: handledRepo(tx, tid) })),
  );
  return handledRoutes(view, {
    record: recordHandled({
      uow,
      timeZoneOf: safeTimeZone(d.timeZoneOf),
      now: d.now ?? (() => new Date()),
    }),
  });
}
