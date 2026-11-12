// CR-102 · C6 · CR-129 · int route bình luận phẳng: sửa/xoá/ẩn (HT-46), ai thấy gì (HT-44), nhắc công ty (mentionables, 422), phân trang.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CommentPageSchema,
  CommentViewSchema,
  MentionableSchema,
  PostViewSchema,
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
let post = "";
let s1Post = "";
const list = async (who: Who, p: string, qs = "") =>
  await ok(CommentPageSchema, call(who, "GET", `/posts/${p}/comments${qs}`));
const texts = async (who: Who, p: string) => (await list(who, p)).comments.map((x) => x.text);
const add = (who: Who, p: string, text: string, mentions: string[] = []) =>
  ok(CommentViewSchema, call(who, "POST", `/posts/${p}/comments`, { text, mentions }), 201);
const MentionablesSchema = z.array(MentionableSchema);

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 61);
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
  const h = await ok(
    PostViewSchema,
    call("hA", "POST", "/posts", {
      type: "sell",
      title: "USB Token",
      fields: { product: "USB Token", qty: "10", price: "500000" },
      cats: ["dong-goi"],
      audience: { mode: "suppliers" },
      media: [],
    }),
    201,
  );
  post = h.id;
  s1Post = (
    await ok(
      PostViewSchema,
      call("s1a", "POST", "/posts", {
        type: "sell",
        title: "Hộp giấy",
        fields: { product: "Hộp giấy", qty: "5", price: "1000" },
        cats: ["dong-goi"],
        media: [],
      }),
      201,
    )
  ).id;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("C6 sửa / xoá / ẩn bình luận", () => {
  it("PATCH + DELETE: người viết sửa (che lại) và xoá (204); RLS chặn đối tác sửa bình luận công ty khác / đồng nghiệp", async () => {
    const mine = await add("s1a", post, "Giá sỉ?");
    const s2c = await add("s2", post, "Của S2");
    // RLS deny: S1 sửa/xoá bình luận của S2 ⇒ 404; đồng nghiệp cùng công ty (s1b) cũng không sửa được.
    expect(
      (await call("s1a", "PATCH", `/posts/${post}/comments/${s2c.id}`, { text: "hack" })).status,
    ).toBe(404);
    expect((await call("s1a", "DELETE", `/posts/${post}/comments/${s2c.id}`)).status).toBe(404);
    expect(
      (await call("s1b", "PATCH", `/posts/${post}/comments/${mine.id}`, { text: "hack" })).status,
    ).toBe(404);
    expect(await texts("hA", post)).toContain("Của S2");
    const e = await ok(
      CommentViewSchema,
      call("s1a", "PATCH", `/posts/${post}/comments/${mine.id}`, { text: "Gọi 0987654321" }),
    );
    expect(e.text.includes("0987654321")).toBe(false);
    expect(await texts("hA", post)).toContain("Gọi 0987654321");
    const d = await call("s1a", "DELETE", `/posts/${post}/comments/${mine.id}`);
    expect(d.status).toBe(204);
    expect((await list("hA", post)).comments.some((x) => x.id === mine.id)).toBe(false);
  });

  it("POST /hide: chủ quản ẩn ⇒ đối tác không còn dấu vết (HT-46), chủ quản vẫn thấy hidden; hiện lại được; bài đối tác ⇒ 404", async () => {
    const t = await add("s1a", post, "Bình luận cần ẩn");
    const h = await ok(
      CommentViewSchema,
      call("hA", "POST", `/posts/${post}/comments/${t.id}/hide`, { hidden: true }),
    );
    expect(h.hidden).toBe(true);
    expect((await list("s1a", post)).comments.some((x) => x.id === t.id)).toBe(false);
    expect((await list("hA", post)).comments.find((x) => x.id === t.id)?.hidden).toBe(true);
    const un = await ok(
      CommentViewSchema,
      call("hA", "POST", `/posts/${post}/comments/${t.id}/hide`, { hidden: false }),
    );
    expect(un.hidden).toBe(false);
    expect(
      (await call("s1a", "POST", `/posts/${post}/comments/${t.id}/hide`, { hidden: true })).status,
    ).toBe(404);
    const pc = await add("s1a", s1Post, "Ghi chú");
    expect(
      (await call("hA", "POST", `/posts/${s1Post}/comments/${pc.id}/hide`, { hidden: true }))
        .status,
    ).toBe(404);
  });
});

