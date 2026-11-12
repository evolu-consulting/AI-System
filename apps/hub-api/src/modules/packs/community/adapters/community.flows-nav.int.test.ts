// CR-120 · `GET /flows/nav` + `/pack/nav` (tách khỏi community.flows.int.test.ts cho gọn ≤ 600 dòng): quyền xem menu luồng Community
// trên route + RLS thật. Agent không dùng ở đây (chỉ cờ `moderationOn`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import {
  type Cast,
  seedCast,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { partnerLinker } from "../../contracts/adapters/partner-linker";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { packNavRoutes } from "../../kit/adapters/pack-nav.route";
import { communityModule } from "../community.mount";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = { read: "c-r", write: "c-w", admin: "c-a" };
type Who = "hA" | "hM" | "s1a" | "s1b" | "s2" | "b2";
const ORG: Partial<Record<Who, "S1" | "S2" | "B2">> = { s1a: "S1", s1b: "S1", s2: "S2", b2: "B2" };
let moderationOn = true;

function view(): PackAccessView {
  return {
    catalog: async () => ({
      features: [
        { id: F.read, key: "community-read", status: "on" },
        { id: F.write, key: "community-write", status: "on" },
        { id: F.admin, key: "community-admin", status: "on" },
      ],
      entitled: new Set(Object.values(F).map((f) => `${c.A}:${f}`)),
      grantGroups: new Map([
        [`${c.A}:${F.read}`, [c.roles.owner, c.roles.editor]],
        [`${c.A}:${F.write}`, [c.roles.owner, c.roles.editor]],
        [`${c.A}:${F.admin}`, [c.roles.owner]],
      ]),
    }),
    user: async (id) => ({
      tenantId: c.A,
      groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
    }),
  };
}

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 53);
  db = createDb(urls().hubApi, { max: 2 });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    const org = ORG[who];
    ctx.set("user", {
      userId: c[who],
      tenantId: c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(org ? { userKind: "external", extOrgId: c[org] } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route(
    "/",
    communityModule(db, view(), pgExternalOrgResolver(db), {
      partners: partnerLinker(),
      flows: { moderationOn: async () => moderationOn },
    }),
  );
  h.route("/pack", packNavRoutes(view()));
  h.onError((e, ctx) => {
    const m = mapError(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("GET /flows/nav [CR-120]", () => {
  it("người duyệt + duyệt bài bật ⇒ đủ, thành viên thường ⇒ không, đối tác ⇒ chỉ gửi yêu cầu, công ty chưa bật khe ⇒ không có hàng chờ", async () => {
    moderationOn = true;
    expect((await call("hA", "GET", "/flows/nav")).json).toEqual({
      moderationQueue: true,
      moderationOn: true,
      joinSubmit: false,
      joinReview: true,
      reports: true,
    });
    expect((await call("hM", "GET", "/flows/nav")).json).toEqual({
      moderationQueue: false,
      moderationOn: true,
      joinSubmit: false,
      joinReview: false,
      reports: false,
    });
    expect((await call("s2", "GET", "/flows/nav")).json).toEqual({
      moderationQueue: false,
      moderationOn: true,
      joinSubmit: true,
      joinReview: false,
      reports: false,
    });
    moderationOn = false; // tenant chưa được gán khe duyệt bài
    const off = (await call("hA", "GET", "/flows/nav")).json;
    expect(off).toMatchObject({ moderationQueue: false, moderationOn: false, reports: true });
    moderationOn = true;
  });

  it("C-7 · /pack/nav: người duyệt thấy đúng số công ty mình (không lẫn công ty khác), người khác không có số", async () => {
    const mk = (t: string, k: string[]) =>
      seedPosts(
        sql,
        t,
        k.map((key) => ({ key, type: "note", org: null, author: c.hA })),
      );
    const ids = [
      ...(await mk(c.A, ["C7_a"])).values(),
      ...(await mk(c.B, ["C7_b1", "C7_b2"])).values(),
    ];
    await sql`update community.posts set moderation = 'pending', mod_at = now() where id = any(${ids}::uuid[])`;
    const [w] =
      await sql`select (select count(*)::int from community.posts where tenant_id = ${c.A}::uuid and moderation = 'pending') as review,
      (select count(*)::int from community.join_requests where tenant_id = ${c.A}::uuid and status = 'pending') as join,
      (select count(*)::int from community.reports where tenant_id = ${c.A}::uuid and status = 'pending') as reports`;
    expect(w?.review).toBeGreaterThanOrEqual(1); // chỉ A; 2 bài chờ của B không được cộng
    const items = async (u: Who) => (await call(u, "GET", "/pack/nav")).json.items;
    expect(await items("hA")).toEqual([
      { cap: "community.review", count: w?.review },
      { cap: "community.join", count: w?.join },
      { cap: "community.reports", count: w?.reports },
    ]);
    expect(await items("hM")).toEqual([]); // thành viên thường: không mục luồng
    expect(await items("s2")).toEqual([{ cap: "community.join", count: 0 }]); // đối tác: chỉ gửi yêu cầu, không số
  });
});
