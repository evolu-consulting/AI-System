// HD7-FR-01…12 · HD7-NFR-01…03 · hạ tầng int HD7: như HD1/HD9 (DB sạch X2a, hub-api THẬT in-process, admin-api THẬT) + vòng quá
// hạn THẬT (`createOverdueSweep`, pool `hub_api` riêng, đồng hồ giả — không sleep). HĐ dựng bằng owner (bỏ RLS) theo `deal()` của
// mgmt-app `tests/mgmt.py`; ngày tương đối theo múi tenant (Asia/Ho_Chi_Minh) như `today_vn()`. Đỏ NGAY nếu thiếu migration HD7.
// Không chứa `it(...)`.
import { expect } from "bun:test";
import { FakeClock } from "@ai/test-kit/clock";
import { connectDb } from "../../../../apps/hub-api/src/lib/db";
import {
  createOverdueSweep,
  type OverdueSweep,
} from "../../../../apps/hub-api/src/modules/packs/contracts/ledger.mount";
import { HUB_API_URL } from "../../H1/_fixtures";
import {
  arrange,
  type CtxN1,
  insContract,
  type Json,
  P,
  type Res,
  type Sql,
  startHd1,
  T,
} from "../../HD1/_support/hd1";

export type { CtxN1, Json, Res, Sql };
export { FakeClock, P, startHd1, T };

export const BASE = "/pack/contracts";
export const VN = "Asia/Ho_Chi_Minh";
export const LEDGER_TABLES = ["partner_event_voids", "partner_events", "obligations"] as const;
type Person = (typeof P)[keyof typeof P];

export async function needHd7(sql: Sql): Promise<void> {
  const [r] = await sql<{ t: boolean; f: boolean; trg: boolean }[]>`select
    to_regclass('contracts.obligations') is not null and to_regclass('contracts.partner_events') is not null
      and to_regclass('contracts.partner_event_voids') is not null as t,
    to_regprocedure('contracts.party_key(text,text)') is not null as f,
    exists (select 1 from pg_trigger where tgrelid = 'contracts.contracts'::regclass and tgname = 'contracts_hd7_schedule') as trg`;
  expect({ hd7_migration: r }).toEqual({ hd7_migration: { t: true, f: true, trg: true } });
}

/** HD1 `arrange` (dọn HĐ, bật quyền) + dọn sổ HD7. */
export async function arrangeHd7(c: CtxN1): Promise<void> {
  await needHd7(c.sql);
  await c.sql.unsafe(`truncate ${LEDGER_TABLES.map((t) => `contracts.${t}`).join(", ")}`);
  await arrange(c);
}

/** Hôm nay ± n ngày theo múi tenant mặc định (= `today_vn()` của mgmt-app). */
export function d(n: number, now = Date.now()): string {
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: VN });
  const t = new Date(`${today}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

let seq = 0;
const nid = (): string => `d7000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });

export type Deal = {
  sale?: boolean | null;
  partner?: string;
  tax?: string | null;
  number?: string;
  value?: number | null;
  end?: string | null;
  start?: string | null;
  signed?: string | null;
  status?: string;
  tenant?: string;
  title?: string;
};
/** `tests/mgmt.py::deal` — HĐ đã duyệt (mặc định `active`), đối tác là bên mua (bán) / bên bán (mua). Trả id. */
export async function deal(sql: Sql, o: Deal = {}): Promise<string> {
  const id = nid();
  const x = {
    sale: false,
    partner: `Đối tác ${id.slice(-4)}`,
    tax: null,
    number: `N-${id.slice(-4)}`,
    value: 100_000_000,
    tenant: T.acme,
    status: "active",
    ...o,
  };
  const party = { name: fv(x.partner), tax: fv(x.tax) };
  const us = { name: fv("Công ty Chúng Tôi"), tax: fv("0100000000") };
  const [buyer, supplier] = x.sale ? [party, us] : [us, party];
  const direction = x.sale === null ? null : x.sale ? "sale" : "purchase";
  await insContract(sql, {
    id,
    tenant: x.tenant,
    title: x.title ?? `HĐ ${x.number}`,
    status: x.status,
    direction,
    fields: {
      number: fv(x.number),
      title: fv(null),
      buyer_name: buyer.name,
      buyer_tax_id: buyer.tax,
      supplier_name: supplier.name,
      supplier_tax_id: supplier.tax,
      total_value: fv(x.value),
      end_date: fv(x.end ?? null),
      start_date: fv(x.start ?? null),
      signed_date: fv(x.signed ?? null),
    },
  });
  return id;
}

