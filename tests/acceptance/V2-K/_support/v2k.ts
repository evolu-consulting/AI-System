// V2-K · hạ tầng int Tổng quan + Cần xử lý: như V2-D (DB sạch, hub-api THẬT in-process; HĐ dựng bằng owner qua `deal()` của HD7;
// SP/tồn qua xác nhận mốc giao THẬT). Mốc tiền chèn thẳng (owner). Đỏ NGAY nếu thiếu migration 0033. Không chứa `it(...)`.
import { expect } from "bun:test";
import { visibility } from "@ai/test-kit/builders";
import {
  arrangeV2d,
  type CtxN1,
  call,
  d,
  deal,
  item,
  type Json,
  ok,
  P,
  product,
  type Res,
  type Sql,
  startHd1,
  stockIn,
  T,
} from "../../V2-D/_support/v2d";

export type { CtxN1, Json, Res, Sql };
export { call, d, deal, item, ok, P, product, startHd1, stockIn, T };

export async function needV2k(sql: Sql): Promise<void> {
  const [r] = await sql<
    { t: boolean }[]
  >`select to_regclass('contracts.todo_dismissals') is not null
    and to_regclass('contracts.business_settings') is not null as t`;
  expect({ v2k_migration_0033: r?.t }).toEqual({ v2k_migration_0033: true });
}

export async function arrangeV2k(c: CtxN1): Promise<void> {
  await needV2k(c.sql);
  await c.sql`truncate contracts.todo_dismissals, contracts.followups, contracts.score_ratings, contracts.visibility_settings`;
  await arrangeV2d(c);
}

export const setVisibility = (c: CtxN1, mode: "tenant" | "org") =>
  visibility(c.sql, [T.acme], mode);

/** HĐ đã xác nhận (owner): loại + hoa hồng + chủ HĐ; xoá mốc mặc định HD7 để test tự đặt mốc. */
export async function contract(
  sql: Sql,
  o: {
    deal: "buy" | "sell" | "referral";
    value?: number;
    pct?: number | null;
    fixed?: number | null;
    owner?: string;
    end?: string | null;
    notice?: number | null;
    tax?: string;
    tenant?: string;
  },
): Promise<string> {
  const id = `ad000000-0000-4000-8000-${String(++cseq).padStart(12, "0")}`;
  const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });
  const party = {
    name: fv(`Đối tác ${cseq}`),
    tax: fv(o.tax ?? `05${String(cseq).padStart(8, "0")}`),
  };
  const us = { name: fv("Công ty Chúng Tôi"), tax: fv("0100000000") };
  const [buyer, supplier] = o.deal === "buy" ? [us, party] : [party, us];
  await sql`insert into contracts.contracts (id, tenant_id, kind, title, direction, deal, commission_pct, commission_fixed,
      status, owner_user_id, created_by, fields)
    values (${id}, ${o.tenant ?? T.acme}, 'contract', ${`HĐ K-${cseq}`}, ${o.deal === "buy" ? "purchase" : "sale"}, ${o.deal},
      ${o.pct ?? null}, ${o.fixed ?? null}, 'active', ${o.owner ?? P.lan.id}, ${P.lan.id},
      ${sql.json({
        number: fv(`K-${cseq}`),
        buyer_name: buyer.name,
        buyer_tax_id: buyer.tax,
        supplier_name: supplier.name,
        supplier_tax_id: supplier.tax,
        total_value: fv(o.value ?? 100_000_000),
        end_date: fv(o.end ?? null),
        notice_days: fv(o.notice ?? null),
      } as never)})`;
  await sql`delete from contracts.obligations where contract_id = ${id}`;
  return id;
}

let cseq = 0;
let seq = 0;
/** Mốc (owner). `kind` BA: collect = Thu tiền, commission, delivery. `done` = ngày xác nhận (có ⇒ đã xong). */
export async function milestone(
  sql: Sql,
  contractId: string,
  m: {
    kind: "collect" | "commission" | "delivery";
    due: string;
    amount?: number | null;
    done?: string | null;
    tenant?: string;
  },
): Promise<string> {
  const kind = m.kind === "collect" ? "payment" : m.kind;
  const [r] = await sql<
    { id: string }[]
  >`insert into contracts.obligations (tenant_id, contract_id, direction, kind, seq,
      due_date, amount, status, done_at, title)
    values (${m.tenant ?? T.acme}, ${contractId}, 'receive', ${kind}, ${++seq}, ${m.due}, ${m.amount ?? null},
      ${m.done ? "done" : "open"}, ${m.done ?? null}, ${`Mốc ${seq}`}) returning id::text`;
  return (r as { id: string }).id;
}

/** Ngày thứ n (0 = mùng 1) của tháng hiện tại / tháng trước (múi tenant). */
export function monthDay(n: number, back = 0): string {
  const [y, m] = d(0).split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 - back, 1 + n)).toISOString().slice(0, 10);
}

export const OV = "/overview";
export const TODO = "/my-work/todo";
type Person = (typeof P)[keyof typeof P];
export const overview = (c: CtxN1, q = "", p: Person = P.lan) => ok(call(c, p, "GET", `${OV}${q}`));
export const todo = (c: CtxN1, p: Person = P.lan) => ok(call(c, p, "GET", TODO));
export const dismissRaw = (c: CtxN1, key: string, action: "skip" | "done", p: Person = P.lan) =>
  call(c, p, "POST", `${TODO}/dismiss`, { key, action });
