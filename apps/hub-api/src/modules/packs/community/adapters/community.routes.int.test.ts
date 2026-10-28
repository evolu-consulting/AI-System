// CR-102 · com-c3 · route `/pack/community/*` thật (pool hub_api + RLS gói + danh bạ kit): một đường chính mỗi endpoint +
// ca chặn chính (HT-52/54/64/71/73/74/82, PACK_DISABLED, đối tác chọn người xem 422, sai loại bài 403). Mọi JSON được kiểm
// bằng schema strict của contract ⇒ trường thừa (saveQuote/hidden/hits/audience cho đối tác) làm đỏ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CommunitySettingsSchema,
  CommunityViewerSchema,
  FeedResponseSchema,
  PartnerOrgSchema,
  PostSourceSchema,
  PostViewSchema,
  ProfileSchema,
  ThreadSchema,
  ThreadSummarySchema,
} from "@ai/contracts/community";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { z } from "zod";
import { type Cast, seedCast } from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { communityModule } from "../community.mount";

let sql: Sql;
let db: Db;
let c: Cast;
const F = { read: "c-r", write: "c-w", admin: "c-a" };

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
        [`${c.A}:${F.read}`, [c.roles.owner, c.roles.editor, c.roles.viewer]],
        [`${c.A}:${F.write}`, [c.roles.owner, c.roles.editor]],
        [`${c.A}:${F.admin}`, [c.roles.owner]],
      ]),
    }),
    user: async (id) => ({
      tenantId: id === c.hB ? c.B : c.A,
      groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
    }),
  };
}

type Who = "hA" | "hM" | "hB" | "s1a" | "s1b" | "s2" | "b1" | "x1";
const ORG: Partial<Record<Who, keyof Cast>> = { s1a: "S1", s1b: "S1", s2: "S2", b1: "B1", x1: "X" };

