// CR-151 · cr151b-list-paging · phân trang `limit/offset` của 3 danh sách người duyệt + «bài của tôi» (tách khỏi community.flows.int.test.ts cho ≤ 600 dòng).
// Agent là giả (kết quả JSON do test đặt); việc nền chờ bằng promise (không ngủ).
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
// ADR-0044: Bảng tin = gói contracts ∧ add-on contracts-community
const F = { read: "c-r", write: "c-w", admin: "c-a", addon: "c-ad" };
type Who = "hA" | "hM" | "s1a" | "s1b" | "s2" | "b2";
const ORG: Partial<Record<Who, "S1" | "S2" | "B2">> = { s1a: "S1", s1b: "S1", s2: "S2", b2: "B2" };

// ---- seams
let moderationOn = true;
type AgentOut = { ok: true; text: string } | { ok: false; code: string };
let agentOut: (key: string, prompt: string) => AgentOut = () => ({
  ok: true,
  text: '{"flagged":false}',
});
/** Cổng giữ agent (test đua): đặt ⇒ mọi lời gọi agent chờ tới khi mở. */
const gate: Promise<void> | null = null;
const bg: Promise<unknown>[] = [];
const drain = async () => {
  await Promise.all(bg.splice(0));
};
const flag = (reason = "nghi spam"): AgentOut => ({
  ok: true,
  text: JSON.stringify({ flagged: true, reason }),
});

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

/** s1a đăng một bài bán; chờ agent screen xong. Trả id. */
async function post(who: Who = "s1a"): Promise<string> {
  const r = await call(who, "POST", "/posts", {
    type: "sell",
    body: "Keo dán",
    fields: { product: "Keo", qty: "1", price: null },
  });
  expect(r.status).toBe(201);
  await drain();
  return r.json.id as string;
}
beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 54);
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
      flows: {
        agents: {
          call: async (r) => {
            if (gate) await gate;
            return agentOut(r.agentKey, r.prompt);
          },
        },
        moderationOn: async () => moderationOn,
        background: (p) => {
          bg.push(p);
        },
      },
    }),
  );
  h.route("/pack", packNavRoutes(view())); // CR-121 C-7 · `GET /pack/nav` (nguồn Community đã đăng ký khi dựng module)
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

// CR-151 · cr151b-list-paging · 3 danh sách người duyệt + «bài của tôi» phân trang `limit/offset` (trần 100, MỘT câu SQL/trang).
type PageJson = { items: { id: string }[]; nextOffset: number | null };
/** Đi hết các trang `limit` cho tới khi `nextOffset` rỗng. */
async function walk(who: Who, path: string, limit: number): Promise<PageJson[]> {
  const pages: PageJson[] = [];
  for (let o: number | null = 0; o !== null; ) {
    const r = await call(who, "GET", `${path}?limit=${limit}&offset=${o}`);
    expect(r.status).toBe(200);
    pages.push(r.json as PageJson);
    o = (r.json as PageJson).nextOffset;
  }
  return pages;
}
const ids = (pages: PageJson[]) => pages.flatMap((p) => p.items.map((i) => i.id));

describe("phân trang danh sách người duyệt [CR-151]", () => {
  it("hàng đợi duyệt + bài của tôi: trang 2 đúng thứ tự, không trùng, trần 100, người đăng ≠ người duyệt", async () => {
    moderationOn = true;
    agentOut = () => flag();
    for (let i = 0; i < 3; i++) await post("s1a");
    const all = ids([(await call("hA", "GET", "/moderation/queue?limit=100")).json]);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const pages = await walk("hA", "/moderation/queue", 2);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages[0]?.items).toHaveLength(2);
    expect(pages[0]?.nextOffset).toBe(2);
    expect(pages.at(-1)?.nextOffset).toBeNull();
    expect(ids(pages)).toEqual(all);
    expect(new Set(ids(pages)).size).toBe(all.length);
    expect((await call("hA", "GET", "/moderation/queue?limit=101")).status).toBe(400);
    // bài của tôi: s1a (người đăng, KHÔNG phải người duyệt) tự phân trang; công ty khác không thấy
    const mineAll = ids([(await call("s1a", "GET", "/moderation/mine?limit=100")).json]);
    const minePages = await walk("s1a", "/moderation/mine", 2);
    expect(ids(minePages)).toEqual(mineAll);
    expect(mineAll.length).toBeGreaterThanOrEqual(3);
    expect(ids(await walk("s2", "/moderation/mine", 2)).some((x) => mineAll.includes(x))).toBe(
      false,
    );
  });

  it("yêu cầu tham gia: trang 2 đúng, đối tác chỉ thấy của công ty mình, trần 100", async () => {
    const form = (company: string) => ({
      company,
      contact: "Anh Ba",
      email: "ba@doi-tac.test",
      reason: "Muốn bán bao bì",
      labels: ["supplier"],
    });
    for (const w of ["s1a", "s2", "b2"] as const) await call(w, "POST", "/join-requests", form(w));
    const all = ids([(await call("hA", "GET", "/join-requests?limit=100")).json]);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const pages = await walk("hA", "/join-requests", 2);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(ids(pages)).toEqual(all);
    expect(pages[0]?.nextOffset).toBe(2);
    expect(ids(await walk("s2", "/join-requests", 2)).length).toBeLessThan(all.length);
    expect((await call("hA", "GET", "/join-requests?limit=101")).status).toBe(400);
    expect((await call("hM", "GET", "/join-requests?limit=2")).status).toBe(403);
  });

  it("báo cáo vi phạm: trang 2 đúng, đối tác chỉ thấy báo cáo của mình, trần 100", async () => {
    agentOut = () => ({ ok: true, text: '{"kind":"spam","level":"low"}' });
    const P = await seedPosts(
      sql,
      c.A,
      ["R_1", "R_2", "R_3"].map((key) => ({ key, type: "note", org: null, author: c.hA })),
    );
    for (const id of P.values()) await call("s2", "POST", `/posts/${id}/report`, { reason: "x" });
    await drain();
    const all = ids([(await call("hA", "GET", "/reports?limit=100")).json]);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const pages = await walk("hA", "/reports", 2);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(ids(pages)).toEqual(all);
    expect(pages.at(-1)?.nextOffset).toBeNull();
    expect((await call("hA", "GET", "/reports?limit=101")).status).toBe(400);
    expect(ids(await walk("b2", "/reports", 2)).some((x) => all.includes(x))).toBe(false);
  });
});
