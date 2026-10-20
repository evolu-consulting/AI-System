// V2-O · danh mục SP + thành phần + giá NCC + đối tác (danh bạ, vai tay, việc, sao, ghi chú, điểm đã chốt). Thuần.
import { type Actors, partnerOf, partyKeyOf, type Row, uid, vnDate } from "./seed-demo-v2.build";
import { JOBS, NOTES, RATINGS, TRENDS } from "./seed-demo-v2.people";
import { PARTNERS, PRICES, PRODUCTS, type ProductSpec } from "./seed-demo-v2.specs";
import type { StockPlan } from "./seed-demo-v2.stock";

const modeOf = (p: ProductSpec) =>
  p.grp === "goods" ? "stock" : p.grp === "service" ? "quota" : "none";

export function productRows(tenant: string, stock: StockPlan, a: Actors) {
  const products = PRODUCTS.map((p) => ({
    id: uid("product", p.key),
    tenant_id: tenant,
    name: p.name,
    unit: p.unit,
    grp: p.grp,
    main_supplier_party_key: p.supplier ? partyKeyOf(p.supplier) : null,
    main_supplier_name: p.supplier ? partnerOf(p.supplier).name : null,
    created_from_contract_id: p.fromContract ? uid("contract", p.fromContract) : null,
    created_by: a.owner,
  }));
  const comps = PRODUCTS.map((p) => {
    const id = uid("comp", p.key);
    const s = stock.comps.get(id);
    return {
      id,
      tenant_id: tenant,
      product_id: uid("product", p.key),
      ord: 0,
      name: p.name,
      unit: p.unit,
      mode: modeOf(p),
      on_hand: s?.onHand ?? 0,
      stock_value: s?.value ?? 0,
      avg_cost: s?.avg ?? 0,
      last_move_id: s?.lastMove ?? null,
    };
  });
  const rules = PRODUCTS.flatMap((p) =>
    p.rules.map((pattern) => ({
      id: uid("rule", `${p.key}:${pattern}`),
      tenant_id: tenant,
      product_id: uid("product", p.key),
      component_id: uid("comp", p.key),
      pattern,
      created_by: a.owner,
    })),
  );
  return { products, comps, rules };
}

export function priceRows(tenant: string, a: Actors, shift: number): Row[] {
  return PRICES.map((x, i) => ({
    id: uid("price", String(i)),
    tenant_id: tenant,
    product_id: uid("product", x.product),
    supplier_name: x.supplier,
    supplier_party_key: x.party ? partyKeyOf(x.party) : null,
    kind: x.kind,
    price: x.price,
    unit: PRODUCTS.find((p) => p.key === x.product)?.unit ?? null,
    source: x.source,
    seen_on: vnDate(x.seen, shift),
    note: x.vat ? "Giá đã gồm VAT" : "Giá chưa VAT",
    created_by: a.owner,
  }));
}

export const companyRows = (tenant: string): Row[] =>
  PARTNERS.map((p) => ({
    tenant_id: tenant,
    party_key: partyKeyOf(p.key),
    tax_id: p.tax,
    name: p.name,
    short_name: p.short,
    created_from: "seed",
  }));

/** Vai đối tác chưa có HĐ (Hãng FAST — mới nhận báo giá): trigger HĐ chỉ tạo vai khi có HĐ. */
export const manualRoleRows = (tenant: string, a: Actors): Row[] =>
  PARTNERS.filter((p) => p.manual).map((p) => ({
    tenant_id: tenant,
    party_key: partyKeyOf(p.key),
    role: "supplier",
    name: p.name,
    created_from: "manual",
    created_by: a.owner,
  }));

export function jobRows(tenant: string, a: Actors, shift: number): Row[] {
  return JOBS.map((j) => ({
    tenant_id: tenant,
    party_key: partyKeyOf(j.party),
    role: j.role,
    type: "job",
    at: vnDate(j.at, shift),
    by_user: a[j.by],
    source: "action",
    contract_id: j.contract ? uid("contract", j.contract) : null,
    grp: j.grp,
    job_type: j.type,
    note: j.note,
  }));
}

export function ratingRows(tenant: string, a: Actors, shift: number): Row[] {
  return RATINGS.flatMap((r) =>
    Object.entries(r.stars).map(([criterion, stars]) => ({
      tenant_id: tenant,
      party_key: partyKeyOf(r.party),
      role: r.role,
      grp: r.grp,
      criterion,
      stars,
      reason: r.reasons?.[criterion] ?? null,
      by_user: a[r.by],
      at: `${vnDate(r.at, shift)}T09:00:00Z`,
    })),
  );
}

export const noteRows = (tenant: string, a: Actors, shift: number): Row[] =>
  NOTES.map((n) => ({
    tenant_id: tenant,
    party_key: partyKeyOf(n.party),
    body: n.body,
    source: "manual",
    created_by: a[n.by],
    created_at: `${vnDate(n.at, shift)}T09:00:00Z`,
  }));

export const levelOf = (s: number): "good" | "fair" | "watch" =>
  s >= 85 ? "good" : s >= 70 ? "fair" : "watch";

/** 6 kỳ tháng đã qua (đầu tháng), cũ → mới: điểm đã chốt cho biểu đồ 3/6/12 tháng. */
export function lockRows(tenant: string, today: string): { locks: Row[]; runs: Row[] } {
  const first = `${today.slice(0, 8)}01`;
  const month = (back: number) => {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - back);
    return d.toISOString().slice(0, 10);
  };
  const locks = TRENDS.flatMap((t) =>
    t.scores.map((s, i) => ({
      tenant_id: tenant,
      period: month(t.scores.length - i),
      party_key: partyKeyOf(t.party),
      role: t.role,
      grp: t.grp,
      score: s,
      data_score: s,
      level: levelOf(s),
      jobs: t.jobs,
      detail: {},
    })),
  );
  const periods = [...new Set(locks.map((l) => l.period))];
  const runs = periods.map((period) => ({
    tenant_id: tenant,
    period,
    rows: locks.filter((l) => l.period === period).length,
  }));
  return { locks, runs };
}
