// HD7-FR-03…08 · HD7-FR-10 · HD7 plan §2 · D7-15…D7-19: lệnh và đọc của sổ thanh toán — port `routes/obligations.py`,
// `routes/partner_events.py`, `ledger/obligations.py`. Mỗi lệnh MỘT tx `PackUow`: khoá HĐ → khoá + đọc lại đợt → luật thuần → MỘT
// câu ghi (CTE: đợt + sổ + nhật ký HĐ). "Hôm nay" = ngày lịch múi tenant (HD4 `localDate`).

import type { PackUow, PackWho } from "../../kit/application/ports";
import { daysLate, roleOf, settledType, undoOf } from "../domain/ledger.rules";
import {
  MANUAL_EVENT_TYPES,
  type PartnerEventCreate,
  type ScheduleRequest,
} from "../domain/ledger.types";
import { localDate } from "../domain/local-time.rules";
import type { Fault } from "../domain/milestones.rules";
import { isSevere } from "../domain/scoring-agg.rules";
import { confirmDelivery } from "./delivery.usecase";
import {
  type EventHead,
  LedgerFail,
  type LedgerRepos,
  type LockedObligation,
} from "./ledger.ports";

type Deps = {
  uow: PackUow<LedgerRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  /** MS-impact: delta uy tín (trước → sau, engine hiện hành) tính NGAY trước tx xác nhận, lưu trên dòng sổ; vắng ⇒ không lưu. */
  repDelta?: (
    who: PackWho,
    id: string,
    at: string,
    fault: Fault | null | undefined,
  ) => Promise<unknown>;
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

/** U2 · R39: ghi/gỡ cờ đỏ phải nêu lý do (ghi tay: người có quyền `write`; gỡ: chỉ `admin`). */
function needReason(text: string | null | undefined, kind: "severe_reason"): void {
  if (!(text ?? "").trim()) throw new LedgerFail(kind);
}

/** `partner_events.create` + `events.record`: loại ghi tay; chỉnh tay chỉ quản lý, delta nguyên ≠ 0 trong ±10, có lý do. */
function checkManual(b: PartnerEventCreate, isAdmin: boolean): void {
  if (!(MANUAL_EVENT_TYPES as readonly string[]).includes(b.type))
    throw new LedgerFail("event_type");
  if (isSevere(b.type)) {
    needReason(b.note, "severe_reason");
    return;
  }
  if (b.type !== "manual_adjust") return;
  if (!isAdmin) throw new LedgerFail("forbidden");
  const delta = b.delta ?? 0;
  if (delta === 0 || Math.abs(delta) > 10 || !(b.note ?? "").trim()) throw new LedgerFail("adjust");
}

const todayOf = (d: Deps) => async (who: PackWho) =>
  localDate(d.now(), await d.timeZoneOf(who.tenantId));

type SettleIn = { at?: string | null; amount?: number | null; fault?: Fault | null };

/** Đã trả/thu một đợt. */
async function settleOne(d: Deps, who: PackWho, id: string, b: SettleIn) {
  const at = b.at ?? (await todayOf(d)(who));
  // Luật 4c: tính delta (các tx chỉ đọc, thấy đợt còn mở vì tx này chưa commit) CHỒNG với khoá + kho; chờ ngay trước câu ghi.
  const impactP = d.repDelta ? d.repDelta(who, id, at, b.fault) : Promise.resolve(null);
  return d.uow.tenant(who, async ({ ledger: r, delivery, notify }) => {
    const ob = await openObligation(r, id);
    const late = daysLate(at, ob.due_date);
    // V2-D · HD-05: mốc giao ⇒ SL đã giao + kho (cùng tx, sau khoá HĐ → mốc); lỗi ⇒ huỷ cả tx, mốc giữ mở.
    const dv = ob.kind === "delivery" ? await confirmDelivery(delivery, id, at) : null;
    const out = await r.settle({
      id,
      at,
      by: who.userId,
      type: settledType(ob.kind, ob.direction),
      role: roleOf(ob.direction),
      late,
      amount: b.amount ?? ob.amount,
      // V2-A · BA §2: chỉ mốc trễ mới có "lỗi do ai"; không chọn ⇒ chưa rõ.
      fault: late > 0 ? (b.fault ?? "unknown") : null,
      delivered: dv?.rows ?? [],
      impact: await impactP,
    });
    if (dv?.notice) await notify.enqueue([dv.notice]);
    return dv?.outcome ? { ...out, delivery: dv.outcome } : out;
  });
}

/** Lệnh trên một đợt: đã trả/thu, hẹn lại, nhắc. */
function obligationCommands(d: Deps) {
  const today = todayOf(d);
  const settle = (who: PackWho, id: string, b: SettleIn) => settleOne(d, who, id, b);

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
  return { settle, postpone, remind };
}

/** Khoá HĐ → đợt của sự kiện rồi tính hoàn tác. V2-D: mở lại mốc giao đã ghi SL/kho ⇒ chặn (đảo kho + BQ khi xoá HĐ — V2-M). */
async function undoPatch(r: Repo, e: EventHead) {
  if (!e.obligation_id || !(await r.lockContractOf(e.obligation_id))) return null;
  const ob = await r.lockObligation(e.obligation_id);
  const patch = ob ? undoOf(e, ob) : null;
  if (e.locked && patch && "reopen" in patch) throw new LedgerFail("locked");
  return patch;
}

/** Lệnh trên sổ đối tác: huỷ dòng, ghi tay. */
function eventCommands(d: Deps) {
  const today = todayOf(d);
  /** `partner_events.void` + `obligations.undo`: dòng hệ thống không huỷ; huỷ song song ⇒ chỉ một lần hoàn tác (D7-16). */
  const voidEvent = (who: PackWho, id: string, reason: string | null = null, isAdmin = false) =>
    d.uow.tenant(who, async ({ ledger: r }) => {
      const e = await r.eventHead(id);
      if (!e) throw new LedgerFail("not_found");
      if (e.source === "system") throw new LedgerFail("system");
      // U2 · R39: gỡ cờ đỏ = huỷ dòng nghiêm trọng — chỉ quản lý (`admin`), có lý do; vết ở `partner_event_voids` + nhật ký.
      if (isSevere(e.type) && !isAdmin) throw new LedgerFail("flag_admin");
      if (isSevere(e.type)) needReason(reason, "severe_reason");
      const patch = await undoPatch(r, e);
      return r.voidEvent({ id, by: who.userId, obligationId: e.obligation_id, patch, reason });
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

  return { voidEvent, record };
}

export function ledgerCommands(d: Deps) {
  const schedule = (who: PackWho, contractId: string, rows: ScheduleRequest["rows"]) =>
    d.uow.tenant(who, async ({ ledger: r }) => {
      if (!(await r.lockContract(contractId))) throw new LedgerFail("not_found");
      return r.replaceSchedule(contractId, rows, who.userId);
    });
  return { schedule, ...obligationCommands(d), ...eventCommands(d) };
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
