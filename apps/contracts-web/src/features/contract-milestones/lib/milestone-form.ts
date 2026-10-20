// V2-F · HD-11 · luật thuần của hộp "Thêm / Sửa mốc": bản nháp ↔ thân API. SL chỉ cho Giao hàng; số tiền chỉ cho Thu tiền / Thanh toán /
// Nhận hoa hồng (đổi loại ⇒ xoá ô không còn hợp lệ). Số đọc kiểu Việt ("1,5", "118.000.000").
import type { ContractDeal, Milestone } from "@ai/contracts";
import { parseMoney, parseQty } from "~/components/shared/format";
import { defaultOwner, type MilestoneKind, MONEY_KINDS } from "./timeline";

export type MsDraft = {
  kind: MilestoneKind;
  title: string;
  due: string;
  owner: "ours" | "partner";
  qty: string;
  amount: string;
};

export function newDraft(deal: ContractDeal, today: string, title: string): MsDraft {
  return {
    kind: "delivery",
    title,
    due: today,
    owner: defaultOwner("delivery", deal),
    qty: "",
    amount: "",
  };
}

export function draftOfMilestone(m: Milestone): MsDraft {
  return {
    kind: m.kind,
    title: m.title,
    due: m.due_date,
    owner: m.owner,
    qty: m.qty == null ? "" : String(m.qty).replace(".", ","),
    amount: m.amount == null ? "" : String(m.amount),
  };
}

/** Đổi loại mốc: việc của ai theo mặc định của loại; tên theo loại nếu người dùng chưa tự sửa; xoá SL/tiền không hợp loại. */
export function withKind(
  d: MsDraft,
  kind: MilestoneKind,
  deal: ContractDeal,
  kindTitle: string,
  titleEdited: boolean,
): MsDraft {
  return {
    ...d,
    kind,
    owner: defaultOwner(kind, deal),
    title: titleEdited ? d.title : kindTitle,
    qty: kind === "delivery" ? d.qty : "",
    amount: MONEY_KINDS.has(kind) ? d.amount : "",
  };
}

export type MsBody = {
  kind: MilestoneKind;
  title: string;
  due_date: string;
  owner: "ours" | "partner";
  qty: number | null;
  amount: number | null;
};

/** Thân gửi API từ bản nháp; lỗi ⇒ khoá i18n (`needTitleDue` | `badNumber`). */
export function bodyOf(d: MsDraft): { ok: MsBody } | { err: "needTitleDue" | "badNumber" } {
  if (!d.title.trim() || !d.due) return { err: "needTitleDue" };
  const qty = d.kind === "delivery" ? parseQty(d.qty) : null;
  const amount = MONEY_KINDS.has(d.kind) ? parseMoney(d.amount) : null;
  if ((qty !== null && Number.isNaN(qty)) || (amount !== null && Number.isNaN(amount)))
    return { err: "badNumber" };
  return {
    ok: { kind: d.kind, title: d.title.trim(), due_date: d.due, owner: d.owner, qty, amount },
  };
}
