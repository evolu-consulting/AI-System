// W1 · "Việc của tôi" + "Mua hàng" · hạ tầng int: như HD7 (`startHd1`: DB sạch X2a, hub-api THẬT in-process, admin-api THẬT) + dọn
// bảng của W1 và các bảng nguồn (đợt, hẹn nhắc CKS, nhắc hạn, lựa chọn nguồn). HĐ dựng bằng owner (bỏ RLS). Không chứa `it(...)`.
import { expect } from "bun:test";
import { visibility } from "@ai/test-kit/builders";
import {
  captureSql,
  getWith,
  insContract,
  jsonWith,
  measure,
  seqScansOf,
} from "../../HD1/_support/hd1";
import {
  arrangeHd7,
  type CtxN1,
  call,
  d,
  type Json,
  ok,
  P,
  type Res,
  type Sql,
  startHd1,
  T,
} from "../../HD7/_support/hd7";

export type { CtxN1, Json, Res, Sql };
export { call, captureSql, d, getWith, jsonWith, measure, ok, P, seqScansOf, startHd1, T };

export const BASE = "/pack/contracts";
/** Cùng MỘT lệnh TRUNCATE: các bảng CKS tham chiếu nhau bằng FK (HD9 `CKS_TABLES`). */
const W1_TABLES = [
  "followups",
  "sourcing_choices",
  "cks_price_audit",
  "cks_followups",
  "cks_signed_docs",
  "cks_renewals",
  "cks_certificates",
  "cks_lots",
  "cks_customers",
  "cks_market_prices",
] as const;
type Person = (typeof P)[keyof typeof P];

export async function needW1(sql: Sql): Promise<void> {
  const [r] = await sql<
    { ok: boolean }[]
  >`select to_regclass('contracts.sourcing_choices') is not null as ok`;
  expect({ w1_migration_0010: r?.ok === true }).toEqual({ w1_migration_0010: true });
}

/** HD7 `arrange` (dọn HĐ + sổ, bật quyền) + dọn bảng W1; chế độ thấy về `tenant`. */
export async function arrangeW1(c: CtxN1): Promise<void> {
  await needW1(c.sql);
  await c.sql.unsafe(`truncate ${W1_TABLES.map((t) => `contracts.${t}`).join(", ")}`);
  await arrangeHd7(c);
  await c.sql.unsafe("truncate contracts.visibility_settings");
}

export const setVisibility = (c: CtxN1, mode: "tenant" | "org") =>
  visibility(c.sql, [T.acme], mode);

const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });
let seq = 0;
let custSeq = 0;
const nid = (): string => `d1000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export type Line = {
  name: string;
  price: number | null;
  unit?: string;
  qty?: number | null;
  ord?: number;
};
export type Priced = {
  sale?: boolean;
  partner: string;
  tax?: string;
  number: string;
  items: Line[];
  status?: string;
  tenant?: string;
  owner?: string | null;
  end?: string | null;
  notice?: number | null;
  handled?: unknown;
  /** Phụ lục: HĐ gốc + ngày hiệu lực. */
  parent?: string;
  effective?: string | null;
  id?: string;
};

function fieldsOf(o: Priced) {
  const party = { name: fv(o.partner), tax: fv(o.tax ?? null) };
  const us = { name: fv("Công ty Chúng Tôi"), tax: fv("0100000000") };
  const [buyer, supplier] = o.sale ? [party, us] : [us, party];
  return {
    number: fv(o.number),
    title: fv(null),
    buyer_name: buyer.name,
    buyer_tax_id: buyer.tax,
    supplier_name: supplier.name,
    supplier_tax_id: supplier.tax,
    end_date: fv(o.end ?? null),
    notice_days: fv(o.notice ?? null),
    effective_date: fv(o.effective ?? null),
  };
}

const direction = (o: Priced): "sale" | "purchase" | null =>
  o.parent ? null : o.sale ? "sale" : "purchase";

/** HĐ đã duyệt có bảng giá: đối tác là bên mua (bán) / bên bán (mua); bên còn lại là "Công ty Chúng Tôi". Trả id. */
export async function priced(sql: Sql, o: Priced): Promise<string> {
  const id = o.id ?? nid();
  const tenant = o.tenant ?? T.acme;
  await insContract(sql, {
    id,
    tenant,
    title: `HĐ ${o.number}`,
    kind: o.parent ? "appendix" : "contract",
    parent: o.parent ?? null,
    status: o.status ?? "active",
    direction: direction(o),
    ...(o.owner === undefined ? {} : { owner: o.owner }),
    ...(o.handled === undefined ? {} : { handled: o.handled }),
    fields: fieldsOf(o),
  });
  for (const [i, l] of o.items.entries())
    await sql`insert into contracts.contract_items (tenant_id, contract_id, ord, name, unit, qty, unit_price)
      values (${tenant}, ${id}, ${l.ord ?? i}, ${l.name}, ${l.unit ?? "ram"}, ${l.qty === undefined ? 10 : l.qty}, ${l.price})`;
  return id;
}

export type Ob = {
  due: string;
  amount?: number | null;
  direction?: "pay" | "receive";
  status?: string;
  kind?: string;
  seq?: number;
};
/** Đợt của một HĐ (owner, bỏ RLS). `status = done` thì tự điền `done_at`. */
export async function addObligation(
  sql: Sql,
  contract: string,
  o: Ob,
  tenant: string = T.acme,
): Promise<string> {
  const status = o.status ?? "open";
  const [r] = await sql<{ id: string }[]>`insert into contracts.obligations
      (tenant_id, contract_id, direction, kind, seq, due_date, amount, status, done_at)
    values (${tenant}, ${contract}, ${o.direction ?? "pay"}, ${o.kind ?? "payment"}, ${o.seq ?? 1}, ${o.due},
      ${o.amount === undefined ? 1_000_000 : o.amount}, ${status}, ${status === "done" ? o.due : null})
    returning id::text`;
  return r?.id as string;
}

/** Khách CKS + hẹn nhắc của một người. */
export async function addFollowup(
  sql: Sql,
  who: Person,
  o: { at: string; name?: string; note?: string; done?: boolean; tenant?: string },
): Promise<string> {
  const tenant = o.tenant ?? T.acme;
  const [cu] = await sql<
    { id: string }[]
  >`insert into contracts.cks_customers (tenant_id, name, created_by)
    values (${tenant}, ${o.name ?? `Khách ${++custSeq}`}, ${who.id}) returning id::text`;
  const [r] = await sql<
    { id: string }[]
  >`insert into contracts.cks_followups (tenant_id, user_id, customer_id, due_at, note, done_at)
    values (${tenant}, ${who.id}, ${cu?.id as string}, ${o.at}::timestamptz, ${o.note ?? null}, ${o.done ? new Date().toISOString() : null})
    returning id::text`;
  return r?.id as string;
}

export const myWork = (c: CtxN1, p: Person, q = "") => call(c, p, "GET", `/my-work${q}`);
export const ids = (r: Res): string[] => (r.json?.items ?? []).map((i: { id: string }) => i.id);
