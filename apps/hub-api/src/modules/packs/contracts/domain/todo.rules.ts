// V2-K · TQ-01 · BA v2 §4.1 (Cần xử lý: quá hạn xếp đầu, hiện 6 + Xem thêm, Bỏ qua / Đã xong) · §5.9 (8 nguồn): luật thuần gom hàng
// thô của câu SQL thành danh sách có loại, số ngày, khoá ổn định và thứ tự. `today` = ngày lịch tenant do tầng trên đưa vào. Lớp 1.

import { daysBetween } from "./local-time.rules";

export const TODO_SOURCE_MAX = 100;
export const TODO_MAX = 300;
export const TODO_KINDS = [
  "overdue",
  "due_soon",
  "contract_expiring",
  "customers_expiring",
  "renewal_contact",
  "commission",
  "rating",
  "rating_quarter",
  "missing_file",
  "market_price",
  "legal",
] as const;
export type TodoKind = (typeof TODO_KINDS)[number];
export const TODO_ACTIONS = ["skip", "done"] as const;
export type TodoAction = (typeof TODO_ACTIONS)[number];
/** Tiền tố khoá ghi ở `todo_dismissals` (mốc dùng chung `milestone`: đổi hạn ⇒ khoá mới ⇒ hiện lại). */
export type RawKind =
  | "milestone"
  | "commission"
  | "contract_expiring"
  | "customers_expiring"
  | "renewal_contact"
  | "rating"
  | "rating_quarter"
  | "missing_file"
  | "market_price"
  | "legal";
export const RAW_KINDS: readonly RawKind[] = [
  "legal",
  "milestone",
  "commission",
  "contract_expiring",
  "customers_expiring",
  "renewal_contact",
  "rating",
  "rating_quarter",
  "missing_file",
  "market_price",
];

export type RawTodo = {
  kind: RawKind;
  id: string;
  due: string;
  title: string | null;
  sub?: string | null;
  party?: string | null;
  party_key?: string | null;
  amount?: number | null;
  direction?: "pay" | "receive" | null;
  count?: number | null;
  contract_id?: string | null;
  product_id?: string | null;
  milestone_id?: string | null;
  followup_id?: string | null;
};

export type TodoItem = {
  /** `<tiền tố>:<uuid>:<YYYY-MM-DD>` — gửi lại khi Bỏ qua / Đã xong. */
  key: string;
  kind: TodoKind;
  /** > 0 trễ n ngày; 0 hôm nay; < 0 còn n ngày (Đánh giá / Thiếu file: ngày HĐ xong / tạo, luôn ≥ 0). */
  days: number;
  due: string;
  title: string | null;
  sub: string | null;
  party: string | null;
  party_key: string | null;
  amount: number | null;
  direction: "pay" | "receive" | null;
  count: number | null;
  contract_id: string | null;
  product_id: string | null;
  milestone_id: string | null;
  followup_id: string | null;
};
export type TodoOut = {
  today: string;
  items: TodoItem[];
  counts: { total: number; overdue: number };
  truncated: boolean;
};

/** Mức ưu tiên (mockup `pri`): quá hạn → việc có hạn gần → đánh giá → thiếu file. */
const PRI: Record<TodoKind, number> = {
  overdue: 0,
  due_soon: 1,
  contract_expiring: 1,
  customers_expiring: 1,
  renewal_contact: 1,
  commission: 1,
  rating: 2,
  rating_quarter: 2,
  market_price: 2,
  legal: 2,
  missing_file: 3,
};

/** BA §5.9 Đánh giá đối tác (nhắc lúc hết quý): chỉ trong 30 ngày đầu quý mới ⇒ đầu quý này + [đầu, cuối] quý trước; ngoài ⇒ null. */
export function quarterWindow(
  today: string,
): { start: string; prevStart: string; prevEnd: string } | null {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const q0 = Math.floor((m - 1) / 3) * 3;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const start = iso(Date.UTC(y, q0, 1));
  if (daysBetween(start, today) > 30) return null;
  return { start, prevStart: iso(Date.UTC(y, q0 - 3, 1)), prevEnd: iso(Date.UTC(y, q0, 0)) };
}

