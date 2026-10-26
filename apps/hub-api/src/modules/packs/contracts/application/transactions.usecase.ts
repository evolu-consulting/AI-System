// CR-097 G1 · GD-FR-01…05 · intake R9, R10, R27–R32: use case Giao dịch. Mỗi lệnh ghi = MỘT tx RLS của người gọi; khoá hàng giao
// dịch `FOR UPDATE` trước (thứ tự khoá: giao dịch → thành phần kho trong `applyDelivery`). Kho đi qua đúng đường giao hàng HĐ
// (`applyDelivery` / đảo kho V2-M); `StockError` ⇒ huỷ cả tx (không ghi gì).
import type {
  TransactionActionOut,
  TransactionAdjust,
  TransactionDescribe,
  TransactionDetail,
  TransactionDraft,
  TransactionDraftPatch,
  TransactionLineIn,
  TransactionListOut,
  TransactionListQuery,
} from "@ai/contracts";
import type { PackUow, PackWho } from "../../kit/application/ports";
import { localDate } from "../domain/local-time.rules";
import { type DeliveryResult, StockError } from "../domain/stock.rules";
import {
  assertCan,
  describeChanges,
  obligationOf,
  planLines,
  stockMovesOf,
  TxRuleError,
} from "../domain/transactions.rules";
import type { TransactionsRepo, TxHeader, TxLineRow, TxLocked } from "./transactions.ports";

export { TxRuleError };