export const call = (c: CtxN1, p: Person, method: string, path: string, body?: unknown) =>
  c.hubCall(p, method, `${BASE}${path}`, body);

/** Thành công (2xx) hoặc đỏ kèm thân lỗi. */
export async function ok(r: Promise<Res>): Promise<Json> {
  const x = await r;
  expect({
    status: x.status < 300 ? "ok" : x.status,
    body: x.status < 300 ? null : x.json,
  }).toEqual({
    status: "ok",
    body: null,
  });
  return x.json;
}

export type Row = { due_date: string; amount?: number | null; kind?: "payment" | "delivery" };
/** `PUT /contracts/:id/schedule` (editor) ⇒ các đợt. */
export const schedule = (c: CtxN1, id: string, rows: Row[], p: Person = P.hoa) =>
  ok(call(c, p, "PUT", `/contracts/${id}/schedule`, { rows }));

export const events = async (c: CtxN1, party: string, p: Person = P.hoa): Promise<Json[]> =>
  ok(call(c, p, "GET", `/partner-events?party=${encodeURIComponent(party)}`));

/** Đợt của HĐ (đọc thẳng DB, mọi trạng thái). */
export async function obligationsOf(sql: Sql, contractId: string) {
  return sql<
    {
      id: string;
      status: string;
      seq: number;
      due_date: string;
      amount: string | null;
      overdue_for: string | null;
      postpones: number;
      reminders: number;
      source: string;
    }[]
  >`select id::text, status, seq, to_char(due_date, 'YYYY-MM-DD') as due_date, amount::text,
    to_char(overdue_for, 'YYYY-MM-DD') as overdue_for, postpones, reminders, source
    from contracts.obligations where contract_id = ${contractId} order by seq, created_at`;
}

export type Sweep = {
  s: OverdueSweep;
  clock: FakeClock;
  stop(): Promise<void>;
  /** Số câu SQL pool gửi trong `fn` (trừ BEGIN/COMMIT/type-discovery). */
  count<R>(
    fn: () => Promise<R>,
  ): Promise<{ n: number; queries: { text: string; params: unknown[] }[]; r: R }>;
};
const TX_CTL = /^\s*((begin|commit|rollback)\b|select b\.oid, b\.typarray)/i;

/** Vòng quá hạn thật trên pool `hub_api` riêng; múi tenant cố định `tz` (mặc định VN). */
export function startSweep(o: {
  at: string;
  tz?: string;
  batch?: number;
  tenants?: string[];
}): Sweep {
  const db = connectDb(HUB_API_URL, 4);
  const clock = new FakeClock(new Date(o.at));
  const s = createOverdueSweep(db, {
    timeZoneOf: async () => o.tz ?? VN,
    now: clock.now,
    tenants: async () => o.tenants ?? [T.acme, T.beta],
    ...(o.batch ? { batchSize: o.batch } : {}),
  });
  type Pool = { options: { debug?: (c: number, q: string, p: unknown[]) => void } };
  const pool = (db.db as unknown as { $client: Pool }).$client;
  return {
    s,
    clock,
    stop: () => db.close(),
    async count(fn) {
      const queries: { text: string; params: unknown[] }[] = [];
      const prev = pool.options.debug;
      pool.options.debug = (cn, q, p) => {
        if (!TX_CTL.test(q)) queries.push({ text: q, params: p ?? [] });
        if (typeof prev === "function") prev(cn, q, p);
      };
      try {
        const r = await fn();
        return { n: queries.length, queries, r };
      } finally {
        pool.options.debug = prev;
      }
    },
  };
}
