// CR-110 · cr110-profile-api · COM-FR-37 trên DB thật (RLS gói, danh bạ kit): `GET /profile/:orgId/media` chỉ trả đính kèm của bài
// người xem ĐƯỢC THẤY (cùng luật bảng tin: chủ quản thấy hết; đối tác thấy bài chủ quản đúng audience + bài công ty mình; KHÔNG
// BAO GIỜ bài đối tác khác); hồ sơ không được xem ⇒ 404; chéo tenant chặn; trang con trỏ ổn định. Tab Đối tác: `GET /partners?rep=1`
// gắn uy tín qua `HostBookReader` chỉ cho chủ quản (đối tác không gọi cổng). Test viết TRƯỚC code (Luật 1b: cách ly đối tác).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PartnerOrgSchema, ProfileMediaSchema } from "@ai/contracts/community";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { z } from "zod";
import {
  type Cast,
  seedCast,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import type { HostBookReader } from "../application/pack-ports";
import { communityModule } from "../community.mount";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = ["c-r", "c-w", "c-a"];
const KEYS = ["community-read", "community-write", "community-admin"];

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: F.map((id, i) => ({ id, key: KEYS[i] as string, status: "on" as const })),
    entitled: new Set(F.flatMap((f) => [`${c.A}:${f}`, `${c.B}:${f}`])),
    grantGroups: new Map(
      F.flatMap((f) => [
        [`${c.A}:${f}`, [c.roles.owner, c.roles.editor]],
        [`${c.B}:${f}`, ["gB"]],
      ]),
    ),
  }),
  user: async (id) =>
    id === c.hB
      ? { tenantId: c.B, groupIds: new Set(["gB"]) }
      : {
          tenantId: c.A,
          groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
        },
});

/** Cổng sổ giả: chỉ hA có quyền contracts (giống `canRead`); ghi lại người gọi để chứng minh đối tác không bao giờ gọi. */
const bookCalls: string[] = [];
const hostBook: HostBookReader = {
  read: async (who, q) => {
    bookCalls.push(who.userId);
    if (who.userId !== c.hA) throw Object.assign(new Error("forbidden"), { kind: "forbidden" });
    return {
      products: [],
      partners: (q.partyKeys ?? []).map((partyKey) => ({ partyKey, band: "good", score: 88 })),
    };
  },
  stockHolders: async () => [],
};

