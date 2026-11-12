// CR-121 F-4 · chặn chéo công ty cho các khe Community (route + RLS thật): admin công ty B — ĐỦ quyền gói của B — không thấy hàng đợi
// duyệt bài / yêu cầu tham gia / báo cáo của công ty A và không quyết được (403/404); dữ liệu công ty A không đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { members } from "@ai/test-kit/builders";
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
import { communityModule } from "../community.mount";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = { read: "c-r", write: "c-w", admin: "c-a" };
type Who = "hA" | "hB" | "s1a" | "b1";
const ORG: Partial<Record<Who, "S1" | "B1">> = { s1a: "S1", b1: "B1" };
const bg: Promise<unknown>[] = [];
const drain = async () => {
  await Promise.all(bg.splice(0));
};
let agentOut = '{"flagged":true,"reason":"nghi spam"}';

function view(): PackAccessView {
  const both = (f: string) => [`${c.A}:${f}`, `${c.B}:${f}`];
  return {
    catalog: async () => ({
      features: [
        { id: F.read, key: "community-read", status: "on" },
        { id: F.write, key: "community-write", status: "on" },
        { id: F.admin, key: "community-admin", status: "on" },
      ],
      entitled: new Set(Object.values(F).flatMap(both)),
      grantGroups: new Map(
        Object.values(F).flatMap((f) => [
          [`${c.A}:${f}`, [c.roles.owner]],
          [`${c.B}:${f}`, [c.rolesB.owner]],
        ]),
      ),
    }),
    user: async (id) =>
      id === c.hB
        ? { tenantId: c.B, groupIds: new Set([c.rolesB.owner]) }
        : { tenantId: c.A, groupIds: new Set(id === c.hA ? [c.roles.owner] : []) },
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
  c = await seedCast(sql, 54);
  await members(sql, c.B, c.rolesB.owner, [c.hB]); // admin công ty B: đủ quyền gói của B
  db = createDb(urls().hubApi, { max: 2 });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    const org = ORG[who];
    ctx.set("user", {
      userId: c[who],
      tenantId: who === "hB" ? c.B : c.A,
      role: who === "hA" || who === "hB" ? "tenant_admin" : "member",
      ...(org ? { userKind: "external", extOrgId: c[org] } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route(
    "/",
    communityModule(db, view(), pgExternalOrgResolver(db), {
      partners: partnerLinker(),
      flows: {
        agents: { call: async () => ({ ok: true as const, text: agentOut }) },
        moderationOn: async () => true,
        background: (p) => {
          bg.push(p);
        },
      },
    }),
  );
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

describe("chặn chéo công ty [CR-121 F-4]", () => {
  it("admin công ty B: không thấy hàng đợi của A, quyết bài/yêu cầu tham gia/báo cáo của A ⇒ 403/404 và dữ liệu A không đổi", async () => {
    // A: một bài chờ duyệt (agent gắn cờ), một yêu cầu tham gia, một báo cáo trên bài của chủ quản.
    const hostPost = (
      await seedPosts(sql, c.A, [{ key: "host", type: "note", org: null, author: c.hA }])
    ).get("host") as string;
    const posted = await call("s1a", "POST", "/posts", {
      type: "sell",
      body: "Keo dán",
      fields: { product: "Keo", qty: "1", price: null },
    });
    expect(posted.status).toBe(201);
    const postId = posted.json.id as string;
    agentOut = '{"kind":"spam","level":"high"}';
    const rp = await call("b1", "POST", `/posts/${hostPost}/report`, { reason: "Quảng cáo rác" });
    expect(rp.status).toBe(201);
    await sql`delete from contracts.partner_profiles where ext_org_id = ${c.B1}::uuid`;
    const jr = await call("b1", "POST", "/join-requests", {
      company: "Công ty Bao Bì Một",
      contact: "Anh Một",
      email: "mot@doi-tac.test",
      reason: "Muốn mua bao bì",
      labels: ["customer"],
    });
    expect(jr.status).toBe(201);
    await drain();
    const jid = jr.json.id as string;
    const rid = rp.json.id as string;
    const snap = async () =>
      JSON.stringify(
        await sql`select (select to_jsonb(p) from community.posts p where p.id = ${postId}::uuid) as post,
          (select to_jsonb(j) from community.join_requests j where j.id = ${jid}::uuid) as jr,
          (select to_jsonb(r) from community.reports r where r.id = ${rid}::uuid) as rp`,
      );
    const before = await snap();
    const ids = (r: { json: { items?: { id: string }[] } | null }) =>
      (r.json?.items ?? []).map((i) => i.id);
    const denied = [403, 404];

    const q = await call("hB", "GET", "/moderation/queue");
    expect([200, ...denied]).toContain(q.status);
    expect(ids(q)).not.toContain(postId);
    expect(ids(await call("hB", "GET", "/join-requests"))).not.toContain(jid);
    expect(ids(await call("hB", "GET", "/reports"))).not.toContain(rid);
    expect(denied).toContain(
      (await call("hB", "POST", `/moderation/${postId}/decide`, { action: "approve" })).status,
    );
    expect(denied).toContain(
      (await call("hB", "POST", `/join-requests/${jid}/decide`, { action: "approve" })).status,
    );
    expect(denied).toContain(
      (await call("hB", "POST", `/reports/${rid}/decide`, { action: "hide" })).status,
    );
    expect(await snap()).toBe(before);
    // đối chứng: admin công ty A quyết được (test không bị chặn vì lý do khác)
    expect(
      (await call("hA", "GET", "/moderation/queue")).json.items.map((i: { id: string }) => i.id),
    ).toContain(postId);
    expect((await call("hA", "POST", `/reports/${rid}/decide`, { action: "dismiss" })).status).toBe(
      200,
    );
  });
});
