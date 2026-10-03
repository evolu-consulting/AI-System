// ADM-FR-51 · M4-R10 · Q6 · ghi audit cùng transaction cho mọi thao tác plan §4.2 (test-plan AW1–AW12; M4-AC04).
// Mỗi ca: mốc `auditMark` → thao tác qua `track` (NOTIFY + sentinel) → dòng `seq > mark` trừ sentinel. Xanh ở T1–T1c.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  type AuditHelpers,
  auditHelpers,
  createM4Env,
  ID,
  ID3,
  type Listener,
  type M4Env,
  resetNow,
  TENANT_ID,
  USER_ID,
  verOf,
  type Who,
} from "./_ab";

let env: M4Env;
let lis: Listener;
const A = TENANT_ID.acme;
const G = TENANT_ID.globex;
const Z = TENANT_ID.zeta;
const KT = ID3.group.acmeKeToan;
const KD = ID3.group.acmeKinhDoanh;
const F = ID.feature;

beforeAll(async () => {
  env = await createM4Env();
  lis = await env.listen();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
});

const ADMIN: Who = { tenant: "platform", user: "admin" };
const BINH: Who = { tenant: "acme", user: "binh" };
const admin = (m: string, p: string, b?: unknown) => env.by("platform", "admin")(m, p, b);
const binh = (m: string, p: string, b?: unknown) => env.by("acme", "binh")(m, p, b);
const audited: AuditHelpers["audited"] = (...a) => auditHelpers(env, lis).audited(...a);
const one: AuditHelpers["one"] = (...a) => auditHelpers(env, lis).one(...a);
const ver = (t: string, id: string) => verOf(env, t, id);

describe("ADM-FR-51 · M4-AC04 · tenant, user", () => {
  it("ADM-FR-51 · M4-AC04 · AW1 · POST tenant → create tenant + create user; PATCH/lock/unlock → update/lock/unlock, tenant_id = tenant, snapshot false", async () => {
    const { res, rows } = await audited(ADMIN, () =>
      admin("POST", "/admin/tenants", {
        key: "initech",
        name: "Initech",
        first_admin: {
          username: "lumbergh",
          display_name: "Bill",
          email: "bill@initech.test",
          locale: "en",
        },
      }),
    );
    expect(res.status).toBe(201);
    const tid = res.json.tenant.id as string;
    expect(rows.map((r) => [r.action, r.entity, r.tenant_id, r.entity_name]).sort()).toEqual([
      ["create", "tenant", tid, "initech"],
      ["create", "user", tid, "lumbergh"],
    ]);
    const v = await ver("tenants", A);
    await one(ADMIN, () => admin("PATCH", `/admin/tenants/${A}`, { version: v, name: "Acme 2" }), {
      action: "update",
      entity: "tenant",
      tenant_id: A,
      entity_id: A,
      entity_name: "acme",
      entity_version: v + 1,
      snapshot: false,
    });
    await one(ADMIN, () => admin("POST", `/admin/tenants/${G}/lock`), {
      action: "lock",
      entity: "tenant",
      tenant_id: G,
    });
    await one(ADMIN, () => admin("POST", `/admin/tenants/${Z}/unlock`), {
      action: "unlock",
      entity: "tenant",
      tenant_id: Z,
    });
  });

  it("ADM-FR-51 · M4-AC04 · AW2 · users POST/PATCH/lock/unlock → create/update/lock/unlock · acme; reset → update, summary.password_reset, config_version NULL", async () => {
    await one(
      ADMIN,
      () =>
        admin("POST", `/admin/users?tenant_id=${A}`, {
          username: "moi",
          display_name: "Moi",
          role: "member",
        }),
      { action: "create", entity: "user", tenant_id: A, entity_name: "moi", snapshot: false },
    );
    const v = await ver("users", USER_ID.lan);
    await one(
      BINH,
      () => binh("PATCH", `/admin/users/${USER_ID.lan}`, { version: v, display_name: "Lan 2" }),
      {
        action: "update",
        entity: "user",
        tenant_id: A,
        entity_id: USER_ID.lan,
        entity_name: "lan",
        entity_version: v + 1,
      },
    );
    await one(BINH, () => binh("POST", `/admin/users/${USER_ID.lan}/lock`), {
      action: "lock",
      entity: "user",
      tenant_id: A,
    });
    await one(BINH, () => binh("POST", `/admin/users/${USER_ID.em}/unlock`), {
      action: "unlock",
      entity: "user",
      tenant_id: A,
    });
    const r = await one(
      BINH,
      () => binh("POST", `/admin/users/${USER_ID.thu}/reset-password`),
      { action: "update", entity: "user", tenant_id: A, entity_name: "thu", config_version: null },
      { bump: false },
    );
    expect(r.summary).toMatchObject({ password_reset: true });
  });
});

