// HD-FR-91 · HD-FR-92 · HD-FR-94 · D9-04 · D9-19 · D9-20: luật thuần lô/bán/gia hạn CKS — port `mgmt-app/api/app/cks/{lots,sales}.py`.
// Ngày là chuỗi ISO `YYYY-MM-DD` (không múi giờ); tiền là số nguyên đồng (BR-1). Lớp 1 — chỉ built-in + domain gói.
import {
  type ContractFieldKey,
  type ContractFields,
  type FieldValue,
  fillFields,
} from "../../domain/fields.rules";

/** Pháp nhân của mình khi chưa có danh bạ (D9-04, `lots.py:9`). */
export const US_FALLBACK = "Công ty của chúng tôi";

const DAY = 86_400_000;
const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, n: number): string =>
  new Date(utc(iso) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number =>
  Math.round((utc(to) - utc(from)) / DAY);

/** Hôm nay theo múi giờ tenant (BR-6). */
export const todayIn = (now: Date, timeZone: string): string =>
  now.toLocaleDateString("en-CA", { timeZone });

/** `sales.py:98-99`: cùng ngày/tháng, `years` năm sau; tháng 2 ⇒ ngày ≤ 28. */
export function plusYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  const m = iso.slice(5, 7);
  const d = m === "02" ? Math.min(Number(iso.slice(8, 10)), 28) : Number(iso.slice(8, 10));
  return `${String(y).padStart(4, "0")}-${m}-${String(d).padStart(2, "0")}`;
}

/** Hạn mới của lượt gia hạn: max(hôm nay, hạn sớm nhất nhóm) + `years` (BR-8). */
export const renewalValidTo = (today: string, earliest: string, years: number): string =>
  plusYears(earliest > today ? earliest : today, years);

/** Số kế `CKS-<năm>-NNN` = lớn nhất đang dùng + 1 (`sales.py:19-24`). */
export function nextSaleNumber(year: string, used: readonly (string | null)[]): string {
  const re = new RegExp(`^CKS-${year}-(\\d+)$`);
  let max = 0;
  for (const n of used) {
    const m = n ? re.exec(n) : null;
    if (m?.[1]) max = Math.max(max, Number(m[1]));
  }
  return `CKS-${year}-${String(max + 1).padStart(3, "0")}`;
}

/** MST (D9-20, review M2) — port `registry.py::normalize_tax_id` (cùng luật `normalizeTaxId` của contract, biên đã trả 400):
 *  bỏ khoảng trắng/chấm; 10 / 12 số hoặc 10-3 (13 số liền ⇒ thêm gạch); sai dạng hoặc rỗng ⇒ null (không bao giờ thành khoá). */
export function normTaxId(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[\s.]/g, "");
  if (s.includes("-") && !/^\d{10}-\d{3}$/.test(s)) return null;
  const digits = s.replace("-", "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 13) return `${digits.slice(0, 10)}-${digits.slice(10)}`;
  return digits.length === 10 || digits.length === 12 ? digits : null;
}

/** "Chữ ký công ty", "Giám đốc · Lê Văn Tâm" (`overview.py:26-28`). */
export const certLabel = (c: { holder_name: string; holder_title: string | null }): string =>
  c.holder_title ? `${c.holder_title} · ${c.holder_name}` : c.holder_name;

/** Nhãn lô mặc định = `YYYY-MM` của ngày mua (`lots.py:24`). */
export const lotLabel = (label: string | null, boughtAt: string): string =>
  label ?? boughtAt.slice(0, 7);

function fields(typed: Partial<Record<ContractFieldKey, FieldValue>>): ContractFields {
  const out = fillFields({});
  for (const [k, v] of Object.entries(typed) as [ContractFieldKey, FieldValue | undefined][])
    if (v !== null && v !== undefined)
      out[k] = { value: v, quote: "", verified: true, edited: true };
  return out;
}

export type CksContract = {
  title: string;
  direction: "purchase" | "sale";
  fields: ContractFields;
  item: { name: string; unit: string; qty: number; unit_price: number };
};

/** HĐ mua lô (`lots.py:27-32`). */
export function lotContract(l: {
  label: string;
  ca: string;
  qty: number;
  unit_cost: number;
  years: number;
  bought_at: string;
  supplier_name: string | null;
  supplier_tax_id: string | null;
}): CksContract {
  const title = `Mua lô ${l.qty} chữ ký · ${l.label}`;
  return {
    title,
    direction: "purchase",
    fields: fields({
      number: `LO-${l.label}`,
      title,
      supplier_name: l.supplier_name ?? l.ca,
      supplier_tax_id: l.supplier_tax_id,
      buyer_name: US_FALLBACK,
      signed_date: l.bought_at,
      start_date: l.bought_at,
      total_value: l.qty * l.unit_cost,
    }),
    item: {
      name: `Chữ ký số ${l.ca} ${l.years} năm`,
      unit: "chữ ký",
      qty: l.qty,
      unit_price: l.unit_cost,
    },
  };
}

/** HĐ bán / gia hạn (`sales.py:27-39`). */
export function saleContract(s: {
  number: string;
  renewal: boolean;
  customer: string;
  customerTax: string | null;
  ca: string;
  count: number;
  price_each: number;
  signed_at: string;
  valid_to: string;
}): CksContract {
  const title = `${s.renewal ? "Gia hạn" : "Dịch vụ"} chữ ký số · ${s.number}`;
  return {
    title,
    direction: "sale",
    fields: fields({
      number: s.number,
      title,
      supplier_name: US_FALLBACK,
      buyer_name: s.customer,
      buyer_tax_id: s.customerTax,
      signed_date: s.signed_at,
      start_date: s.signed_at,
      end_date: s.valid_to,
      notice_days: 30,
      total_value: s.count * s.price_each,
    }),
    item: { name: `Chữ ký số ${s.ca}`, unit: "chữ ký", qty: s.count, unit_price: s.price_each },
  };
}

/** Serial trùng trong cùng lệnh (khoá chuẩn hoá) ⇒ true (BR-7, G12). */
export function hasDuplicate(keys: readonly (string | null)[]): boolean {
  const xs = keys.filter((k): k is string => k !== null);
  return new Set(xs).size !== xs.length;
}
