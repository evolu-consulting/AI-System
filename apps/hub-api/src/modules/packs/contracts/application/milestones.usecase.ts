// V2-A · BA v2 §2 · §3.1 HD-11 · KN-07: thêm / sửa / xoá mốc HĐ. Mỗi lệnh MỘT tx `PackUow`: khoá HĐ → (khoá mốc) → luật thuần →
// MỘT câu ghi (CTE: mốc + nhật ký HĐ + dữ liệu 5.4a). Chỉ mốc chưa xác nhận sửa/xoá được (mốc đã xác nhận giữ nguyên để không đổi
// điểm đã tính). Lớp 2: không SQL.
import type { PackUow, PackWho } from "../../kit/application/ports";
import {
  checkMilestone,
  type Deal,
  defaultOwner,
  fromDb,
  MILESTONE_TITLES,
  type MilestoneKind,
  type Owner,
  toDb,
} from "../domain/milestones.rules";
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
  amount?: number | null | undefined;
};
export type MilestoneChange = {
  kind?: MilestoneKind | undefined;
  title?: string | undefined;
  due_date?: string | undefined;
  owner?: Owner | undefined;
  qty?: number | null | undefined;
  amount?: number | null | undefined;
};

type Uow = PackUow<MilestoneRepos>;
const num = (v: number | string | null): number | null => (v === null ? null : Number(v));

/** Đầu vào đã gộp ⇒ hàng ghi; sai luật SL/tiền ⇒ `invalid`. */
function toWrite(deal: Deal, m: Required<MilestoneChange> & { title: string }): MilestoneWrite {
  if (checkMilestone({ kind: m.kind, qty: m.qty, amount: m.amount }) !== "ok")
    throw new MilestoneFail("invalid");
  const db = toDb(m.kind, deal);
  return {
    ...db,
    title: m.title,
    owner: m.owner,
    due_date: m.due_date,
    qty: m.qty,
    amount: m.amount,
  };
}

/** Sửa: khoá rỗng giữ giá trị cũ; đổi loại mà không gửi SL/tiền ⇒ bỏ SL/tiền không hợp loại mới, việc của ai theo loại mới. */
export function mergeChange(deal: Deal, cur: MilestoneRow, p: MilestoneChange): MilestoneWrite {
  const was = fromDb(cur.kind, cur.direction);
  const kind = p.kind ?? was;
  const switched = kind !== was;
  const keepQty = kind === "delivery" ? num(cur.qty) : null;
  const keepAmount = ["collect", "pay", "commission"].includes(kind) ? num(cur.amount) : null;
  return toWrite(deal, {
    kind,
    title: p.title ?? cur.title ?? MILESTONE_TITLES[kind],
    due_date: p.due_date ?? cur.due_date,
    owner: p.owner ?? (switched ? defaultOwner(kind, deal) : cur.owner),
    qty: p.qty !== undefined ? p.qty : keepQty,
    amount: p.amount !== undefined ? p.amount : keepAmount,
  });
}

/** Khoá HĐ của mốc rồi mốc; mốc đã xác nhận ⇒ `confirmed`. */
async function editable(r: MilestoneRepos["milestones"], id: string) {
  const c = await r.lockContractOf(id);
  if (!c) throw new MilestoneFail("not_found");
  const cur = await r.lockRow(id);
  if (!cur) throw new MilestoneFail("not_found");
  if (cur.status === "done") throw new MilestoneFail("confirmed");
  return { deal: c.deal, cur };
}

export function milestoneCommands(d: { uow: Uow }) {
  const add = (who: PackWho, contractId: string, b: MilestoneInput): Promise<MilestoneWritten> =>
    d.uow.tenant(who, async ({ milestones: r }) => {
      const c = await r.lockContract(contractId);
      if (!c) throw new MilestoneFail("not_found");
      if (!c.deal || c.n >= MILESTONES_PER_CONTRACT) throw new MilestoneFail("invalid");
      const w = toWrite(c.deal, {
        kind: b.kind,
        title: b.title ?? MILESTONE_TITLES[b.kind],
        due_date: b.due_date,
        owner: b.owner ?? defaultOwner(b.kind, c.deal),
        qty: b.qty ?? null,
        amount: b.amount ?? null,
      });
      return r.insert(contractId, w, who.userId);
    });

  const edit = (who: PackWho, id: string, p: MilestoneChange): Promise<MilestoneWritten> =>
    d.uow.tenant(who, async ({ milestones: r }) => {
      const { deal, cur } = await editable(r, id);
      if (!deal) throw new MilestoneFail("invalid");
      const w = mergeChange(deal, cur, p);
      return r.update(id, { ...w, moved: w.due_date !== cur.due_date }, who.userId);
    });

  const remove = (who: PackWho, id: string): Promise<void> =>
    d.uow.tenant(who, async ({ milestones: r }) => {
      await editable(r, id);
      if (!(await r.remove(id, who.userId))) throw new MilestoneFail("not_found");
    });

  return { add, edit, remove };
}
export type MilestoneCommands = ReturnType<typeof milestoneCommands>;
