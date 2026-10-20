// V2-F · HD-01 · 5.5a · Q15: luật thuần của form hợp đồng (nhập tay + xác nhận sau upload) — trạng thái, ô bắt buộc (viền đỏ),
// giá trị tự cộng khi để trống, đọc số kiểu Việt ("91.500.000", SL "1,5"), thân `POST /contracts/manual`. Không React, không fetch.
import type { ContractDeal, ManualContractRequest } from "@ai/contracts";
import { parseMoney, parseQty } from "~/components/shared/format";

export type LineState = {
  /** V2-G: id dòng đã lưu (AI đọc) — màn xác nhận sửa tại chỗ, không xoá. */
  id?: string;
  name: string;
  unit: string;
  qty: string;
  unit_price: string;
  /** Sản phẩm danh mục đã chọn; `NEW` = tạo SP mới từ dòng (BA 5.5c). */
  product_id: string | typeof NEW_PRODUCT | "";
  component_id: string;
  /** Khi `product_id = NEW`: tên + nhóm SP mới. */
  new_name: string;
  new_group: "service" | "goods" | "referral";
  /** Gợi ý tự động đang được chọn (hiện nhãn "Gợi ý"). */
  suggested: boolean;
};
export const NEW_PRODUCT = "__new__" as const;

export type FormState = {
  deal: ContractDeal;
  title: string;
  number: string;
  partner_name: string;
  partner_tax_id: string;
  start_date: string;
  end_date: string;
  notice_days: string;
  total_value: string;
  commission_pct: string;
  commission_fixed: string;
  payment_terms: string;
  partner_signer: string;
  our_signer: string;
  items: LineState[];
};
export type TextKey = Exclude<keyof FormState, "items" | "deal">;

export const EMPTY_LINE: LineState = {
  name: "",
  unit: "",
  qty: "",
  unit_price: "",
  product_id: "",
  component_id: "",
  new_name: "",
  new_group: "goods",
  suggested: false,
};
export const EMPTY_FORM: FormState = {
  deal: "buy",
  title: "",
  number: "",
  partner_name: "",
  partner_tax_id: "",
  start_date: "",
  end_date: "",
  notice_days: "30",
  total_value: "",
  commission_pct: "",
  commission_fixed: "",
  payment_terms: "",
  partner_signer: "",
  our_signer: "",
  items: [EMPTY_LINE],
};

export const named = (items: readonly LineState[]) => items.filter((i) => i.name.trim());

/** Ô bắt buộc còn thiếu (đỏ viền + tên ô trong thông báo). Giới thiệu: cần % hoặc số tiền hoa hồng, không cần giá trị. */
export type RequiredKey = "title" | "partner_name" | "start_date" | "commission";
export function missingRequired(f: FormState): RequiredKey[] {
  const out: RequiredKey[] = [];
  if (!f.title.trim()) out.push("title");
  if (!f.partner_name.trim()) out.push("partner_name");
  if (f.deal === "referral" && !f.commission_pct.trim() && !f.commission_fixed.trim())
    out.push("commission");
  if (!f.start_date) out.push("start_date");
  return out;
}

/** 5.5a: dòng có tên mà chưa gắn SP danh mục (hoặc chọn "tạo mới" nhưng chưa đặt tên SP) ⇒ chưa được lưu. */
export function unlinkedLines(f: FormState): number[] {
  const out: number[] = [];
  f.items.forEach((l, i) => {
    if (!l.name.trim()) return;
    if (!l.product_id || (l.product_id === NEW_PRODUCT && !l.new_name.trim())) out.push(i);
  });
  return out;
}

/** Thành tiền của dòng (null khi thiếu SL hoặc đơn giá hoặc không đọc được). */
export function lineTotal(l: Pick<LineState, "qty" | "unit_price">): number | null {
  const q = parseQty(l.qty);
  const p = parseMoney(l.unit_price);
  if (q === null || p === null || Number.isNaN(q) || Number.isNaN(p)) return null;
  return Math.round(q * p);
}

/** Tổng các dòng có tên (bỏ dòng thiếu SL/giá); null khi không dòng nào tính được ⇒ giá trị HĐ để trống. */
export function autoTotal(items: readonly LineState[]): number | null {
  let sum = 0;
  let any = false;
  for (const l of named(items)) {
    const t = lineTotal(l);
    if (t === null) continue;
    sum += t;
    any = true;
  }
  return any ? sum : null;
}

/** Nhãn (key i18n) của ô số bị lỗi, kèm tên hàng nếu là dòng hàng. */
export type BadNumber = { key: string; name?: string };
export type Numbers = {
  notice_days: number | null;
  total_value: number | null;
  commission_pct: number | null;
  commission_fixed: number | null;
  lines: { qty: number | null; unit_price: number | null }[];
  bad: BadNumber[];
};

export function readNumbers(f: FormState): Numbers {
  const bad: BadNumber[] = [];
  const check = (b: BadNumber, v: number | null) => {
    if (v !== null && Number.isNaN(v)) bad.push(b);
    return v;
  };
  const pct = f.commission_pct.trim() ? Number(f.commission_pct.trim().replace(",", ".")) : null;
  if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) bad.push({ key: "pctShort" });
  const notice = check({ key: "noticeShort" }, parseMoney(f.notice_days));
  const total = check({ key: "valueShort" }, parseMoney(f.total_value));
  const fixed = check({ key: "fixedShort" }, parseMoney(f.commission_fixed));
  const lines = named(f.items).map((i) => ({
    qty: check({ key: "qtyOf", name: i.name }, parseQty(i.qty)),
    unit_price: check({ key: "priceOf", name: i.name }, parseMoney(i.unit_price)),
  }));
  return {
    notice_days: notice,
    total_value: total,
    commission_pct: pct !== null && !Number.isNaN(pct) ? pct : null,
    commission_fixed: fixed,
    lines,
    bad,
  };
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** Thân gửi API (chỉ gọi khi `bad` rỗng). `productIds`: id SP theo dòng có tên (đã tạo SP mới nếu cần). */
export function toRequest(
  f: FormState,
  n: Numbers,
  productIds: readonly (string | null)[],
): ManualContractRequest {
  const referral = f.deal === "referral";
  const total = referral ? null : (n.total_value ?? autoTotal(f.items));
  return {
    deal: f.deal,
    number: orNull(f.number),
    title: f.title.trim(),
    partner_name: f.partner_name.trim(),
    partner_tax_id: orNull(f.partner_tax_id),
    start_date: orNull(f.start_date),
    end_date: orNull(f.end_date),
    notice_days: n.notice_days,
    total_value: total,
    payment_terms: orNull(f.payment_terms),
    partner_signer: orNull(f.partner_signer),
    our_signer: orNull(f.our_signer),
    ...(referral ? { commission_pct: n.commission_pct, commission_fixed: n.commission_fixed } : {}),
    items: named(f.items).map((l, j) => {
      const pid = productIds[j] ?? null;
      return {
        name: l.name.trim(),
        unit: orNull(l.unit),
        ...n.lines[j],
        ...(pid ? { product_id: pid } : {}),
        ...(pid && l.component_id ? { component_ids: [l.component_id] } : {}),
      };
    }),
  };
}
