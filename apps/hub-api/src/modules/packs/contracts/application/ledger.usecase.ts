// HD7-FR-03…08 · HD7-FR-10 · HD7 plan §2 · D7-15…D7-19: lệnh và đọc của sổ thanh toán — port `routes/obligations.py`,
// `routes/partner_events.py`, `ledger/obligations.py`. Mỗi lệnh MỘT tx `PackUow`: khoá HĐ → khoá + đọc lại đợt → luật thuần → MỘT
// câu ghi (CTE: đợt + sổ + nhật ký HĐ). "Hôm nay" = ngày lịch múi tenant (HD4 `localDate`).
import type { PartnerEventCreate, ScheduleRequest } from "@ai/contracts";
import { MANUAL_EVENT_TYPES } from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { daysLate, roleOf, settledType, undoOf } from "../domain/ledger.rules";
import { localDate } from "../domain/local-time.rules";
import { LedgerFail, type LedgerRepos, type LockedObligation } from "./ledger.ports";

type Deps = {
  uow: PackUow<LedgerRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
};
type Repo = LedgerRepos["ledger"];

/** Khoá HĐ của đợt rồi khoá đợt (D7-15); đợt phải đang mở (mgmt `ValueError("done")` ⇒ 409). */
async function openObligation(r: Repo, id: string): Promise<LockedObligation> {
  if (!(await r.lockContractOf(id))) throw new LedgerFail("not_found");
  const ob = await r.lockObligation(id);
  if (!ob) throw new LedgerFail("not_found");
  if (ob.status !== "open") throw new LedgerFail("done");
  return ob;
}

/** `partner_events.create` + `events.record`: loại ghi tay; chỉnh tay chỉ quản lý, delta nguyên ≠ 0 trong ±10, có lý do. */
function checkManual(b: PartnerEventCreate, isAdmin: boolean): void {
  if (!(MANUAL_EVENT_TYPES as readonly string[]).includes(b.type))
    throw new LedgerFail("event_type");
  if (b.type !== "manual_adjust") return;
  if (!isAdmin) throw new LedgerFail("forbidden");
  const delta = b.delta ?? 0;
  if (delta === 0 || Math.abs(delta) > 10 || !(b.note ?? "").trim()) throw new LedgerFail("adjust");
}

export function ledgerCommands(d: Deps) {
  const today = async (who: PackWho) => localDate(d.now(), await d.timeZoneOf(who.tenantId));

  const schedule = (who: PackWho, contractId: string, rows: ScheduleRequest["rows"]) =>
    d.uow.tenant(who, async ({ ledger: r }) => {
      if (!(await r.lockContract(contractId))) throw new LedgerFail("not_found");
      return r.replaceSchedule(contractId, rows, who.userId);
    });

  const settle = async (
    who: PackWho,
    id: string,
    b: { at?: string | null; amount?: number | null },
  ) => {
    const at = b.at ?? (await today(who));
    return d.uow.tenant(who, async ({ ledger: r }) => {
      const ob = await openObligation(r, id);
      return r.settle({
        id,
        at,
        by: who.userId,
        type: settledType(ob.kind, ob.direction),
        role: roleOf(ob.direction),
        late: daysLate(at, ob.due_date),
        amount: b.amount ?? ob.amount,
      });
    });
  };

  const postpone = async (who: PackWho, id: string, b: { to: string; note?: string | null }) => {
    const day = await today(who);
    return d.uow.tenant(who, async ({ ledger: r }) => {
      const ob = await openObligation(r, id);
      if (b.to <= ob.due_date) throw new LedgerFail("postpone_date");
      return r.postpone({
        id,
        to: b.to,
        was: ob.due_date,
        today: day,
        by: who.userId,
        role: roleOf(ob.direction),
        note: b.note ? b.note : null,
      });
    });
  };

  const remind = async (who: PackWho, id: string) => {
    const day = await today(who);
    return d.uow.tenant(who, async ({ ledger: r }) => {
      const ob = await openObligation(r, id);
      return r.remind({ id, today: day, by: who.userId, role: roleOf(ob.direction) });
    });
  };

  /** `partner_events.void` + `obligations.undo`: dòng hệ thống không huỷ; huỷ song song ⇒ chỉ một lần hoàn tác (D7-16). */
  const voidEvent = (who: PackWho, id: string) =>
    d.uow.tenant(who, async ({ ledger: r }) => {
      const e = await r.eventHead(id);
      if (!e) throw new LedgerFail("not_found");
      if (e.source === "system") throw new LedgerFail("system");
      let patch = null;
      if (e.obligation_id && (await r.lockContractOf(e.obligation_id))) {
        const ob = await r.lockObligation(e.obligation_id);
        if (ob) patch = undoOf(e, ob);
      }
      return r.voidEvent({ id, by: who.userId, obligationId: e.obligation_id, patch });
    });

  /** Ghi tay (`POST /partner-events`): loại ghi tay được; chỉnh tay ±10 có lý do, chỉ quản lý (`admin`). */
  const record = async (who: PackWho, b: PartnerEventCreate, isAdmin: boolean) => {
    checkManual(b, isAdmin);
    const at = b.at ?? (await today(who));
    const delta = b.type === "manual_adjust" ? b.delta : null;
    return d.uow.tenant(who, async ({ ledger: r }) => {
      const e = await r.insertManual({ ...b, delta, at, by: who.userId });
      if (!e) throw new LedgerFail("not_found");
      return e;
    });
  };

  return { schedule, settle, postpone, remind, voidEvent, record };
}
export type LedgerCommands = ReturnType<typeof ledgerCommands>;

export function ledgerReads(d: Deps) {
  return {
    payments: async (who: PackWho, filter: string) => {
      const day = localDate(d.now(), await d.timeZoneOf(who.tenantId));
      return d.uow.tenant(who, ({ ledger: r }) => r.payments(filter, day));
    },
    paymentsText: async (who: PackWho, filter: string) => {
      const day = localDate(d.now(), await d.timeZoneOf(who.tenantId));
      // Hai tx chỉ đọc song song (độ trễ = nửa chậm hơn); ghép chữ JSON: {stats,total} + rows.
      const [head, rows] = await Promise.all([
        d.uow.tenant(who, ({ ledger: r }) => r.paymentsHead(filter, day)),
        d.uow.tenant(who, ({ ledger: r }) => r.paymentsRows(filter, day)),
      ]);
      return `${head.slice(0, -1)}, "rows" : ${rows}}`;
    },
    obligations: (who: PackWho, q: Parameters<Repo["obligations"]>[0]) =>
      d.uow.tenant(who, ({ ledger: r }) => r.obligations(q)),
    events: (who: PackWho, party: string, role: string | null) =>
      d.uow.tenant(who, ({ ledger: r }) => r.events(party, role)),
    partner: (who: PackWho, contractId: string) =>
      d.uow.tenant(who, async ({ ledger: r }) => {
        const p = await r.contractPartner(contractId);
        if (!p) throw new LedgerFail("not_found");
        return p;
      }),
  };
}
export type LedgerReads = ReturnType<typeof ledgerReads>;
