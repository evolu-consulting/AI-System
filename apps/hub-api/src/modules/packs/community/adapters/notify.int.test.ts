// CR-102 · com-c9 · chuông Community thật (pool hub_api + RLS gói + notify.enqueue): mỗi loại một đường chính, một ca chặn visibility,
// tuỳ chọn tắt, vòng quét với đồng hồ giả (không sleep). Bình luận phát qua `communityEvents.emitComment` (C6 gọi từ route của mình).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import {
  type Cast,
  seedCast,
  seedComments,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { packHosts } from "../../kit/adapters/pack-hosts";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { communityModule } from "../community.mount";
import { communityEvents } from "./notify.events";
import { sweepCommunityOnce } from "./notify.sweep";

let sql: Sql;
let db: Db;
let c: Cast;
const F = { read: "n-r", write: "n-w", admin: "n-a" };
type Who = "hA" | "hM" | "s1a" | "s1b" | "s2" | "b1";
const ORG: Partial<Record<Who, keyof Cast>> = { s1a: "S1", s1b: "S1", s2: "S2", b1: "B1" };

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
      tenantId: c.A,
      groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
    }),
  };
}

const savedBy: string[] = [];
const stock: string[] = [];
let app: Hono<PackGuardVars>;
const uow = () => createPackUow(db, "community", (tx) => ({ tx }));
const events = () =>
  communityEvents({
    uow: uow(),
    hosts: packHosts(db, view(), "community"),
    savedBy: async () => savedBy,
    stockMatch: async () => stock,
  });

function build() {
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
      savedBy: async () => savedBy,
      stockMatch: async () => stock,
    }),
  );
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
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
type Item = { kind: string; postId?: string; orgId?: string; actorName: string; unread: boolean };
const bell = async (who: Who): Promise<Item[]> =>
  ((await call(who, "GET", "/notifications")).json as { items: Item[] }).items;
const kinds = async (who: Who) => (await bell(who)).map((i) => i.kind).sort();

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 61);
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const sell = (price: string | null = "500000") => ({
  type: "sell",
  title: "Token USB",
  fields: { product: "Token USB", qty: "10", price },
  cats: ["dong-goi"],
});

describe("bài mới của đối tác ⇒ chủ quản", () => {
  it("newSell tới mọi chủ quản, không tới đối tác; tắt tuỳ chọn ⇒ không nhận; chuông có postId", async () => {
    const r = await call("s1a", "POST", "/posts", sell());
    expect(r.status).toBe(201);
    expect(await kinds("hA")).toEqual(["newSell"]);
    expect(await kinds("hM")).toEqual(["newSell"]);
    expect((await bell("hA"))[0]?.postId).toBe(r.json.id);
    expect(await kinds("s1b")).toEqual([]); // đối tác khác trong cùng công ty cũng không
    expect(await kinds("s2")).toEqual([]);
    const s = (await call("hM", "GET", "/settings")).json;
    await call("hM", "PUT", "/settings", { ...s, notify: { ...s.notify, newSell: false } });
    await call("s1a", "POST", "/posts", sell());
    expect(await kinds("hA")).toEqual(["newSell", "newSell"]);
    expect(await kinds("hM")).toEqual(["newSell"]);
    await call("hM", "PUT", "/settings", s);
  });
  it("newBuy tới chủ quản; chủ quản khớp hàng nhận matchBuy thay cho newBuy", async () => {
    stock.splice(0, stock.length, c.hA);
    const r = await call("b1", "POST", "/posts", {
      type: "buy",
      fields: { product: "Token USB", qty: "5", area: "HN", neededBy: "2026-12-01" },
    });
    expect(r.status).toBe(201);
    expect((await kinds("hA")).filter((k) => k !== "newSell")).toEqual(["matchBuy"]);
    expect((await kinds("hM")).filter((k) => k !== "newSell")).toEqual(["newBuy"]);
    stock.length = 0;
  });
  it("chủ quản đăng bài thì không ai nhận newSell/newBuy", async () => {
    const before = (await bell("hM")).length;
    await call("hA", "POST", "/posts", { ...sell(), audience: { mode: "all" } });
    expect((await bell("hM")).length).toBe(before);
  });
});

describe("sửa giá bài đã lưu (R29)", () => {
  it("chủ quản đã lưu nhận priceEdited, NCC không nhận gì; đổi khoảng trắng không phát", async () => {
    const id = (await call("s1a", "POST", "/posts", sell("100"))).json.id as string;
    savedBy.push(c.hM);
    const before = (await kinds("hM")).length;
    expect((await call("s1a", "PATCH", `/posts/${id}`, { fields: { price: "120" } })).status).toBe(
      200,
    );
    const k = await bell("hM");
    expect(k.length).toBe(before + 1);
    expect(k[0]?.kind).toBe("priceEdited");
    expect(await kinds("s1a")).toEqual([]);
    expect(await kinds("s1b")).toEqual([]);
    await call("s1a", "PATCH", `/posts/${id}`, { fields: { price: " 120 " } });
    expect((await bell("hM")).length).toBe(before + 1);
    savedBy.length = 0;
  });
});

