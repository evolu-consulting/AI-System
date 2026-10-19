// W1 · "Việc của tôi" (port `assistant/digest.py` — `_late`, `money_cards`, `renewal_cards`, `followup_cards`; sắp xếp
// `digest.build`): gom bốn nguồn hàng thô (hẹn nhắc của mình, đợt thanh toán, hạn xử lý HĐ, nhắc hạn đã gửi) thành MỘT danh sách có
// mức độ gấp. Thuần: không đọc DB/đồng hồ — `today` là ngày lịch tenant do tầng trên đưa vào (HD4 `localDate`).
import {
  MYWORK_MAX,
  MYWORK_SOURCE_MAX,
  type MyWorkItem,
  type MyWorkKind,
  type MyWorkOut,
  type MyWorkTone,
} from "@ai/contracts";
import { daysBetween } from "./local-time.rules";

type Dir = "pay" | "receive";
type ContractDir = "sale" | "purchase";

export type RawFollowup = {
  id: string;
  due: string;
  at: string;
  note: string | null;
  customer_id: string | null;
  customer_name: string | null;
  subject: "renewal" | "customer";
};
/** Hẹn nhắc chung (W1): tiêu đề do máy chủ đặt lúc hẹn ("Thu Khách An 5.000.000 đ"), gắn HĐ khi có. */
export type RawGenericFollowup = {
  id: string;
  due: string;
  at: string;
  note: string | null;
  title: string;
  subject: "obligation" | "contract" | "company" | "renewal";
  contract_id: string | null;
};
export type RawObligation = {
  id: string;
  contract_id: string;
  direction: Dir;
  amount: number | null;
  due: string;
  number: string | null;
  title: string | null;
  party: string | null;
  contract_direction: ContractDir | null;
};
export type RawDeadline = {
  id: string;
  deadline: string;
  number: string | null;
  title: string | null;
  party: string | null;
  contract_direction: ContractDir | null;
};
export type RawReminder = {
  id: string;
  contract_id: string;
  deadline: string;
  milestone: number;
  number: string | null;
  title: string | null;
  party: string | null;
  contract_direction: ContractDir | null;
};
export type RawMyWork = {
  followups: RawFollowup[];
  gfollowups: RawGenericFollowup[];
  obligations: RawObligation[];
  deadlines: RawDeadline[];
  reminders: RawReminder[];
};

const KIND_RANK: Record<MyWorkKind, number> = {
  followup: 0,
  obligation: 1,
  deadline: 2,
  reminder: 3,
};
const TONE_RANK: Record<MyWorkTone, number> = { late: 0, soon: 1, dim: 2 };

/** `_late`: trễ ⇒ late; hôm nay ⇒ soon; còn ngày ⇒ dim (mgmt tô "soon" cho cả "Còn n ngày"; ở đây phần sắp tới là mức dim). */
export function toneOf(days: number): MyWorkTone {
  return days > 0 ? "late" : days === 0 ? "soon" : "dim";
}

const base = (kind: MyWorkKind, id: string, due: string, today: string) => {
  const days = daysBetween(due, today);
  return { id: `${kind}:${id}`, kind, tone: toneOf(days), days, due };
};

const blank = {
  at: null,
  title: null,
  party: null,
  amount: null,
  direction: null,
  contract_direction: null,
  contract_id: null,
  customer_id: null,
  note: null,
  milestone: null,
  subject: null,
} satisfies Omit<MyWorkItem, "id" | "kind" | "tone" | "days" | "due">;

const name = (n: { number: string | null; title: string | null }) => n.title ?? n.number;

export function followupItem(f: RawFollowup, today: string): MyWorkItem {
  return {
    ...blank,
    ...base("followup", f.id, f.due, today),
    // hẹn nhắc tới giờ mà ngày đã qua = trễ; cùng ngày = đến hẹn (mgmt `Đến hẹn HH:MM`)
    at: f.at,
    title: f.customer_name,
    note: f.note,
    customer_id: f.customer_id,
    subject: f.subject,
  };
}

export function genericFollowupItem(f: RawGenericFollowup, today: string): MyWorkItem {
  return {
    ...blank,
    ...base("followup", f.id, f.due, today),
    at: f.at,
    title: f.title,
    note: f.note,
    contract_id: f.contract_id,
    subject: f.subject,
  };
}

export function obligationItem(o: RawObligation, today: string): MyWorkItem {
  return {
    ...blank,
    ...base("obligation", o.id, o.due, today),
    title: name(o),
    party: o.party,
    amount: o.amount,
    direction: o.direction,
    contract_direction: o.contract_direction,
    contract_id: o.contract_id,
  };
}

export function deadlineItem(d: RawDeadline, today: string): MyWorkItem {
  return {
    ...blank,
    ...base("deadline", d.id, d.deadline, today),
    title: name(d),
    party: d.party,
    contract_direction: d.contract_direction,
    contract_id: d.id,
  };
}

export function reminderItem(r: RawReminder, today: string): MyWorkItem {
  return {
    ...blank,
    ...base("reminder", r.id, r.deadline, today),
    title: name(r),
    party: r.party,
    contract_direction: r.contract_direction,
    contract_id: r.contract_id,
    milestone: r.milestone,
  };
}

/** Trước hết cái gấp (trễ → hôm nay → sắp tới), rồi nhắc việc của mình → tiền (trả trước thu) → hạn HĐ → nhắc đã gửi, rồi theo hạn. */
export function compareItems(a: MyWorkItem, b: MyWorkItem): number {
  return (
    TONE_RANK[a.tone] - TONE_RANK[b.tone] ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    Number(a.direction === "receive") - Number(b.direction === "receive") ||
    a.due.localeCompare(b.due) ||
    (a.at ?? "").localeCompare(b.at ?? "") ||
    a.id.localeCompare(b.id)
  );
}

/** Mỗi nguồn đọc tối đa `MYWORK_SOURCE_MAX + 1` hàng: dư một hàng ⇒ nguồn bị cắt. */
export function buildMyWork(raw: RawMyWork, today: string): MyWorkOut {
  const cut = [raw.followups, raw.gfollowups, raw.obligations, raw.deadlines, raw.reminders].some(
    (s) => s.length > MYWORK_SOURCE_MAX,
  );
  const cap = <T>(s: T[]): T[] => s.slice(0, MYWORK_SOURCE_MAX);
  const all = [
    ...cap(raw.followups).map((f) => followupItem(f, today)),
    ...cap(raw.gfollowups).map((f) => genericFollowupItem(f, today)),
    ...cap(raw.obligations).map((o) => obligationItem(o, today)),
    ...cap(raw.deadlines).map((d) => deadlineItem(d, today)),
    ...cap(raw.reminders).map((r) => reminderItem(r, today)),
  ].sort(compareItems);
  const items = all.slice(0, MYWORK_MAX);
  return {
    today,
    items,
    counts: {
      late: items.filter((i) => i.tone === "late").length,
      today: items.filter((i) => i.days === 0).length,
      upcoming: items.filter((i) => i.days < 0).length,
    },
    truncated: cut || all.length > MYWORK_MAX,
  };
}