type Who = "hA" | "hM" | "hB" | "s1a";
function build() {
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    ctx.set("user", {
      userId: c[who],
      tenantId: ctx.req.header("x-tenant") ?? (who === "hB" ? c.B : c.A),
      role: who === "hA" ? "tenant_admin" : "member",
      ...(who === "s1a" ? { userKind: "external", extOrgId: c.S1 } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route("/", communityModule(db, view(), pgExternalOrgResolver(db), { hostBook }));
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  return h;
}

const call = async (who: Who, path: string, tenant?: string) => {
  const res = await app.request(path, {
    headers: { "x-who": who, ...(tenant ? { "x-tenant": tenant } : {}) },
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};
const media = async (who: Who, org: string, qs = "") => {
  const r = await call(who, `/profile/${org}/media${qs}`);
  expect({ status: r.status, err: r.status === 200 ? null : r.json }).toEqual({
    status: 200,
    err: null,
  });
  return ProfileMediaSchema.parse(r.json);
};
const labels = (m: { items: { label: string }[] }) => m.items.map((x) => x.label).sort();

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 67);
  const a = await seedPosts(sql, c.A, [
    { key: "H-all", type: "sell", org: null, author: c.hA, aud: { mode: "all" } },
    {
      key: "H-b1",
      type: "sell",
      org: null,
      author: c.hA,
      aud: { mode: "companies", orgs: [c.B1] },
    },
    { key: "H-arch", type: "note", org: null, author: c.hA, status: "archived" },
    { key: "S1-p", type: "sell", org: c.S1, author: c.s1a },
    { key: "S1-hid", type: "sell", org: c.S1, author: c.s1a, hidden: true },
    { key: "S2-p", type: "sell", org: c.S2, author: c.s2 },
  ]);
  const b = await seedPosts(sql, c.B, [
    { key: "B-all", type: "sell", org: null, author: c.hB, aud: { mode: "all" } },
  ]);
  const m = (t: string, post: string | undefined, n: number, label: string) =>
    Array.from({ length: n }, (_, i) => ({
      t,
      post,
      i,
      kind: i % 2 ? "video" : "image",
      label: `${label}#${i}`,
    }));
  const rows = [
    ...m(c.A, a.get("H-all"), 2, "H-all"),
    ...m(c.A, a.get("H-b1"), 1, "H-b1"),
    ...m(c.A, a.get("H-arch"), 1, "H-arch"),
    ...m(c.A, a.get("S1-p"), 2, "S1-p"),
    ...m(c.A, a.get("S1-hid"), 1, "S1-hid"),
    ...m(c.A, a.get("S2-p"), 1, "S2-p"),
    ...m(c.B, b.get("B-all"), 1, "B-all"),
  ];
  await sql`insert into community.media (tenant_id, post_id, position, kind, label, url)
    select x.t, x.post, x.i, x.kind, x.label, 'https://img.example.test/' || x.label
    from jsonb_to_recordset(${sql.json(rows)}) as x(t uuid, post uuid, i int, kind text, label text)`;
  await sql`update community.partner_companies set party_key = 'tax:S1' where ext_org_id = ${c.S1}::uuid`;
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("GET /profile/:orgId/media (COM-FR-37)", () => {
  it("[COM-FR-37] chủ quản thấy mọi đính kèm bài của công ty đối tác (kể cả bài ẩn), không lẫn bên khác", async () => {
    const r = await media("hA", c.S1);
    expect(labels(r)).toEqual(["S1-hid#0", "S1-p#0", "S1-p#1"]);
    expect(r.items.every((x) => x.url?.startsWith("https://img.example.test/"))).toBe(true);
    expect(labels(await media("hM", c.A))).toEqual(["H-all#0", "H-all#1", "H-arch#0", "H-b1#0"]);
  });

  it("[COM-FR-37] đối tác A thấy media chủ quản đúng audience + của mình; không bao giờ của đối tác B", async () => {
    expect(labels(await media("s1a", c.A))).toEqual(["H-all#0", "H-all#1"]);
    expect(labels(await media("s1a", c.S1))).toEqual(["S1-hid#0", "S1-p#0", "S1-p#1"]);
    const other = await call("s1a", `/profile/${c.S2}/media`);
    expect(other.status).toBe(404);
    expect(JSON.stringify(other.json)).not.toContain("S2-p");
  });

  it("[COM-FR-37] chặn chéo tenant: B chỉ thấy media B; hồ sơ tenant A ⇒ 404; user A mang tenant B ⇒ 403", async () => {
    expect(labels(await media("hB", c.B))).toEqual(["B-all#0"]);
    expect((await call("hB", `/profile/${c.A}/media`)).status).toBe(404);
    const spoof = await call("hA", `/profile/${c.B}/media`, c.B);
    expect(spoof.status).toBe(403);
    expect(JSON.stringify(spoof.json)).not.toContain("B-all");
  });

  it("[COM-FR-37] trang con trỏ ổn định: đi từng trang = một trang lớn, mới nhất trước, không trùng", async () => {
    const all = await media("hA", c.A, "?limit=60");
    expect(all.nextCursor).toBeUndefined();
    const walked: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i++) {
      const p = await media("hA", c.A, `?limit=1${cursor ? `&cursor=${cursor}` : ""}`);
      walked.push(...p.items.map((x) => x.id));
      cursor = p.nextCursor;
      if (!cursor) break;
    }
    expect(walked).toEqual(all.items.map((x) => x.id));
    expect(new Set(walked).size).toBe(4);
    const at = all.items.map((x) => Date.parse(x.createdAt));
    expect(at).toEqual([...at].sort((x, y) => y - x));
    expect((await call("hA", `/profile/${c.A}/media?cursor=xx`)).status).toBe(400);
  });
});

describe("GET /partners?rep=1 — tab Đối tác (COM-FR-37, chỉ chủ quản)", () => {
  it("[COM-FR-37] chủ quản có quyền contracts: uy tín qua HostBookReader cho đối tác đã liên kết SHT", async () => {
    const r = await call("hA", "/partners?rep=1");
    expect(r.status).toBe(200);
    const list = z.array(PartnerOrgSchema).parse(r.json);
    expect(list.find((p) => p.id === c.S1)?.reputation).toEqual({ band: "good", score: 88 });
    expect(list.find((p) => p.id === c.S2)?.reputation).toBeUndefined();
    expect(
      z.array(PartnerOrgSchema).parse((await call("hA", "/partners")).json)[0],
    ).not.toHaveProperty("reputation");
  });

  it("[COM-FR-37] chủ quản không quyền contracts / đối tác: không uy tín; đối tác không gọi cổng sổ", async () => {
    const m = z.array(PartnerOrgSchema).parse((await call("hM", "/partners?rep=1")).json);
    expect(m.some((p) => p.reputation)).toBe(false);
    bookCalls.length = 0;
    const s = await call("s1a", "/partners?rep=1");
    expect(s.status).toBe(200);
    const list = z.array(PartnerOrgSchema).parse(s.json);
    expect(list.map((p) => p.id)).toEqual([c.S1]);
    expect(JSON.stringify(s.json)).not.toMatch(/reputation|partyKey|tax:S1/);
    expect(bookCalls).toEqual([]);
  });
});
