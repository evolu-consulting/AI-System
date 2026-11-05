// CR-120 · cr120-community-flows · int 3 khe Community trên route + RLS thật: chuyển trạng thái từng khe, quyền (thành viên /
// admin / đối tác), RLS người xem của bảng mới. Agent là giả (kết quả JSON do test đặt); việc nền chờ bằng promise (không ngủ).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, inPackAs, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import {
  type Cast,
  seedCast,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { communityModule } from "../community.mount";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
let hostPost = "";
const F = { read: "c-r", write: "c-w", admin: "c-a" };
type Who = "hA" | "hM" | "s1a" | "s1b" | "s2" | "b2";
const ORG: Partial<Record<Who, "S1" | "S2" | "B2">> = { s1a: "S1", s1b: "S1", s2: "S2", b2: "B2" };

// ---- seams
let moderationOn = true;
type AgentOut = { ok: true; text: string } | { ok: false; code: string };
let agentOut: (key: string) => AgentOut = () => ({ ok: true, text: '{"flagged":false}' });
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
const as = <R>(u: string, fn: (tx: Sql) => Promise<R>) => inPackAs("community", c.A, u, fn);

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
const modRow = async (id: string) =>
  (
    await sql`select moderation, mod_screen, mod_task_id::text as task from community.posts where id = ${id}::uuid`
  )[0] as { moderation: string; mod_screen: string | null; task: string | null };
