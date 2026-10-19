// HD-FR-26 · S04 · Q15: luật thuần form nhập tay — port `NewContractPage.tsx:8-35` (form rỗng, đọc số kiểu Việt "91.500.000",
// SL "1,5"; số không đọc được ⇒ dừng lưu và nêu tên ô) + thân `POST /pack/contracts/contracts/manual`.
import type { ManualContractRequest } from "@ai/contracts";
import { parseMoney, parseQty } from "~/components/shared/format";

export type ItemRow = { name: string; unit: string; qty: string; unit_price: string };
export type NewForm = {
  direction: "purchase" | "sale";
  number: string;
  title: string;
  partner_name: string;
  partner_tax_id: string;
  start_date: string;
  end_date: string;
  notice_days: string;
  total_value: string;
  payment_terms: string;
  partner_signer: string;
  our_signer: string;
  items: ItemRow[];
};
export const EMPTY_ITEM: ItemRow = { name: "", unit: "", qty: "", unit_price: "" };
export const EMPTY_FORM: NewForm = {
  direction: "purchase",
  number: "",
  title: "",
  partner_name: "",
  partner_tax_id: "",
  start_date: "",
  end_date: "",
  notice_days: "30",
  total_value: "",
  payment_terms: "",
  partner_signer: "",
  our_signer: "",
  items: [EMPTY_ITEM],
};

/** Nhãn (key i18n) của ô số bị lỗi, kèm tên hàng nếu là dòng hàng. */
export type BadNumber = { key: string; name?: string };

export function readNumbers(f: NewForm): {
  values: { notice_days: number | null; total_value: number | null };
  items: { qty: number | null; unit_price: number | null }[];
  bad: BadNumber[];
} {
  const bad: BadNumber[] = [];
  const check = (b: BadNumber, v: number | null) => {
    if (v !== null && Number.isNaN(v)) bad.push(b);
    return v;
  };
  const values = {
    notice_days: check({ key: "noticeShort" }, parseMoney(f.notice_days)),
    total_value: check({ key: "valueShort" }, parseMoney(f.total_value)),
  };
  const items = f.items
    .filter((i) => i.name.trim())
    .map((i) => ({
      qty: check({ key: "qtyOf", name: i.name }, parseQty(i.qty)),
      unit_price: check({ key: "priceOf", name: i.name }, parseMoney(i.unit_price)),
    }));
  return { values, items, bad };
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s);

/** Thân gửi API (chỉ gọi khi `bad` rỗng). */
export function toRequest(f: NewForm, n: ReturnType<typeof readNumbers>): ManualContractRequest {
  return {
    direction: f.direction,
    number: orNull(f.number),
    title: f.title,
    partner_name: f.partner_name,
    partner_tax_id: orNull(f.partner_tax_id),
    start_date: orNull(f.start_date),
    end_date: orNull(f.end_date),
    notice_days: n.values.notice_days,
    total_value: n.values.total_value,
    payment_terms: orNull(f.payment_terms),
    partner_signer: orNull(f.partner_signer),
    our_signer: orNull(f.our_signer),
    items: f.items
      .filter((i) => i.name.trim())
      .map((i, j) => ({ name: i.name, unit: orNull(i.unit), ...n.items[j] })),
  };
}