describe("bình luận (emitComment)", () => {
  const comment = async (who: "hA" | "s1a", text: string, orgId?: string, direct = false) => {
    if (direct)
      // C3 chặn chủ quản viết vào luồng của công ty đã hết thấy bài ⇒ chèn thẳng (owner) để thử riêng luật người nhận
      await sql`insert into community.comments (tenant_id, post_id, thread_id, thread_org, author_user_id, author_name,
          text_raw, text_masked) select ${c.A}::uuid, t.post_id, t.id, t.ext_org_id, ${c[who]}::uuid, ${who}, ${text}, ${text}
        from community.threads t where t.post_id = ${hostPost}::uuid and t.ext_org_id = ${c.S1}::uuid`;
    else {
      const r = await call(who, "POST", `/posts/${hostPost}/comments`, {
        text,
        ...(orgId ? { orgId } : {}),
      });
      expect(r.status).toBe(201);
    }
    if (!direct) return; // đường route đã tự phát chuông (emitComment sau commit của C6)
    const row =
      (await sql`select id::text as id from community.comments where post_id = ${hostPost}::uuid
      order by created_at desc, id desc limit 1`) as unknown as { id: string }[];
    await events().emitComment({
      tenantId: c.A,
      postId: hostPost,
      threadOrg: c.S1,
      commentId: row[0]?.id as string,
      actor: { userId: c[who], name: who },
      activeOrgs: [c.S1, c.S2, c.B1, c.B2, c.X],
    });
  };
  let hostPost = "";
  it("đối tác bình luận bài chủ quản ⇒ người đăng nhận comment; chủ quản trả lời ⇒ đối tác nhận reply (mở đúng luồng)", async () => {
    hostPost = (await call("hA", "POST", "/posts", { ...sell(), audience: { mode: "all" } })).json
      .id;
    const base = (await bell("hA")).length;
    await comment("s1a", "Cho hỏi giá?");
    const a = await bell("hA");
    expect(a.length).toBe(base + 1);
    expect({ kind: a[0]?.kind, post: a[0]?.postId, org: a[0]?.orgId }).toEqual({
      kind: "comment",
      post: hostPost,
      org: c.S1,
    });
    await comment("hA", "Giá 500k", c.S1);
    const s = await bell("s1a");
    expect(s.map((i) => i.kind)).toEqual(["reply"]);
    expect(s[0]?.orgId).toBe(c.S1);
    expect((await bell("hA")).length).toBe(base + 1); // không tự báo cho chính mình
  });
  it("visibility: bài chuyển sang chỉ người mua ⇒ NCC hết thấy ⇒ không nhận reply", async () => {
    await sql`update community.posts set aud_mode = 'buyers' where id = ${hostPost}::uuid`;
    await comment("hA", "Xin lỗi, đổi kế hoạch", c.S1, true);
    expect((await bell("s1a")).length).toBe(1);
    expect(await kinds("s2")).toEqual([]);
  });
});

const bellsOf = async (u: string) =>
  (
    (await sql`select count(*)::int as n from hub.notifications where user_id = ${u}::uuid
      and source = 'community'`) as unknown as { n: number }[]
  )[0]?.n ?? 0;

describe("review Thấp-10: người nhận còn quyền / công ty còn hiệu lực", () => {
  it("chủ quản đã mất quyền gói và đối tác công ty đã rời không nhận reply; người còn quyền vẫn nhận", async () => {
    const [lost] = (await users(sql, c.A, 1, { from: 6100 })) as [string]; // nội bộ, không nhóm ⇒ không quyền gói
    const p = (await call("hA", "POST", "/posts", { ...sell(), audience: { mode: "all" } })).json
      .id as string;
    await seedComments(sql, c.A, [
      { key: "mất quyền", post: p, thread: c.S1, author: lost, org: null },
      { key: "đã rời", post: p, thread: c.S1, author: c.gone, org: c.S1 }, // tác giả thuộc S1 nhưng ta coi S1 đã rời
    ]);
    const before = {
      lost: await bellsOf(lost),
      gone: await bellsOf(c.gone),
      hA: await bellsOf(c.hA),
    };
    await events().emitComment({
      tenantId: c.A,
      postId: p,
      threadOrg: c.S1,
      commentId: "00000000-0000-4000-8000-000000000001",
      actor: { userId: c.hM, name: "hM" },
      activeOrgs: [c.S2, c.B1], // S1 không còn hiệu lực
    });
    expect({
      lost: await bellsOf(lost),
      gone: await bellsOf(c.gone),
      hA: await bellsOf(c.hA),
    }).toEqual({
      ...before,
      hA: before.hA + 1, // người đăng còn quyền: comment
    });
  });

  it("vòng quét: không nhắc hết hạn cho chủ quản mất quyền / đối tác công ty đã rời", async () => {
    const [lost] = (await users(sql, c.A, 1, { from: 6200 })) as [string];
    const t0 = new Date(); // "bây giờ": không lưu trữ nhầm bài của các ca khác
    const soon = new Date(t0.getTime() + 2 * 86_400_000);
    await sql`insert into community.posts (tenant_id, type, author_user_id, author_org, title_raw, title_masked, aud_mode,
        expires_at)
      values (${c.A}::uuid, 'note', ${lost}::uuid, null, 'mất quyền', 'mất quyền', 'all', ${soon}),
        (${c.A}::uuid, 'sell', ${c.gone}::uuid, ${c.LEFT}::uuid, 'đã rời', 'đã rời', null, ${soon})`;
    const before = [await bellsOf(lost), await bellsOf(c.gone)];
    const r = await sweepCommunityOnce(
      {
        uow: uow(),
        tenants: async () => [c.A],
        hosts: packHosts(db, view(), "community"),
        orgNames: (t, ids) => pgExternalOrgResolver(db).orgNames(t, ids),
      },
      t0,
    );
    expect(r.expiring).toBeGreaterThanOrEqual(2);
    expect([await bellsOf(lost), await bellsOf(c.gone)]).toEqual(before);
  });
});

