// niti-import2 · phần còn lại phía gói contracts + thông báo, của MỘT tài khoản (đã lọc org/[E2E] — `keepExtras`):
// - cks_certificates + signed_docs ⇒ `contracts.cks_*` (module CKS chỉ đọc); khách CKS theo công ty được trỏ; HĐ bán CKS nối HĐ đã
//   nhập ở lô chính (`linkSource`) khi HĐ đó thuộc chủ; lô mua CKS / chuỗi thay thế không thuộc phạm vi ⇒ để trống (ghi chú).
//   mgmt-app không giữ bytes văn bản ký (chỉ sha256) ⇒ không có file để đưa vào FileBox.
// - quotes ⇒ `contracts.price_quotes` (nguồn quote/website như app); market_scans: kết quả (`market_observations` CKS của lượt quét)
//   ⇒ `contracts.cks_market_prices` (giá tham chiếu kèm ngày thấy), bản ghi lượt quét + score_config_history ⇒ `contracts.legacy_records`
//   (JSON nguyên văn, chỉ thêm — lịch sử chỉ đọc).
// - notifications ⇒ lịch sử đã đọc (`notify.import_read`, không phát). Id tất định theo nhãn lô. Thuần.
import { type Company, companyIndex, customerOf } from "./companies.rules";
import type { SourceDoc } from "./context";
import { targetId, uuidV5 } from "./ids.rules";
import { bool, day, type Issue, int, jsonSafe, money, serialKey, str, ts } from "./values.rules";

type Row = Record<string, unknown>;
export const EXTRA_TABLES = [
  "cks_customers",
  "cks_certificates",
  "cks_signed_docs",
  "cks_market_prices",
  "price_quotes",
  "legacy_records",
] as const;
export type ExtraTable = (typeof EXTRA_TABLES)[number];

export type ContractsPlan = {
  rows: Record<ExtraTable, Row[]>;
  notifications: Row[];
  notes: Record<string, number>;
};
type Ctx = {
  source: string;
  linkSource: string;
  userId: string;
  /** Id cũ các HĐ của chủ (đã nhập ở lô chính). */
  contracts: Set<string>;
  org: string;
  issues: Issue[];
};
type K = { c: Ctx; p: ContractsPlan; companies: Map<string, Company>; certs: Set<string> };

const note = (p: ContractsPlan, k: string) => {
  p.notes[k] = (p.notes[k] ?? 0) + 1;
};
const DOC_KIND = new Set(["invoice", "tax_return", "contract", "other"]);
const CERT_STATUS = new Set(["active", "pending_renewal", "replaced", "revoked"]);
const cap = (v: number | null): number | null => (v !== null && v <= 10_000_000_000 ? v : null);

function customer(k: K, companyId: string | null): Row | null {
  if (!companyId) return null;
  const cu = customerOf(k.companies, companyId);
  if (!k.p.rows.cks_customers.some((r) => r._key === cu.key))
    k.p.rows.cks_customers.push({
      id: targetId(k.c.source, "company", companyId),
      name: cu.name,
      tax_id: cu.tax,
      _key: cu.key,
    });
  return { cust_name: cu.name, cust_tax: cu.tax };
}

function linkContract(k: K, v: unknown): string | null {
  const id = str(v, 128);
  if (!id) return null;
  if (k.c.contracts.has(id)) return targetId(k.c.linkSource, "contract", id);
  note(k.p, "cert_sale_contract_not_owned");
  return null;
}

function cert(k: K, d: SourceDoc): void {
  const s = d.src;
  const ref = `cks_certificates/${d.id}`;
  const validTo = day(s.valid_to);
  const cust = customer(k, str(s.company_id, 300));
  if (!validTo || !cust) {
    k.c.issues.push({ entity: "cks_certificate", ref, code: "CERT_INCOMPLETE" });
    return;
  }
  if (str(s.lot_id, 128)) note(k.p, "cert_lot_not_imported");
  if (str(s.replaces, 128) || str(s.replaced_by, 128)) note(k.p, "cert_chain_not_imported");
  k.p.rows.cks_certificates.push({
    id: targetId(k.c.source, "cert", d.id),
    ...cust,
    serial: str(s.serial, 100),
    serial_key: serialKey(s.serial),
    ca: str(s.ca, 60) ?? "?",
    device: s.device === "remote" ? "remote" : "token",
    holder_name: str(s.holder_name, 200) ?? str(s.serial, 200) ?? "?",
    holder_title: str(s.holder_title, 200),
    keeper: str(s.keeper, 200),
    valid_from: day(s.valid_from),
    valid_to: validTo,
    source: s.source === "elsewhere" ? "elsewhere" : "ours",
    lot_id: null,
    sale_contract_id: linkContract(k, s.sale_contract_id),
    sale_price: cap(money(s.sale_price, k.c.issues, "cks_certificate", ref)),
    status: CERT_STATUS.has(String(s.status)) ? s.status : "active",
    replaces: null,
    replaced_by: null,
    created_by: k.c.userId,
    created_at: ts(s.created_at),
  });
  k.certs.add(d.id);
}