let app: Hono<PackGuardVars>;
function build() {
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    const org = ORG[who];
    ctx.set("user", {
      userId: c[who],
      tenantId: who === "hB" ? c.B : c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(org ? { userKind: "external", extOrgId: c[org] } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route("/", communityModule(db, view(), pgExternalOrgResolver(db), { shtUrl: "/sht" }));
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  return h;
}

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
};
const ok = async <S extends z.ZodType>(
  schema: S,
  p: Promise<{ status: number; json: unknown }>,
  want = 200,
) => {
  const r = await p;
  expect({ status: r.status, err: r.status === want ? null : r.json }).toEqual({
    status: want,
    err: null,
  });
  return schema.parse(r.json) as z.output<S>;
};

let hostPost = "";
let s1Post = "";

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 41);
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("viewer / partners / cats / profile / settings / notifications", () => {
  it("GET /viewer: Admin chủ quản, thành viên, đối tác (nhãn + nhóm hàng của công ty)", async () => {
    expect(await ok(CommunityViewerSchema, call("hA", "GET", "/viewer"))).toMatchObject({
      role: "host_admin",
      orgId: c.A,
      labels: [],
    });
    expect((await ok(CommunityViewerSchema, call("hM", "GET", "/viewer"))).role).toBe(
      "host_member",
    );
    expect(await ok(CommunityViewerSchema, call("x1", "GET", "/viewer"))).toMatchObject({
      role: "partner",
      orgId: c.X,
      orgName: "Công ty Hai Chiều",
      labels: ["supplier", "buyer"],
      cats: ["dong-goi"],
    });
  });
  it("PACK_DISABLED khi tenant chưa bật gói", async () => {
    expect((await call("hB", "GET", "/viewer")).status).toBe(403);
  });
  it("GET /partners: chủ quản thấy mọi bạn bè (kể cả đã rời); HT-71 đối tác chỉ công ty mình", async () => {
    const host = await ok(z.array(PartnerOrgSchema), call("hM", "GET", "/partners"));
    expect(host.length).toBe(6);
    expect(host.find((p) => p.id === c.LEFT)?.left).toBe(true);
    expect(
      (await ok(z.array(PartnerOrgSchema), call("s1a", "GET", "/partners"))).map((p) => p.id),
    ).toEqual([c.S1]);
  });
  it("PUT /partners/:orgId: chỉ Admin chủ quản (HT-82: thành viên/đối tác 403)", async () => {
    const body = {
      labels: ["supplier", "buyer"],
      cats: ["dong-goi", "chu-ky-so"],
      partyKey: "sht-123",
    };
    expect((await call("hM", "PUT", `/partners/${c.S2}`, body)).status).toBe(403);
    expect((await call("s2", "PUT", `/partners/${c.S2}`, body)).status).toBe(403);
    expect(await ok(PartnerOrgSchema, call("hA", "PUT", `/partners/${c.S2}`, body))).toMatchObject({
      labels: ["buyer", "supplier"],
      partyKey: "sht-123",
    });
    await call("hA", "PUT", `/partners/${c.S2}`, { labels: ["supplier"], cats: ["chu-ky-so"] });
  });
  it("GET /cats, /notifications; settings mặc định → lưu → đọc lại", async () => {
    expect(await ok(z.array(z.string()), call("hA", "GET", "/cats"))).toContain("dong-goi");
    expect((await call("s1a", "GET", "/notifications")).json).toEqual({ items: [], unread: 0 });
    expect((await ok(CommunitySettingsSchema, call("s1a", "GET", "/settings"))).accent).toBe(
      "indigo",
    );
    const s = {
      accent: "teal" as const,
      notify: { ...(await call("s1a", "GET", "/settings")).json.notify, digest: true },
    };
    await ok(CommunitySettingsSchema, call("s1a", "PUT", "/settings", s));
    expect(await ok(CommunitySettingsSchema, call("s1a", "GET", "/settings"))).toEqual(s);
    expect((await ok(CommunitySettingsSchema, call("s1b", "GET", "/settings"))).accent).toBe(
      "indigo",
    );
  });
  it("GET /profile: chủ quản có shtUrl + bạn bè; HT-74 đối tác xem hồ sơ chủ quản (không SHT); HT-73 công ty khác 404", async () => {
    expect(await ok(ProfileSchema, call("hA", "GET", "/profile"))).toMatchObject({
      org: { isHost: true },
      stats: { friends: 5 },
      shtUrl: "/sht",
    });
    const host = await ok(ProfileSchema, call("s1a", "GET", `/profile/${c.A}`));
    expect({ sht: host.shtUrl, friends: host.stats.friends }).toEqual({
      sht: undefined,
      friends: undefined,
    });
    expect((await ok(ProfileSchema, call("s1a", "GET", "/profile"))).org.id).toBe(c.S1);
    expect((await call("s1a", "GET", `/profile/${c.S2}`)).status).toBe(404);
  });
});

describe("bài: tạo / bảng tin / sửa / thao tác / nguồn", () => {
  it("POST /posts chủ quản (audience mặc định) + đối tác (che lúc ghi, nhắc HT-54); đối tác chọn người xem ⇒ 422; sai loại ⇒ 403", async () => {
    const h = await ok(
      PostViewSchema,
      call("hA", "POST", "/posts", {
        type: "sell",
        title: "USB Token",
        fields: { product: "USB Token", qty: "10", price: "500000" },
        cats: ["dong-goi"],
        audience: { mode: "all" },
        media: [{ id: "m", kind: "image", label: "ảnh 1" }],
      }),
      201,
    );
    hostPost = h.id;
    expect(h).toMatchObject({
      authorSide: "host",
      audience: { mode: "all" },
      actions: ["edit", "archive", "done", "delete"],
    });
    expect(h.media.map((m) => m.label)).toEqual(["ảnh 1"]);
    const res = await call("s1a", "POST", "/posts", {
      type: "sell",
      title: "Băng keo",
      body: "Gọi 0912 345 678 hoặc hỏi Hãng NCCA",
      fields: { product: "Băng keo 5cm", qty: "100 cuộn", price: null },
      cats: ["dong-goi"],
    });
    const p = PostViewSchema.parse(res.json);
    s1Post = p.id;
    expect({ status: res.status, hint: res.headers.get("x-contact-detected") }).toEqual({
      status: 201,
      hint: "1",
    });
    expect(p.body).not.toContain("0912");
    expect(p.body).not.toContain("NCCA");
    expect(Object.keys(p)).not.toEqual(expect.arrayContaining(["hits"]));
    expect(
      (
        await call("s1a", "POST", "/posts", {
          type: "buy",
          fields: { product: "x", qty: "1", area: "HN", neededBy: "2026-11-01" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call("s1a", "POST", "/posts", {
          type: "sell",
          fields: { product: "x", qty: "1", price: null },
          audience: { mode: "all" },
        })
      ).status,
    ).toBe(422);
  });
  it("GET /feed: HT-51 chủ quản raw + hits + Lưu báo giá; HT-52/64 đối tác (S1b) masked, không hidden/hits/saveQuote; HT-23 B1 không thấy", async () => {
    const host = await ok(FeedResponseSchema, call("hM", "GET", "/feed"));
    const hp = host.items.find((x) => x.id === s1Post);
    expect(hp?.body).toContain("0912 345 678");
    expect(hp?.hits?.map((x) => x.kind)).toEqual(["phone", "company"]);
    expect(hp?.actions).toEqual(["hide", "saveQuote"]);
    expect(host.counts).toMatchObject({ all: 2, sell: 2, archived: 0 });
    const s1b = await ok(FeedResponseSchema, call("s1b", "GET", "/feed?mine=true"));
    expect(s1b.items.map((x) => x.id)).toEqual([s1Post]);
    const mine = s1b.items[0];
    expect(
      mine &&
        Object.keys(mine).filter((k) => ["hidden", "hits", "audience", "authorLeft"].includes(k)),
    ).toEqual([]);
    expect(mine?.body).not.toContain("0912");
    expect(mine?.actions).not.toContain("saveQuote");
    const b1 = await ok(FeedResponseSchema, call("b1", "GET", "/feed"));
    expect(b1.items.map((x) => x.id)).toEqual([hostPost]);
    const page = await ok(FeedResponseSchema, call("hA", "GET", "/feed?limit=1&q=keo"));
    expect({ ids: page.items.map((x) => x.id), next: page.nextCursor }).toEqual({
      ids: [s1Post],
      next: undefined,
    });
  });
  it("GET /posts/:id/source: HT-52 raw chỉ cho chính người đăng (S1a); S1b 404", async () => {
    expect(
      (await ok(PostSourceSchema, call("s1a", "GET", `/posts/${s1Post}/source`))).body,
    ).toContain("0912 345 678");
    expect((await call("s1b", "GET", `/posts/${s1Post}/source`)).status).toBe(404);
  });
  it("PATCH /posts/:id: người đăng sửa ⇒ edited; đồng nghiệp cùng công ty (Thấp2) / công ty khác 404", async () => {
    const p = await ok(
      PostViewSchema,
      call("s1a", "PATCH", `/posts/${s1Post}`, { fields: { price: "12.000đ" } }),
    );
    expect({ edited: p.edited, price: p.fields.price }).toEqual({ edited: true, price: "12.000đ" });
    expect((await call("s1b", "PATCH", `/posts/${s1Post}`, { title: "x" })).status).toBe(404);
    expect((await call("s2", "PATCH", `/posts/${s1Post}`, { title: "x" })).status).toBe(404);
  });
  it("POST /posts/:id/actions: chủ quản ẩn bài S1 (HT-29; S1 vẫn thấy, không biết — HT-30); S1 lưu trữ; đối tác ẩn bài chủ quản ⇒ 404; xoá ⇒ 204", async () => {
    expect(
      (await ok(PostViewSchema, call("hM", "POST", `/posts/${s1Post}/actions`, { action: "hide" })))
        .hidden,
    ).toBe(true);
    const own = await ok(
      PostViewSchema,
      call("s1a", "POST", `/posts/${s1Post}/actions`, { action: "archive" }),
    );
    expect({ status: own.status, hidden: own.hidden }).toEqual({
      status: "archived",
      hidden: undefined,
    });
    expect(
      (await call("s1a", "POST", `/posts/${hostPost}/actions`, { action: "hide" })).status,
    ).toBe(404);
    const tmp = await ok(
      PostViewSchema,
      call("hA", "POST", "/posts", { type: "note", body: "Thông báo nghỉ lễ" }),
      201,
    );
    expect(
      (await call("hA", "POST", `/posts/${tmp.id}/actions`, { action: "delete" })).status,
    ).toBe(204);
  });
});

describe("luồng bình luận (D3)", () => {
  it("POST /comments + GET /threads + GET /threads/:org: luồng riêng mỗi công ty; chủ quản trả lời đúng luồng", async () => {
    const t1 = await ok(
      ThreadSchema,
      call("s1a", "POST", `/posts/${hostPost}/comments`, { text: "Giá sỉ? zalo 0987654321" }),
      201,
    );
    expect({ org: t1.orgId, masked: !t1.comments[0]?.text.includes("0987654321") }).toEqual({
      org: c.S1,
      masked: true,
    });
    await ok(
      ThreadSchema,
      call("b1", "POST", `/posts/${hostPost}/comments`, { text: "Còn hàng không?" }),
      201,
    );
    expect(
      (await call("hA", "POST", `/posts/${hostPost}/comments`, { text: "Bạn chọn luồng" })).status,
    ).toBe(422);
    const reply = await ok(
      ThreadSchema,
      call("hA", "POST", `/posts/${hostPost}/comments`, {
        text: "Gọi tôi 0911111111",
        orgId: c.S1,
      }),
      201,
    );
    expect(reply.comments.map((x) => x.authorSide)).toEqual(["partner", "host"]);
    const host = await ok(
      z.array(ThreadSummarySchema),
      call("hM", "GET", `/posts/${hostPost}/threads`),
    );
    expect(host.map((t) => t.orgId).sort()).toEqual([c.S1, c.B1].sort());
    const s1b = await ok(ThreadSchema, call("s1b", "GET", `/posts/${hostPost}/threads/${c.B1}`)); // orgId lạ ⇒ luồng mình
    expect({
      org: s1b.orgId,
      texts: s1b.comments.map((x) => x.text.includes("0911111111")),
    }).toEqual({
      org: c.S1,
      texts: [false, true], // HT-55: nội dung chủ quản không che
    });
    expect(
      (await ok(z.array(ThreadSummarySchema), call("b1", "GET", `/posts/${hostPost}/threads`))).map(
        (t) => t.orgId,
      ),
    ).toEqual([c.B1]);
    expect((await call("s2", "GET", `/posts/${s1Post}/threads`)).status).toBe(404);
  });
});