export type TransactionsDeps = {
  uow: PackUow<{ transactions: TransactionsRepo }>;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

type R = TransactionsRepo;
type Ctx = {
  run: <T>(who: PackWho, fn: (r: R) => Promise<T>) => Promise<T>;
  today: (who: PackWho) => Promise<string>;
};

const productIds = (ls: readonly TransactionLineIn[]) => [
  ...new Set(ls.map((l) => l.product_id).filter((x): x is string => !!x)),
];

async function planned(r: R, ls: readonly TransactionLineIn[]) {
  const p = planLines(ls, await r.comps(productIds(ls)));
  return {
    total: p.total,
    lines: p.lines.map((l): TxLineRow => ({ ...l, id: crypto.randomUUID() })),
  };
}

async function mustLock(r: R, id: string): Promise<TxLocked> {
  const t = await r.lock(id);
  if (!t) throw new TxRuleError("not_found");
  return t;
}

async function detailOf(r: R, id: string): Promise<TransactionDetail> {
  const x = await r.detail(id);
  if (!x) throw new TxRuleError("not_found");
  return x;
}

async function checkContract(r: R, contractId: string | null | undefined): Promise<void> {
  if (contractId && !(await r.contractVisible(contractId)))
    throw new TxRuleError("invalid", "hợp đồng liên kết không có");
}

function notFuture(on: string, today: string): void {
  if (on > today) throw new TxRuleError("invalid", "ngày phát sinh ở tương lai");
}

const stockOut = (res: DeliveryResult | null) =>
  (res?.components ?? [])
    .filter((x) => x.mode === "stock" || x.mode === "quota")
    .map((x) => ({
      component_id: x.componentId,
      on_hand_before: x.onHandBefore,
      on_hand_after: x.onHandAfter,
      avg_cost_before: x.avgCostBefore,
      avg_cost_after: x.avgCostAfter,
    }));

/** Ghi kho một bản dòng của giao dịch (dòng gắn SP) — không dòng kho ⇒ không chạm kho. */
async function applyLines(
  r: R,
  t: Pick<TxLocked, "id" | "deal" | "party_key">,
  h: { occurred_on: string; valid_until: string | null },
  lines: readonly TxLineRow[],
): Promise<DeliveryResult | null> {
  const ls = lines.filter((l) => l.productId !== null);
  if (ls.length === 0) return null;
  const comps = await r.comps([...new Set(ls.map((l) => l.productId as string))]);
  const moves = stockMovesOf(
    { deal: t.deal, partyKey: t.party_key, validUntil: h.valid_until },
    ls,
    comps,
  );
  return moves.length === 0 ? null : r.applyStock(moves, h.occurred_on, t.id);
}

const draftHeader = (b: TransactionDraft, total: number): TxHeader => ({
  deal: b.deal,
  occurred_on: b.occurred_on,
  due_on: b.due_on ?? null,
  valid_until: b.valid_until ?? null,
  partner_name: b.partner_name,
  partner_tax_id: b.partner_tax_id ?? null,
  product_group: b.product_group ?? null,
  contract_id: b.contract_id ?? null,
  note: b.note ?? null,
  holder: b.holder ?? null,
  lot_label: b.lot_label ?? null,
  total,
});

/** GD-FR-01 · tạo nháp (dòng + tổng; HĐ liên kết phải thấy được). */
const create = (c: Ctx, who: PackWho, b: TransactionDraft) =>
  c.run(who, async (r) => {
    await checkContract(r, b.contract_id);
    const p = await planned(r, b.lines);
    const id = await r.insert(draftHeader(b, p.total));
    await r.writeLines(id, 0, p.lines, false);
    await r.event(id, "created", null, { total: p.total, lines: p.lines.length });
    return detailOf(r, id);
  });

/** GD-FR-01 · sửa nháp tự do (có `lines` ⇒ thay toàn bộ dòng + tính lại tổng). */
const patchDraft = (c: Ctx, who: PackWho, id: string, b: TransactionDraftPatch) =>
  c.run(who, async (r) => {
    assertCan((await mustLock(r, id)).status, "edit");
    await checkContract(r, b.contract_id);
    const { lines, ...head } = b;
    const p = lines ? await planned(r, lines) : null;
    await r.update(id, { ...head, ...(p ? { total: p.total } : {}) });
    if (p) await r.writeLines(id, 0, p.lines, true);
    await r.event(id, "edited", null, { fields: Object.keys(b) });
    return detailOf(r, id);
  });

/** GD-FR-02 · ghi sổ: kho theo luật giao hàng HĐ + nghĩa vụ thanh toán + vết. */
async function post(c: Ctx, who: PackWho, id: string): Promise<TransactionActionOut> {
  const day = await c.today(who);
  return c.run(who, async (r) => {
    const t = await mustLock(r, id);
    assertCan(t.status, "post");
    notFuture(t.occurred_on, day);
    const res = await applyLines(r, t, t, await r.lines(id, 0));
    const next = obligationOf({
      deal: t.deal,
      total: t.total,
      done: 0,
      dueOn: t.due_on,
      occurredOn: t.occurred_on,
      rev: t.rev,
    });
    await r.settleObligations(id, { reason: null, next, partyKey: t.party_key, voidEvents: false });
    await r.update(id, { status: "posted", posted_at: "now", posted_by: who.userId });
    await r.event(id, "posted", null, { total: t.total, stock: stockOut(res) });
    return { transaction: await detailOf(r, id), stock: stockOut(res), stock_reversed: 0 };
  });
}

/** GD-FR-03 · mô tả (ghi chú, người giữ, nhãn lô) sửa trực tiếp sau ghi sổ, có vết trước → sau. */
const describe = (c: Ctx, who: PackWho, id: string, b: TransactionDescribe) =>
  c.run(who, async (r) => {
    const t = await mustLock(r, id);
    assertCan(t.status, "describe");
    const changes = describeChanges(t, b);
    await r.update(id, Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v?.to])));
    await r.event(id, "described", null, { changes });
    return detailOf(r, id);
  });

const adjustedHeader = (t: TxLocked, b: TransactionAdjust) => ({
  occurred_on: b.occurred_on ?? t.occurred_on,
  due_on: b.due_on === undefined ? t.due_on : b.due_on,
  valid_until: b.valid_until === undefined ? t.valid_until : b.valid_until,
  product_group: b.product_group === undefined ? t.product_group : b.product_group,
});

