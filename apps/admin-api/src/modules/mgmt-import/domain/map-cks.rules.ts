// I1 · CKS mgmt-app (cks_lots, cks_certificates, cks_renewals, signed_docs, market_observations[cks], followups) ⇒ bảng
// `contracts.cks_*`. Khách CKS = công ty được chữ ký/gia hạn/văn bản/hẹn nhắc trỏ tới; hàng con mang (MST, tên) khách để SQL
// tra `customer_id` theo khoá tự nhiên (đúng cả khi khách đã có sẵn). Tiền = số nguyên đồng, không làm tròn. Thuần.
import { type Company, customerOf } from "./companies.rules";
import { type Ctx, docsOf, idOf, type Snapshot, type SourceDoc } from "./context";
import { eachOrgDoc } from "./each.rules";
import { addMoney, type Plan, push, type Row, type TenantPlan, tenantPlan } from "./plan";
import { bool, day, int, lowerEmail, money, serialKey, str, ts } from "./values.rules";

const CERT_STATUS = new Set(["active", "pending_renewal", "replaced", "revoked"]);
const DOC_KIND = new Set(["invoice", "tax_return", "contract", "other"]);
const device = (v: unknown): string => (v === "remote" ? "remote" : "token");
const cap = (v: number | null): number | null => (v !== null && v <= 10_000_000_000 ? v : null);

type Cks = {
  companies: Map<string, Company>;
  lots: Set<string>;
  certs: Set<string>;
  renewals: Set<string>;
  /** `tenant|serial_key` đã dùng (khoá duy nhất chữ ký). */
  serials: Set<string>;
  /** `tenant|sha|serial` đã dùng (khoá duy nhất văn bản ký). */
  signed: Set<string>;
};

/** Khách: thêm hàng cks_customers (gộp theo khoá) + trả cột tra cứu cho hàng con. */
function customer(t: TenantPlan, k: Cks, ctx: Ctx, companyId: string | null): Row | null {
  if (!companyId) return null;
  const c = customerOf(k.companies, companyId);
  const rows = t.rows["contracts.cks_customers"] ?? [];
  if (!rows.some((r) => r.key === c.key))
    push(t, "contracts.cks_customers", {
      id: idOf(ctx, "company", companyId),
      name: c.name,
      tax_id: c.tax,
      key: c.key,
    });
  return { cust_name: c.name, cust_tax: c.tax };
}

function mapLot(d: SourceDoc, t: TenantPlan, ctx: Ctx, k: Cks): void {
  const s = d.src;
  const ref = `cks_lots/${d.id}`;
  const qty = int(s.qty, 1, 100_000);
  const cost = cap(money(s.unit_cost, ctx.issues, "cks_lot", ref));
  const bought = day(s.bought_at);
  const pc = str(s.purchase_contract_id, 128);
  if (qty === null || cost === null || !bought || !pc) {
    ctx.issues.push({ entity: "cks_lot", ref, code: "LOT_INCOMPLETE" });
    return;
  }
  push(t, "contracts.cks_lots", {
    id: idOf(ctx, "lot", d.id),
    label: str(s.label, 40) ?? d.id.slice(0, 40),
    ca: str(s.ca, 60) ?? "?",
    qty,
    unit_cost: cost,
    years: int(s.years, 1, 5) ?? 1,
    device: device(s.device),
    bought_at: bought,
    purchase_contract_id: idOf(ctx, "contract", pc),
    created_by: ctx.fallbackUser(t.tenantId),
    created_at: ts(s.created_at),
  });
  k.lots.add(d.id);
  addMoney(t, "cks_lots.qty_x_unit_cost", BigInt(qty) * BigInt(cost));
}

/** review B#21: lô bị bỏ (LOT_INCOMPLETE) hoặc không có ⇒ null + LOT_MISSING (không để FK `cks_certificates_lot_fk` rollback cả lô). */
function lotRef(v: unknown, k: Cks, ctx: Ctx, ref: string): string | null {
  const id = str(v, 128);
  if (!id) return null;
  if (k.lots.has(id)) return idOf(ctx, "lot", id);
  ctx.issues.push({ entity: "cks_certificate", ref, code: "LOT_MISSING" });
  return null;
}