function signed(k: K, d: SourceDoc, seen: Set<string>): void {
  const s = d.src;
  const sha = typeof s.sha256 === "string" && /^[0-9a-f]{64}$/.test(s.sha256) ? s.sha256 : null;
  const filename = str(s.filename, 255);
  const sk = serialKey(s.serial);
  const once = `${sha}|${sk ?? ""}`;
  if (!sha || !filename || seen.has(once)) {
    k.c.issues.push({
      entity: "cks_signed_doc",
      ref: `signed_docs/${d.id}`,
      code: sha && filename ? "SIGNED_DUP" : "SIGNED_INCOMPLETE",
    });
    return;
  }
  seen.add(once);
  const certId = str(s.certificate_id, 128);
  k.p.rows.cks_signed_docs.push({
    id: targetId(k.c.source, "signed", d.id),
    ...(customer(k, str(s.company_id, 300)) ?? { cust_name: null, cust_tax: null }),
    certificate_id: certId && k.certs.has(certId) ? targetId(k.c.source, "cert", certId) : null,
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
    created_by: k.c.userId,
    created_at: ts(s.created_at),
  });
}

function market(k: K, d: SourceDoc): void {
  const s = d.src;
  const caKey = str(s.ca, 40);
  const years = int(s.years, 1, 5);
  const seller = str(s.seller, 200);
  const seen = day(s.seen) ?? day(s.created_at);
  if (s.product_kind !== "cks" || !caKey || years === null || !seller || !seen) {
    k.c.issues.push({
      entity: "cks_market_price",
      ref: `market_observations/${d.id}`,
      code: "MARKET_INCOMPLETE",
    });
    return;
  }
  k.p.rows.cks_market_prices.push({
    id: targetId(k.c.source, "market", d.id),
    ca_key: caKey,
    ca_name: str(s.ca_name, 100),
    years,
    kind: s.kind === "new" || s.kind === "renew" ? s.kind : null,
    device: s.device === "token" || s.device === "remote" ? s.device : null,
    seller,
    tier: str(s.tier, 100),
    price_ex_vat: cap(money(s.price_ex_vat, k.c.issues, "cks_market_price", d.id)),
    url: str(s.url, 2000),
    verified: bool(s.verified),
    seen,
  });
}

/** Khoá mặt hàng cũ `<org>|name:…|…` ⇒ khoá của app mới (`name:…|…` / `code:…`). */
export function productKey(v: unknown, org: string): string | null {
  const k = str(v, 900);
  if (!k) return null;
  return (k.startsWith(`${org}|`) ? k.slice(org.length + 1) : k).slice(0, 600);
}

function quote(k: K, d: SourceDoc): void {
  const s = d.src;
  const key = productKey(s.product, k.c.org);
  const supplier = str(s.supplier_name, 200);
  const price = int(s.price, 1, 1e15);
  const quotedAt = day(s.quoted_at) ?? day(s.created_at);
  const name =
    str(s.product_name, 300) ??
    (key ? str(key.replace(/^(name|code):/, "").split("|")[0], 300) : null);
  if (!key || !supplier || price === null || !quotedAt || !name) {
    k.c.issues.push({ entity: "price_quote", ref: `quotes/${d.id}`, code: "QUOTE_INCOMPLETE" });
    return;
  }
  const comp = k.companies.get(String(s.supplier_company_id ?? ""));
  const url = str(s.url, 2000);
  k.p.rows.price_quotes.push({
    id: targetId(k.c.source, "quote", d.id),
    product_key: key,
    product_name: name,
    unit: str(s.unit, 40),
    supplier_name: supplier,
    supplier_tax_id: comp?.tax ?? null,
    price,
    quoted_at: quotedAt,
    source: url ? "website" : "quote",
    url,
    verified: typeof s.verified === "boolean" ? s.verified : null,
    page_date: day(s.page_date),
    check_note: str(s.check_note, 200),
    note: str(s.note, 500),
    created_by: k.c.userId,
    created_at: ts(s.created_at),
  });
}

const legacy = (kind: string, d: SourceDoc): Row => ({
  kind,
  mgmt_id: d.id.slice(0, 300),
  doc: jsonSafe(d.src),
});

/** Khoá thông báo ≤ 63 ký tự (dedup_key = `<nhãn ≤ 64>:<khoá>` ≤ 128). */
const notifKey = (id: string): string => (/^[A-Za-z0-9_-]{1,60}$/.test(id) ? id : uuidV5(id));

function notification(k: K, d: SourceDoc): Row {
  return {
    user_id: k.c.userId,
    mgmt_id: notifKey(d.id),
    title: str(d.src.title, 200) ?? "Thông báo",
    body: str(d.src.body, 2000) ?? "",
    created_at: ts(d.src.created_at),
    read_at: ts(d.src.read_at),
  };
}

export function planContractsExtras(
  c: Ctx,
  docs: Partial<Record<string, SourceDoc[]>>,
): ContractsPlan {
  const p: ContractsPlan = {
    rows: Object.fromEntries(EXTRA_TABLES.map((t) => [t, []])) as unknown as ContractsPlan["rows"],
    notifications: [],
    notes: {},
  };
  const k: K = {
    c,
    p,
    companies: companyIndex({ docs: { companies: docs.companies ?? [] }, graph: {} }),
    certs: new Set(),
  };
  const each = (ix: string, f: (d: SourceDoc) => void) => {
    for (const d of docs[ix] ?? []) f(d);
  };
  const seen = new Set<string>();
  each("cks_certificates", (d) => cert(k, d));
  each("signed_docs", (d) => signed(k, d, seen));
  each("market_observations", (d) => market(k, d));
  each("quotes", (d) => quote(k, d));
  each("market_scans", (d) => p.rows.legacy_records.push(legacy("market_scans", d)));
  each("score_config_history", (d) =>
    p.rows.legacy_records.push(legacy("score_config_history", d)),
  );
  each("notifications", (d) => p.notifications.push(notification(k, d)));
  for (const r of p.rows.cks_customers) delete r._key;
  return p;
}
