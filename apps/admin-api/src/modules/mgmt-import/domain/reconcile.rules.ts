// I1 · đối soát: tổng tiền NGUỒN tính độc lập với mapper (mọi bản ghi nguồn của org, kể cả hàng mapper bỏ ⇒ lệch lộ ra),
// tập HĐ mỗi user thấy theo luật mgmt-app (`orgs.Ctx.sees`), so trường mẫu nguồn ↔ đích. Thuần.
import { docsOf, type Snapshot } from "./context";
import type { Membership } from "./map-identity.rules";
import type { MoneyKey } from "./plan";
import { isObj } from "./values.rules";

const asBig = (v: unknown): bigint =>
  typeof v === "number" && Number.isSafeInteger(v) ? BigInt(v) : 0n;

type Src = Record<string, unknown>;
const fieldValue = (s: Src, k: string): unknown =>
  isObj(s.fields) && isObj(s.fields[k]) ? s.fields[k].value : null;
const itemsSum = (s: Src): bigint =>
  (Array.isArray(s.items) ? s.items : []).reduce<bigint>(
    (a, it) => a + (isObj(it) && it.name ? asBig(it.unit_price) : 0n),
    0n,
  );

/** (index nguồn, khoá tiền, giá trị) — cùng công thức với `TargetStore.money`. */
const MONEY_RULES: [string, MoneyKey, (s: Src) => bigint][] = [
  ["contracts", "contracts.total_value", (s) => asBig(fieldValue(s, "total_value"))],
  ["contracts", "items.unit_price", itemsSum],
  ["obligations", "obligations.amount", (s) => asBig(s.amount)],
  ["partner_events", "partner_events.amount", (s) => asBig(s.amount)],
  ["cks_lots", "cks_lots.qty_x_unit_cost", (s) => asBig(s.qty) * asBig(s.unit_cost)],
  ["cks_certificates", "cks_certificates.sale_price", (s) => asBig(s.sale_price)],
  ["cks_renewals", "cks_renewals.price_each", (s) => asBig(s.price_each)],
];

/** Tổng tiền nguồn theo org. Giá thị trường CKS dùng chung (`org_id = "*"`) cộng vào mọi org (đích chép vào mọi tenant). */
export function sourceMoney(
  s: Snapshot,
  orgs: readonly string[],
): Map<string, Partial<Record<MoneyKey, bigint>>> {
  const out = new Map<string, Partial<Record<MoneyKey, bigint>>>(orgs.map((o) => [o, {}]));
  const add = (org: unknown, k: MoneyKey, v: bigint) => {
    const m = out.get(String(org));
    if (m) m[k] = (m[k] ?? 0n) + v;
  };
  for (const [ix, key, fn] of MONEY_RULES)
    for (const d of docsOf(s, ix)) add(d.src.org_id, key, fn(d.src));
  for (const d of docsOf(s, "market_observations").filter((x) => x.src.product_kind === "cks")) {
    const targets = d.src.org_id === "*" ? orgs : [d.src.org_id];
    for (const o of targets) add(o, "cks_market_prices.price_ex_vat", asBig(d.src.price_ex_vat));
  }
  return out;
}

/** Cấp dưới mọi tầng theo `manager_email` (≡ mgmt `orgs.reports`). */
function reports(members: Map<string, Membership>, org: string, email: string): Set<string> {
  const out = new Set<string>();
  const queue = [email];
  while (queue.length) {
    const m = queue.shift() as string;
    for (const x of members.values())
      if (x.orgId === org && x.manager === m && !out.has(x.email) && x.email !== email) {
        out.add(x.email);
        queue.push(x.email);
      }
  }
  return out;
}

/** Id mgmt các HĐ `email` thấy ở mgmt-app (≡ `orgs.Ctx.sees`: chủ thấy hết; còn lại: owner_email trong phạm vi, hoặc chưa giao
 *  mà mình tạo, hoặc phụ lục chưa giao theo HĐ cha). Membership chưa active ⇒ null (mgmt-app trả 403). */
export function mgmtVisible(
  s: Snapshot,
  members: Map<string, Membership>,
  email: string,
  active: boolean,
): Set<string> | null {
  const m = members.get(email);
  if (!m || !active) return null;
  const recs = docsOf(s, "contracts").filter((d) => d.src.org_id === m.orgId);
  if (m.role === "owner") return new Set(recs.map((d) => d.id));
  const scope = new Set([email, ...reports(members, m.orgId, email)]);
  const byId = new Map(recs.map((d) => [d.id, d.src]));
  const sees = (r: Record<string, unknown>, id: string, depth = 0): boolean => {
    if (typeof r.owner_email === "string" && r.owner_email) return scope.has(r.owner_email);
    if (r.created_by === email) return true;
    const pid = typeof r.parent_id === "string" ? r.parent_id : null;
    const parent = pid && pid !== id ? byId.get(pid) : undefined;
    return !!parent && depth < 20 && sees(parent, pid as string, depth + 1);
  };
  return new Set(recs.filter((d) => sees(d.src, d.id)).map((d) => d.id));
}

export type FieldDiff = {
  entity: string;
  mgmt_id: string;
  field: string;
  source: unknown;
  target: unknown;
};

const norm = (v: unknown): unknown => {
  if (v === undefined || v === "") return null;
  if (typeof v === "string" && /^\d+(\.0+)?$/.test(v)) return Number(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return v;
};

/** So từng cặp (nguồn, đích) theo danh sách trường; trả các trường lệch. */
export function diffFields(
  entity: string,
  mgmtId: string,
  pairs: [string, unknown, unknown][],
): FieldDiff[] {
  return pairs
    .filter(([, a, b]) => JSON.stringify(norm(a)) !== JSON.stringify(norm(b)))
    .map(([field, source, target]) => ({ entity, mgmt_id: mgmtId, field, source, target }));
}
