// CR-130 · p3a · ADR-0044 · lát 1: quyền mặt `/pack/community/*` = quyền gói `contracts` ∧ add-on `contracts.community`; bản cơ bản
// không admin (duyệt đơn/báo cáo = mọi nội bộ; ẩn bình luận = chủ bài; đối tác đọc/bình luận, không duyệt). Pool hub_api + RLS thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CommentViewSchema, PostViewSchema } from "@ai/contracts/community";
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
// ADR-0044: Bảng tin = gói contracts ∧ add-on contracts.community (không còn feature community-*)
let addonOn = true;
const F = { read: "c-r", write: "c-w", admin: "c-a", addon: "c-ad" };

function view(): PackAccessView {
  return {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
        { id: F.addon, key: "contracts.community", status: "on" },
      ],
      entitled: new Set(
        Object.entries(F)
          .filter(([k]) => k !== "addon" || addonOn)
          .map(([, f]) => `${c.A}:${f}`),
      ),
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

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 71);
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-130 p3a · ADR-0044 · mặt community theo quyền gói contracts + add-on", () => {
  let post = "";
  it("nội bộ chỉ có contracts-write (không admin, không Group community): đăng bài, thấy hàng duyệt đơn/báo cáo, đọc danh sách đơn", async () => {
    const p = await ok(
      PostViewSchema,
      call("hM", "POST", "/posts", { type: "note", body: "Chào cả nhà" }),
      201,
    );
    post = p.id;
    const nav = await call("hM", "GET", "/flows/nav");
    expect(nav.status).toBe(200);
    expect(nav.json).toMatchObject({ joinReview: true, reports: true, joinSubmit: false });
    expect((await call("hM", "GET", "/join-requests")).status).toBe(200);
  });
  it("đối tác: đọc + bình luận Bảng tin được; KHÔNG duyệt đơn (403), nav không có quyền duyệt", async () => {
    expect((await call("s1a", "GET", "/feed")).status).toBe(200);
    await ok(
      CommentViewSchema,
      call("s1a", "POST", `/posts/${post}/comments`, { text: "Em chào anh chị" }),
      201,
    );
    expect((await call("s1a", "GET", "/join-requests")).status).toBe(403);
    expect(await call("s1a", "GET", "/flows/nav")).toMatchObject({
      json: { joinReview: false, reports: false },
    });
  });
  it("ẩn bình luận = CHỈ chủ bài: người nội bộ khác (kể cả tenant_admin) ⇒ 404; chủ bài ⇒ 200", async () => {
    const cm = await ok(
      CommentViewSchema,
      call("s1a", "POST", `/posts/${post}/comments`, { text: "Bình luận cần ẩn" }),
      201,
    );
    const hide = (who: Who) =>
      call(who, "POST", `/posts/${post}/comments/${cm.id}/hide`, { hidden: true });
    expect((await hide("hA")).status).toBe(404);
    expect((await hide("hM")).status).toBe(200);
  });
  it("add-on contracts.community tắt ⇒ mặt community như gói tắt (403 PACK_DISABLED, cả nội bộ lẫn đối tác); bật lại ⇒ 200", async () => {
    addonOn = false;
    try {
      for (const who of ["hM", "s1a"] as const) {
        const r = await call(who, "GET", "/feed");
        expect({ who, status: r.status, code: r.json?.error?.code ?? r.json?.code }).toEqual({
          who,
          status: 403,
          code: "PACK_DISABLED",
        });
      }
    } finally {
      addonOn = true;
    }
    expect((await call("hM", "GET", "/feed")).status).toBe(200);
  });
});
