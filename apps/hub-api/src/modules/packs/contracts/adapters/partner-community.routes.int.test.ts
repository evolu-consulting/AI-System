// CR-130 pha 2 · L3 · `GET|PUT /pack/contracts/partners/community*` (route thật + pool hub_api + RLS 0103): hồ sơ Bảng tin của đối tác SHT.
// Đường chính: đọc → sửa nhóm hàng/khu vực → danh sách tài khoản chọn được → mời → gỡ. Chặn: không phải quản trị gói ⇒ 403; đối tác
// của tenant khác / không có ⇒ 404; tài khoản của tenant khác ⇒ 422; tài khoản đã gắn đối tác khác ⇒ 409.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly, pgExternalOrgResolver } from "../../kit/public";
import { partnerCommunityUsecase } from "../application/partner-community.usecase";
import { partnerCommunityRoutes } from "./partner-community.routes";
import { partnerProfileRepo } from "./partner-profile.repo";

let sql: Sql;
let db: Db;
let A = "";
let B = "";
let own = "";
let ed = "";
let other = "";
const O = (n: number) => `7e5d00d2-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const [ORG1, ORG2, ORG_B] = [O(1), O(2), O(3)];
const F = { read: "f-r", write: "f-w", admin: "f-a" };

function app(user: string, tenant: string, groups: string[]) {
  const view: PackAccessView = {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set([A, B].flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
      grantGroups: new Map(
        [A, B].flatMap((t) => [
          [`${t}:${F.read}`, ["g-own", "g-edit"]],
          [`${t}:${F.write}`, ["g-own", "g-edit"]],
          [`${t}:${F.admin}`, ["g-own"]],
        ]),
      ),
    }),
    user: async () => ({ tenantId: tenant, groupIds: new Set(groups) }),
  };
  const uow = packTenantOnly(
    createPackUow(db, "contracts", (tx, t) => ({ profile: partnerProfileRepo(tx, t) })),
  );
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: user, tenantId: tenant, role: "member" } as never);
    await next();
  });
  h.route(
    "/",
    partnerCommunityRoutes(view, partnerCommunityUsecase({ uow, ext: pgExternalOrgResolver(db) })),
  );
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
const put = (h: Hono<PackGuardVars>, path: string, body: unknown) =>
  h.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const P1 = "tax:0201000001";
const P2 = "tax:0201000002";
const q = (p: string) => `/partners/community?party=${encodeURIComponent(p)}`;

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 1301)) as [string, string];
  [own, ed] = (await users(sql, A, 2, { from: 1301 })) as [string, string];
  [other] = (await users(sql, B, 1, { from: 1311 })) as [string];
  const roles = await enablePack(sql, [A], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [own]);
  await sql`insert into admin.external_orgs (id, tenant_id, name) values
    (${ORG1}, ${A}, 'Công ty Mời Một'), (${ORG2}, ${A}, 'Công ty Mời Hai'), (${ORG_B}, ${B}, 'Công ty của B')`;
  await sql`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from) values
    (${A}, ${P1}, 'customer', 'Công ty Alpha', 'manual'), (${A}, ${P2}, 'supplier', 'Công ty Beta', 'manual')`;
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-130 L3 · hồ sơ Bảng tin của đối tác qua route", () => {
  it("đường chính: đọc → sửa nhóm hàng/khu vực → ứng viên → mời → gỡ", async () => {
    const admin = app(own, A, ["g-own"]);
    const r0 = await admin.request(q(P1));
    expect(r0.status).toBe(200);
    expect(await r0.json()).toEqual({
      party: P1,
      name: "Công ty Alpha",
      roles: ["customer"],
      cats: [],
      area: "",
      account: null,
      invited_at: null,
    });
    const r1 = await put(admin, "/partners/community/profile", {
      party: P1,
      cats: ["dong-goi", "dong-goi", "chu-ky-so"],
      area: "Hà Nội",
    });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ cats: ["dong-goi", "chu-ky-so"], area: "Hà Nội" });

    const c0 = (await (await admin.request("/partners/community/candidates")).json()) as {
      id: string;
    }[];
    expect(c0.map((x) => x.id).sort()).toEqual([ORG1, ORG2]); // không có tài khoản của tenant B

    const r2 = await put(admin, "/partners/community/account", { party: P1, ext_org_id: ORG1 });
    expect(r2.status).toBe(200);
    const inv = (await r2.json()) as { account: unknown; invited_at: string; cats: string[] };
    expect(inv.account).toEqual({ id: ORG1, name: "Công ty Mời Một", active: true });
    expect(inv.invited_at).toBeTruthy();
    expect(inv.cats).toEqual(["dong-goi", "chu-ky-so"]); // mời không mất nhóm hàng
    const c1 = (await (await admin.request("/partners/community/candidates")).json()) as {
      id: string;
    }[];
    expect(c1.map((x) => x.id)).toEqual([ORG2]);

    const r3 = await put(admin, "/partners/community/account", { party: P1, ext_org_id: null });
    expect(await r3.json()).toMatchObject({ account: null, invited_at: null });
  });

  it("chặn: không phải quản trị gói ⇒ 403; đối tác lạ / tenant khác ⇒ 404; tài khoản tenant khác ⇒ 422; trùng tài khoản ⇒ 409", async () => {
    const editor = app(ed, A, ["g-edit"]);
    expect((await put(editor, "/partners/community/profile", { party: P1, cats: [] })).status).toBe(
      403,
    );
    expect(
      (await put(editor, "/partners/community/account", { party: P1, ext_org_id: ORG1 })).status,
    ).toBe(403);
    expect((await editor.request("/partners/community/candidates")).status).toBe(403);

    const admin = app(own, A, ["g-own"]);
    expect((await admin.request(q("tax:khong-co"))).status).toBe(404);
    expect(
      (await put(admin, "/partners/community/profile", { party: "tax:khong-co", cats: [] })).status,
    ).toBe(404);
    // người dùng tenant B (có quyền đọc gói) không thấy đối tác của A
    expect((await app(other, B, ["g-edit"]).request(q(P1))).status).toBe(404);
    expect(
      (await put(admin, "/partners/community/account", { party: P1, ext_org_id: ORG_B })).status,
    ).toBe(422);
    expect(
      (
        await put(admin, "/partners/community/account", {
          party: P1,
          ext_org_id: crypto.randomUUID(),
        })
      ).status,
    ).toBe(422);
    expect(
      (await put(admin, "/partners/community/account", { party: P1, ext_org_id: "x" })).status,
    ).toBe(400);

    expect(
      (await put(admin, "/partners/community/account", { party: P1, ext_org_id: ORG1 })).status,
    ).toBe(200);
    expect(
      (await put(admin, "/partners/community/account", { party: P2, ext_org_id: ORG1 })).status,
    ).toBe(409);
    const kept = (await (await admin.request(q(P2))).json()) as { account: unknown };
    expect(kept.account).toBeNull();
  });
});
