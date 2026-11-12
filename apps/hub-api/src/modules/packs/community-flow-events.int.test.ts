// CR-122 · A2 · FLOW2-FR-12/15/19 · int 3 sự kiện Community trên route + RLS + hub thật: (1) cờ FLOW_TRIGGERS tắt ⇒ vẫn có sự kiện + bóng, 0 lượt mới; bật ⇒
// `post.created` / `partner.join_requested` / `report.created` ghi CÙNG tx bản ghi (role `community_rw` qua `hub.emit_flow_event`),
// event_id ổn định, facts đúng manifest; (2) FactsReader đọc dữ kiện hiện tại; (3) OutcomeHandler chạy trong tx engine, idempotent,
// đổi trạng thái bài / đơn / báo cáo; (4) chặn đọc chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../lib/errors";
import { dispatchOnce } from "../processes/triggers/dispatcher";
import { type CommunityFlowPorts, communityModule } from "./community/community.mount";
import { partnerLinker } from "./contracts/adapters/partner-linker";
import { pgExternalOrgResolver } from "./kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "./kit/adapters/pack-guard.middleware";

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
    const org = who === "s1a" ? c.S1 : who === "b2" ? c.B2 : null;
    ctx.set("user", {
      userId: c[who],
      tenantId: c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(org ? { userKind: "external", extOrgId: org } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route(
    "/",
    communityModule(db, view(), pgExternalOrgResolver(db), {
      partners: partnerLinker(),
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
  it("cờ tắt ⇒ đường khe cũ vẫn chạy (agent screen), app VẪN phát sự kiện; bộ điều phối chỉ ghi bóng, 0 lượt mới", async () => {
    triggersOn = false;
    const id = await newPost();
    expect(await events(`post.created:${id}`)).toHaveLength(1);
    expect(
      (await row(sql`select mod_screen from community.posts where id = ${id}::uuid`)).mod_screen,
    ).toBe("flagged");
    const [d] = await sql<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, description,
        input_hint, run_group_ids, stages, token_budget, enabled, sources, inputs, trigger)
      select ${c.A}::uuid, 'm1-bai', 'm1-bai', '', input_hint, run_group_ids, stages, token_budget, true, sources, inputs,
        ${sql.json({ event: "post.created" })} from hub.process_defs
      where key = 'hd-mac-dinh' and tenant_id is null returning id::text as id`;
    const [cf] = await sql<
      { id: string }[]
    >`insert into hub.company_flows (tenant_id, flow_id, enabled, position)
      values (${c.A}::uuid, ${d?.id as string}::uuid, true, 0) returning id::text as id`;
    const launched: string[] = [];
    await dispatchOnce({
      db,
      launch: async (_e, cand) => {
        launched.push(cand.defKey);
        return { runId: crypto.randomUUID() };
      },
      now: () => new Date(Date.now() + 60_000),
    });
    expect(launched).toEqual([]);
    const ev = await row(sql`select outcome, processed_at is not null as done from hub.flow_events
      where tenant_id = ${c.A}::uuid and event_id = ${`post.created:${id}`}`);
    expect(ev).toMatchObject({ done: true, outcome: { shadow: true, would_run: [cf?.id] } });
    const runs = await row(sql`select count(*)::int as n from hub.process_runs
      where tenant_id = ${c.A}::uuid and flow_event_id is not null`);
    expect(runs.n).toBe(0);
  });

  it("cờ tắt, phát sự kiện ném lỗi ⇒ bài VẪN được ghi (savepoint), 0 sự kiện; cờ bật thì lỗi làm hỏng bài", async () => {
    // CHECK chưa kiểm hàng cũ nhưng chặn mọi INSERT mới của post.created ⇒ `hub.emit_flow_event` ném 23514.
    await sql`alter table hub.flow_events add constraint m1_boom check (event <> 'post.created') not valid`;
    try {
      triggersOn = false;
      const r = await call("s1a", "POST", "/posts", {
        type: "sell",
        body: "Keo dán 2",
        fields: { product: "Keo", qty: "1", price: null },
      });
      expect(r.status).toBe(201);
      await Promise.all(bg.splice(0));
      const id = r.json.id as string;
      expect(await events(`post.created:${id}`)).toHaveLength(0);
      expect(
        (await row(sql`select count(*)::int as n from community.posts where id = ${id}::uuid`)).n,
      ).toBe(1);
      triggersOn = true;
      const bad = await call("s1a", "POST", "/posts", {
        type: "sell",
        body: "Keo dán 3",
        fields: { product: "Keo", qty: "1", price: null },
      });
      expect(bad.status).toBeGreaterThanOrEqual(500);
    } finally {
      await sql`alter table hub.flow_events drop constraint m1_boom`;
    }
  });

  it("cờ bật: bài ⇒ post.created cùng tx, Hiện/Ẩn idempotent", async () => {
    triggersOn = true;
    const id = await newPost();
    const ev = await row(events(`post.created:${id}`));
    expect(ev).toMatchObject({
      event: "post.created",
      ref: id,
      facts: { post_kind: "sell", author_is_partner: true },
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

  it("UX-S5 · cờ bật, sự kiện chốt mà không mở được lượt ⇒ bài sang người duyệt NGAY (không kẹt 'đang kiểm tra'), duyệt/ẩn được", async () => {
    triggersOn = true;
    const id = await newPost();
    const st = () =>
      row(sql`select moderation, mod_screen from community.posts where id = ${id}::uuid`);
    expect(await st()).toMatchObject({ moderation: "pending", mod_screen: "running" });
    const queue = async () =>
      ((await call("hA", "GET", "/moderation/queue")).json.items as Record<string, unknown>[]).find(
        (x) => x.id === id,
      );
    // chưa chốt: còn "đang kiểm tra" (chưa quá hạn) ⇒ chưa có nút duyệt
    expect(await queue()).toMatchObject({ awaitingReview: false, screen: "running" });
    const notLaunched = () =>
      withHubScope(
        db,
        { kind: "system" },
        async (tx) =>
          (await ports.handler.notLaunched?.(tx, {
            tenantId: c.A,
            event: "post.created",
            ref: id,
            reason: "FLOW_NOT_ASSIGNED",
          })) ?? false,
      );
    expect(await notLaunched()).toBe(true);
    expect(await notLaunched()).toBe(false); // CAS: chỉ đổi một lần
    expect(await st()).toMatchObject({ moderation: "pending", mod_screen: "error" });
    // người xem thấy gì: hàng chờ có nút Duyệt/Ẩn + tác giả thấy "chờ người duyệt"
    expect(await queue()).toMatchObject({ awaitingReview: true, screen: "error" });
    const mine = (await call("s1a", "GET", "/moderation/mine")).json.items as Record<
      string,
      unknown
    >[];
    expect(mine.find((x) => x.id === id)).toMatchObject({ awaitingReview: true, screen: "error" });
    const queued = (await queue()) as { taskId: string };
    const hide = await call("hA", "POST", `/moderation/${id}/decide`, {
      action: "reject",
      taskId: queued.taskId,
      feedback: "Chưa đủ thông tin",
    });
    expect(hide.status).toBe(200);
    expect(hide.json).toMatchObject({ moderation: "rejected", feedback: "Chưa đủ thông tin" });
    // sự kiện khác của app / bài đã quyết ⇒ không đổi
    expect(await notLaunched()).toBe(false);
    expect((await st()).moderation).toBe("rejected");
  });

  it("cờ bật: đơn xin tham gia ⇒ partner.join_requested, Nhận idempotent", async () => {
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
      facts: { company_name: "Công ty Số Hai", email_domain: "doi-tac.test" },
    });
    expect(JSON.stringify((await row(events(`partner.join_requested:${id}`))).facts)).not.toContain(
      "ba@",
    ); // PII không nhân bản vào hàng đợi sự kiện
    expect(await readerOf("partner.join_requested").read(c.A, id, [])).toMatchObject({
      email_domain: "doi-tac.test",
    });
    expect(await finish("partner.join_requested", id, "accepted")).toBe("applied");
    expect(await finish("partner.join_requested", id, "accepted")).toBe("already_applied");
    expect(await finish("partner.join_requested", id, "rejected")).toBe("already_applied");
    expect(
      (await row(sql`select status from community.join_requests where id = ${id}::uuid`)).status,
    ).toBe("approved");
    const pc = await sql`select array_agg(pr.role) as roles
      from contracts.partner_profiles pp join contracts.partner_roles pr on pr.tenant_id = pp.tenant_id and pr.party_key = pp.party_key
      where pp.tenant_id = ${c.A}::uuid and pp.ext_org_id = ${c.B2}::uuid`;
    expect(pc[0]?.roles).toContain("supplier");
  });

  it("cờ bật: báo cáo ⇒ report.created, Ẩn idempotent", async () => {
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