describe("ADM-FR-51 · M4-AC04 · group, grant, entitlement", () => {
  it("ADM-FR-51 · M4-AC04 · AW3 · groups POST/PATCH/DELETE snapshot true; members thêm/bớt → update, summary.added/removed, before/after null", async () => {
    await one(BINH, () => binh("POST", "/admin/groups", { key: "moi-nhom", name: { vi: "Mới" } }), {
      action: "create",
      entity: "group",
      tenant_id: A,
      entity_name: "moi-nhom",
      snapshot: true,
      before: null,
    });
    const v = await ver("groups", KT);
    const p = await one(
      BINH,
      () => binh("PATCH", `/admin/groups/${KT}`, { version: v, name: { vi: "KT 2" } }),
      {
        action: "update",
        entity_id: KT,
        entity_name: "ke-toan",
        entity_version: v + 1,
        snapshot: true,
      },
    );
    expect([p.before?.name, p.after?.name]).toEqual([
      { vi: "Kế toán", en: "Accounting" },
      { vi: "KT 2" },
    ]);
    const d = await one(BINH, () => binh("DELETE", `/admin/groups/${KD}`), {
      action: "delete",
      entity_id: KD,
      after: null,
      snapshot: true,
    });
    expect(d.before?.key).toBe("kinh-doanh");
    const add = await one(
      BINH,
      () => binh("POST", `/admin/groups/${KT}/members`, { usernames: ["dung"] }),
      {
        action: "update",
        entity: "group",
        before: null,
        after: null,
        snapshot: false,
      },
    );
    expect(add.summary).toMatchObject({ added: ["dung"] });
    const rm = await one(BINH, () => binh("DELETE", `/admin/groups/${KT}/members/${USER_ID.lan}`), {
      action: "update",
      entity: "group",
    });
    expect(rm.summary).toMatchObject({ removed: ["lan"] });
  });

  it("ADM-FR-51 · M4-AC04 · AW4 · grant POST/DELETE → grant/revoke, summary.subject_*, feature_key; batch 3 cặp đổi + 1 có sẵn → 3 dòng", async () => {
    const g = await one(
      BINH,
      () => binh("POST", "/admin/grants", { feature_id: F.dichThuat, group_id: KT }),
      {
        action: "grant",
        entity: "grant",
        tenant_id: A,
        entity_name: "dich-thuat",
      },
    );
    expect(g.summary).toMatchObject({ subject_type: "group", feature_key: "dich-thuat" });
    expect(typeof g.summary.subject_name).toBe("string");
    await one(BINH, () => binh("DELETE", `/admin/grants?feature_id=${F.keToan}&group_id=${KT}`), {
      action: "revoke",
      entity: "grant",
      tenant_id: A,
    });
    const { res, rows } = await audited(BINH, () =>
      binh("PUT", "/admin/grants/batch", {
        add: [
          { feature_id: F.baoCao, group_id: KT },
          { feature_id: F.keToan, group_id: KT },
          { feature_id: F.dichThuat, group_id: KD },
          { feature_id: F.dichThuat, group_id: KT },
        ],
        remove: [],
      }),
    );
    expect(res.status).toBe(200);
    expect(rows.map((r) => `${r.action}:${r.entity}`)).toEqual([
      "grant:grant",
      "grant:grant",
      "grant:grant",
    ]);
  });

  it("ADM-FR-51 · M4-AC04 · AW5 · entitlement PUT/DELETE → grant/revoke · entitlement · tenant được cấp", async () => {
    await one(ADMIN, () => admin("PUT", `/admin/features/${F.keToan}/entitlements/${Z}`), {
      action: "grant",
      entity: "entitlement",
      tenant_id: Z,
      entity_name: "ke-toan",
    });
    await one(ADMIN, () => admin("DELETE", `/admin/features/${F.keToan}/entitlements/${A}`), {
      action: "revoke",
      entity: "entitlement",
      tenant_id: A,
    });
  });
});