export const todoKey = (raw: RawKind, id: string, due: string) => `${raw}:${id}:${due}`;
const KEY_RE =
  /^([a-z_]{1,24}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{4}-\d{2}-\d{2})$/;
/** Khoá hợp lệ ⇒ (tiền tố, uuid, ngày); sai ⇒ null. */
export function parseTodoKey(key: string): { raw: RawKind; id: string; due: string } | null {
  const m = KEY_RE.exec(key);
  if (!m || !RAW_KINDS.includes(m[1] as RawKind)) return null;
  return { raw: m[1] as RawKind, id: m[2] as string, due: m[3] as string };
}

/** Đánh giá sau quý: `title` thô = đầu quý trước ⇒ "Đánh giá n đối tác sau quý Q/YYYY" (mockup). */
function titleOf(r: RawTodo): string | null {
  if (r.kind !== "rating_quarter" || !r.title) return r.title ?? null;
  const [y, m] = r.title.split("-").map(Number) as [number, number];
  return `Đánh giá ${r.count ?? 0} đối tác sau quý ${Math.floor((m - 1) / 3) + 1}/${y}`;
}

function kindOf(r: RawTodo, days: number): TodoKind {
  if (r.kind === "milestone") return days > 0 ? "overdue" : "due_soon";
  return r.kind;
}

export function todoItem(r: RawTodo, today: string): TodoItem {
  const days = daysBetween(r.due, today);
  return {
    key: todoKey(r.kind, r.id, r.due),
    kind: kindOf(r, days),
    days,
    due: r.due,
    title: titleOf(r),
    sub: r.sub ?? null,
    party: r.party ?? null,
    party_key: r.party_key ?? null,
    amount: r.amount ?? null,
    direction: r.direction ?? null,
    count: r.count ?? null,
    contract_id: r.contract_id ?? null,
    product_id: r.product_id ?? null,
    milestone_id: r.milestone_id ?? null,
    followup_id: r.followup_id ?? null,
  };
}

/** Quá hạn đầu (trễ lâu nhất trước); rồi theo mức, hạn gần trước; Đánh giá / Thiếu file mới nhất trước. */
export function compareTodo(a: TodoItem, b: TodoItem): number {
  const backward = (k: TodoKind) =>
    k === "rating" ||
    k === "rating_quarter" ||
    k === "missing_file" ||
    k === "market_price" ||
    k === "legal";
  return (
    PRI[a.kind] - PRI[b.kind] ||
    (backward(a.kind) ? b.due.localeCompare(a.due) : a.due.localeCompare(b.due)) ||
    a.key.localeCompare(b.key)
  );
}

/** Mỗi nguồn đọc tối đa `TODO_SOURCE_MAX + 1` hàng: dư ⇒ `truncated`. Mốc (quá hạn + sắp đến hạn) là một nguồn. */
export function buildTodo(raw: readonly RawTodo[], today: string): TodoOut {
  const per = new Map<RawKind, number>();
  for (const r of raw) per.set(r.kind, (per.get(r.kind) ?? 0) + 1);
  const cut = [...per.values()].some((n) => n > TODO_SOURCE_MAX);
  const seen = new Map<RawKind, number>();
  const kept = raw.filter((r) => {
    const n = (seen.get(r.kind) ?? 0) + 1;
    seen.set(r.kind, n);
    return n <= TODO_SOURCE_MAX;
  });
  const all = kept.map((r) => todoItem(r, today)).sort(compareTodo);
  const items = all.slice(0, TODO_MAX);
  return {
    today,
    items,
    counts: { total: items.length, overdue: items.filter((i) => i.kind === "overdue").length },
    truncated: cut || all.length > TODO_MAX,
  };
}
