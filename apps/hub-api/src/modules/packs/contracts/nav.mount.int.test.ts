// CR-125 G7 · số «Đang chờ công ty nhận» của mục menu `contracts.partner` (`GET /pack/nav`) trên DB THẬT: đếm đúng trạng thái pending của
// ĐÚNG công ty người xem (không lẫn công ty khác), đổi theo trạng thái thật (trả lời xong ⇒ số giảm), tính năng tắt ⇒ không mục.
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

let o: Sql;
let db: Db;
let A = "";
let B = "";
let C = "";
let UA = "";
let UB = "";
let UC = "";

const viewer = (tenantId: string, userId: string, userKind: "internal" | "external" = "internal") =>
  ({ userId, tenantId, role: "member", userKind }) as never;
const source = (partnerOn = true) =>
  contractsNavSource(
    async () => true,
    undefined,
    async () => partnerOn,
    partnerCountPort(db),
  );

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B, C] = (await tenants(o, 3, 1500)) as [string, string, string];
  [UA] = (await users(o, A, 1, { from: 1500 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1501 })) as [string];
  [UC] = (await users(o, C, 1, { from: 1502 })) as [string];
  await seedPartnerInbox(o, A, UA, { from: 150_000, total: 5, pending: 3 });
  await seedPartnerInbox(o, B, UB, { from: 160_000, total: 4, pending: 2 });
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 G7 · nav contracts.partner đếm partner_inbox pending", () => {
  it("mỗi công ty thấy đúng số của mình; công ty chưa có thư ⇒ mục hiện, số 0", async () => {
    expect(await source().caps(viewer(A, UA))).toEqual([{ cap: "contracts.partner", count: 3 }]);
    expect(await source().caps(viewer(B, UB))).toEqual([{ cap: "contracts.partner", count: 2 }]);
    expect(await source().caps(viewer(C, UC))).toEqual([{ cap: "contracts.partner", count: 0 }]);
  });

  it("tính năng tắt hoặc người xem bên ngoài ⇒ không mục", async () => {
    expect(await source(false).caps(viewer(A, UA))).toEqual([]);
    expect(await source().caps(viewer(A, UA, "external"))).toEqual([]);
  });

  it("qua GET /pack/nav: trả lời một thư ⇒ số giảm theo trạng thái thật", async () => {
    const view: PackAccessView = {
      catalog: async () => ({
        features: [{ id: "f1", key: "contracts-read", status: "on" }],
        entitled: new Set([`${A}:f1`]),
        grantGroups: new Map(),
      }),
      user: async () => ({ tenantId: A, groupIds: new Set() }),
    };
    const reg = createPackNavRegistry();
    reg.register(source());
    const h = new Hono<PackGuardVars>();
    h.use("*", async (c, next) => {
      c.set("user", viewer(A, UA));
      await next();
    });
    h.route("/pack", packNavRoutes(view, reg));
    const items = async () =>
      ((await (await h.request("/pack/nav")).json()) as { items: unknown }).items;
    expect(await items()).toEqual([{ cap: "contracts.partner", count: 3 }]);
    await o`update contracts.partner_inbox set status = 'confirmed', replied_at = now()
      where tenant_id = ${A}::uuid and status = 'pending' and contract_id = (
        select contract_id from contracts.partner_inbox where tenant_id = ${A}::uuid and status = 'pending' limit 1)`;
    expect(await items()).toEqual([{ cap: "contracts.partner", count: 2 }]);
  });
});
