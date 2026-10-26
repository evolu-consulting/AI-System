// CR-097 G2 · GD-FR-01…05: logic thuần của màn Giao dịch — query danh sách, mô hình form nháp (chuỗi → thân API), tổng dòng,
// nhãn trạng thái, bảng kho trước → sau, câu lỗi (409 TRANSACTION_STATE/STOCK, 422 TRANSACTION_INVALID). Không DOM, không mạng.
import type {
  TransactionActionOut,
  TransactionDetail,
  TransactionDraft,
  TransactionLineIn,
  TransactionLineOut,
  TransactionListQuery,
} from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { parseMoney } from "~/components/shared/format";
import type { TagTone } from "~/components/shared/tag";

type T = (key: string) => string;

type TransactionStockChangeOut = TransactionActionOut["stock"][number];

export type TxStatus = "draft" | "posted" | "cancelled";
export type TxDeal = "buy" | "sell";

export const STATUS_TONE: Record<TxStatus, TagTone> = {
  draft: "soon",
  posted: "ok",
  cancelled: "grey",
};

/** Bộ lọc danh sách (chuỗi rỗng = không lọc). */
export type TxFilter = {
  status: "" | TxStatus;
  deal: "" | TxDeal;
  q: string;
  contract_id: string;
  from: string;
  to: string;
  page: number;
  limit: number;
};
export const EMPTY_FILTER: TxFilter = {
  status: "",
  deal: "",
  q: "",
  contract_id: "",
  from: "",
  to: "",
  page: 1,
  limit: 20,
};

/** Chuỗi query của `GET /transactions` — chỉ gửi trường có giá trị. */
export function listQuery(f: TxFilter): string {
  const u = new URLSearchParams();
  const set = (k: keyof TransactionListQuery, v: string) => {
    if (v.trim()) u.set(k, v.trim());
  };
  set("status", f.status);
  set("deal", f.deal);
  set("q", f.q);
  set("contract_id", f.contract_id);
  set("from", f.from);
  set("to", f.to);
  u.set("page", String(Math.max(1, f.page)));
  u.set("limit", String(f.limit));
  return u.toString();
}

export const hasFilter = (f: TxFilter): boolean =>
  !!(f.status || f.deal || f.q.trim() || f.contract_id || f.from || f.to);

// ── Số lượng / tiền ────────────────────────────────────────────────────────────

/** "1,5" / "1.5" → "1.5" (≤ 4 số lẻ, ≤ 14 số nguyên); sai dạng → null. Dạng "1.500" (nghìn) coi là 1.5 như API (dấu chấm = thập phân). */
export function normQty(s: string): string | null {
  const t = s.trim().replace(",", ".");
  return /^\d{1,14}(\.\d{1,4})?$/.test(t) ? t : null;
}

/** Thành tiền một dòng (đồng, làm tròn) — chỉ để hiện tạm trên form; số chính thức do máy chủ tính. */
export function lineAmount(qty: string, price: string): number {
  const q = normQty(qty);
  const p = parseMoney(price);
  if (q === null || p === null || Number.isNaN(p)) return 0;
  return Math.round(Number(q) * p);
}

// ── Form nháp ──────────────────────────────────────────────────────────────────

export type LineForm = {
  key: string;
  product_id: string;
  component_id: string;
  name: string;
  unit: string;
  qty: string;
  price: string;
};
export type TxForm = {
  deal: TxDeal;
  occurred_on: string;
  due_on: string;
  partner_name: string;
  partner_tax_id: string;
  contract_id: string;
  note: string;
  lines: LineForm[];
};

let seq = 0;
export const newLine = (): LineForm => ({
  key: `l${++seq}`,
  product_id: "",
  component_id: "",
  name: "",
  unit: "",
  qty: "1",
  price: "",
});

export const emptyForm = (today: string, deal: TxDeal = "sell"): TxForm => ({
  deal,
  occurred_on: today,
  due_on: "",
  partner_name: "",
  partner_tax_id: "",
  contract_id: "",
  note: "",
  lines: [newLine()],
});

export const lineFromOut = (l: TransactionLineOut): LineForm => ({
  key: `l${++seq}`,
  product_id: l.product_id ?? "",
  component_id: l.component_ids?.length === 1 ? (l.component_ids[0] ?? "") : "",
  name: l.name,
  unit: l.unit ?? "",
  qty: l.qty,
  price: String(l.unit_price),
});

export const formFromDetail = (d: TransactionDetail): TxForm => ({
  deal: d.deal,
  occurred_on: d.occurred_on,
  due_on: d.due_on ?? "",
  partner_name: d.partner_name,
  partner_tax_id: d.partner_tax_id ?? "",
  contract_id: d.contract_id ?? "",
  note: d.note ?? "",
  lines: d.lines.length ? d.lines.map(lineFromOut) : [newLine()],
});

export type FormError =
  | "partner"
  | "date"
  | "noLines"
  | { line: number; field: "name" | "qty" | "price" };

/** Câu lỗi form (i18n) — dòng sai nêu số thứ tự. */
export const formErrorText = (
  e: FormError,
  t: (k: string, o?: Record<string, unknown>) => string,
) =>
  typeof e === "string"
    ? t(`contracts.txn.formError.${e}`)
    : t(`contracts.txn.formError.line.${e.field}`, { n: e.line + 1 });

