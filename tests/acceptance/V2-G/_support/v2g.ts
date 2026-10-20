// V2-G · hạ tầng int: hub-api THẬT + admin-api THẬT (như HD2/V2-A); AI chỉ là agent GIẢ tất định (seam `contractsAi.transport`) — không
// gọi AI thật. Cờ duyệt đặt thẳng `approval_settings.approval_enabled` và TRẢ LẠI sau file. Đỏ NGAY nếu thiếu migration 0027.
// Không chứa `it(...)`.
import { expect } from "bun:test";
import { startHd1 } from "../../HD1/_support/hd1";
import { agentJson, C1_TEXT, CBASE, cid, insContract, startHd2 } from "../../HD2/_support/hd2";
import {
  arrangeV2a,
  type CtxN1,
  call,
  d,
  detail,
  type Json,
  ok,
  P,
  restoreApproval,
  rowsOf,
  type Sql,
  setApproval,
  T,
} from "../../V2-A/_support/v2a";

export type { CtxN1, Json, Sql };
export {
  agentJson,
  arrangeV2a,
  C1_TEXT,
  CBASE,
  call,
  cid,
  d,
  detail,
  insContract,
  ok,
  P,
  restoreApproval,
  rowsOf,
  setApproval,
  startHd1,
  startHd2,
  T,
};

export async function needV2g(sql: Sql): Promise<void> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns
    where table_schema = 'contracts' and table_name = 'contracts' and column_name = 'ai_read'`;
  expect({ v2g_migration_0027: r?.n }).toEqual({ v2g_migration_0027: 1 });
}

/** Đầu ra agent v2: như `agentJson` + khoá loại / chưa chắc / tóm tắt / mốc. */
export function agentV2(
  f: Parameters<typeof agentJson>[0],
  items: Parameters<typeof agentJson>[1] = [],
  extra: {
    deal?: string | null;
    unsure?: string[];
    summary?: unknown;
    milestones?: unknown[];
  } = {},
): string {
  return JSON.stringify({ ...JSON.parse(agentJson(f, items)), ...extra });
}

export const SUMMARY = {
  main: "Hợp đồng mua bán thùng carton giữa hai công ty, thời hạn một năm.",
  deadlines: ["Thanh toán đợt 1 trước 15/02/2026", "Hết hạn 31/12/2026"],
  penalties: ["Phạt chậm giao 0,5% mỗi ngày"],
  bonuses: [],
  clauses: ["Điều 5: bảo hành 12 tháng"],
};
/** Văn bản HĐ mẫu có phạt + đợt thanh toán (để trích dẫn mốc kiểm được). */
export const V2G_TEXT = `${C1_TEXT}
Phạt chậm giao 0,5% mỗi ngày. Đợt 1: thanh toán 100.000.000 đồng trước ngày 15/02/2026.`;

const fv = (value: unknown, o: Record<string, unknown> = {}) => ({
  value,
  quote: "",
  verified: true,
  edited: false,
  ...o,
});
export type SeedItem = {
  id?: string;
  name: string;
  qty?: number | null;
  unit_price?: number | null;
  unit?: string | null;
};
/** HĐ chờ xác nhận (`needs_review`) với trường + phần AI đọc + dòng hàng — dựng bằng owner (bỏ qua RLS). Trả id dòng theo thứ tự. */
export async function seedReview(
  c: CtxN1,
  n: number,
  o: {
    status?: string;
    deal?: "buy" | "sell" | "referral" | null;
    fields?: Record<string, unknown>;
    ai?: unknown;
    items?: SeedItem[];
    tenant?: string;
  } = {},
): Promise<{ id: string; items: string[] }> {
  const id = cid(n);
  const deal = o.deal ?? null;
  await insContract(c.sql, {
    id,
    tenant: o.tenant ?? T.acme,
    status: o.status ?? "needs_review",
    createdBy: P.hoa.id,
    owner: P.hoa.id,
    direction: deal === null ? null : deal === "buy" ? "purchase" : "sale",
    fields: {
      title: fv("HĐ chờ xác nhận"),
      supplier_name: fv("Công ty Bán"),
      buyer_name: fv("Công ty Mua"),
      start_date: fv(d(10)),
      end_date: fv(d(40)),
      total_value: fv(100_000_000),
      ...o.fields,
    },
  });
  if (deal !== null) await c.sql`update contracts.contracts set deal = ${deal} where id = ${id}`;
  if (o.ai !== undefined)
    await c.sql`update contracts.contracts set ai_read = ${c.sql.json(o.ai as never)} where id = ${id}`;
  const ids: string[] = [];
  for (const [ord, it] of (o.items ?? []).entries()) {
    const iid = it.id ?? crypto.randomUUID();
    ids.push(iid);
    await c.sql`insert into contracts.contract_items (id, tenant_id, contract_id, ord, name, unit, qty, unit_price, verified, edited)
      values (${iid}, ${o.tenant ?? T.acme}, ${id}, ${ord}, ${it.name}, ${it.unit ?? null}, ${it.qty ?? null},
        ${it.unit_price ?? null}, true, false)`;
  }
  return { id, items: ids };
}

export const reviewOf = (c: CtxN1, id: string, body: Json, p: (typeof P)[keyof typeof P] = P.hoa) =>
  call(c, p, "POST", `/contracts/${id}/review`, body);

export async function itemRows(sql: Sql, contractId: string) {
  return sql<
    {
      id: string;
      ord: number;
      name: string;
      unit: string | null;
      qty: string | null;
      unit_price: string | null;
      product_id: string | null;
      component_ids: string[] | null;
      edited: boolean;
    }[]
  >`select id::text, ord, name, unit, qty::text, unit_price::text, product_id::text,
      component_ids::text[] as component_ids, edited
    from contracts.contract_items where contract_id = ${contractId} order by ord`;
}

/** Sản phẩm của tenant (qua API thật) — trả id SP + id thành phần đầu. */
export async function makeProduct(
  c: CtxN1,
  p: (typeof P)[keyof typeof P],
  body: Json,
): Promise<{ id: string; comps: string[] }> {
  const r = await ok(call(c, p, "POST", "/products", body));
  return { id: r.id, comps: r.components.map((x: Json) => x.id) };
}

/** Bản chụp toàn bộ dữ liệu HĐ (để chứng minh một lần Lưu lỗi không ghi gì). */
export async function snapshot(sql: Sql, id: string) {
  const [c] = await sql<
    Json[]
  >`select version, status, deal, direction, fields, ai_read, commission_pct, commission_fixed,
      confirmed_at is not null as confirmed from contracts.contracts where id = ${id}`;
  const items = await itemRows(sql, id);
  const ms = await rowsOf(sql, id);
  const [e] = await sql<
    { n: number }[]
  >`select count(*)::int as n from contracts.contract_events where contract_id = ${id}`;
  return { c, items, ms, events: e?.n };
}
