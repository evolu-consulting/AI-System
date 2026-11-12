// CR-130 · fix-j2-linker · duyệt đơn tham gia kèm «Gắn với đối tác có sẵn» qua ĐÚNG wiring của app (`mountCommunityWired`, như `packs.mount.ts`):
// cổng `PartnerLinker` phải tới được use case (trước đây `mountCommunity` làm rơi `partners` ⇒ 503 «Partner linking unavailable»).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../lib/errors";
import { mountCommunityWired } from "./community-wire.mount";
import type { PackAccessView, PackGuardVars } from "./kit/adapters/pack-guard.middleware";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = { read: "j-r", write: "j-w", admin: "j-a", addon: "j-ad" };
const PARTY = "tax:0300000099";

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
        [`${c.A}:${F.addon}`, [c.roles.owner, c.roles.editor]],
      ]),
    }),
    user: async () => ({ tenantId: c.A, groupIds: new Set([c.roles.owner]) }),
  };
}

type Who = "hA" | "s1a";
const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(`/pack/community${path}`, {
    method,
    headers: { "x-who": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 73);
  await enablePack(sql, [c.A], "contracts");
  await sql`delete from contracts.partner_profiles where ext_org_id = ${c.S1}::uuid`; // seedCast đã gắn S1 — dọn để gắn lại
  await sql`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from, created_by)
    values (${c.A}, ${PARTY}, 'supplier', 'Công ty Đã Có', 'manual', ${c.hA})`;
  db = createDb(urls().hubApi, { max: 2 });
  app = new Hono<PackGuardVars>();
  app.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    ctx.set("user", {
      userId: c[who],
      tenantId: c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(who === "s1a" ? { userKind: "external", extOrgId: c.S1 } : { userKind: "internal" }),
    } as never);
    await next();
  });
  // đúng đường của `packs.mount.ts` (không tiêm tay cổng liên kết)
  mountCommunityWired(app, "/pack", db, view(), async () => "Asia/Ho_Chi_Minh", { worker: false });
  app.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("duyệt đơn tham gia kèm đối tác có sẵn qua wiring thật", () => {
  it("quản trị duyệt + partyKey ⇒ 200 approved, hồ sơ SHT gắn công ty đối tác; không còn 503 PARTNER_LINK_UNAVAILABLE", async () => {
    const r = await call("s1a", "POST", "/join-requests", {
      company: "Công ty Xin Vào",
      contact: "Anh Ba",
      email: "ba@doi-tac.test",
      reason: "Muốn bán bao bì",
      labels: ["supplier"],
    });
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    const d = await call("hA", "POST", `/join-requests/${id}/decide`, {
      action: "approve",
      partyKey: PARTY,
    });
    expect({ status: d.status, code: d.json?.error?.code ?? d.json?.code }).toMatchObject({
      status: 200,
    });
    expect(d.json).toMatchObject({ status: "approved" });
    const [p] = await sql<
      { ext_org_id: string | null }[]
    >`select ext_org_id::text from contracts.partner_profiles where tenant_id = ${c.A}::uuid and party_key = ${PARTY}`;
    expect(p?.ext_org_id).toBe(c.S1);
  });
});
