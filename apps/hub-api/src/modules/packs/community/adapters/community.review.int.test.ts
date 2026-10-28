// CR-102 · com-c3 · sửa sau security review (TB1–TB3, Thấp1–3) trên route + RLS thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PostViewSchema } from "@ai/contracts/community";
import { createDb, type Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import {
  type Cast,
  seedCast,
  seedComments,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { communityModule } from "../community.mount";
import { feedQuery } from "./post.sql";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
let P = new Map<string, string>();
const F = { read: "c-r", write: "c-w", admin: "c-a" };

type Who = "hA" | "hM" | "s1a" | "s1b" | "s2" | "b1";
const ORG: Partial<Record<Who, "S1" | "S2" | "B1">> = { s1a: "S1", s1b: "S1", s2: "S2", b1: "B1" };

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

/** `x-kind: internal` = token nói nội bộ (bất kể DB) — giả token cũ/giả (TB1). */
const call = async (who: Who, method: string, path: string, body?: unknown, kind?: string) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": who, "x-kind": kind ?? "", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 51);
  db = createDb(urls().hubApi, { max: 2 });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    const org = ORG[who];
    const forced = ctx.req.header("x-kind") === "internal";
    ctx.set("user", {
      userId: c[who],
      tenantId: c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(org && !forced ? { userKind: "external", extOrgId: c[org] } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route("/", communityModule(db, view(), pgExternalOrgResolver(db)));
  h.onError((e, ctx) => {
    const m = mapError(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
  P = await seedPosts(sql, c.A, [
    { key: "P_sup", type: "note", org: null, author: c.hA, aud: { mode: "suppliers" } },
    { key: "S1_post", type: "sell", org: c.S1, author: c.s1a },
  ]);
  await seedComments(sql, c.A, [
    { key: "c_s2", post: P.get("P_sup") as string, thread: c.S2, author: c.s2, org: c.S2 },
    { key: "c_s1", post: P.get("P_sup") as string, thread: c.S1, author: c.s1a, org: c.S1 },
  ]);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("com-c3 review", () => {
  it("TB1: token nói nội bộ nhưng DB là đối tác ⇒ 403; cột raw/hits/audience do DB quyết (đối tác không nhận)", async () => {
    const s = await call("s1a", "POST", "/posts", {
      type: "sell",
      body: "Gọi 0912 345 678",
      fields: { product: "Keo", qty: "1", price: null },
    });
    expect(s.status).toBe(201);
    expect((await call("s1a", "GET", "/feed", undefined, "internal")).status).toBe(403);
    const raw = await withPackScope(
      db,
      { packKey: "community", tenantId: c.A, userId: c.s1a },
      (tx) =>
        feedQuery(tx, c.A, {
          org: null, // giả server nhầm là chủ quản — DB vẫn che
          tab: "all",
          cat: null,
          area: null,
          author: null,
          q: null,
          mine: false,
          cursor: null,
          limit: 50,
        }),
    );
    const mine = raw.items.find((x) => x.id === s.json.id);
    expect({ body: mine?.body.includes("0912"), hits: mine?.hits ?? null }).toEqual({
      body: false,
      hits: null,
    });
    expect(raw.items.every((x) => x.aud === null)).toBe(true);
  });

  it("TB2: url media chỉ http(s); nhãn media của đối tác bị che", async () => {
    const post = (url: string) =>
      call("s1a", "POST", "/posts", {
        type: "sell",
        fields: { product: "Keo", qty: "1", price: null },
        media: [{ id: "m", kind: "image", label: "zalo 0987654321", url }],
      });
    expect((await post("javascript:alert(1)")).status).toBe(400);
    expect((await post("data:text/html,x")).status).toBe(400);
    const ok = await post("https://cdn.test/a.png");
    expect(ok.status).toBe(201);
    expect(PostViewSchema.parse(ok.json).media[0]?.label).not.toContain("0987654321");
  });

  it("TB3: đối tác chèn bình luận vào luồng công ty khác (thread_id của S2) ⇒ 42501; đổi bài khi sửa ⇒ 23514", async () => {
    const pa = P.get("P_sup") as string;
    const [t2] = await sql<{ id: string }[]>`select id::text as id from community.threads
      where post_id = ${pa}::uuid and ext_org_id = ${c.S2}::uuid`;
    const code = await pgCode(() =>
      inPackAs(
        "community",
        c.A,
        c.s1a,
        (tx) => tx`insert into community.comments (tenant_id, post_id, thread_id,
          thread_org, author_user_id, author_org, text_raw, text_masked)
        values (${c.A}::uuid, ${pa}::uuid, ${t2?.id as string}::uuid, ${c.S1}::uuid, ${c.s1a}::uuid, ${c.S1}::uuid, 'x', 'x')`,
      ),
    );
    const move = await pgCode(() =>
      inPackAs(
        "community",
        c.A,
        c.s1a,
        (tx) => tx`update community.comments set post_id = ${P.get("S1_post") as string}::uuid
        where text_raw = 'c_s1'`,
      ),
    );
    expect({ code, move }).toEqual({ code: "42501", move: "23514" });
  });

  it("Thấp1: chủ quản mở luồng cho công ty ngoài audience / khác bên đăng ⇒ 404; đúng ⇒ 201", async () => {
    const pa = P.get("P_sup") as string;
    const s1p = P.get("S1_post") as string;
    expect(
      (await call("hA", "POST", `/posts/${pa}/comments`, { text: "x", orgId: c.B1 })).status,
    ).toBe(404);
    expect(
      (await call("hA", "POST", `/posts/${s1p}/comments`, { text: "x", orgId: c.S2 })).status,
    ).toBe(404);
    expect(
      (await call("hA", "POST", `/posts/${pa}/comments`, { text: "x", orgId: c.S2 })).status,
    ).toBe(201);
  });

  it("Thấp2: đồng nghiệp cùng công ty không có `edit` và PATCH 404", async () => {
    const id = P.get("S1_post") as string;
    const feed = await call("s1b", "GET", "/feed?mine=true");
    const mine = (feed.json.items as { id: string; actions: string[] }[]).find((x) => x.id === id);
    expect({
      edit: mine?.actions.includes("edit"),
      patch: (await call("s1b", "PATCH", `/posts/${id}`, { title: "y" })).status,
    }).toEqual({
      edit: false,
      patch: 404,
    });
  });

  it("Thấp3: ghi nhãn đối tác ở DB chỉ Admin chủ quản (thành viên ⇒ 42501)", async () => {
    const w = (u: string) =>
      pgCode(() =>
        inPackAs(
          "community",
          c.A,
          u,
          (tx) => tx`update community.partner_companies set area = 'HN'
          where ext_org_id = ${c.S1}::uuid`,
        ),
      );
    expect({ member: await w(c.hM), admin: await w(c.hA) }).toEqual({
      member: "42501",
      admin: null,
    });
  });
});
