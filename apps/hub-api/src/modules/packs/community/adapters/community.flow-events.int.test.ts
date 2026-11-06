// CR-122 · A2 · FLOW2-FR-12/15/19 · int 3 sự kiện Community trên route + RLS + hub thật: (1) cờ FLOW_TRIGGERS tắt ⇒ không sự kiện; bật ⇒
// `post.created` / `partner.join_requested` / `report.created` ghi CÙNG tx bản ghi (role `community_rw` qua `hub.emit_flow_event`),
// event_id ổn định, facts đúng manifest; (2) FactsReader đọc dữ kiện hiện tại; (3) OutcomeHandler chạy trong tx engine, idempotent,
// đổi trạng thái bài / đơn / báo cáo; (4) chặn đọc chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { type CommunityFlowPorts, communityModule } from "../community.mount";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
let ports: CommunityFlowPorts;
let triggersOn = false;
const F = { read: "c-r", write: "c-w", admin: "c-a" };
type Who = "hA" | "hM" | "s1a" | "b2";
const bg: Promise<unknown>[] = [];

const view = (): PackAccessView => ({
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
});

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
const events = async (eventId: string) =>
  sql`select event, ref, facts, actor_id::text as actor from hub.flow_events
    where tenant_id = ${c.A}::uuid and event_id = ${eventId}`;
/** Chạy handler như engine: trong một tx hub (rollback cùng lượt). */
const finish = (event: string, ref: string, outcome: string, tenantId = c.A) =>
  withHubScope(db, { kind: "system" }, (tx) =>
    ports.handler.apply(tx, {
      tenantId,
      runId: crypto.randomUUID(),
      event,
      ref,
      outcome,
      actorId: null,
    }),
  );