function mapCert(d: SourceDoc, t: TenantPlan, ctx: Ctx, k: Cks): void {
  const seen = k.serials;
  const s = d.src;
  const ref = `cks_certificates/${d.id}`;
  const validTo = day(s.valid_to);
  const cust = customer(t, k, ctx, str(s.company_id, 300));
  if (!validTo || !cust) {
    ctx.issues.push({ entity: "cks_certificate", ref, code: "CERT_INCOMPLETE" });
    return;
  }
  let sk = serialKey(s.serial);
  if (sk && seen.has(`${t.tenantId}|${sk}`)) {
    ctx.issues.push({ entity: "cks_certificate", ref, code: "SERIAL_DUP" });
    sk = null;
  }
  if (sk) seen.add(`${t.tenantId}|${sk}`);
  const price = cap(money(s.sale_price, ctx.issues, "cks_certificate", ref));
  const ref2 = (v: unknown, kind: string) =>
    str(v, 128) ? idOf(ctx, kind, str(v, 128) as string) : null;
  push(t, "contracts.cks_certificates", {
    id: idOf(ctx, "cert", d.id),
    ...cust,
    serial: str(s.serial, 100),
    serial_key: sk,
    ca: str(s.ca, 60) ?? "?",
    device: device(s.device),
    holder_name: str(s.holder_name, 200) ?? str(s.serial, 200) ?? "?",
    holder_title: str(s.holder_title, 200),
    keeper: str(s.keeper, 200),
    valid_from: day(s.valid_from),
    valid_to: validTo,
    source: s.source === "elsewhere" ? "elsewhere" : "ours",
    lot_id: lotRef(s.lot_id, k, ctx, ref),
    sale_contract_id: ref2(s.sale_contract_id, "contract"),
    sale_price: price,
    status: CERT_STATUS.has(String(s.status)) ? s.status : "active",
    replaces: ref2(s.replaces, "cert"),
    replaced_by: ref2(s.replaced_by, "cert"),
    created_by: ctx.userOf(t.tenantId, lowerEmail(s.created_by)),
    created_at: ts(s.created_at),
  });
  k.certs.add(d.id);
  addMoney(t, "cks_certificates.sale_price", price);
}

function mapRenewal(d: SourceDoc, t: TenantPlan, ctx: Ctx, k: Cks): void {
  const s = d.src;
  const ref = `cks_renewals/${d.id}`;
  const certs = (Array.isArray(s.certificate_ids) ? s.certificate_ids : []).filter(
    (c): c is string => typeof c === "string" && k.certs.has(c),
  );
  const price = cap(money(s.price_each, ctx.issues, "cks_renewal", ref));
  const sale = str(s.sale_contract_id, 128);
  const next = str(s.new_contract_id, 128);
  const validTo = day(s.valid_to);
  const cust = customer(t, k, ctx, str(s.company_id, 300));
  if (!certs.length || price === null || !sale || !next || !validTo || !cust) {
    ctx.issues.push({ entity: "cks_renewal", ref, code: "RENEWAL_INCOMPLETE" });
    return;
  }
  push(t, "contracts.cks_renewals", {
    id: idOf(ctx, "renewal", d.id),
    sale_contract_id: idOf(ctx, "contract", sale),
    ...cust,
    certificate_ids: certs.slice(0, 500).map((c) => idOf(ctx, "cert", c)),
    status: ["open", "done", "lost"].includes(String(s.status)) ? s.status : "open",
    new_contract_id: idOf(ctx, "contract", next),
    price_each: price,
    valid_to: validTo,
    lost_reason: str(s.lost_reason, 500),
    created_by: ctx.userOf(t.tenantId, lowerEmail(s.by)) ?? ctx.fallbackUser(t.tenantId),
    created_at: ts(s.created_at),
    done_at: day(s.done_at),
  });
  k.renewals.add(d.id);
  addMoney(t, "cks_renewals.price_each", price);
}

function mapSigned(d: SourceDoc, t: TenantPlan, ctx: Ctx, k: Cks): void {
  const seen = k.signed;
  const s = d.src;
  const sha = typeof s.sha256 === "string" && /^[0-9a-f]{64}$/.test(s.sha256) ? s.sha256 : null;
  const filename = str(s.filename, 255);
  const sk = serialKey(s.serial);
  const once = `${t.tenantId}|${sha}|${sk ?? ""}`;
  if (!sha || !filename || seen.has(once)) {
    ctx.issues.push({
      entity: "cks_signed_doc",
      ref: `signed_docs/${d.id}`,
      code: sha ? "SIGNED_DUP" : "SIGNED_NO_SHA",
    });
    return;
  }
  seen.add(once);
  const cert = str(s.certificate_id, 128);
  push(t, "contracts.cks_signed_docs", {
    id: idOf(ctx, "signed", d.id),
    ...(customer(t, k, ctx, str(s.company_id, 300)) ?? { cust_name: null, cust_tax: null }),
    certificate_id: cert && k.certs.has(cert) ? idOf(ctx, "cert", cert) : null,
    serial_key: sk,
    kind: DOC_KIND.has(String(s.kind)) ? s.kind : "other",
    number: str(s.number, 100),
    title: str(s.title, 300) ?? filename,
    signed_at: day(s.signed_at),
    period: str(s.period, 50),
    source: s.source === "pdf" ? "pdf" : "xml",
    filename,
    sha256: sha,
    unsigned: bool(s.unsigned),
    created_by: ctx.userOf(t.tenantId, lowerEmail(s.by)) ?? ctx.fallbackUser(t.tenantId),
    created_at: ts(s.created_at),
  });
}

