// V2-O · dựng các hàng của bộ mẫu v2 (thuần, không DB): HĐ + dòng + mốc + SL giao + sổ kho/lô/BQ. Id ổn định (sha1 của khoá) ⇒ nạp
// lại ra đúng cùng id. Ngày VN của mockup dịch theo "hôm nay" thật (`shiftOf`).
import { createHash } from "node:crypto";
import { CONTRACTS } from "./seed-demo-v2.contracts";
import {
  type ContractSpec,
  type MsSpec,
  OWN,
  PARTNERS,
  type PKey,
  PRODUCTS,
  type ProductSpec,
} from "./seed-demo-v2.specs";

export const MOCK_TODAY = "2024-10-19";
export type Actors = { owner: string; editor: string };
export type Row = Record<string, unknown>;

export const uid = (ns: string, key: string): string => {
  const h = createHash("sha1").update(`demo-v2:${ns}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const DAY = 86_400_000;
export const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const shiftOf = (today: string): number =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${MOCK_TODAY}T00:00:00Z`)) / DAY);

/** "dd/mm/yyyy" của mockup → ngày ISO đã dịch theo hôm nay thật. */
export function vnDate(s: string, shift: number): string {
  const [d, m, y] = s.split("/").map(Number) as [number, number, number];
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return addDays(iso, shift);
}

function need<T>(x: T | undefined, what: string): T {
  if (x === undefined) throw new Error(`seed-demo-v2: thiếu ${what}`);
  return x;
}
export const partnerOf = (k: PKey) =>
  need(
    PARTNERS.find((p) => p.key === k),
    `đối tác ${k}`,
  );
export const partyKeyOf = (k: PKey): string => `tax:${partnerOf(k).tax}`;
export const productOf = (key: string): ProductSpec =>
  need(
    PRODUCTS.find((p) => p.key === key),
    `SP ${key}`,
  );
const fv = (value: string | number | boolean | null) => ({
  value,
  quote: "",
  verified: true,
  edited: false,
});

const REPS: Partial<Record<PKey, string>> = { ncca: "Nguyễn Văn A", abc: "Trần B" };
const OWN_REP = "Lê Thị Thuý Tiên";

function fieldsOf(c: ContractSpec, shift: number): Row {
  const p = partnerOf(c.partner);
  const own = { name: OWN.name, tax: OWN.tax, rep: OWN_REP };
  const other = { name: p.name, tax: p.tax, rep: REPS[c.partner] ?? null };
  const [sup, buyer] = c.deal === "buy" ? [other, own] : [own, other];
  const goods = c.items.some((i) => productOf(i.product).grp === "goods");
  const start = vnDate(c.start, shift);
  return {
    number: fv(c.number),
    title: fv(c.title),
    type: fv(c.deal === "buy" || goods ? "purchase" : "service"),
    supplier_name: fv(sup.name),
    supplier_tax_id: fv(sup.tax),
    supplier_representative: fv(sup.rep),
    buyer_name: fv(buyer.name),
    buyer_tax_id: fv(buyer.tax),
    buyer_representative: fv(buyer.rep),
    signed_date: fv(start),
    start_date: fv(start),
    end_date: fv(vnDate(c.end, shift)),
    notice_days: fv(c.notice),
    total_value: fv(c.value),
    payment_terms: fv(c.payment ?? null),
    auto_renew: fv(false),
  };
}

function aiReadOf(c: ContractSpec): Row | null {
  if (!c.summary) return null;
  return {
    deal: c.deal,
    unsure: [],
    summary: {
      main: c.summary,
      deadlines: [`Hết hạn ${c.end}`],
      penalties: [],
      bonuses: [],
      clauses: c.payment ? [c.payment] : [],
    },
    milestones: [],
  };
}

export function contractRows(a: Actors, tenant: string, shift: number): Row[] {
  return CONTRACTS.map((c) => {
    const start = vnDate(c.start, shift);
    return {
      id: uid("contract", c.key),
      tenant_id: tenant,
      kind: "contract",
      title: c.title,
      direction: c.deal === "buy" ? "purchase" : "sale",
      deal: c.deal,
      status: c.status,
      owner_user_id: a[c.who],
      created_by: a.owner,
      created_at: `${start}T08:00:00Z`,
      confirmed_at: `${start}T08:00:00Z`,
      confirmed_by: a.owner,
      fields: fieldsOf(c, shift),
      commission_pct: c.pct ?? null,
      ai_read: aiReadOf(c),
    };
  });
}

export function itemRows(tenant: string): Row[] {
  return CONTRACTS.flatMap((c) =>
    c.items.map((i, ord) => {
      const p = productOf(i.product);
      return {
        id: uid("item", `${c.key}:${i.key}`),
        tenant_id: tenant,
        contract_id: uid("contract", c.key),
        ord,
        name: i.name,
        unit: p.unit,
        qty: i.qty,
        unit_price: i.price,
        product_id: uid("product", p.key),
        component_ids: [uid("comp", p.key)],
        verified: true,
      };
    }),
  );
}

const msStatus = (m: MsSpec) => (m.done ? "done" : "open");
export function obligationRows(a: Actors, tenant: string, shift: number): Row[] {
  return CONTRACTS.flatMap((c) =>
    c.ms.map((m, i) => ({
      id: uid("ms", `${c.key}:${m.key}`),
      tenant_id: tenant,
      contract_id: uid("contract", c.key),
      party_key: partyKeyOf(c.partner),
      direction: c.deal === "buy" ? "pay" : "receive",
      kind: m.kind,
      seq: i + 1,
      due_date: vnDate(m.due, shift),
      amount: m.amount ?? null,
      status: msStatus(m),
      done_at: m.done ? vnDate(m.done, shift) : null,
      done_by: m.done ? a.owner : null,
      source: "manual",
      title: m.title,
      fault: m.done ? (m.fault ?? null) : null,
    })),
  );
}

export function milestoneItemRows(a: Actors, tenant: string): Row[] {
  return CONTRACTS.flatMap((c) =>
    c.ms.flatMap((m) =>
      (m.items ?? []).map(([item, qty]) => ({
        tenant_id: tenant,
        contract_id: uid("contract", c.key),
        milestone_id: uid("ms", `${c.key}:${m.key}`),
        contract_item_id: uid("item", `${c.key}:${item}`),
        qty,
        delivered: m.done ? qty : null,
        created_by: a.owner,
      })),
    ),
  );
}
