// HD7-FR-03…08 · HD7-FR-10 · HD7 plan §2 · D7-15…D7-19: lệnh và đọc của sổ thanh toán — port `routes/obligations.py`,
// `routes/partner_events.py`, `ledger/obligations.py`. Mỗi lệnh MỘT tx `PackUow`: khoá HĐ → khoá + đọc lại đợt → luật thuần → MỘT
// câu ghi (CTE: đợt + sổ + nhật ký HĐ). "Hôm nay" = ngày lịch múi tenant (HD4 `localDate`).

import type { PackUow, PackWho } from "../../kit/public";
import { qtyOf } from "../domain/delivery.rules";
import {
  blockedByHold,
  daysLate,
  fulfillMoney,
  roleOf,
  settledType,
  undoOf,
} from "../domain/ledger.rules";
import {
  MANUAL_EVENT_TYPES,
  type PartnerEventCreate,
  type ScheduleRequest,
} from "../domain/ledger.types";
import { localDate } from "../domain/local-time.rules";
import { claimVerdict } from "../domain/milestone-claim.rules";
import type { Fault } from "../domain/milestones.rules";
import { isSevere } from "../domain/scoring-agg.rules";
import { confirmDelivery } from "./delivery.usecase";
import {
  type ChildWrite,
  type EventHead,
  type EvidenceWrite,
  LedgerFail,
  type LedgerRepos,
  type LockedContract,
  type LockedObligation,
} from "./ledger.ports";

type Deps = {
  uow: PackUow<LedgerRepos>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  /** CR-127 X5: người ghi có quyền `admin` của gói (quản trị công ty) — chỉ tra khi mốc có việc đã nhận và người ghi không phải owner. */
  isAdmin?: (who: PackWho) => Promise<boolean>;
  /**
   * MS-impact: delta uy tín (trước → sau) tính TRONG tx xác nhận (cùng kết nối, sau khoá đợt, trước câu ghi), lưu trên dòng sổ; trả
   * null ⇒ không lưu (vd cờ `hd8`); vắng ⇒ không lưu.
   */
  repDelta?: (
    who: PackWho,
    repos: LedgerRepos,
    q: { head: LockedObligation; at: string; fault: Fault | null },
  ) => Promise<unknown>;
};
type Repo = LedgerRepos["ledger"];

