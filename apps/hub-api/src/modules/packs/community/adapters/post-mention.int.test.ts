// CR-145 · nhắc NGƯỜI trong bài đăng, trên route + RLS + chuông thật: chỉ người thấy được bài (422 nếu ngoài phạm vi), chuông tới người
// được nhắc (không tới người đăng — N2), bài chờ duyệt chỉ báo khi duyệt, sửa bài chỉ báo người MỚI, RLS `post_mentions`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withPackScope } from "@ai/db/pack-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { packHosts } from "../../kit/adapters/pack-hosts";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { communityModule } from "../community.mount";
import { communityEvents } from "./notify.events";

let own: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
let moderationOn = false;
const F = { read: "pm-r", write: "pm-w", admin: "pm-a", addon: "pm-ad" };
type Who = "hA" | "hM" | "s1a" | "s1b" | "s2" | "b1";
const ORG: Partial<Record<Who, keyof Cast>> = { s1a: "S1", s1b: "S1", s2: "S2", b1: "B1" };

function view(): PackAccessView {
  return {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
        { id: F.addon, key: "contracts-community", status: "on" },
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

const bells = async (u: string): Promise<string[]> =>
  (
    (await own`select title from hub.notifications where user_id = ${u}::uuid and source = 'community'
      and kind = 'community.mention' order by created_at, id`) as unknown as { title: string }[]
  ).map((r) => r.title);

const notePost = (mentionUserIds: string[], extra: Record<string, unknown> = {}) => ({
  type: "note",
  title: "Lịch giao hàng",
  body: "Nhờ các bên xem lịch giao tuần này",
  audience: { mode: "suppliers", cats: [], companies: [] },
  mentionUserIds,
  ...extra,
});

beforeAll(async () => {
  await cloneDb("full");
  own = openOwner(2);
  c = await seedCast(own, 56);
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
      flows: { moderationOn: async () => moderationOn },
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
  await own?.end({ timeout: 2 });
});

describe("CR-145 nhắc người trong bài", () => {
  let postId = "";

  it("chủ quản nhắc người thấy được bài ⇒ 201, bài hiện «Nhắc», người được nhắc nhận chuông, người đăng không nhận (N2)", async () => {
    const r = await call("hA", "POST", "/posts", notePost([c.hM, c.s1a, c.hA]));
    expect(r.status).toBe(201);
    postId = r.json.id;
    expect(r.json.mentionedUsers.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [c.hM, c.s1a, c.hA].sort(),
    );
    expect(await bells(c.hM)).toEqual([expect.stringContaining("nhắc bạn")]);
    expect(await bells(c.s1a)).toHaveLength(1);
    expect(await bells(c.hA)).toHaveLength(0); // không báo chính mình
    const link = (await own`select link from hub.notifications where user_id = ${c.s1a}::uuid
      and kind = 'community.mention'`) as unknown as { link: string }[];
    expect(link[0]?.link).toBe(`/community?post=${postId}`);
  });

  it("nhắc người của công ty KHÔNG thuộc nhóm người xem bài ⇒ 422 MENTION_USER_NOT_ALLOWED và bài không được tạo", async () => {
    const r = await call("hA", "POST", "/posts", notePost([c.b1], { title: "Bài bị chặn" }));
    expect(r.status).toBe(422);
    expect(r.json.error?.code ?? r.json.code).toBe("MENTION_USER_NOT_ALLOWED");
    const n =
      (await own`select count(*)::int as n from community.posts where title_raw = 'Bài bị chặn'`) as unknown as {
        n: number;
      }[];
    expect(n[0]?.n).toBe(0);
    expect(await bells(c.b1)).toHaveLength(0);
  });

  it("nhắc người của tenant khác ⇒ 422; quá 10 người ⇒ 400/422 theo contract", async () => {
    expect((await call("hA", "POST", "/posts", notePost([c.hB]))).status).toBe(422);
    const many = Array.from({ length: 11 }, () => crypto.randomUUID());
    expect([400, 422]).toContain((await call("hA", "POST", "/posts", notePost(many))).status);
  });

  it("đối tác chỉ nhắc đồng nghiệp công ty mình: nhắc chủ quản / công ty khác ⇒ 422; nhắc đồng nghiệp ⇒ 201 và đồng nghiệp nhận chuông", async () => {
    const sell = (ids: string[]) => ({
      type: "sell",
      title: "Keo mới",
      fields: { product: "Keo", qty: "1", price: null },
      mentionUserIds: ids,
    });
    expect((await call("s1a", "POST", "/posts", sell([c.hA]))).status).toBe(422);
    expect((await call("s1a", "POST", "/posts", sell([c.s2]))).status).toBe(422);
    const ok = await call("s1a", "POST", "/posts", sell([c.s1b]));
    expect(ok.status).toBe(201);
    expect(await bells(c.s1b)).toHaveLength(1);
    expect(await bells(c.s1a)).toHaveLength(1); // chỉ chuông lần trước (người đăng bài này không nhận)
  });

  it("RLS post_mentions: người công ty khác / tenant khác không đọc được hàng nhắc", async () => {
    const seen = (tenantId: string, userId: string, where = "true") =>
      withPackScope(db, { packKey: "community", tenantId, userId }, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from community.post_mentions where ${sql.raw(where)}`,
        );
        return Number(rows[0]?.n);
      });
    expect(await seen(c.A, c.hA)).toBeGreaterThan(0);
    // S2 thấy bài chủ quản (nhóm nhà cung cấp) nhưng không thấy người công ty KHÁC được nhắc (s1a) — RLS, không chỉ SQL feed
    expect(await seen(c.A, c.s2, "user_org is not null")).toBe(0);
    expect(await seen(c.B, c.hB)).toBe(0); // tenant khác
  });

  it("sửa bài thêm người mới ⇒ chỉ người MỚI nhận chuông; người đã được nhắc không nhận lại", async () => {
    const r = await call("hA", "PATCH", `/posts/${postId}`, {
      mentionUserIds: [c.hM, c.s1a, c.s2],
    });
    expect(r.status).toBe(200);
    expect(await bells(c.s2)).toHaveLength(1);
    expect(await bells(c.hM)).toHaveLength(1);
    expect(await bells(c.s1a)).toHaveLength(1);
    // bỏ người: danh sách thay toàn bộ
    const r2 = await call("hA", "PATCH", `/posts/${postId}`, { mentionUserIds: [c.hM] });
    expect(r2.json.mentionedUsers.map((m: { userId: string }) => m.userId)).toEqual([c.hM]);
  });

  it("bài chờ duyệt: chưa báo; khi được duyệt (emitPostMentions) mới báo, người đăng không nhận", async () => {
    moderationOn = true;
    const [m] =
      (await own`select count(*)::int as n from hub.notifications where user_id = ${c.hM}::uuid
      and kind = 'community.mention'`) as unknown as { n: number }[];
    const r = await call("hA", "POST", "/posts", notePost([c.hM], { title: "Chờ duyệt" }));
    moderationOn = false;
    expect(r.status).toBe(201);
    const after = (await bells(c.hM)).length;
    expect(after).toBe(Number(m?.n)); // bài chờ duyệt ⇒ chưa có chuông mới
    const ev = communityEvents({
      uow: createPackUow(db, "community", (tx) => ({ tx })),
      hosts: packHosts(db, view(), "community"),
      orgMembers: (t, ids) => pgExternalOrgResolver(db).orgMembers(t, ids),
    });
    await ev.emitPostMentions({
      tenantId: c.A,
      postId: r.json.id,
      actor: { userId: c.hA, name: "A" },
      titleMasked: "Chờ duyệt",
    });
    expect((await bells(c.hM)).length).toBe(after + 1);
    expect(await bells(c.hA)).toHaveLength(0);
  });

  it("gợi ý người: chủ quản thấy chủ quản + người công ty trong nhóm xem (nhà cung cấp), không thấy khách mua; đối tác chỉ thấy đồng nghiệp; tìm theo tên", async () => {
    const host = await call("hA", "GET", "/mentionable-people?type=note&mode=suppliers");
    expect(host.status).toBe(200);
    const ids = host.json.map((p: { userId: string }) => p.userId);
    expect(ids).toContain(c.hM);
    expect(ids).toContain(c.s1a);
    expect(ids).not.toContain(c.b1);
    expect(ids).not.toContain(c.hA); // không gồm chính mình
    const partner = await call("s1a", "GET", "/mentionable-people");
    expect(partner.json.map((p: { userId: string }) => p.userId)).toEqual([c.s1b]);
    const q = await call("hA", "GET", "/mentionable-people?type=note&mode=suppliers&q=S1b");
    expect(q.json.map((p: { userId: string }) => p.userId)).toEqual([c.s1b]);
    const byPost = await call("hA", "GET", `/mentionable-people?postId=${postId}`);
    expect(byPost.json.map((p: { userId: string }) => p.userId)).not.toContain(c.b1);
  });
});
