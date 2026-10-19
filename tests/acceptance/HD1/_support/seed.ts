// HD-NFR-01/02/03 · HD-AC14 · spec §6 · plan §6 "Dữ liệu đo": 3 tenant × 10.000 HĐ (5 items, 20 event, 50 loại hàng) + 1 tenant nền
// 70.000 HĐ trơn. Dựng THEO TẬP (mỗi bảng × tenant = một câu `INSERT … SELECT generate_series`, không vòng lặp từng hàng), bằng owner
// (qua RLS FORCE vì owner là superuser). `autovacuum_enabled=false` để pha "chưa ANALYZE" đúng nghĩa. Trả thời gian dựng (đo thật).
// Không chứa `it(...)`.
import { P, type Sql, T, truncateAll } from "./hd1";

export const PERF_TENANTS = [T.acme, T.beta, T.gamma] as const;
export const BG_TENANT = "b9b90000-0000-4000-8000-000000000001";
export const PER_TENANT = 10_000;
export const BG_ROWS = 70_000;
export const CATS = 50;
export const ITEMS_PER = 5;
export const EVENTS_PER = 20;
const OWNERS = [
  P.lan.id,
  P.hoa.id,
  P.tam.id,
  "0e0e0000-0000-4000-8000-000000000001",
  "0e0e0000-0000-4000-8000-000000000002",
];
const KEYS = [
  "number",
  "title",
  "type",
  "supplier_name",
  "supplier_tax_id",
  "supplier_address",
  "supplier_representative",
  "buyer_name",
  "buyer_tax_id",
  "buyer_representative",
  "signed_date",
  "start_date",
  "end_date",
  "effective_date",
  "auto_renew",
  "notice_days",
  "total_value",
  "vat_rate",
  "vat_included",
  "payment_terms",
  "delivery_terms",
  "warranty",
  "penalty",
];
const STATUS =
  "array['extracting','extract_failed','needs_review','active','expiring','expired','renewed','terminated','rejected']::text[]";
const fv = (expr: string) =>
  `jsonb_build_object('value', ${expr}, 'quote', 'trích dẫn nguyên văn từ hợp đồng', 'verified', true, 'edited', false)`;

/** uuid theo (chỉ số tenant 1…9, số thứ tự) — cùng công thức cho HĐ/event/item nên không cần join. */
const contractUuid = (n: string, g: string) =>
  `('c0de0' || ${n} || '00-0000-4000-8000-' || lpad(${g}::text, 12, '0'))::uuid`;
export const perfContractId = (tenantIdx: number, g: number): string =>
  `c0de0${tenantIdx}00-0000-4000-8000-${String(g).padStart(12, "0")}`;
export const perfCatId = (tenantIdx: number, g: number): string =>
  `ca7e0000-0000-4000-8000-${String(tenantIdx * 1000 + g).padStart(12, "0")}`;