const inFeed = async (who: Who, id: string) =>
  ((await call(who, "GET", "/feed")).json.items as { id: string }[]).some((x) => x.id === id);

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 53);
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
      flows: {
        agents: { call: async (r) => agentOut(r.agentKey) },
        moderationOn: async () => moderationOn,
        background: (p) => {
          bg.push(p);
        },
      },
    }),
  );
  h.onError((e, ctx) => {
    const m = mapError(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
  const P = await seedPosts(sql, c.A, [{ key: "H_all", type: "note", org: null, author: c.hA }]);
  hostPost = P.get("H_all") as string;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("khe community.post-moderation [CR-120]", () => {
  it("gắn cờ ⇒ pending/flagged, chỉ người đăng + chủ quản thấy, admin duyệt ⇒ approved, hiện trên bảng tin", async () => {
    agentOut = () => flag();
    const id = await post();
    expect(await modRow(id)).toMatchObject({ moderation: "pending", mod_screen: "flagged" });
    // hàng đợi: chỉ admin chủ quản
    expect(
      (await call("hA", "GET", "/moderation/queue")).json.items.map((i: { id: string }) => i.id),
    ).toContain(id);
    expect((await call("hM", "GET", "/moderation/queue")).status).toBe(403);
    expect((await call("s1a", "GET", "/moderation/queue")).status).toBe(403);
    expect((await call("s1a", "GET", "/moderation/mine")).json.items[0].id).toBe(id);
    // bảng tin: người đăng thấy; chủ quản (thành viên) chưa thấy tới khi duyệt
    expect(await inFeed("s1a", id)).toBe(true);
    expect(await inFeed("hM", id)).toBe(false);
    // RLS: đối tác khác không đọc được hàng pending dù biết id; người đăng + chủ quản đọc được
    const seen = (u: string) =>
      as(u, (tx) => tx`select id from community.posts where id = ${id}::uuid`).then(
        (r) => r.length,
      );
    expect(await seen(c.s2)).toBe(0);
    expect(await seen(c.s1b)).toBe(0);
    expect(await seen(c.s1a)).toBe(1);
    expect(await seen(c.hM)).toBe(1);
    // quyền quyết: đối tác / thành viên ⇒ 403; sai taskId ⇒ 409; action lạ ⇒ 422
    const body = { action: "approve" };
    expect((await call("s1a", "POST", `/moderation/${id}/decide`, body)).status).toBe(403);
    expect((await call("hM", "POST", `/moderation/${id}/decide`, body)).status).toBe(403);
    expect(
      (
        await call("hA", "POST", `/moderation/${id}/decide`, {
          ...body,
          taskId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect((await call("hA", "POST", `/moderation/${id}/decide`, { action: "hide" })).status).toBe(
      422,
    );
    const ok = await call("hA", "POST", `/moderation/${id}/decide`, body);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ moderation: "approved", awaitingReview: false });
    expect(await inFeed("hM", id)).toBe(true);
    // đã quyết ⇒ 409, không quyết lại
    expect(
      (await call("hA", "POST", `/moderation/${id}/decide`, { action: "reject" })).status,
    ).toBe(409);
  });

  it("từ chối ⇒ rejected, không lên bảng tin, người đăng vẫn thấy trạng thái ở 'bài của tôi'", async () => {
    agentOut = () => flag();
    const id = await post();
    const r = await call("hA", "POST", `/moderation/${id}/decide`, {
      action: "reject",
      feedback: "sai chủ đề",
    });
    expect(r.json).toMatchObject({ moderation: "rejected", feedback: "sai chủ đề" });
    expect(await inFeed("hM", id)).toBe(false);
    const mine = (await call("s1a", "GET", "/moderation/mine")).json.items as {
      id: string;
      moderation: string;
    }[];
    expect(mine.find((i) => i.id === id)?.moderation).toBe("rejected");
  });

  it("agent sạch ⇒ approved ngay (không qua duyệt), agent lỗi/sai hình ⇒ vào duyệt, KHÔNG tự đăng", async () => {
    agentOut = () => ({ ok: true, text: '{"flagged":false}' });
    const clean = await post();
    expect(await modRow(clean)).toMatchObject({ moderation: "approved", mod_screen: "clean" });
    expect(await inFeed("hM", clean)).toBe(true);
    agentOut = () => ({ ok: false, code: "TIMEOUT" });
    const err = await post();
    expect(await modRow(err)).toMatchObject({ moderation: "pending", mod_screen: "error" });
    agentOut = () => ({ ok: true, text: "Bài này ổn, đăng đi" });
    const odd = await post();
    expect(await modRow(odd)).toMatchObject({ moderation: "pending", mod_screen: "error" });
    expect(await inFeed("hM", odd)).toBe(false);
  });

  it("tenant chưa gán khe ⇒ bài đăng như cũ (moderation = none)", async () => {
    moderationOn = false;
    try {
      const id = await post();
      expect(await modRow(id)).toMatchObject({ moderation: "none", mod_screen: null });
      expect(await inFeed("hM", id)).toBe(true);
    } finally {
      moderationOn = true;
    }
  });

  it("đối tác không tự đổi cột duyệt (trigger posts_moderation_guard)", async () => {
    agentOut = () => flag();
    const id = await post();
    const code = await pgCode(() =>
      as(
        c.s1a,
        (tx) => tx`update community.posts set moderation = 'approved' where id = ${id}::uuid`,
      ),
    );
    expect(code).toBe("42501");
    expect((await modRow(id)).moderation).toBe("pending");
  });
});

describe("khe community.partner-join [CR-120]", () => {
  const form = (company: string) => ({
    company,
    contact: "Anh Ba",
    email: "ba@doi-tac.test",
    reason: "Muốn bán bao bì",
    labels: ["supplier"],
  });

  it("đối tác gửi form ⇒ pending, trùng ⇒ 409, chủ quản gửi ⇒ 403, tenant admin duyệt ⇒ liên kết công ty đối tác", async () => {
    await sql`delete from community.partner_companies where ext_org_id = ${c.B2}::uuid`;
    const r = await call("b2", "POST", "/join-requests", form("Công ty Số Hai"));
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("pending");
    expect((await call("b2", "POST", "/join-requests", form("Công ty Số Hai"))).status).toBe(409);
    expect((await call("hA", "POST", "/join-requests", form("X"))).status).toBe(403);
    const id = r.json.id as string;
    // danh sách: admin thấy; thành viên chủ quản 403; đối tác khác không thấy yêu cầu của công ty khác
    expect(
      (await call("hA", "GET", "/join-requests?pending=1")).json.items.map(
        (i: { id: string }) => i.id,
      ),
    ).toContain(id);
    expect((await call("hM", "GET", "/join-requests")).status).toBe(403);
    expect((await call("s2", "GET", "/join-requests")).json.items).toEqual([]);
    expect((await call("b2", "GET", "/join-requests")).json.items).toHaveLength(1);
    // quyền quyết
    expect(
      (await call("b2", "POST", `/join-requests/${id}/decide`, { action: "approve" })).status,
    ).toBe(403);
    expect(
      (await call("hM", "POST", `/join-requests/${id}/decide`, { action: "approve" })).status,
    ).toBe(403);
    expect(
      (await call("hA", "POST", `/join-requests/${id}/decide`, { action: "hide" })).status,
    ).toBe(422);
    const ok = await call("hA", "POST", `/join-requests/${id}/decide`, { action: "approve" });
    expect(ok.json).toMatchObject({ status: "approved", decidedBy: expect.any(String) });
    const pc =
      await sql`select labels from community.partner_companies where ext_org_id = ${c.B2}::uuid`;
    expect(pc).toHaveLength(1);
    expect(pc[0]?.labels).toEqual(["supplier"]);
    expect(
      (await call("hA", "POST", `/join-requests/${id}/decide`, { action: "reject" })).status,
    ).toBe(409);
  });

  it("từ chối ⇒ rejected, KHÔNG liên kết, sau đó được gửi lại yêu cầu mới", async () => {
    await sql`delete from community.partner_companies where ext_org_id = ${c.S2}::uuid`;
    const r = await call("s2", "POST", "/join-requests", form("Hãng NCCA"));
    const id = r.json.id as string;
    const rej = await call("hA", "POST", `/join-requests/${id}/decide`, {
      action: "reject",
      feedback: "thiếu hồ sơ",
    });
    expect(rej.json).toMatchObject({ status: "rejected", feedback: "thiếu hồ sơ" });
    expect(
      await sql`select 1 from community.partner_companies where ext_org_id = ${c.S2}::uuid`,
    ).toHaveLength(0);
    expect((await call("s2", "POST", "/join-requests", form("Hãng NCCA"))).status).toBe(201);
  });

  it("RLS: đối tác không sửa trạng thái / không tạo dưới tên công ty khác", async () => {
    const r = await call("s1a", "POST", "/join-requests", form("Cơ sở Tân Phát"));
    const id = r.json.id as string;
    const upd = await as(
      c.s1a,
      (tx) =>
        tx`update community.join_requests set status = 'approved' where id = ${id}::uuid returning id`,
    );
    expect(upd).toHaveLength(0);
    const code = await pgCode(() =>
      as(
        c.s1a,
        (
          tx,
        ) => tx`insert into community.join_requests (tenant_id, requester_user_id, requester_org, company, contact, email)
        values (${c.A}::uuid, ${c.s1a}::uuid, ${c.S2}::uuid, 'x', 'x', 'x@x.test')`,
      ),
    );
    expect(code).toBe("42501");
  });
});

describe("khe community.report [CR-120]", () => {
  it("đối tác báo cáo ⇒ triage chạy nền, trùng ⇒ 409, bài không thấy ⇒ 404, chỉ thấy báo cáo của mình", async () => {
    agentOut = () => ({ ok: true, text: '{"kind":"spam","level":"high"}' });
    const r = await call("s2", "POST", `/posts/${hostPost}/report`, { reason: "Quảng cáo rác" });
    expect(r.status).toBe(201);
    await drain();
    const id = r.json.id as string;
    expect(
      (await call("s2", "POST", `/posts/${hostPost}/report`, { reason: "lần hai" })).status,
    ).toBe(409);
    expect(
      (await call("s2", "POST", `/posts/${crypto.randomUUID()}/report`, { reason: "x" })).status,
    ).toBe(404);
    const mine = (await call("s2", "GET", "/reports")).json.items as {
      id: string;
      triage: string;
      kind: string;
      level: string;
    }[];
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id, triage: "done", kind: "spam", level: "high" });
    expect((await call("s1a", "GET", "/reports")).json.items).toEqual([]);
    // chủ quản: admin thấy hàng đợi; thành viên thường không phải người duyệt ⇒ 403
    expect(
      (await call("hA", "GET", "/reports?pending=1")).json.items.map((i: { id: string }) => i.id),
    ).toContain(id);
    expect((await call("hM", "GET", "/reports")).status).toBe(403);
  });

  it("triage lỗi ⇒ triage=error nhưng vẫn xử lý tay, quyết hide ⇒ resolved + bài bị ẩn, quyền + quyết lại", async () => {
    agentOut = () => ({ ok: false, code: "TIMEOUT" });
    const r = await call("s1b", "POST", `/posts/${hostPost}/report`, { reason: "Nghi lừa đảo" });
    await drain();
    const id = r.json.id as string;
    expect(
      (await call("hA", "GET", "/reports?pending=1")).json.items.find(
        (i: { id: string }) => i.id === id,
      ),
    ).toMatchObject({ triage: "error", status: "pending" });
    expect((await call("s1b", "POST", `/reports/${id}/decide`, { action: "hide" })).status).toBe(
      403,
    );
    expect((await call("hM", "POST", `/reports/${id}/decide`, { action: "hide" })).status).toBe(
      403,
    );
    expect((await call("hA", "POST", `/reports/${id}/decide`, { action: "approve" })).status).toBe(
      422,
    );
    const ok = await call("hA", "POST", `/reports/${id}/decide`, { action: "hide" });
    expect(ok.json).toMatchObject({ status: "resolved", action: "hide" });
    expect(
      (await sql`select hidden from community.posts where id = ${hostPost}::uuid`)[0]?.hidden,
    ).toBe(true);
    expect((await call("hA", "POST", `/reports/${id}/decide`, { action: "dismiss" })).status).toBe(
      409,
    );
  });

  it("RLS: đối tác không đọc báo cáo của người khác, không sửa kết quả xử lý", async () => {
    const rows = await as(c.b2, (tx) => tx`select id from community.reports`);
    expect(rows).toHaveLength(0);
    const own = await as(
      c.s2,
      (tx) => tx`update community.reports set status = 'resolved', action = 'dismiss' returning id`,
    );
    expect(own).toHaveLength(0);
  });
});
