// I1 · kế hoạch ghi: hàng đích theo tenant × bảng (thứ tự bảng = thứ tự FK), vấn đề theo hàng, tổng tiền nguồn. Thuần.
import type { Issue } from "./values.rules";

/** Thứ tự ghi (cha trước con). Khoá = bảng đích (schema.table); `legacy` = vùng chờ chưa có bảng đích. */
export const TABLE_ORDER = [
  "contracts.visibility_settings",
  "contracts.contract_categories",
  "contracts.files",
  "contracts.contracts",
  "contracts.contract_items",
  "contracts.contract_events",
  "contracts.contract_reminders",
  "contracts.cks_customers",
  "contracts.cks_lots",
  "contracts.cks_certificates",
  "contracts.cks_renewals",
  "contracts.cks_followups",
  "contracts.cks_signed_docs",
  "contracts.cks_market_prices",
  "contracts.obligations",
  "contracts.partner_events",
  "contracts.partner_event_voids",
  "contracts.legacy_records",
  "knowledge.documents",
  "knowledge.chunks",
  "knowledge.entities",
  "knowledge.chunk_entities",
  "knowledge.entity_aliases",
  "knowledge.entity_rels",
  "knowledge.chunk_links",
  "knowledge.document_links",
] as const;
export type TableName = (typeof TABLE_ORDER)[number];
export type Row = Record<string, unknown>;

/** Bảng của G1 (nhánh slice/g1-graph) — chỉ ghi khi DB đích đã có bảng (phụ thuộc ghi ở tasks.md). */
export const G1_TABLES: readonly TableName[] = [
  "knowledge.entities",
  "knowledge.chunk_entities",
  "knowledge.entity_aliases",
  "knowledge.entity_rels",
  "knowledge.chunk_links",
  "knowledge.document_links",
];

/** Tổng tiền (đồng) theo tenant — cùng công thức ở nguồn và đích (đối soát khớp tuyệt đối). */
export type MoneyKey =
  | "contracts.total_value"
  | "items.unit_price"
  | "obligations.amount"
  | "partner_events.amount"
  | "cks_lots.qty_x_unit_cost"
  | "cks_certificates.sale_price"
  | "cks_renewals.price_each"
  | "cks_market_prices.price_ex_vat";

export type TenantPlan = {
  tenantId: string;
  orgId: string;
  rows: Partial<Record<TableName, Row[]>>;
  money: Partial<Record<MoneyKey, bigint>>;
};

export type Plan = {
  tenants: Map<string, TenantPlan>;
  issues: Issue[];
  /** Số bản ghi nguồn đọc theo index/truy vấn đồ thị. */
  read: Record<string, number>;
  /** Bản ghi nguồn không có tenant (org trống, nội bộ) — không chuyển, chỉ đếm theo index. */
  noTenant: Record<string, number>;
};

export const newPlan = (): Plan => ({ tenants: new Map(), issues: [], read: {}, noTenant: {} });

export function tenantPlan(p: Plan, tenantId: string, orgId: string): TenantPlan {
  let t = p.tenants.get(tenantId);
  if (!t) {
    t = { tenantId, orgId, rows: {}, money: {} };
    p.tenants.set(tenantId, t);
  }
  return t;
}

export function push(t: TenantPlan, table: TableName, row: Row): void {
  const list = t.rows[table] ?? [];
  list.push(row);
  t.rows[table] = list;
}

export function addMoney(t: TenantPlan, key: MoneyKey, v: number | bigint | null): void {
  if (v === null) return;
  t.money[key] = (t.money[key] ?? 0n) + BigInt(v);
}

export const bump = (m: Record<string, number>, k: string, n = 1): void => {
  m[k] = (m[k] ?? 0) + n;
};