/** Khoá HĐ của đợt rồi khoá đợt (D7-15); đợt phải đang mở (mgmt `ValueError("done")` ⇒ 409). */
async function openObligation(r: Repo, id: string): Promise<LockedObligation> {
  return (await openLocked(r, id)).ob;
}
/** Như `openObligation` + trạng thái tạm khoá của HĐ (CR-127 X1 — đọc trong câu khoá HĐ). */
async function openLocked(
  r: Repo,
  id: string,
): Promise<{ c: LockedContract; ob: LockedObligation }> {
  const c = await r.lockContractOf(id);
  if (!c) throw new LedgerFail("not_found");
  const ob = await r.lockObligation(id);
  if (!ob) throw new LedgerFail("not_found");
  if (ob.status !== "open") throw new LedgerFail("done");
  return { c, ob };
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
/** CR-127 X1 · spec §4.1: thân `fulfill` (SL dạng chuỗi/số; bằng chứng bắt buộc ở zod). */
export type FulfillIn = SettleIn & {
  qty_items?: { contract_item_id: string; qty: string | number }[] | null;
  remainder?: "keep" | { split: { due_date: string; title?: string } } | null;
  evidence?: EvidenceWrite | null;
};

/** Luật chặn trong tx (sau khoá HĐ → mốc): tạm khoá (trừ thu tiền), yêu cầu thay đổi chờ duyệt. */
function guard(c: LockedContract, ob: LockedObligation): void {
  if (c.hold && blockedByHold(ob.kind, ob.direction)) throw new LedgerFail("on_hold", c.hold);
  if (ob.pending) throw new LedgerFail("change_pending");
}

/**
 * CR-127 X5 · spec §5.9 · BR-40: mốc có việc «Xác nhận mốc» đang mở (1 câu `FlowTaskSignal.holder`) ⇒ chỉ người đã nhận / người phụ trách /
 * quản trị công ty ghi được; người khác ⇒ 409 `TASK_CLAIMED{by}`, chưa ai nhận ⇒ 409 `TASK_NOT_CLAIMED`. Không có việc ⇒ đường cũ.
 */
async function claimGuard(
  d: Pick<Deps, "isAdmin">,
  r: Repo,
  who: PackWho,
  c: LockedContract,
  id: string,
): Promise<void> {
  const holders = await r.milestoneHolders(id);
  let v = claimVerdict(holders, who.userId, c.owner === who.userId);
  if (!v.ok && (await d.isAdmin?.(who))) v = { ok: true };
  if (v.ok) return;
  if (v.kind === "claimed") throw new LedgerFail("task_claimed", { by: v.by, reason: null });
  throw new LedgerFail("task_not_claimed");
}

/** Hàng con phần còn lại (spec §2.2): `keep` = hạn cũ, `split` = hạn mới; null = làm đủ. */
function childOf(
  ob: LockedObligation,
  b: FulfillIn,
  amountLeft: number | null,
  itemsLeft: { item_id: string; qty: string }[],
): ChildWrite | null {
  if (amountLeft === null && itemsLeft.length === 0) return null;
  const split = b.remainder && b.remainder !== "keep" ? b.remainder.split : null;
  return {
    due_date: split?.due_date ?? ob.due_date,
    title: split?.title ?? null,
    amount: amountLeft,
    items: itemsLeft,
  };
}

const qtyMap = (rows: FulfillIn["qty_items"]) =>
  rows ? new Map(rows.map((x) => [x.contract_item_id, qtyOf(String(x.qty)) ?? 0n])) : null;

/** Tiền thật: `full` (lệnh `settle` cũ) = đủ, `amount` chỉ ghi sổ; còn lại theo `fulfillMoney` (vượt ⇒ `over_plan`). */
function moneyOf(ob: LockedObligation, b: FulfillIn, full: boolean) {
  if (full) return { amount: b.amount ?? ob.amount, left: null };
  const m = fulfillMoney(ob.amount, b.amount);
  if (m === "over") throw new LedgerFail("over_plan");
  return m;
}
const deliveryOf = (
  r: LedgerRepos["delivery"],
  ob: LockedObligation,
  at: string,
  actual: ReadonlyMap<string, bigint> | null,
) => (ob.kind === "delivery" ? confirmDelivery(r, ob.id, at, actual) : Promise.resolve(null));

/**
 * CR-127 X1 · spec §6 `recordFulfillment` — MỘT đường ghi giao/nhận/thu/chi của HĐ vào mốc (xác nhận mốc, `settle`, giao dịch gắn mốc
 * ở X2). Trong MỘT tx: khoá HĐ → mốc; tạm khoá chặn (trừ thu tiền); yêu cầu chờ duyệt chặn; vượt ⇒ `over_plan`; mốc giao ⇒ kho theo SL
 * thật; thiếu ⇒ hàng con cùng CTE; bằng chứng + nhật ký trước → sau. `full` (lệnh `settle` cũ) = làm đủ phần còn lại: `amount` chỉ ghi sổ.
 */
async function recordFulfillment(d: Deps, who: PackWho, id: string, b: FulfillIn, full = false) {
  const at = b.at ?? (await todayOf(d)(who));
  return d.uow.tenant(who, (repos) => fulfillIn(d, repos, who, id, b, full, at, true));
}

/** Thân `recordFulfillment` trong một tx ĐÃ MỞ (repo gói + khoá HĐ → mốc ở đây). X2: OutcomeHandler "Giao dịch đã duyệt" chạy cùng đường trên tx engine. */
async function fulfillIn(
  d: Deps,
  repos: LedgerRepos,
  who: PackWho,
  id: string,
  b: FulfillIn,
  full: boolean,
  at: string,
  checkClaim: boolean,
) {
  const { ledger: r, delivery, notify } = repos;
  const { c, ob } = await openLocked(r, id);
  guard(c, ob);
  if (checkClaim) await claimGuard(d, r, who, c, id);
  const money = moneyOf(ob, b, full);
  const late = daysLate(at, ob.due_date);
  // V2-D · HD-05: mốc giao ⇒ SL đã giao + kho (cùng tx, sau khoá HĐ → mốc); lỗi ⇒ huỷ cả tx, mốc giữ mở.
  const dv = await deliveryOf(delivery, ob, at, full ? null : qtyMap(b.qty_items));
  const fault = late > 0 ? (b.fault ?? "unknown") : null;
  // MS-impact · Luật 4c: cùng tx/kết nối, tuần tự (không mở thêm kết nối trên đường nóng).
  const impact = d.repDelta ? await d.repDelta(who, repos, { head: ob, at, fault }) : null;
  const out = await r.settle({
    id,
    at,
    by: who.userId,
    type: settledType(ob.kind, ob.direction),
    role: roleOf(ob.direction),
    late,
    amount: money.amount,
    // V2-A · BA §2: chỉ mốc trễ mới có "lỗi do ai"; không chọn ⇒ chưa rõ.
    fault,
    delivered: dv?.rows ?? [],
    impact,
    evidence: b.evidence ?? null,
    child: childOf(ob, b, money.left, dv?.left ?? []),
  });
  // CR-127 X5 · #54: mốc xong ⇒ chỉ ghi tín hiệu đóng việc (cùng tx; engine đóng task ở tx riêng, idempotent).
  await r.signalMilestone(id, "done");
  if (dv?.notice) await notify.enqueue([dv.notice]);
  return { ...out, delivery: dv?.outcome ?? null };
}

export type LedgerDeps = Deps;
/**
 * CR-127 X2 · cùng đường `recordFulfillment` trên tx ĐÃ MỞ bởi nơi khác (engine settle, role gói + tenant): giao dịch gắn mốc được duyệt
 * ⇒ ghi vào mốc đúng như xác nhận trực tiếp. `at` vắng ⇒ ngày lịch múi tenant.
 */
export function fulfillInTx(d: Deps) {
  return async (repos: LedgerRepos, who: PackWho, id: string, b: FulfillIn) =>
    // Kiểm «đang xử lý» đã làm lúc lập yêu cầu (X2 `precheckFulfill`); người duyệt áp kết cục không bị chặn bởi việc của mốc.
    fulfillIn(d, repos, who, id, b, false, b.at ?? (await todayOf(d)(who)), false);
}

/** Đã trả/thu một đợt (lệnh cũ) = ghi thực hiện đủ phần còn lại (spec §4.1 `settle`). */
async function settleOne(d: Deps, who: PackWho, id: string, b: SettleIn) {
  const { ob, delivery } = await recordFulfillment(d, who, id, b, true);
  return delivery ? { ...ob, delivery } : ob;
}

/** Lệnh trên một đợt: đã trả/thu, hẹn lại, nhắc. */
function obligationCommands(d: Deps) {
  const today = todayOf(d);
  const settle = (who: PackWho, id: string, b: SettleIn) => settleOne(d, who, id, b);
  /** CR-127 X1: `POST /obligations/:id/fulfill` ⇒ `{obligation, child}`. */
  const fulfill = async (who: PackWho, id: string, b: FulfillIn) => {
    const { ob, child, delivery } = await recordFulfillment(d, who, id, b);
    return { obligation: ob, child, ...(delivery ? { delivery } : {}) };
  };

  const postpone = async (who: PackWho, id: string, b: { to: string; note?: string | null }) => {
    const day = await today(who);
    return d.uow.tenant(who, async ({ ledger: r }) => {
      const ob = await openObligation(r, id);
      if (b.to <= ob.due_date) throw new LedgerFail("postpone_date");
      const out = await r.postpone({
        id,
        to: b.to,
        was: ob.due_date,
        today: day,
        by: who.userId,
        role: roleOf(ob.direction),
        note: b.note ? b.note : null,
      });
      await r.signalMilestone(id, "cancelled"); // CR-127 X5: dời hạn ⇒ việc cũ đóng `cancelled`, hạn mới nhận việc mới (#55)
      return out;
    });
  };

  const remind = async (who: PackWho, id: string) => {
    const day = await today(who);
    return d.uow.tenant(who, async ({ ledger: r }) => {
      const ob = await openObligation(r, id);
      return r.remind({ id, today: day, by: who.userId, role: roleOf(ob.direction) });
    });
  };
  return { settle, fulfill, postpone, remind };
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

/** CR-127 X2 · kiểm TRƯỚC khi lập yêu cầu chờ duyệt: cùng khoá/luật chặn của `recordFulfillment` (mốc xong, tạm khoá, yêu cầu đang chờ, vượt tiền). */
export async function precheckFulfill(
  repos: LedgerRepos,
  id: string,
  b: FulfillIn,
  claim?: { d: Pick<Deps, "isAdmin">; who: PackWho },
): Promise<void> {
  const { c, ob } = await openLocked(repos.ledger, id);
  guard(c, ob);
  if (claim) await claimGuard(claim.d, repos.ledger, claim.who, c, id); // X5: cùng luật «đang xử lý»
  moneyOf(ob, b, false);
}