function marketRow(d: SourceDoc, t: TenantPlan, ctx: Ctx): void {
  const s = d.src;
  const caKey = str(s.ca, 40);
  const years = int(s.years, 1, 5);
  const seller = str(s.seller, 200);
  const seen = day(s.seen);
  if (!caKey || years === null || !seller || !seen) {
    ctx.issues.push({
      entity: "cks_market_price",
      ref: `market_observations/${d.id}`,
      code: "MARKET_INCOMPLETE",
    });
    return;
  }
  const price = cap(money(s.price_ex_vat, ctx.issues, "cks_market_price", d.id));
  push(t, "contracts.cks_market_prices", {
    id: idOf(ctx, "market", `${t.tenantId}|${d.id}`),
    ca_key: caKey,
    ca_name: str(s.ca_name, 100),
    years,
    kind: s.kind === "new" || s.kind === "renew" ? s.kind : null,
    device: s.device === "token" || s.device === "remote" ? s.device : null,
    seller,
    tier: str(s.tier, 100),
    price_ex_vat: price,
    url: str(s.url, 2000),
    verified: bool(s.verified),
    seen,
  });
  addMoney(t, "cks_market_prices.price_ex_vat", price);
}

/** Giá thị trường CKS: hàng dùng chung (`org_id = "*"`) chép vào MỌI tenant được nhập; hàng của org vào tenant đó. */
function mapMarket(s: Snapshot, ctx: Ctx, p: Plan): void {
  for (const d of docsOf(s, "market_observations")) {
    if (d.src.product_kind !== "cks") continue;
    if (d.src.org_id === "*") for (const t of p.tenants.values()) marketRow(d, t, ctx);
    else {
      const org = str(d.src.org_id, 128);
      const tid = ctx.tenantOf(org);
      if (tid && org) marketRow(d, tenantPlan(p, tid, org), ctx);
    }
  }
}

/** Hẹn nhắc về một gia hạn/khách CKS ⇒ cks_followups; hẹn khác (đợt, HĐ) chưa có bảng ⇒ trả về để vào vùng chờ. */
function mapFollowup(d: SourceDoc, t: TenantPlan, ctx: Ctx, k: Cks): boolean {
  const s = d.src;
  const subject = str(s.subject_id, 300);
  const user = ctx.userOf(t.tenantId, lowerEmail(s.user_email));
  const due = ts(s.at);
  if (!subject || !user || !due) return false;
  const base = {
    id: idOf(ctx, "followup", d.id),
    user_id: user,
    due_at: due,
    note: str(s.note, 200) ?? str(s.title, 200),
    created_at: ts(s.created_at),
    done_at: s.status === "done" ? (ts(s.done_at) ?? due) : null,
  };
  if (k.renewals.has(subject)) {
    push(t, "contracts.cks_followups", {
      ...base,
      renewal_id: idOf(ctx, "renewal", subject),
      cust_name: null,
      cust_tax: null,
    });
    return true;
  }
  const isCustomer = (t.rows["contracts.cks_customers"] ?? []).some(
    (r) => r.id === idOf(ctx, "company", subject),
  );
  if (!isCustomer) return false;
  push(t, "contracts.cks_followups", {
    ...base,
    renewal_id: null,
    ...(customer(t, k, ctx, subject) as Row),
  });
  return true;
}

/** Trả id followup đã chuyển (phần còn lại vào vùng chờ). */
export function mapCks(
  s: Snapshot,
  ctx: Ctx,
  p: Plan,
  companies: Map<string, Company>,
): Set<string> {
  const k: Cks = {
    companies,
    lots: new Set(),
    certs: new Set(),
    renewals: new Set(),
    serials: new Set(),
    signed: new Set(),
  };
  eachOrgDoc({ s, ctx, p }, "cks_lots", (d, t) => mapLot(d, t, ctx, k));
  eachOrgDoc({ s, ctx, p }, "cks_certificates", (d, t) => mapCert(d, t, ctx, k));
  eachOrgDoc({ s, ctx, p }, "cks_renewals", (d, t) => mapRenewal(d, t, ctx, k));
  eachOrgDoc({ s, ctx, p }, "signed_docs", (d, t) => mapSigned(d, t, ctx, k));
  mapMarket(s, ctx, p);
  const moved = new Set<string>();
  eachOrgDoc({ s, ctx, p }, "followups", (d, t) => {
    if (mapFollowup(d, t, ctx, k)) moved.add(d.id);
  });
  for (const t of p.tenants.values()) {
    const certs = t.rows["contracts.cks_certificates"] ?? [];
    const ids = new Set(certs.map((c) => c.id));
    for (const c of certs)
      for (const col of ["replaces", "replaced_by"] as const)
        if (c[col] && !ids.has(c[col])) c[col] = null;
  }
  return moved;
}
