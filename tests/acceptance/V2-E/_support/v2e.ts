// V2-E · hạ tầng int uy tín v2: như V2-A/HD7 (DB sạch, hub-api THẬT in-process, admin-api THẬT). HĐ + mốc đã xác nhận dựng thẳng
// bằng owner (bỏ RLS) — nhanh, đúng cột V2-A (`deal`, `owner`, `fault`) + V2-E (`product_group`). Vòng chốt tháng THẬT trên pool
// `hub_api` riêng, đồng hồ giả (không sleep). Đỏ NGAY nếu thiếu migration 0028. Không chứa `it(...)`.
import { expect } from "bun:test";
import { FakeClock } from "@ai/test-kit/clock";
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import { createRepLock } from "../../../../apps/hub-api/src/modules/packs/contracts/reputation.mount";
import { HUB_API_URL } from "../../H1/_fixtures";
import {
  arrangeV2a,
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
} from "../../V2-A/_support/v2a";

export type { CtxN1, Json, Res, Sql };
export { call, d, ok, P, startHd1, T };

export const V2E_TABLES = [
  "score_ratings",
  "score_locks",
  "score_lock_runs",
  "score_configs_v2",
] as const;

export async function needV2e(sql: Sql): Promise<void> {
  const [r] = await sql<{ t: number; col: boolean; fn: boolean }[]>`select
    (select count(*)::int from unnest(${V2E_TABLES.map((t) => `contracts.${t}`)}::text[]) x where to_regclass(x) is not null) as t,
    exists (select 1 from information_schema.columns where table_schema = 'contracts' and table_name = 'contracts'
      and column_name = 'product_group') as col,
    to_regprocedure('contracts.v2e_cell(text,text)') is not null as fn`;
  expect({ v2e_migration_0028: r }).toEqual({ v2e_migration_0028: { t: 4, col: true, fn: true } });
}

export async function arrangeV2e(c: CtxN1): Promise<void> {
  await needV2e(c.sql);
  await arrangeV2a(c);
  await c.sql.unsafe(`truncate ${V2E_TABLES.map((t) => `contracts.${t}`).join(", ")}`);
}

let seq = 0;
const nid = () => `e2000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });

export type Deal = "buy" | "sell" | "referral";
/** HĐ đã xác nhận (active) với đối tác `tax`; nhóm SP `group` (null ⇒ hàng hoá; Giới thiệu luôn nhóm referral). Trả id. */
export async function contract(
  sql: Sql,
  o: {
    deal: Deal;
    tax: string;
    name?: string;
    group?: "service" | "goods" | null;
    value?: number;
    tenant?: string;
  },
): Promise<string> {
  const id = nid();
  const party = { name: fv(o.name ?? `Đối tác ${o.tax}`), tax: fv(o.tax) };
  const us = { name: fv("Công ty Chúng Tôi"), tax: fv("0100000000") };
  const [buyer, supplier] = o.deal === "buy" ? [us, party] : [party, us];
  await sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, deal, product_group, status, owner_user_id,
      created_by, fields)
    values (${id}, ${o.tenant ?? T.acme}, 'contract', ${`HĐ ${id.slice(-4)}`}, ${o.deal === "buy" ? "purchase" : "sale"},
      ${o.deal}, ${o.group ?? null}, 'active', ${P.lan.id}, ${P.lan.id},
      ${sql.json({
        number: fv(`E-${id.slice(-4)}`),
        buyer_name: buyer.name,
        buyer_tax_id: buyer.tax,
        supplier_name: supplier.name,
        supplier_tax_id: supplier.tax,
        total_value: fv(o.value ?? 100_000_000),
        start_date: fv(d(-30)),
      } as never)})`;
  return id;
}

export type Ms = {
  kind: "delivery" | "payment" | "serial" | "commission" | "other";
  owner?: "partner" | "ours";
  /** Ngày hoàn thành = hôm nay + `done` (âm = quá khứ). */
  done: number;
  late?: number;
  fault?: "partner" | "ours" | "unknown" | null;
};
/** Mốc ĐÃ xác nhận của HĐ (đối tác `party`). */
export async function milestones(
  sql: Sql,
  contractId: string,
  party: string,
  rows: Ms[],
  tenant = T.acme,
) {
  let i = 0;
  for (const m of rows) {
    i++;
    const doneAt = d(m.done);
    const due = d(m.done - (m.late ?? 0));
    await sql`insert into contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, status, done_at,
        owner, fault, title)
      values (${tenant}, ${contractId}, ${party}, ${m.kind === "payment" && m.owner === "ours" ? "pay" : "receive"}, ${m.kind},
        ${i}, ${due}, 'done', ${doneAt}, ${m.owner ?? "partner"}, ${(m.late ?? 0) > 0 ? (m.fault ?? "unknown") : null},
        ${`Mốc ${i}`})`;
  }
}

/** Vòng chốt tháng thật trên pool `hub_api` riêng; múi VN. */
export function startLock(at: string, tenants: string[] = [T.acme, T.beta]) {
  const db = connectDb(HUB_API_URL, 4);
  const clock = new FakeClock(new Date(at));
  const s = createRepLock(db, {
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    now: clock.now,
    tenants: async () => tenants,
  });
  return { s, clock, stop: () => db.close() };
}

export const enc = encodeURIComponent;
export const R = "/reputation";
/** Đường đầy đủ (gọi `fetch` thẳng trong đo p95). */
export const BASE_R = `/pack/contracts${R}`;
type Person = (typeof P)[keyof typeof P];
export const board = (c: CtxN1, q = "", p: Person = P.hoa): Promise<Json[]> =>
  ok(call(c, p, "GET", `${R}/partners${q}`));
export const partner = (c: CtxN1, party: string, role: string, p: Person = P.hoa): Promise<Json> =>
  ok(call(c, p, "GET", `${R}/partner?party=${enc(party)}&role=${role}`));
