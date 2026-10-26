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
  /** Đợt giao theo % (chỉ Giao hàng; có % thì không nhập SL chung). */
  pct: string;
  amount: string;
};

export function newDraft(deal: ContractDeal, today: string, title: string): MsDraft {
  return {
    kind: "delivery",
    title,
    due: today,
    owner: defaultOwner("delivery", deal),
    qty: "",
    pct: "",
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
    pct: m.pct == null ? "" : String(m.pct).replace(".", ","),
    amount: m.amount == null ? "" : String(m.amount),
  };
}

/** Đổi loại mốc: việc của ai theo mặc định của loại; tên theo loại nếu người dùng chưa tự sửa; xoá SL/tiền không hợp loại. */
export function withKind(
  d: MsDraft,
  kind: MilestoneKind,
  deal: ContractDeal,
  ...title: [kindTitle: string, titleEdited: boolean]
): MsDraft {
  const [kindTitle, titleEdited] = title;
  return {
    ...d,
    kind,
    owner: defaultOwner(kind, deal),
    title: titleEdited ? d.title : kindTitle,
    qty: kind === "delivery" ? d.qty : "",
    pct: kind === "delivery" ? d.pct : "",
    amount: MONEY_KINDS.has(kind) ? d.amount : "",
  };
}

export type MsBody = {
  kind: MilestoneKind;
  title: string;
  due_date: string;
  owner: "ours" | "partner";
  qty: number | null;
  /** Chỉ gửi khi có % (thêm mốc) hoặc khi sửa mốc (null = bỏ %). */
  pct?: number | null;
  amount: number | null;
};

/** % đợt giao: 0 < % ≤ 100, tối đa 2 số lẻ ("30", "33,33"); rỗng ⇒ null; sai ⇒ NaN. */
export function parsePct(s: string): number | null {
  const v = parseQty(s);
  if (v === null) return null;
  return Number.isNaN(v) ||
    v <= 0 ||
    v > 100 ||
    Math.round(v * 100) !== Number((v * 100).toFixed(6))
    ? Number.NaN
    : v;
}

/** Thân gửi API từ bản nháp; lỗi ⇒ khoá i18n (`needTitleDue` | `badNumber`). Có % thì bỏ SL chung (đi một trong hai). */
export function bodyOf(
  d: MsDraft,
  forEdit = false,
): { ok: MsBody } | { err: "needTitleDue" | "badNumber" } {
  if (!d.title.trim() || !d.due) return { err: "needTitleDue" };
  const pct = d.kind === "delivery" ? parsePct(d.pct) : null;
  const qty = d.kind === "delivery" && pct === null ? parseQty(d.qty) : null;
  const amount = MONEY_KINDS.has(d.kind) ? parseMoney(d.amount) : null;
  if (
    (qty !== null && Number.isNaN(qty)) ||
    (pct !== null && Number.isNaN(pct)) ||
    (amount !== null && Number.isNaN(amount))
  )
    return { err: "badNumber" };
  return {
    ok: {
      kind: d.kind,
      title: d.title.trim(),
      due_date: d.due,
      owner: d.owner,
      qty,
      ...(pct !== null || (forEdit && d.kind === "delivery") ? { pct } : {}),
      amount,
    },
  };
}