const readerOf = (event: string) => {
  const r = ports.readers.find((x) => x.events.includes(event));
  if (!r) throw new Error(`reader ${event} chưa đăng ký`);
  return r;
};
async function newPost(): Promise<string> {
  const r = await call("s1a", "POST", "/posts", {
    type: "sell",
    body: "Keo dán",
    fields: { product: "Keo", qty: "1", price: null },
  });
  expect(r.status).toBe(201);
  await Promise.all(bg.splice(0));
  return r.json.id as string;
}
const row = async <T>(q: Promise<T[]>) => (await q)[0] as T;

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 122);
  db = createDb(urls().hubApi, { max: 2 });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    ctx.set("user", {
      userId: c[who],
      tenantId: c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(who === "b2" ? { userKind: "external", extOrgId: c.B2 } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route(
    "/",
    communityModule(db, view(), pgExternalOrgResolver(db), {
      flows: {
        agents: { call: async () => ({ ok: true, text: '{"flagged":true}' }) },
        moderationOn: async () => true,
        background: (p) => {
          bg.push(p);
        },
        triggersOn: async () => triggersOn,
        registerPorts: (p) => {
          ports = p;
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

describe("sự kiện flow Community [CR-122 A2]", () => {
  it("cờ tắt ⇒ giữ đường khe cũ: không ghi sự kiện, agent screen vẫn chạy", async () => {
    triggersOn = false;
    const id = await newPost();
    expect(await events(`post.created:${id}`)).toHaveLength(0);
    expect(
      (await row(sql`select mod_screen from community.posts where id = ${id}::uuid`)).mod_screen,
    ).toBe("flagged");
  });

  it("cờ bật: bài ⇒ post.created cùng tx (event_id theo bài, facts đúng), không chạy screen cũ; Hiện/Ẩn idempotent", async () => {
    triggersOn = true;
    const id = await newPost();
    const ev = await row(events(`post.created:${id}`));
    expect(ev).toMatchObject({
      event: "post.created",
      ref: id,
      facts: { post_kind: "sell", author_is_partner: false },
      actor: c.s1a,
    });
    const st = () =>
      row(sql`select moderation, mod_screen from community.posts where id = ${id}::uuid`);
    expect(await st()).toMatchObject({ moderation: "pending", mod_screen: "running" });
    // FactsReader: dữ kiện hiện tại
    expect(await readerOf("post.created").read(c.A, id, ["post_kind"])).toMatchObject({
      post_kind: "sell",
    });
    // OutcomeHandler: Hiện bài ⇒ approved; gọi lại ⇒ already_applied; Ẩn sau đó không ghi đè quyết định
    expect(await finish("post.created", id, "shown")).toBe("applied");
    expect(await finish("post.created", id, "shown")).toBe("already_applied");
    expect(await finish("post.created", id, "hidden")).toBe("already_applied");
    expect((await st()).moderation).toBe("approved");
    // outcome lạ ⇒ ném (engine rollback, Cần xử lý)
    expect(finish("post.created", id, "bogus")).rejects.toThrow();
    // bài mới: Ẩn ⇒ rejected
    const id2 = await newPost();
    expect(await finish("post.created", id2, "hidden")).toBe("applied");
    expect(
      (await row(sql`select moderation from community.posts where id = ${id2}::uuid`)).moderation,
    ).toBe("rejected");
  });

  it("cờ bật: đối tác xin tham gia ⇒ partner.join_requested; Nhận ⇒ liên kết công ty, idempotent", async () => {
    triggersOn = true;
    const r = await call("b2", "POST", "/join-requests", {
      company: "Công ty Số Hai",
      contact: "Anh Ba",
      email: "ba@doi-tac.test",
      reason: "Muốn bán bao bì",
      labels: ["supplier"],
    });
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    expect(await row(events(`partner.join_requested:${id}`))).toMatchObject({
      ref: id,
      facts: { company_name: "Công ty Số Hai", email: "ba@doi-tac.test" },
    });
    expect(await readerOf("partner.join_requested").read(c.A, id, [])).toMatchObject({
      email: "ba@doi-tac.test",
    });
    expect(await finish("partner.join_requested", id, "accepted")).toBe("applied");
    expect(await finish("partner.join_requested", id, "accepted")).toBe("already_applied");
    expect(await finish("partner.join_requested", id, "rejected")).toBe("already_applied");
    expect(
      (await row(sql`select status from community.join_requests where id = ${id}::uuid`)).status,
    ).toBe("approved");
    const pc = await sql`select labels from community.partner_companies
      where tenant_id = ${c.A}::uuid and ext_org_id = ${c.B2}::uuid`;
    expect(pc[0]?.labels).toContain("supplier");
  });

  it("cờ bật: báo cáo ⇒ report.created; Ẩn ⇒ resolved + ẩn bài, idempotent", async () => {
    triggersOn = true;
    const post = await newPost();
    const r = await call("hM", "POST", `/posts/${post}/report`, { reason: "Quảng cáo rác" });
    expect(r.status).toBe(201);
    await Promise.all(bg.splice(0));
    const id = r.json.id as string;
    expect(await row(events(`report.created:${id}`))).toMatchObject({
      ref: id,
      facts: { report_kind: null, severity: null },
    });
    expect(await readerOf("report.created").read(c.A, id, [])).toHaveProperty("severity");
    expect(await finish("report.created", id, "hidden")).toBe("applied");
    expect(await finish("report.created", id, "hidden")).toBe("already_applied");
    expect(await finish("report.created", id, "kept")).toBe("already_applied");
    const rep = await row(sql`select status, action from community.reports where id = ${id}::uuid`);
    expect(rep).toMatchObject({ status: "resolved", action: "hide" });
    expect(
      (await row(sql`select hidden from community.posts where id = ${post}::uuid`)).hidden,
    ).toBe(true);
  });

  it("chặn chéo tenant: tenant khác không đọc dữ kiện, không đổi trạng thái bản ghi của tenant A", async () => {
    triggersOn = true;
    const id = await newPost();
    expect(await readerOf("post.created").read(c.B, id, [])).toBeNull();
    expect(await finish("post.created", id, "hidden", c.B)).toBe("not_found");
    expect(
      (await row(sql`select moderation from community.posts where id = ${id}::uuid`)).moderation,
    ).toBe("pending");
    // và event của A không hiện với tenant B
    const other = await sql`select 1 from hub.flow_events where tenant_id = ${c.B}::uuid`;
    expect(other).toHaveLength(0);
  });
});
