// CR-127 · E6 · spec §5.5 (#64) · nối nguồn sự kiện THEO LỊCH của gói Hợp đồng: `ScheduledSource` (đăng ký `flowPortRegistry`) +
// `FactsReader` thật cho `contract.expiring`, `milestone.due`, `milestone.overdue` (thay bộ đọc rỗng của `flow-unsourced-events.mount.ts`,
// tự rời danh sách) + kết cục `done` của mốc (manifest: "Không đổi mốc"). Kết cục gia hạn/chấm dứt/để hết hạn của `contract.expiring` = K6 (`expiring-outcome.repo.ts`).
// Gọi từ `mountContractFlow` (trước `bindUnsourcedContractEvents`). Đăng ký lại ⇒ thay (vô hại).
import type { Db, Tx } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import {
  departmentsOfUsers,
  type FactsReader,
  type FlowFacts,
  flowPortRegistry,
  moduleRegistry,
  type OutcomeHandler,
  type ScheduledDue,
  type ScheduledSource,
  withPackRoleInTx,
} from "../kit/public";
import { registerContractDoneHook } from "./adapters/contract-state.repo";
import {
  applyExpiringOutcome,
  isExpiringOutcome,
  renewalDoneHook,
} from "./adapters/expiring-outcome.repo";
import {
  currentScheduleFacts,
  type DueRow,
  dueRows,
  EV_EXPIRING,
  EV_MILESTONE_DUE,
  MILESTONE_EVENTS,
  SCHEDULE_EVENTS,
} from "./adapters/schedule-source.repo";
import { CONTRACTS_PACK } from "./domain/contract-flow-events.rules";
import { localDate } from "./domain/local-time.rules";
import { milestoneConfirmBinding } from "./nodes/milestone-confirm/binding";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_GROUP = "contract_owner_group_id";
const asObj = (f: DueRow["facts"]): Record<string, unknown> =>
  (typeof f === "string" ? JSON.parse(f) : f) ?? {};

/** Nguồn lịch: MỘT câu gói mỗi trang (+ MỘT câu phòng của người phụ trách cho `milestone.due`). */
export function contractsScheduledSource(
  db: Db,
  timeZoneOf?: (tenantId: string) => Promise<string>,
  now: () => Date = () => new Date(),
): ScheduledSource {
  const depts = departmentsOfUsers(db);
  return {
    packKey: CONTRACTS_PACK,
    events: SCHEDULE_EVENTS,
    async dueRecords(q): Promise<ScheduledDue[]> {
      // CR-127 X4b: "hôm nay" = ngày lịch múi giờ công ty (không UTC) — cửa sổ 0..N ngày và `days_late` theo ngày của công ty.
      const today = timeZoneOf ? localDate(now(), await timeZoneOf(q.tenantId)) : q.today;
      const rows = await withPackScope(
        db,
        { packKey: CONTRACTS_PACK, tenantId: q.tenantId, userId: null },
        (tx) =>
          dueRows(tx, q.tenantId, q.event, {
            today,
            days: q.params.days,
            limit: q.limit,
            after: q.after,
          }),
      );
      const owners =
        q.event === EV_MILESTONE_DUE && rows.length > 0
          ? await depts(q.tenantId, rows.map((r) => r.owner ?? "").filter(Boolean))
          : new Map<string, string[]>();
      return rows.map((r) => {
        const facts = asObj(r.facts);
        const g = r.owner ? owners.get(r.owner) : undefined;
        if (g && g.length > 0) facts[OWNER_GROUP] = g;
        return { ref: r.ref, dueKey: r.due_key, actorId: r.actor, facts: facts as FlowFacts };
      });
    },
  };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Dữ kiện HIỆN TẠI của `events` (HĐ hoặc mốc; tự lọc tenant, chạy NGOÀI tx engine). */
export function scheduleFactsReader(
  db: Db,
  events: readonly string[],
  today: () => string = todayUtc,
  timeZoneOf?: (tenantId: string) => Promise<string>,
  now: () => Date = () => new Date(),
): FactsReader {
  const depts = departmentsOfUsers(db);
  const event = events[0] as string;
  return {
    packKey: CONTRACTS_PACK,
    events,
    async read(tenantId, ref, keys) {
      if (!UUID.test(ref)) return null;
      const day = timeZoneOf ? localDate(now(), await timeZoneOf(tenantId)) : today();
      const x = await withPackScope(db, { packKey: CONTRACTS_PACK, tenantId, userId: null }, (tx) =>
        currentScheduleFacts(tx, tenantId, event, ref, day),
      );
      if (!x) return null;
      const all: Record<string, unknown> = { ...x.facts };
      const owner = keys.includes(OWNER_GROUP) ? x.owner : null;
      const g = owner ? (await depts(tenantId, [owner])).get(owner) : undefined;
      if (g && g.length > 0) all[OWNER_GROUP] = g;
      return pick(all, keys);
    },
  };
}

const pick = (all: Record<string, unknown>, keys: readonly string[]): FlowFacts =>
  Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]])) as FlowFacts;

/** Kết cục `done` của mốc: không đổi gì (idempotent). */
export function milestoneOutcomeHandler(): OutcomeHandler<Tx> {
  return {
    packKey: CONTRACTS_PACK,
    events: MILESTONE_EVENTS,
    async apply(_tx, input) {
      if (input.outcome === "done") return "applied";
      throw new Error(`contracts outcome chưa hỗ trợ: ${input.event} · ${input.outcome}`);
    },
  };
}

/** Kết cục `contract.expiring` (K6): renew / terminate / let_expire — dưới role gói trong tx settle của engine. */
export function expiringOutcomeHandler(): OutcomeHandler<Tx> {
  return {
    packKey: CONTRACTS_PACK,
    events: [EV_EXPIRING],
    async apply(tx, i) {
      if (!isExpiringOutcome(i.outcome))
        throw new Error(`contracts outcome chưa hỗ trợ: ${i.event} · ${i.outcome}`);
      const outcome = i.outcome;
      return withPackRoleInTx(tx, CONTRACTS_PACK, i.tenantId, () =>
        applyExpiringOutcome(tx, i.tenantId, { ref: i.ref, actorId: i.actorId, outcome }),
      );
    },
  };
}

export function mountContractSchedules(
  db: Db,
  timeZoneOf?: (tenantId: string) => Promise<string>,
): void {
  flowPortRegistry.registerScheduledSource(contractsScheduledSource(db, timeZoneOf));
  moduleRegistry.bindEvent<Tx>({
    facts: scheduleFactsReader(db, [EV_EXPIRING], undefined, timeZoneOf),
    outcome: expiringOutcomeHandler(),
  });
  registerContractDoneHook(renewalDoneHook, "renewal"); // K6 · HĐ gia hạn vào DONE ⇒ HĐ cũ "Đã gia hạn"
  moduleRegistry.bindEvent<Tx>({
    facts: scheduleFactsReader(db, MILESTONE_EVENTS, undefined, timeZoneOf),
    outcome: milestoneOutcomeHandler(),
  });
  moduleRegistry.bindNode(milestoneConfirmBinding()); // CR-127 · E10 · node Xác nhận mốc (không tool)
}