describe("CR-129 bình luận phẳng theo bạn bè + nhắc đối tác", () => {
  it("ai thấy gì: chủ quản thấy tất cả; S1 thấy của mình + chủ quản, không thấy S2; chủ quản trả lời S2 ⇒ S1 cũng thấy (HT-44)", async () => {
    await add("s1a", post, "d1 S1 hỏi");
    await add("s2", post, "d1 S2 hỏi");
    await add("hA", post, "d1 chủ quản trả lời S2", [c.S2]);
    const mineOnly = (xs: string[]) => xs.filter((x) => x.startsWith("d1 "));
    expect({
      host: mineOnly(await texts("hA", post)),
      s1: mineOnly(await texts("s1b", post)),
      s2: mineOnly(await texts("s2", post)),
    }).toEqual({
      host: ["d1 S1 hỏi", "d1 S2 hỏi", "d1 chủ quản trả lời S2"],
      s1: ["d1 S1 hỏi", "d1 chủ quản trả lời S2"],
      s2: ["d1 S2 hỏi", "d1 chủ quản trả lời S2"],
    });
    // bài không thấy ⇒ 404 (B1 là người mua, bài chỉ cho nhà cung cấp)
    expect((await call("b1", "GET", `/posts/${post}/comments`)).status).toBe(404);
  });

  it("mentions trong CommentView: chủ quản thấy đủ; đối tác chỉ nhận phần tử là công ty mình", async () => {
    const t = await add("hA", post, "d2 tag hai", [c.S1, c.S2]);
    expect(t.mentions.map((m) => m.orgId).sort()).toEqual([c.S1, c.S2].sort());
    const find = async (who: Who) =>
      (await list(who, post)).comments.find((x) => x.id === t.id)?.mentions.map((m) => m.orgId);
    expect({ s1: await find("s1a"), s2: await find("s2") }).toEqual({ s1: [c.S1], s2: [c.S2] });
  });

  it("GET /mentionables: công ty còn hiệu lực thấy được bài (audience), lọc q, limit; đối tác ⇒ rỗng; bài đối tác ⇒ chỉ công ty đăng", async () => {
    const ids = (r: { orgId: string }[]) => r.map((x) => x.orgId).sort();
    const all = await ok(MentionablesSchema, call("hA", "GET", `/posts/${post}/mentionables`));
    expect(ids(all)).toEqual([c.S1, c.S2, c.X].sort()); // nhà cung cấp; B1/B2 là người mua; LEFT đã rời
    const q = await ok(MentionablesSchema, call("hA", "GET", `/posts/${post}/mentionables?q=tân`));
    expect(q.map((x) => x.orgId)).toEqual([c.S1]);
    const one = await ok(
      MentionablesSchema,
      call("hA", "GET", `/posts/${post}/mentionables?limit=1`),
    );
    expect(one).toHaveLength(1);
    expect(await ok(MentionablesSchema, call("s1a", "GET", `/posts/${post}/mentionables`))).toEqual(
      [],
    );
    const mine = await ok(MentionablesSchema, call("hA", "GET", `/posts/${s1Post}/mentionables`));
    expect(mine.map((x) => x.orgId)).toEqual([c.S1]);
    expect((await call("hA", "GET", `/posts/${post}/mentionables?limit=21`)).status).toBe(400);
  });

  it("POST mentions ngoài tập ⇒ 422 MENTION_NOT_ALLOWED (không ghi gì); đối tác không nhắc được ai; quá 10 ⇒ 422", async () => {
    const before = (await list("hA", post)).comments.length;
    const post422 = (who: Who, mentions: string[]) =>
      call(who, "POST", `/posts/${post}/comments`, { text: "d3", mentions });
    const code = (r: { status: number; json: { error?: { code?: string } } | null }) => ({
      s: r.status,
      code: r.json?.error?.code,
    });
    const notAllowed = { s: 422, code: "MENTION_NOT_ALLOWED" };
    expect(code(await post422("hA", [c.B1]))).toEqual(notAllowed); // ngoài audience
    expect(code(await post422("hA", [c.LEFT]))).toEqual(notAllowed); // đã rời
    expect(code(await post422("s1a", [c.S2]))).toEqual(notAllowed); // đối tác không nhắc ai
    expect(
      (
        await post422(
          "hA",
          Array.from({ length: 11 }, () => c.S1),
        )
      ).status,
    ).toBe(400);
    expect((await list("hA", post)).comments.length).toBe(before);
  });

  it("GET /comments phân trang cũ → mới: limit + nextCursor, không lặp, không sót", async () => {
    const all = (await list("hA", post, "?limit=100")).comments.map((x) => x.id);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const got: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const p = await list("hA", post, `?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      got.push(...p.comments.map((x) => x.id));
      cursor = p.nextCursor;
      if (!cursor) break;
    }
    expect(got).toEqual(all);
    expect((await call("hA", "GET", `/posts/${post}/comments?limit=101`)).status).toBe(400);
    expect((await call("hA", "GET", `/posts/${post}/comments?cursor=xx`)).status).toBe(400);
  });
});
