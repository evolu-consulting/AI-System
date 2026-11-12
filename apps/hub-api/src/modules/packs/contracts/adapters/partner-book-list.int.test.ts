// CR-130 · fix-j2-partners · «Chọn đối tác» (duyệt đơn tham gia Bảng tin) = sổ đối tác `GET /pack/contracts/partners/search` (vai ∪ danh bạ, RLS M1),
// KHÔNG phải bảng điểm uy tín `GET /partners` (chỉ đối tác có HĐ duyệt). Route thật + pool hub_api.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack, members, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { partnersModule } from "../partners.mount";

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
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: user, tenantId: tenant, role: "member" } as never);
    await next();
  });
  h.route("/", partnersModule(db, view, { timeZoneOf: async () => "Asia/Ho_Chi_Minh" }));
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
const NAME = "Công ty Gắn Thử Một";
const KEY = "name:cong ty gan thu mot";

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [A, B] = (await tenants(sql, 2, 1401)) as [string, string];
  [own, ed] = (await users(sql, A, 2, { from: 1401 })) as [string, string];
  [other] = (await users(sql, B, 1, { from: 1411 })) as [string];
  const roles = await enablePack(sql, [A], "contracts");
  await members(sql, A, roles.get(A)?.owner as string, [own]);
  // như e2e J2 / UI: đối tác nhập tay (chưa có HĐ nào) do người dùng `ed` thêm — `created_by` = người thêm (RLS M1 0024)
  await sql`insert into contracts.partner_roles (tenant_id, party_key, role, name, created_from, created_by)
    values (${A}, ${KEY}, 'customer', ${NAME}, 'manual', ${ed})`;
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

type Row = { party: string; name: string | null };
const get = async (h: Hono<PackGuardVars>, path: string) => {
  const r = await h.request(path);
  return { status: r.status, rows: (await r.json()) as Row[] };
};

describe("CR-130 fix-j2 · «Chọn đối tác» khi duyệt đơn tham gia lấy từ SỔ đối tác, không từ bảng điểm uy tín", () => {
  it("đối tác nhập tay chưa có HĐ: KHÔNG có trong bảng điểm `GET /partners` (chỉ đối tác có HĐ duyệt) — đây là nguyên nhân J2 đỏ", async () => {
    const r = await get(app(ed, A, ["g-edit"]), "/partners?role=all");
    expect(r.status).toBe(200);
    expect(r.rows.some((x) => x.name === NAME)).toBe(false);
  });
  it("`GET /partners/search` (sổ đối tác): người thêm (và quản trị) thấy, tìm theo tiền tố được; tenant khác không thấy", async () => {
    const mine = await get(app(ed, A, ["g-edit"]), "/partners/search?limit=50");
    expect({
      status: mine.status,
      has: mine.rows.some((x) => x.party === KEY && x.name === NAME),
    }).toEqual({
      status: 200,
      has: true,
    });
    const byPrefix = await get(
      app(own, A, ["g-own"]),
      `/partners/search?limit=50&q=${encodeURIComponent("công ty gắn")}`,
    );
    expect(byPrefix.rows.map((x) => x.party)).toContain(KEY);
    const foreign = await get(app(other, B, ["g-own"]), "/partners/search?limit=50");
    expect(foreign.rows.some((x) => x.party === KEY)).toBe(false);
  });
});