/** Dòng form → dòng API; sai → tên trường lỗi. */
export function lineToIn(l: LineForm): TransactionLineIn | "name" | "qty" | "price" {
  const name = l.name.trim();
  if (!name) return "name";
  const qty = normQty(l.qty);
  if (qty === null || Number(qty) <= 0) return "qty";
  const price = parseMoney(l.price);
  if (price === null || Number.isNaN(price)) return "price";
  return {
    name,
    qty,
    unit_price: price,
    product_id: l.product_id || null,
    component_ids: l.product_id && l.component_id ? [l.component_id] : null,
    unit: l.unit.trim() || null,
  };
}

export function linesToIn(
  lines: readonly LineForm[],
): { ok: true; lines: TransactionLineIn[] } | { ok: false; error: FormError } {
  if (!lines.length) return { ok: false, error: "noLines" };
  const out: TransactionLineIn[] = [];
  for (const [i, l] of lines.entries()) {
    const r = lineToIn(l);
    if (typeof r === "string") return { ok: false, error: { line: i, field: r } };
    out.push(r);
  }
  return { ok: true, lines: out };
}

/** Form → thân `POST/PATCH /transactions`; lỗi đầu tiên (đối tác → ngày → dòng). */
export function toDraft(
  f: TxForm,
): { ok: true; body: TransactionDraft } | { ok: false; error: FormError } {
  if (!f.partner_name.trim()) return { ok: false, error: "partner" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.occurred_on)) return { ok: false, error: "date" };
  const ls = linesToIn(f.lines);
  if (!ls.ok) return ls;
  return {
    ok: true,
    body: {
      deal: f.deal,
      occurred_on: f.occurred_on,
      due_on: f.due_on || null,
      partner_name: f.partner_name.trim(),
      partner_tax_id: f.partner_tax_id.trim() || null,
      contract_id: f.contract_id || null,
      note: f.note.trim() || null,
      lines: ls.lines,
    },
  };
}

export const formTotal = (lines: readonly LineForm[]): number =>
  lines.reduce((s, l) => s + lineAmount(l.qty, l.price), 0);

// ── Thao tác theo trạng thái ───────────────────────────────────────────────────

export type TxActions = {
  edit: boolean;
  remove: boolean;
  post: boolean;
  describe: boolean;
  adjust: boolean;
  cancel: boolean;
};
/** Theo luật G1: nháp sửa/xoá/ghi sổ; đã ghi sổ mô tả/điều chỉnh/huỷ; đã huỷ chỉ xem. Người chỉ-đọc không có thao tác. */
export function actionsOf(status: TxStatus, write: boolean): TxActions {
  const none = {
    edit: false,
    remove: false,
    post: false,
    describe: false,
    adjust: false,
    cancel: false,
  };
  if (!write) return none;
  if (status === "draft") return { ...none, edit: true, remove: true, post: true };
  if (status === "posted") return { ...none, describe: true, adjust: true, cancel: true };
  return none;
}

// ── Kho trước → sau ────────────────────────────────────────────────────────────

export type StockRow = {
  component_id: string;
  label: string;
  before: string;
  after: string;
  /** Tồn tăng / giảm / không đổi — chọn màu. */
  trend: "up" | "down" | "same";
  costBefore: number;
  costAfter: number;
};

/** `label` tra theo `component_id` (tên SP · thành phần); thiếu thì rút gọn id. */
export function stockRows(
  stock: readonly TransactionStockChangeOut[],
  labels: ReadonlyMap<string, string>,
): StockRow[] {
  return stock.map((s) => {
    const b = Number(s.on_hand_before);
    const a = Number(s.on_hand_after);
    return {
      component_id: s.component_id,
      label: labels.get(s.component_id) ?? s.component_id.slice(0, 8),
      before: s.on_hand_before,
      after: s.on_hand_after,
      trend: a > b ? "up" : a < b ? "down" : "same",
      costBefore: s.avg_cost_before,
      costAfter: s.avg_cost_after,
    };
  });
}

// ── Lỗi ────────────────────────────────────────────────────────────────────────

/** 409 TRANSACTION_STOCK / 422 TRANSACTION_INVALID: máy chủ soạn sẵn câu tiếng Việt nêu dòng/tồn ⇒ hiện nguyên văn. */
export function txErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    const code = e.code as string;
    if ((code === "TRANSACTION_STOCK" || code === "TRANSACTION_INVALID") && e.message)
      return e.message;
    if (code === "TRANSACTION_STATE") return t("contracts.txn.errors.state");
    if (e.status === 403) return t("contracts.txn.errors.forbidden");
    if (e.status === 404) return t("contracts.txn.errors.notFound");
    if (code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}

/** Lý do bắt buộc 3–500 ký tự (như `Reason` của API). */
export const reasonOk = (s: string): boolean => s.trim().length >= 3 && s.trim().length <= 500;

/** Khoá i18n của loại sự kiện trên dòng thời gian. */
export const eventKey = (type: string): string => `contracts.txn.event.${type}`;

/** Chuỗi tóm tắt `data` của sự kiện (total/lines/fields/changes) cho dòng thời gian; rỗng nếu không có gì đáng hiện. */
export function eventDetail(
  data: Record<string, unknown>,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const parts: string[] = [];
  if (typeof data.total === "number") parts.push(data.total.toLocaleString("vi-VN"));
  if (typeof data.lines === "number") parts.push(t("contracts.txn.eventLines", { n: data.lines }));
  if (Array.isArray(data.fields)) parts.push(data.fields.join(", "));
  if (data.changes && typeof data.changes === "object")
    parts.push(Object.keys(data.changes).join(", "));
  return parts.join(" · ");
}
