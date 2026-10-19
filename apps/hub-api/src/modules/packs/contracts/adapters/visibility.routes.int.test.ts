// M1D-FR-04 · `GET|PUT /pack/contracts/visibility` (route thật + pool hub_api + RLS gói): mặc định `tenant`; owner (admin) đổi sang
// `org` ⇒ editor thấy ít đi ngay câu kế; editor PUT ⇒ 403 PACK_FORBIDDEN; thân sai ⇒ 400; tenant khác không bị đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { visibilityRoutes } from "./visibility.routes";

let sql: Sql;
let db: Db;
let A = "";
let B = "";
let own = "";
let ed = "";
let other = "";
const F = { read: "f-r", write: "f-w", admin: "f-a" };

function app(user: string, tenant: string, groups: string[]) {
  const view: PackAccessView = {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set([A, B].flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
      grantGroups: new Map(
        [A, B].flatMap((t) => [
          [`${t}:${F.read}`, ["g-own", "g-edit"]],
          [`${t}:${F.write}`, ["g-own", "g-edit"]],
          [`${t}:${F.admin}`, ["g-own"]],
        ]),
      ),
    }),
    user: async () => ({ tenantId: tenant, groupIds: new Set(groups) }),
  };
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: user, tenantId: tenant, role: "member" } as never);
    await next();
  });
  h.route("/", visibilityRoutes(view, "contracts", db));
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
const put = (h: Hono<PackGuardVars>, body: unknown) =>
  h.request("/visibility", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 851)) as [string, string];
  [own, ed] = (await users(sql, A, 2, { from: 851 })) as [string, string];
  [other] = (await users(sql, B, 1, { from: 861 })) as [string];
  await contracts(sql, A, 1, { from: 851, createdBy: own, owner: own });
  await contracts(sql, A, 1, { from: 852, createdBy: ed, owner: ed });
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const seenBy = (u: string) =>
  inPackAs("contracts", A, u, async (tx) => (await tx`select id from contracts.contracts`).length);

describe("M1D-FR-04 · chế độ thấy qua route", () => {
  it("mặc định tenant; editor PUT ⇒ 403; thân sai ⇒ 400; owner PUT org ⇒ editor chỉ còn HĐ của mình; tenant B vẫn tenant", async () => {
    const owner = app(own, A, ["g-own"]);
    const editor = app(ed, A, ["g-edit"]);
    const before = {
      mode: await (await editor.request("/visibility")).json(),
      seen: await seenBy(ed),
    };
    const forbidden = (await put(editor, { mode: "org" })).status;
    const bad = (await put(owner, { mode: "all" })).status;
    const ok = await (await put(owner, { mode: "org" })).json();
    const after = {
      mode: await (await editor.request("/visibility")).json(),
      seen: await seenBy(ed),
    };
    const b = await (await app(other, B, ["g-edit"]).request("/visibility")).json();
    expect({ before, forbidden, bad, ok, after, b }).toEqual({
      before: { mode: { mode: "tenant" }, seen: 2 },
      forbidden: 403,
      bad: 400,
      ok: { mode: "org" },
      after: { mode: { mode: "org" }, seen: 1 },
      b: { mode: "tenant" },
    });
  });
});
