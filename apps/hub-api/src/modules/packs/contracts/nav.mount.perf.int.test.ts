// CR-125 G7 · đường nóng `GET /pack/nav` (menu mọi app): thêm số chờ hộp thư đối tác KHÔNG làm vượt ngưỡng p95 ≤ 50 ms.
// Đo cùng DB, xen kẽ: TRƯỚC = nguồn contracts không có cổng đếm (count 0 cố định, như cũ) · SAU = có cổng đếm (MỘT câu count qua index).
// Dữ liệu: công ty có 10.000 thư (20 chờ). In số thật ra log.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { packNavRoutes } from "../kit/adapters/pack-nav.route";
import { createPackNavRegistry } from "../kit/application/pack-nav.ports";
import { contractsNavSource, partnerCountPort } from "./nav.mount";
import { seedPartnerInbox } from "./testing/partner-inbox.seed";

const P95_MAX_MS = 50;
const N = 300;
let o: Sql;
let db: Db;
let A = "";
let UA = "";

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: [{ id: "f1", key: "contracts-read", status: "on" }],
    entitled: new Set([`${A}:f1`]),
    grantGroups: new Map(),
  }),
  user: async () => ({ tenantId: A, groupIds: new Set() }),
});
const appWith = (count: ReturnType<typeof partnerCountPort> | undefined) => {
  const reg = createPackNavRegistry();
  reg.register(
    contractsNavSource(
      async () => true,
      undefined,
      async () => true,
      count,
    ),
  );
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: UA, tenantId: A, role: "member", userKind: "internal" } as never);
    await next();
  });
  h.route("/pack", packNavRoutes(view(), reg));
  return h;
};
const p95 = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A] = (await tenants(o, 1, 1700)) as [string];
  [UA] = (await users(o, A, 1, { from: 1700 })) as [string];
  await seedPartnerInbox(o, A, UA, { from: 190_000, total: 10_000, pending: 20 });
  await o`analyze contracts.partner_inbox`;
  db = createDb(urls().hubApi, { max: 4 });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("perf · GET /pack/nav với số chờ hộp thư đối tác", () => {
  it("p95 không vượt ngưỡng và số đúng (trước → sau)", async () => {
    const before = appWith(undefined);
    const after = appWith(partnerCountPort(db));
    const call = async (h: Hono<PackGuardVars>) => {
      const t = performance.now();
      const res = await h.request("/pack/nav");
      const body = (await res.json()) as { items: { cap: string; count: number }[] };
      return { ms: performance.now() - t, body };
    };
    for (let i = 0; i < 30; i++) {
      await call(before);
      await call(after);
    }
    const tb: number[] = [];
    const ta: number[] = [];
    for (let i = 0; i < N; i++) {
      tb.push((await call(before)).ms);
      ta.push((await call(after)).ms);
    }
    expect((await call(before)).body.items).toEqual([{ cap: "contracts.partner", count: 0 }]);
    expect((await call(after)).body.items).toEqual([{ cap: "contracts.partner", count: 20 }]);
    console.log(
      `PERF /pack/nav p95 trước=${p95(tb).toFixed(2)}ms sau=${p95(ta).toFixed(2)}ms (p50 trước=${[...tb].sort((a, b) => a - b)[N >> 1]?.toFixed(2)} sau=${[...ta].sort((a, b) => a - b)[N >> 1]?.toFixed(2)}; N=${N}, 10000 thư/20 chờ)`,
    );
    expect(p95(ta)).toBeLessThanOrEqual(P95_MAX_MS);
  }, 120_000);
});
