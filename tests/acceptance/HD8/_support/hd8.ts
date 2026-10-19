// HD8-FR-01…07 · hạ tầng int HD8: dùng lại HD7 (DB sạch, hub-api THẬT, `deal()` của mgmt `tests/mgmt.py`) + dòng hàng HĐ, sổ đối
// tác ghi thẳng như `events.record` của mgmt, dọn bảng HD8. Đỏ NGAY nếu thiếu migration 0010. Không chứa `it(...)`.
import { expect } from "bun:test";
import { arrangeHd7, type CtxN1, d, type Sql } from "../../HD7/_support/hd7";

export * from "../../HD7/_support/hd7";

export const HD8_TABLES = [
  "score_configs",
  "score_config_history",
  "score_snapshots",
  "price_quotes",
  "market_observations",
  "companies",
] as const;

export async function needHd8(sql: Sql): Promise<void> {
  const [r] = await sql<{ t: boolean; f: boolean; c: boolean }[]>`select
    to_regclass('contracts.score_configs') is not null and to_regclass('contracts.price_quotes') is not null
      and to_regclass('contracts.score_snapshots') is not null and to_regclass('contracts.score_config_history') is not null as t,
    to_regprocedure('contracts.user_label(uuid)') is not null as f,
    exists (select 1 from information_schema.columns where table_schema = 'contracts' and table_name = 'cks_customers'
      and column_name = 'party_key') as c`;
  expect({ hd8_migration: r }).toEqual({ hd8_migration: { t: true, f: true, c: true } });
}

/** HD7 `arrangeHd7` + dọn bảng HD8. */
export async function arrangeHd8(c: CtxN1): Promise<void> {
  await needHd8(c.sql);
  await c.sql.unsafe(`truncate ${HD8_TABLES.map((t) => `contracts.${t}`).join(", ")}`);
  await arrangeHd7(c);
}

/** Dòng hàng của HĐ (`items=[{name, unit, qty, unit_price}]` của mgmt `deal`). */
export async function items(
  sql: Sql,
  tenant: string,
  contractId: string,
  rows: {
    name: string;
    unit?: string | null;
    qty?: number | null;
    unit_price?: number | null;
    code?: string | null;
  }[],
): Promise<void> {
  for (const [i, r] of rows.entries())
    await sql`insert into contracts.contract_items (tenant_id, contract_id, ord, code, name, unit, qty, unit_price)
      values (${tenant}, ${contractId}, ${i}, ${r.code ?? null}, ${r.name}, ${r.unit ?? null}, ${r.qty ?? null},
        ${r.unit_price ?? null})`;
}

/** `events.record(org, company, role, type, at, by, **kw)` — ghi thẳng sổ (owner, bỏ RLS). */
export async function record(
  sql: Sql,
  tenant: string,
  party: string,
  role: "customer" | "supplier",
  type: string,
  at: string,
  kw: {
    days_late?: number | null;
    by?: string | null;
    contract_id?: string | null;
    data?: object;
  } = {},
): Promise<void> {
  await sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, source, contract_id,
      days_late, data)
    values (${tenant}, ${party}, ${role}, ${type}, ${at}, ${kw.by ?? null}, 'action', ${kw.contract_id ?? null},
      ${kw.days_late ?? null}, ${sql.json((kw.data ?? {}) as never)})`;
}

/** Hôm nay − n ngày (múi tenant VN, = `today_vn() - timedelta(days=n)`). */
export const ago = (n: number) => d(-n);