describe("vòng quét (đồng hồ giả)", () => {
  const day = 86_400_000;
  const sweepDeps = () => ({
    uow: uow(),
    tenants: async () => [c.A],
    hosts: packHosts(db, view(), "community"),
    warn: (m: string, meta: Record<string, unknown>) => console.error(m, meta),
  });
  it("tự lưu trữ bài quá hạn + nhắc 3 ngày đúng một lần; chạy lại = 0; gia hạn nhắc lại", async () => {
    const t0 = new Date("2026-06-01T20:00:00Z"); // 03:00 giờ Hà Nội hôm sau: chưa tới 8:00
    const ins = async (title: string, at: Date) =>
      (
        (await sql`insert into community.posts (tenant_id, type, author_user_id, author_org, title_raw, title_masked,
            aud_mode, expires_at) values (${c.A}::uuid, 'note', ${c.hM}::uuid, null, ${title}, ${title}, 'all', ${at})
          returning id::text as id`) as unknown as { id: string }[]
      )[0]?.id as string;
    const soon = await ins("sắp hết", new Date(t0.getTime() + 2 * day));
    const gone = await ins("đã hết", new Date(t0.getTime() - day));
    const far = await ins("còn lâu", new Date(t0.getTime() + 20 * day));
    const base = (await bell("hM")).length;
    const r1 = await sweepCommunityOnce(sweepDeps(), t0);
    expect({ a: r1.archived, e: r1.expiring }).toEqual({ a: 1, e: 1 });
    const status = async (id: string) =>
      (
        (await sql`select status from community.posts where id = ${id}::uuid`) as unknown as {
          status: string;
        }[]
      )[0]?.status;
    expect([await status(gone), await status(soon), await status(far)]).toEqual([
      "archived",
      "active",
      "active",
    ]);
    const k = await bell("hM");
    expect(k.length).toBe(base + 1);
    expect({ kind: k[0]?.kind, post: k[0]?.postId }).toEqual({ kind: "expiring", post: soon });
    const r2 = await sweepCommunityOnce(sweepDeps(), t0);
    expect({ a: r2.archived, e: r2.expiring, b: r2.bells }).toEqual({ a: 0, e: 0, b: 0 });
    // tiến 19 ngày: `far` sắp hết hạn, `soon` đã quá hạn
    const r3 = await sweepCommunityOnce(sweepDeps(), new Date(t0.getTime() + 19 * day));
    expect({ a: r3.archived, e: r3.expiring }).toEqual({ a: 1, e: 1 });
    expect(await status(soon)).toBe("archived");
  });
  it("tổng hợp 8:00: chỉ chủ quản đã bật, một lần mỗi ngày, bỏ qua khi chưa tới giờ", async () => {
    await call("hA", "PUT", "/settings", {
      accent: "indigo",
      notify: { ...(await call("hA", "GET", "/settings")).json.notify, digest: true },
    });
    const base = (await bell("hA")).length;
    const early = new Date("2026-09-01T00:30:00Z"); // 07:30 Hà Nội
    expect((await sweepCommunityOnce(sweepDeps(), early)).digests).toBe(0);
    const at = new Date(Date.now()); // bài đối tác tạo ở các test trên nằm trong 24 giờ
    const due = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 3, 0));
    const r = await sweepCommunityOnce(sweepDeps(), due);
    expect(r.digests).toBe(1);
    expect((await bell("hA")).length).toBe(base + 1);
    expect((await bell("hA"))[0]?.kind).toBe("digest");
    expect((await sweepCommunityOnce(sweepDeps(), due)).digests).toBe(0);
    expect(await kinds("hM")).not.toContain("digest"); // mặc định Tắt
  });
});
