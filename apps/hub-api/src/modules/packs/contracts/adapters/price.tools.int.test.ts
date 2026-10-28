// com-c10a · int: 3 tool giá trên DB thật (RLS gói, reader thật) + người ngoài/không quyền bị từ chối.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import type { PackAccessView } from "../../kit/adapters/pack-guard.middleware";
import type { PackToolCtx, PackToolDef } from "../../kit/application/pack-tools.ports";
import { hostBookModule } from "../host-book.mount";
import { PRICE_TOOL_KEYS, priceTools } from "./price.tools";

let sql: Sql;
let db: Db;
let A = "";
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
    entitled: new Set(Object.values(F).map((f) => `${A}:${f}`)),
    grantGroups: new Map([[`${A}:${F.read}`, ["g-read"]]]),
  }),
  user: async (id) => ({ tenantId: A, groupIds: new Set(id === u1 ? ["g-read"] : ["g-none"]) }),
};
let tools: PackToolDef[] = [];
const run = (k: string, userId: string, a: Record<string, string>, kind?: "external") =>
  (tools.find((t) => t.name === k) as PackToolDef).run(
    { tenantId: A, userId, runId: null, ...(kind ? { userKind: kind } : {}) } as PackToolCtx,
    a,
  );

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A] = (await tenants(sql, 1, 881)) as [string];
  [u1, u2] = (await users(sql, A, 2, { from: 881 })) as [string, string];
  await enablePack(sql, [A], "contracts");
  const [p] = await sql<
    { id: string }[]
  >`insert into contracts.products (tenant_id, name, unit, grp)
    values (${A}::uuid, 'Xi măng PCB40', 'bao', 'goods') returning id::text`;
  await sql`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, supplier_party_key, kind, price, unit, source, seen_on)
    values (${A}::uuid, ${p?.id as string}::uuid, 'NCC Một', 'tax:0100', 'new', 95000, 'bao', 'quote', '2026-10-01'),
           (${A}::uuid, ${p?.id as string}::uuid, 'NCC Hai', 'name:ncc hai', 'new', 91000, 'bao', 'manual', '2026-10-20')`;
  db = createDb(urls().hubApi, { max: 4 });
  tools = priceTools(
    hostBookModule(db, view, {
      reputation: async () => new Map([["tax:0100", { score: 88, level: "good" as const }]]),
    }),
  );
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("com-c10a · price tools", () => {
  it("lookup: giá + nguồn + ngày + uy tín; không khớp ⇒ chưa có giá", async () => {
    const r = (await run(PRICE_TOOL_KEYS.lookup, u1, { product: "xi mang pcb40" })) as {
      prices: {
        supplier: string;
        date: string;
        source: string;
        reputation: { band: string } | null;
      }[];
    };
    expect(r.prices.map((x) => x.supplier)).toEqual(["NCC Hai", "NCC Một"]);
    expect(r.prices[1]).toMatchObject({ date: "2026-10-01", source: "quote" });
    expect(r.prices[1]?.reputation?.band).toBe("good");
    const n = (await run(PRICE_TOOL_KEYS.lookup, u1, { product: "gạch" })) as { message: string };
    expect(n.message).toContain("chưa có giá");
  });
  it("compare: rẻ nhất cùng đơn vị", async () => {
    const r = (await run(PRICE_TOOL_KEYS.compare, u1, { product: "xi mang pcb40" })) as {
      cheapest: { supplier: string; date: string };
      unit: string;
    };
    expect(r.cheapest).toMatchObject({ supplier: "NCC Hai", date: "2026-10-20" });
    expect(r.unit).toBe("bao");
  });
  it("find_suppliers: NCC kèm uy tín", async () => {
    const r = (await run(PRICE_TOOL_KEYS.suppliers, u1, { product: "xi mang" })) as {
      suppliers: { supplier: string }[];
    };
    expect(r.suppliers).toHaveLength(2);
  });
  it("người ngoài / không quyền đọc gói: từ chối cả 3 tool", async () => {
    for (const k of Object.values(PRICE_TOOL_KEYS)) {
      await expect(run(k, u1, { product: "xi mang" }, "external")).rejects.toThrow("forbidden");
      await expect(run(k, u2, { product: "xi mang" })).rejects.toThrow("forbidden");
    }
  });
});
