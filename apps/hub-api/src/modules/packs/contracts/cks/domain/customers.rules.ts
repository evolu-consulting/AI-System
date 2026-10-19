// HD-FR-93 · BR-5 · BR-6 · D9-08 · D9-14: gom chữ ký còn hiệu lực thành khách + nhóm bán (S10/S11) và đếm tổng quan — port
// `mgmt-app/api/app/cks/overview.py`. Lớp 1 — thuần; đầu vào là hàng SQL đã lọc tenant, sắp theo (`valid_to`, `id`).
import { certLabel, daysBetween } from "./sale.rules";

export type CertRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  serial: string | null;
  ca: string;
  device: "token" | "remote";
  holder_name: string;
  holder_title: string | null;
  keeper: string | null;
  valid_from: string | null;
  valid_to: string;
  source: "ours" | "elsewhere";
  lot_id: string | null;
  sale_contract_id: string | null;
  sale_price: number | null;
  status: "active" | "pending_renewal" | "replaced" | "revoked";
  signed_count: number;
  sale_number: string | null;
  sale_signed_at: string | null;
  renewal_id: string | null;
};

export type CustomerFilter = {
  filter?: "expiring" | "expired" | "elsewhere";
  lot?: string;
  ca?: string;
};

const LIVE = new Set(["active", "pending_renewal"]);

/** CA xuất hiện nhiều nhất; hoà ⇒ CA gặp trước (thứ tự `valid_to`), như `Counter.most_common(1)`. */
function topCa(group: readonly CertRow[]): string {
  const n = new Map<string, number>();
  for (const c of group) n.set(c.ca, (n.get(c.ca) ?? 0) + 1);
  let best = group[0]?.ca ?? "";
  for (const [ca, k] of n) if (k > (n.get(best) ?? 0)) best = ca;
  return best;
}

function saleGroup(id: string, group: readonly CertRow[]) {
  const first = group[0] as CertRow;
  const price = first.sale_price;
  return {
    contract_id: id,
    number: first.sale_number,
    signed_at: first.sale_signed_at,
    count: group.length,
    price_each: price,
    total: price === null ? null : price * group.length,
    paid: false, // D9-08: công nợ là HD7
    valid_to: group.reduce((m, c) => (c.valid_to < m ? c.valid_to : m), first.valid_to),
    renewal: first.renewal_id ? { id: first.renewal_id, status: "open" as const } : null,
  };
}

const certOut = (c: CertRow) => ({
  id: c.id,
  company_id: c.customer_id,
  serial: c.serial,
  ca: c.ca,
  device: c.device,
  holder_name: c.holder_name,
  holder_title: c.holder_title,
  label: certLabel(c),
  valid_from: c.valid_from,
  valid_to: c.valid_to,
  sale_price: c.sale_price,
  signed_count: c.signed_count,
  status: c.status,
  keeper: c.keeper,
  source: c.source,
  lot_id: c.lot_id,
  sale_contract_id: c.sale_contract_id,
});

function passes(
  group: readonly CertRow[],
  left: number,
  elsewhere: boolean,
  f: CustomerFilter,
): boolean {
  if (f.lot && !group.some((c) => c.lot_id === f.lot)) return false;
  if (f.ca && !group.some((c) => c.ca === f.ca)) return false;
  if (f.filter === "expiring") return left >= 0 && left <= 30;
  if (f.filter === "expired") return left < 0;
  if (f.filter === "elsewhere") return elsewhere;
  return true;
}

function customer(group: readonly CertRow[], today: string) {
  const first = group[0] as CertRow;
  const earliest = group.reduce((m, c) => (c.valid_to < m ? c.valid_to : m), first.valid_to);
  const bySale = new Map<string, CertRow[]>();
  for (const c of group)
    if (c.sale_contract_id)
      bySale.set(c.sale_contract_id, [...(bySale.get(c.sale_contract_id) ?? []), c]);
  const sales = [...bySale.entries()]
    .map(([id, g]) => saleGroup(id, g))
    .sort(
      (a, b) =>
        (a.signed_at ?? "").localeCompare(b.signed_at ?? "") ||
        (a.number ?? "").localeCompare(b.number ?? ""),
    );
  const elsewhere = sales.length === 0 && group.every((c) => c.source === "elsewhere");
  return {
    company_id: first.customer_id,
    name: first.customer_name,
    cert_count: group.length,
    group_count: sales.length,
    ca: topCa(group),
    earliest,
    days_left: daysBetween(today, earliest),
    sale_price: sales.length ? group.reduce((s, c) => s + (c.sale_price ?? 0), 0) : null,
    signed_count: group.reduce((s, c) => s + c.signed_count, 0),
    elsewhere,
    has_sale: sales.length > 0,
    sales,
    certs: group.map(certOut),
  };
}
export type CksCustomerOut = ReturnType<typeof customer>;

/** Khách có ≥ 1 chữ ký còn hiệu lực, lọc rồi sắp theo (`days_left`, tên) (`overview.py:44-73`). */
export function groupCustomers(
  rows: readonly CertRow[],
  today: string,
  f: CustomerFilter = {},
): CksCustomerOut[] {
  const by = new Map<string, CertRow[]>();
  for (const r of rows)
    if (LIVE.has(r.status)) {
      const g = by.get(r.customer_id);
      if (g) g.push(r);
      else by.set(r.customer_id, [r]);
    }
  const out: CksCustomerOut[] = [];
  for (const group of by.values()) {
    const c = customer(group, today);
    if (passes(group, c.days_left, c.elsewhere, f)) out.push(c);
  }
  return out.sort(
    (a, b) => a.days_left - b.days_left || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** Hàng danh sách S10: chữ ký chỉ giữ cột màn hiện (`CksPage.tsx:176-187`) — chi tiết ở `GET /customers/:id`. */
export function briefCustomer(c: CksCustomerOut) {
  return {
    ...c,
    certs: c.certs.map((x) => ({
      id: x.id,
      label: x.label,
      device: x.device,
      ca: x.ca,
      valid_to: x.valid_to,
      sale_price: x.sale_price,
      signed_count: x.signed_count,
      sale_contract_id: x.sale_contract_id,
    })),
  };
}
