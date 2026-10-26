// V2-A · BA v2 §2 · §3.1 HD-11 · KN-07: thêm / sửa / xoá mốc HĐ. Mỗi lệnh MỘT tx `PackUow`: khoá HĐ → (khoá mốc) → luật thuần →
// MỘT câu ghi (CTE: mốc + nhật ký HĐ + dữ liệu 5.4a). Chỉ mốc chưa xác nhận sửa/xoá được (mốc đã xác nhận giữ nguyên để không đổi
// điểm đã tính). Lớp 2: không SQL.
import type { PackUow, PackWho } from "../../kit/application/ports";
import {
  checkMilestone,
  type DbKind,
  type Deal,
  defaultOwner,
  fromDb,
  MILESTONE_TITLES,
  type MilestoneKind,
  type Owner,
  toDb,
} from "../domain/milestones.rules";
import { DeliveryFail, type DeliveryRepo } from "./delivery.ports";
import { checkMilestonePlan } from "./delivery.usecase";
import {
  MilestoneFail,
  type MilestoneRepos,
  type MilestoneRow,
  type MilestoneWrite,
  type MilestoneWritten,
} from "./milestones.ports";

/** Trần mốc còn hiệu lực mỗi HĐ (chi tiết đọc một câu, `MILESTONES_MAX`). */
export const MILESTONES_PER_CONTRACT = 200;

export type MilestoneInput = {
  kind: MilestoneKind;
  title?: string | null | undefined;
  due_date: string;
  owner?: Owner | null | undefined;
  qty?: number | null | undefined;
  /** Đợt giao theo % (chỉ Giao hàng; không đi cùng SL chung). */
  pct?: number | null | undefined;
  amount?: number | null | undefined;
  /** V2-D · 5.7a: bảng "Giao lần này" (chỉ mốc Giao hàng). */
  items?: PlanInput | null | undefined;
};
type PlanInput = readonly { item_id: string; qty: number | null }[];
export type MilestoneChange = {
  kind?: MilestoneKind | undefined;
  title?: string | undefined;
  due_date?: string | undefined;
  owner?: Owner | undefined;
  qty?: number | null | undefined;
  pct?: number | null | undefined;
  amount?: number | null | undefined;
  /** V2-D: thay cả bảng SL (null/[] = giao hết phần còn lại). */
  items?: PlanInput | null | undefined;
};

type Uow = PackUow<MilestoneRepos>;
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** Đầu vào đã gộp ⇒ hàng ghi; sai luật SL/tiền ⇒ `invalid`. */
function toWrite(
  deal: Deal,
  m: Required<Omit<MilestoneChange, "items">> & { title: string },
): MilestoneWrite {
  if (checkMilestone({ kind: m.kind, qty: m.qty, amount: m.amount }) !== "ok")
    throw new MilestoneFail("invalid");
  if (m.pct !== null && (m.kind !== "delivery" || m.qty !== null))
    throw new MilestoneFail("invalid");
  const db = toDb(m.kind, deal);
  return {
    ...db,
    title: m.title,
    owner: m.owner,
    due_date: m.due_date,
    qty: m.qty,
    pct: m.pct,
    amount: m.amount,
  };
}

/** SL chung / % của mốc sau khi sửa: giữ giá trị cũ (chỉ Giao hàng); gửi SL chung ⇒ bỏ %, gửi % ⇒ bỏ SL chung. */
function mergeQtyPct(delivery: boolean, cur: MilestoneRow, p: MilestoneChange) {
  const keepQty = delivery ? num(cur.qty) : null;
  const keepPct = delivery ? num(cur.delivery_pct ?? null) : null;
  const qty = p.qty !== undefined ? p.qty : p.pct != null ? null : keepQty;
  const pct = p.pct !== undefined ? p.pct : p.qty != null ? null : keepPct;
  return { qty, pct };
}

/** Sửa: khoá rỗng giữ giá trị cũ; đổi loại mà không gửi SL/tiền ⇒ bỏ SL/tiền không hợp loại mới, việc của ai theo loại mới. */
export function mergeChange(deal: Deal, cur: MilestoneRow, p: MilestoneChange): MilestoneWrite {
  const was = fromDb(cur.kind, cur.direction);
  const kind = p.kind ?? was;
  const switched = kind !== was;
  const { qty, pct } = mergeQtyPct(kind === "delivery", cur, p);
  const keepAmount = ["collect", "pay", "commission"].includes(kind) ? num(cur.amount) : null;
  return toWrite(deal, {
    kind,
    title: p.title ?? cur.title ?? MILESTONE_TITLES[kind],
    due_date: p.due_date ?? cur.due_date,
    owner: p.owner ?? (switched ? defaultOwner(kind, deal) : cur.owner),
    qty,
    pct,
    amount: p.amount !== undefined ? p.amount : keepAmount,
  });
}

