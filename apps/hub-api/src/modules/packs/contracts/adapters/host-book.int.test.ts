// com-c8-host-read · ADR-0031 · int cổng đọc `HostBookReader` trên DB thật (pool hub_api, RLS gói): đường chính (khớp tên đúng/tiền tố,
// kho + BQ, giá đã ghi nhận, uy tín), chặn `kind=external` / người không có quyền đọc gói / > 50 gợi ý, số câu SQL cố định theo cỡ lô.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { PackAccessView } from "../../kit/adapters/pack-guard.middleware";
import { HostBookError } from "../application/host-book.ports";
import { hostBookModule } from "../host-book.mount";

let sql: Sql;
let db: Db;
let A = "";
let B = "";
let u1 = "";
let u2 = "";
const F = { read: "f-r", write: "f-w", admin: "f-a" };
const view: PackAccessView = {
  catalog: async () => ({
    features: [
      { id: F.read, key: "contracts-read", status: "on" },
      { id: F.write, key: "contracts-write", status: "on" },
      { id: F.admin, key: "contracts-admin", status: "on" },
    ],
    entitled: new Set([A, B].flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
    grantGroups: new Map([A, B].map((t) => [`${t}:${F.read}`, ["g-read"]] as const)),
  }),
  user: async (id) => ({
    tenantId: A,
    groupIds: new Set(id === u1 ? ["g-read"] : ["g-none"]),
  }),
};
const reader = () =>
  hostBookModule(db, view, {
    reputation: async () => new Map([["tax:0100", { score: 88, level: "good" as const }]]),
  });

async function product(
  tid: string,
  name: string,
  o: { onHand?: number; value?: number; avg?: number },
) {
  const [p] = await sql<
    { id: string }[]
  >`insert into contracts.products (tenant_id, name, unit, grp)
    values (${tid}::uuid, ${name}, 'bao', 'goods') returning id::text`;
  await sql`insert into contracts.product_components (tenant_id, product_id, ord, name, unit, mode, on_hand, stock_value, avg_cost)
    values (${tid}::uuid, ${p?.id as string}::uuid, 0, ${name}, 'bao', 'stock', ${o.onHand ?? 0}, ${o.value ?? 0}, ${o.avg ?? 0})`;
  return p?.id as string;
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 871)) as [string, string];
  [u1, u2] = (await users(sql, A, 2, { from: 871 })) as [string, string];
  await enablePack(sql, [A, B], "contracts");
  const x1 = await product(A, "Xi măng PCB40", { onHand: 100, value: 9_000_000, avg: 90_000 });
  await product(A, "Xi măng PCB30 Nghi Sơn", {});
  await product(B, "Thép phi 10", { onHand: 5, value: 50, avg: 10 });
  await sql`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, supplier_party_key, kind, price, unit, source, seen_on)
    values (${A}::uuid, ${x1}::uuid, 'NCC Một', 'tax:0100', 'new', 95000, 'bao', 'quote', '2026-10-01'),
           (${A}::uuid, ${x1}::uuid, 'NCC Hai', 'name:ncc hai', 'new', 91000, 'bao', 'manual', '2026-10-20')`;
  await sql`update contracts.product_supplier_prices set vat_included = true, expires_on = '2999-01-01' where supplier_name = 'NCC Hai' and tenant_id = ${A}::uuid`;
  await sql`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, unit, source, seen_on, removed_at)
    select ${A}::uuid, ${x1}::uuid, 'NCC Gỡ', 'new', 1000, 'bao', 'manual', '2026-10-25', now()`;
  await sql`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, unit, source, seen_on, expires_on)
    select ${A}::uuid, ${x1}::uuid, 'NCC Hết hạn', 'new', 2000, 'bao', 'manual', '2026-10-26', current_date - 1`;
  await sql`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, unit, source, seen_on, replaced_at)
    select ${A}::uuid, ${x1}::uuid, 'NCC Thay', 'new', 3000, 'bao', 'quote', '2026-10-27', now()`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const TX_CTL =
  /^\s*((begin|commit|rollback|savepoint|release)\b|select set_config\(|select b\.oid,\s+b\.typarray\s+from pg_catalog\.pg_type)/i;
async function counted<T>(fn: () => Promise<T>): Promise<{ r: T; queries: number }> {
  // biome-ignore lint/suspicious/noExplicitAny: hook debug của pool postgres.js (đếm câu)
  const opts = (db as any).db.$client.options as { debug?: unknown };
  const prev = opts.debug;
  let n = 0;
  opts.debug = (_c: number, q: string) => {
    if (!TX_CTL.test(q)) n += 1;
  };
  try {
    return { r: await fn(), queries: n };
  } finally {
    opts.debug = prev;
  }
}
const who = (userId: string, kind?: "internal" | "external") => ({
  tenantId: A,
  userId,
  ...(kind ? { kind } : {}),
});
const kindOf = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) => (e instanceof HostBookError ? e.kind : "other"),
  );

describe("com-c8 · HostBookReader", () => {
  it("đường chính: khớp đúng + tiền tố, kho/BQ, giá mới nhất trước, uy tín; không thấy SP tenant khác", async () => {
    const out = await reader().read(who(u1, "internal"), {
      hints: [
        { name: "xi mang pcb40" },
        { name: "Xi măng PCB30" },
        { name: "Thép phi 10" },
        { name: "Gạch" },
      ],
      partyKeys: ["tax:0100", "tax:none"],
    });
    const [a, b, c, d] = out.products;
    expect(a?.match?.how).toBe("exact");
    expect(a?.onHand).toBe("100.0000");
    expect(a?.avgCost).toBe(90_000);
    expect(a?.prices.map((p) => p.supplierName)).toEqual(["NCC Hai", "NCC Một"]);
    expect(a?.prices[0]?.vatIncluded).toBe(true);
    expect(a?.prices[0]?.expiresOn).toBe("2999-01-01");
    expect(a?.prices[1]?.vatIncluded).toBeNull();
    expect(b?.match?.how).toBe("prefix");
    expect(b?.match?.name).toBe("Xi măng PCB30 Nghi Sơn");
    expect(c?.match).toBeNull();
    expect(d?.match).toBeNull();
    expect(out.partners).toEqual([
      { partyKey: "tax:0100", band: "good", score: 88 },
      { partyKey: "tax:none", band: null, score: null },
    ]);
  });

  it("chặn: kind=external, người không có quyền đọc gói, > 50 gợi ý, id sai", async () => {
    const q = { hints: [{ name: "Xi măng" }] };
    expect(await kindOf(reader().read(who(u1, "external"), q))).toBe("forbidden");
    expect(await kindOf(reader().read(who(u2, "internal"), q))).toBe("forbidden");
    const many = { hints: Array.from({ length: 51 }, (_, i) => ({ name: `sp ${i}` })) };
    expect(await kindOf(reader().read(who(u1), many))).toBe("too_many");
    expect(await kindOf(reader().read(who(u1), { hints: [{ productId: "x" }] }))).toBe("invalid");
  });

  it("Luật 4c: số câu SQL cố định, không theo cỡ lô", async () => {
    const hint = (i: number) => ({ name: i % 2 ? "Xi măng PCB" : `sp ${i}` });
    const run = (n: number) =>
      counted(() =>
        reader().read(who(u1), {
          hints: Array.from({ length: n }, (_, i) => hint(i)),
          partyKeys: ["tax:0100"],
        }),
      );
    const one = await run(1);
    const fifty = await run(50);
    expect(one.queries).toBe(2);
    expect(fifty.queries).toBe(one.queries);
    expect(fifty.r.products).toHaveLength(50);
  });
});