/** GD-FR-04 · điều chỉnh: bản rev+1 (bản cũ giữ), đảo kho bản cũ + ghi kho bản mới, nghĩa vụ mở thay bằng phần còn lại. */
async function adjust(c: Ctx, who: PackWho, id: string, b: TransactionAdjust) {
  const day = await c.today(who);
  return c.run(who, async (r): Promise<TransactionActionOut> => {
    const t = await mustLock(r, id);
    assertCan(t.status, "adjust");
    const h = adjustedHeader(t, b);
    notFuture(h.occurred_on, day);
    const p = await planned(r, b.lines);
    const rev = t.rev + 1;
    const reversed = await r.reverseStock(id, day);
    await r.update(id, { ...h, total: p.total, rev });
    await r.writeLines(id, rev, p.lines, false);
    const res = await applyLines(r, t, h, p.lines);
    const done = await r.doneSum(id);
    const next = obligationOf({
      deal: t.deal,
      total: p.total,
      done,
      dueOn: h.due_on,
      occurredOn: h.occurred_on,
      rev,
    });
    const why = `điều chỉnh: ${b.reason}`;
    await r.settleObligations(id, { reason: why, next, partyKey: t.party_key, voidEvents: false });
    const stock = stockOut(res);
    const data = {
      rev,
      total_before: t.total,
      total_after: p.total,
      stock_reversed: reversed,
      stock,
    };
    await r.event(id, "adjusted", b.reason, data);
    return { transaction: await detailOf(r, id), stock, stock_reversed: reversed };
  });
}

/** GD-FR-05 · huỷ: hoàn kho, huỷ nghĩa vụ mở + sự kiện đối tác của nghĩa vụ, ghi sự kiện huỷ (không xoá). */
async function cancel(c: Ctx, who: PackWho, id: string, reason: string) {
  const day = await c.today(who);
  return c.run(who, async (r): Promise<TransactionActionOut> => {
    const t = await mustLock(r, id);
    assertCan(t.status, "cancel");
    const reversed = await r.reverseStock(id, day);
    const why = `huỷ giao dịch: ${reason}`;
    await r.settleObligations(id, {
      reason: why,
      next: null,
      partyKey: t.party_key,
      voidEvents: true,
    });
    await r.update(id, {
      status: "cancelled",
      cancelled_at: "now",
      cancelled_by: who.userId,
      cancel_reason: reason,
    });
    await r.event(id, "cancelled", reason, { stock_reversed: reversed });
    return { transaction: await detailOf(r, id), stock: [], stock_reversed: reversed };
  });
}

export function transactionsUsecase(d: TransactionsDeps) {
  const now = d.now ?? (() => new Date());
  const c: Ctx = {
    // Lỗi kho (thiếu hàng / không đảo được) ⇒ `stock`; tx đã huỷ.
    run: (who, fn) =>
      d.uow
        .tenant(who, (x) => fn(x.transactions))
        .catch((e) => {
          if (e instanceof StockError) throw new TxRuleError("stock", e.detail);
          throw e;
        }),
    today: async (who) => localDate(now(), await d.timeZoneOf(who.tenantId)),
  };
  return {
    list: (who: PackWho, q: TransactionListQuery): Promise<TransactionListOut> =>
      c.run(who, (r) => r.list(q)),
    get: (who: PackWho, id: string) => c.run(who, (r) => detailOf(r, id)),
    create: (who: PackWho, b: TransactionDraft) => create(c, who, b),
    patchDraft: (who: PackWho, id: string, b: TransactionDraftPatch) => patchDraft(c, who, id, b),
    /** GD-FR-01 · xoá nháp (hẳn; dòng + vết theo CASCADE). */
    remove: (who: PackWho, id: string) =>
      c.run(who, async (r) => {
        assertCan((await mustLock(r, id)).status, "delete");
        await r.remove(id);
      }),
    post: (who: PackWho, id: string) => post(c, who, id),
    describe: (who: PackWho, id: string, b: TransactionDescribe) => describe(c, who, id, b),
    adjust: (who: PackWho, id: string, b: TransactionAdjust) => adjust(c, who, id, b),
    cancel: (who: PackWho, id: string, reason: string) => cancel(c, who, id, reason),
  };
}

export type TransactionsUsecase = ReturnType<typeof transactionsUsecase>;