export type SeedResult = {
  ms: number;
  rows: { contracts: number; items: number; events: number; categories: number };
};
export async function seedPerf(sql: Sql): Promise<SeedResult> {
  const t0 = performance.now();
  await truncateAll(sql);
  for (const t of [
    "contracts",
    "contract_items",
    "contract_events",
    "contract_categories",
    "files",
  ])
    await sql.unsafe(`alter table contracts.${t} set (autovacuum_enabled = false)`);
  // Xoá thống kê cũ (lần đo trước trên cùng DB) để pha "chưa ANALYZE" đúng nghĩa; owner là superuser trên DB test.
  await sql.unsafe(
    `delete from pg_statistic where starelid = any(array['contracts.contracts'::regclass::oid, 'contracts.contract_items'::regclass::oid,
       'contracts.contract_events'::regclass::oid, 'contracts.contract_categories'::regclass::oid])`,
  );
  const tpl = Object.fromEntries(
    KEYS.map((k) => [
      k,
      { value: null, quote: "trích dẫn nguyên văn từ hợp đồng", verified: false, edited: false },
    ]),
  );
  const tplJson = JSON.stringify(tpl);
  const owners = `array[${OWNERS.map((o) => `'${o}'`).join(",")}]::uuid[]`;
  for (const [i, tid] of PERF_TENANTS.entries()) {
    const n = String(i + 1);
    await sql.unsafe(
      `insert into contracts.contract_categories (id, tenant_id, name)
       select ('ca7e0000-0000-4000-8000-' || lpad((${n}::int * 1000 + g)::text, 12, '0'))::uuid, $1::uuid, 'Loại hàng ' || g
       from generate_series(1, ${CATS}) g`,
      [tid],
    );
    await sql.unsafe(
      `insert into contracts.contracts (id, tenant_id, kind, parent_id, title, direction, status, owner_user_id, created_by,
         created_at, updated_at, version, fields)
       select ${contractUuid(n, "g")}, $1::uuid, case when g % 20 = 0 then 'appendix' else 'contract' end,
         case when g % 20 = 0 then ${contractUuid(n, "(g - 1)")} end, 'Hợp đồng ' || g,
         (array['sale','purchase',null]::text[])[1 + g % 3], (${STATUS})[1 + g % 9], (${owners})[1 + g % 5], '${OWNERS[0]}'::uuid,
         timestamptz '2026-01-01 00:00:00+00' + g * interval '1 minute', timestamptz '2026-01-01 00:00:00+00' + g * interval '1 minute', 1,
         $2::text::jsonb || jsonb_build_object(
           'number', ${fv("'HD-' || g")},
           'supplier_name', ${fv("'Bên bán ' || (g % 200)")},
           'buyer_name', ${fv("'Bên mua ' || (g % 150)")},
           'supplier_representative', ${fv("'Người ký bán ' || (g % 150) || ' – Giám đốc'")},
           'buyer_representative', ${fv("'Người ký mua ' || (g % 150)")},
           'total_value', ${fv("g * 100000")},
           'end_date', ${fv("to_char(date '2026-01-01' + (g % 700), 'YYYY-MM-DD')")},
           'type', ${fv("(array['purchase','service','framework','principle'])[1 + g % 4]")},
           'notice_days', ${fv("30")})
       from generate_series(1, ${PER_TENANT}) g`,
      [tid, tplJson],
    );
    await sql.unsafe(
      `insert into contracts.contract_items (id, tenant_id, contract_id, ord, name, qty, unit_price, category_id)
       select gen_random_uuid(), $1::uuid, ${contractUuid(n, "g")}, o, 'Hàng ' || o, 10 + o, 1000 * (o + 1),
         ('ca7e0000-0000-4000-8000-' || lpad((${n}::int * 1000 + 1 + (g + o) % ${CATS})::text, 12, '0'))::uuid
       from generate_series(1, ${PER_TENANT}) g, generate_series(0, ${ITEMS_PER - 1}) o`,
      [tid],
    );
    await sql.unsafe(
      `insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, at, data)
       select $1::uuid, ${contractUuid(n, "g")}, case when e = 1 then 'uploaded' else 'field_edited' end, '${OWNERS[0]}'::uuid,
         timestamptz '2026-01-01 00:00:00+00' + e * interval '1 hour', jsonb_build_object('n', e)
       from generate_series(1, ${PER_TENANT}) g, generate_series(1, ${EVENTS_PER}) e`,
      [tid],
    );
  }
  await sql.unsafe(
    `insert into contracts.contracts (id, tenant_id, title, direction, status, owner_user_id, created_by, created_at, updated_at, fields)
     select ('c0de0900-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, $1::uuid, 'Nền ' || g,
       (array['sale','purchase',null]::text[])[1 + g % 3], (${STATUS})[1 + g % 9], (${owners})[1 + g % 5], '${OWNERS[0]}'::uuid,
       timestamptz '2026-01-01 00:00:00+00' + g * interval '1 minute', timestamptz '2026-01-01 00:00:00+00' + g * interval '1 minute', $2::text::jsonb
     from generate_series(1, ${BG_ROWS}) g`,
    [BG_TENANT, tplJson],
  );
  const ms = performance.now() - t0;
  return {
    ms,
    rows: {
      contracts: PERF_TENANTS.length * PER_TENANT + BG_ROWS,
      items: PERF_TENANTS.length * PER_TENANT * ITEMS_PER,
      events: PERF_TENANTS.length * PER_TENANT * EVENTS_PER,
      categories: PERF_TENANTS.length * CATS,
    },
  };
}
export async function analyzeAll(sql: Sql): Promise<number> {
  const t0 = performance.now();
  for (const t of ["contracts", "contract_items", "contract_events", "contract_categories"])
    await sql.unsafe(`analyze contracts.${t}`);
  return performance.now() - t0;
}
export async function restoreAutovacuum(sql: Sql): Promise<void> {
  for (const t of [
    "contracts",
    "contract_items",
    "contract_events",
    "contract_categories",
    "files",
  ])
    await sql.unsafe(`alter table contracts.${t} reset (autovacuum_enabled)`);
}
