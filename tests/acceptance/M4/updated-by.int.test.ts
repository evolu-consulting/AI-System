// ADM-FR-55 · M4-R17 · TD #7 · CR-016 · `updated_by` của user/tenant (test-plan UB1–UB4; M4-AC14). Xanh ở T1b.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  createM4Env,
  expectErr4,
  type M4Env,
  newField,
  resetNow,
  TENANT_ID,
  USER_ID,
  verOf,
} from "./_ab";

let env: M4Env;
const A = TENANT_ID.acme;
const LAN = USER_ID.lan;

beforeAll(async () => {
  env = await createM4Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const dbUpdatedBy = async (table: "users" | "tenants", id: string) => {
  const [r] = await env.owner.unsafe(
    `select u.username from admin.${table} x left join admin.users u on u.id = x.updated_by where x.id = $1`,
    [id],
  );
  return (r?.username ?? null) as string | null;
};
const chi = (m: string, p: string, b?: unknown) => env.by("acme", "chi")(m, p, b);
const admin = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);

describe("ADM-FR-55 · M4-R17 · updated_by", () => {
  it("ADM-FR-55 · M4-R17 · UB1 · chi PATCH lan → updated_by 'chi' (API + DB)", async () => {
    const res = await chi("PATCH", `/admin/users/${LAN}`, {
      version: await verOf(env, "users", LAN),
      display_name: "Lan 2",
    });
    expect(res.status).toBe(200);
    expect(newField<string | null>(res.json, "updated_by")).toBe("chi");
    expect(await dbUpdatedBy("users", LAN)).toBe("chi");
  });

  it("ADM-FR-55 · M4-R17 · UB2 · admin PATCH tenant acme → updated_by 'admin'; khoá/mở tenant cũng ghi", async () => {
    const res = await admin("PATCH", `/admin/tenants/${A}`, {
      version: await verOf(env, "tenants", A),
      name: "Acme 2",
    });
    expect(res.status).toBe(200);
    const t = (res.json?.tenant ?? res.json) as unknown;
    expect(newField<string | null>(t, "updated_by")).toBe("admin");
    expect(await dbUpdatedBy("tenants", A)).toBe("admin");
    await env.owner`update admin.tenants set updated_by = null where id = ${TENANT_ID.globex}`;
    expect((await admin("POST", `/admin/tenants/${TENANT_ID.globex}/lock`)).status).toBeLessThan(
      300,
    );
    expect(await dbUpdatedBy("tenants", TENANT_ID.globex)).toBe("admin");
    await env.owner`update admin.tenants set updated_by = null where id = ${TENANT_ID.globex}`;
    expect((await admin("POST", `/admin/tenants/${TENANT_ID.globex}/unlock`)).status).toBeLessThan(
      300,
    );
    expect(await dbUpdatedBy("tenants", TENANT_ID.globex)).toBe("admin");
  });

  it("ADM-FR-55 · M4-R17 · M4-AC14 · UB3 · PATCH user/tenant version cũ → 409, details.current.updated_by = người sửa trước", async () => {
    const vu = await verOf(env, "users", LAN);
    expect(
      (await chi("PATCH", `/admin/users/${LAN}`, { version: vu, display_name: "Lan 2" })).status,
    ).toBe(200);
    const binh = env.by("acme", "binh");
    const du = expectErr4(
      await binh("PATCH", `/admin/users/${LAN}`, { version: vu, display_name: "Lan 3" }),
      "VERSION_CONFLICT",
    );
    expect(newField<string | null>(du.current, "updated_by")).toBe("chi");
    const vt = await verOf(env, "tenants", A);
    expect(
      (await admin("PATCH", `/admin/tenants/${A}`, { version: vt, name: "Acme 2" })).status,
    ).toBe(200);
    const dt = expectErr4(
      await admin("PATCH", `/admin/tenants/${A}`, { version: vt, name: "Acme 3" }),
      "VERSION_CONFLICT",
    );
    expect(newField<string | null>(dt.current, "updated_by")).toBe("admin");
  });

  it("ADM-FR-55 · M4-R17 · BR-09 · UB4 · admin sửa lan; binh xem lan → updated_by null (RLS che platform admin), không lỗi", async () => {
    const v = await verOf(env, "users", LAN);
    expect(
      (await admin("PATCH", `/admin/users/${LAN}`, { version: v, display_name: "Lan A" })).status,
    ).toBe(200);
    const res = await env.by("acme", "binh")("GET", `/admin/users/${LAN}`);
    expect(res.status).toBe(200);
    expect(res.json && "updated_by" in res.json).toBe(true);
    expect(newField<string | null>(res.json, "updated_by")).toBeNull();
  });
});