/** Khoá HĐ của mốc rồi mốc; mốc đã xác nhận ⇒ `confirmed`. */
async function editable(r: MilestoneRepos["milestones"], id: string) {
  const c = await r.lockContractOf(id);
  if (!c) throw new MilestoneFail("not_found");
  if (c.locked) throw new MilestoneFail("locked");
  const cur = await r.lockRow(id);
  if (!cur) throw new MilestoneFail("not_found");
  if (cur.status === "done") throw new MilestoneFail("confirmed");
  return { deal: c.deal, cur };
}

/** V2-D: bảng SL chỉ cho mốc Giao hàng; dòng thuộc HĐ (lạ/trùng ⇒ `invalid`); vượt phần còn lại ⇒ `DeliveryFail("over")`. */
async function planOf(
  r: DeliveryRepo,
  contractId: string,
  kind: DbKind,
  items: PlanInput,
): Promise<{ item_id: string; qty: string | null }[]> {
  if (items.length === 0) return [];
  if (kind !== "delivery") throw new MilestoneFail("invalid");
  try {
    return await checkMilestonePlan(r, contractId, items);
  } catch (e) {
    if (e instanceof DeliveryFail && e.kind === "invalid") throw new MilestoneFail("invalid");
    throw e;
  }
}

/** Thêm mốc: khoá rỗng ⇒ mặc định theo loại (tên, việc của ai). */
const newWrite = (deal: Deal, b: MilestoneInput): MilestoneWrite =>
  toWrite(deal, {
    kind: b.kind,
    title: b.title ?? MILESTONE_TITLES[b.kind],
    due_date: b.due_date,
    owner: b.owner ?? defaultOwner(b.kind, deal),
    qty: b.qty ?? null,
    pct: b.pct ?? null,
    amount: b.amount ?? null,
  });

/** Thêm mốc: HĐ không có / đã khoá (lock-strict) / chưa rõ chiều / đủ trần ⇒ lỗi. */
function addableDeal(c: { deal: Deal | null; n: number; locked: boolean } | null): Deal {
  if (!c) throw new MilestoneFail("not_found");
  if (c.locked) throw new MilestoneFail("locked");
  if (!c.deal || c.n >= MILESTONES_PER_CONTRACT) throw new MilestoneFail("invalid");
  return c.deal;
}

export function milestoneCommands(d: { uow: Uow }) {
  const add = (who: PackWho, contractId: string, b: MilestoneInput): Promise<MilestoneWritten> =>
    d.uow.tenant(who, async ({ milestones: r, delivery }) => {
      const c = await r.lockContract(contractId);
      const deal = addableDeal(c);
      const w = newWrite(deal, b);
      const plan = b.items?.length ? await planOf(delivery, contractId, w.kind, b.items) : null;
      const out = await r.insert(contractId, w, who.userId);
      if (plan) await delivery.replacePlan(out.m.id, contractId, plan);
      return out;
    });

  const edit = (who: PackWho, id: string, p: MilestoneChange): Promise<MilestoneWritten> =>
    d.uow.tenant(who, async ({ milestones: r, delivery }) => {
      const { deal, cur } = await editable(r, id);
      if (!deal) throw new MilestoneFail("invalid");
      const w = mergeChange(deal, cur, p);
      const plan =
        p.items !== undefined
          ? await planOf(delivery, cur.contract_id, w.kind, p.items ?? [])
          : null;
      const out = await r.update(id, { ...w, moved: w.due_date !== cur.due_date }, who.userId);
      if (plan) await delivery.replacePlan(id, cur.contract_id, plan);
      return out;
    });

  const remove = (who: PackWho, id: string): Promise<void> =>
    d.uow.tenant(who, async ({ milestones: r }) => {
      await editable(r, id);
      if (!(await r.remove(id, who.userId))) throw new MilestoneFail("not_found");
    });

  return { add, edit, remove };
}
export type MilestoneCommands = ReturnType<typeof milestoneCommands>;
