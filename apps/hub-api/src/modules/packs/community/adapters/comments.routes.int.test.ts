// CR-102 · C6 · int route sửa/xoá/ẩn bình luận + Nhắn riêng (HT-46): đường chính mỗi endpoint + một ca RLS chặn đối tác sửa bình luận công ty khác.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PostViewSchema, ThreadSchema } from "@ai/contracts/community";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { z } from "zod";

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
const cid = async (who: Who, p: string, org: string) =>
  (await ok(ThreadSchema, call(who, "GET", `/posts/${p}/threads/${org}`))).comments;

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
  it("PATCH + DELETE: người viết sửa (che lại) và xoá; RLS chặn đối tác sửa bình luận công ty khác / đồng nghiệp", async () => {
    const t = await ok(
      ThreadSchema,
      call("s1a", "POST", `/posts/${post}/comments`, { text: "Giá sỉ?" }),
      201,
    );
    const id = t.comments[0]?.id ?? "";
    const other = await ok(
      ThreadSchema,
      call("s2", "POST", `/posts/${post}/comments`, { text: "Của S2" }),
      201,
    );
    const s2c = other.comments[0]?.id ?? "";
    // RLS deny: S1 sửa/xoá bình luận của S2 (luồng khác) ⇒ 404; đồng nghiệp cùng công ty (s1b) cũng không sửa được.
    expect(
      (await call("s1a", "PATCH", `/posts/${post}/comments/${s2c}`, { text: "hack" })).status,
    ).toBe(404);
    expect((await call("s1a", "DELETE", `/posts/${post}/comments/${s2c}`)).status).toBe(404);
    expect(
      (await call("s1b", "PATCH", `/posts/${post}/comments/${id}`, { text: "hack" })).status,
    ).toBe(404);
    expect((await cid("hA", post, c.S2))[0]?.text).toBe("Của S2");
    const e = await ok(
      ThreadSchema,
      call("s1a", "PATCH", `/posts/${post}/comments/${id}`, { text: "Gọi 0987654321" }),
    );
    expect(e.comments[0]?.text.includes("0987654321")).toBe(false);
    expect((await cid("hA", post, c.S1))[0]?.text).toBe("Gọi 0987654321");
    const d = await ok(ThreadSchema, call("s1a", "DELETE", `/posts/${post}/comments/${id}`));
    expect(d.comments).toEqual([]);
  });

  it("POST /hide: chủ quản ẩn ⇒ đối tác không còn dấu vết (HT-46), chủ quản vẫn thấy hidden; hiện lại được; bài đối tác ⇒ 404", async () => {
    const t = await ok(
      ThreadSchema,
      call("s1a", "POST", `/posts/${post}/comments`, { text: "Bình luận cần ẩn" }),
      201,
    );
    const id = t.comments[0]?.id ?? "";
    const h = await ok(
      ThreadSchema,
      call("hA", "POST", `/posts/${post}/comments/${id}/hide`, { hidden: true }),
    );
    expect(h.comments.find((x) => x.id === id)?.hidden).toBe(true);
    expect((await cid("s1a", post, c.S1)).some((x) => x.id === id)).toBe(false);
    const un = await ok(
      ThreadSchema,
      call("hA", "POST", `/posts/${post}/comments/${id}/hide`, { hidden: false }),
    );
    expect(un.comments.find((x) => x.id === id)?.hidden).toBe(false);
    expect(
      (await call("s1a", "POST", `/posts/${post}/comments/${id}/hide`, { hidden: true })).status,
    ).toBe(404);
    const pc = await ok(
      ThreadSchema,
      call("b1", "POST", `/posts/${s1Post}/comments`, { text: "Hỏi giá" }),
      201,
    );
    const pid = pc.comments[0]?.id ?? "";
    expect(
      (await call("hA", "POST", `/posts/${s1Post}/comments/${pid}/hide`, { hidden: true })).status,
    ).toBe(404);
  });

  it("Nhắn riêng: chủ quản mở luồng với công ty trong audience (201), ngoài audience ⇒ 422; xoá bình luận của chính chủ quản", async () => {
    expect(
      (await call("hA", "POST", `/posts/${post}/comments`, { text: "Riêng", orgId: c.B1 })).status,
    ).toBe(422);
    const t = await ok(
      ThreadSchema,
      call("hA", "POST", `/posts/${post}/comments`, { text: "Riêng", orgId: c.S2 }),
      201,
    );
    const mine = t.comments.find((x) => x.mine);
    const d = await ok(ThreadSchema, call("hA", "DELETE", `/posts/${post}/comments/${mine?.id}`));
    expect(d.comments.some((x) => x.mine)).toBe(false);
  });
});
