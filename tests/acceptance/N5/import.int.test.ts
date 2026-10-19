// N5-FR-02, N5-FR-03, N5-FR-06, N5-FR-07 · công cụ chuyển user mgmt-app: tenant + Group vai, cách ly tenant, dry-run,
// idempotent, chạy lại KHÔNG hoàn tác thu hồi (review Trung 1 / security L2), marker có nguồn (security M1), USER_CONFLICT ở
// cả dry-run (review Trung 2), chạy lại với username fallback. Mỗi describe tự seed org riêng (độc lập thứ tự — review Thấp 8).
// Dữ liệu export GIẢ. Mật khẩu / CLI / actor / file: `import-security.int.test.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { runIdentityImport } from "../../../apps/admin-api/src/modules/identity-import/identity-import.run";
import {
  type CtxN5,
  mkExport,
  ROLE_GROUP,
  rolesIn,
  snapshot,
  startN5,
  tenantOfOrg,
  USERS,
  userX,
} from "./_support/n5";

let c: CtxN5;
beforeAll(async () => {
  c = await startN5();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const run = (raw: unknown, apply: boolean) =>
  runIdentityImport(c.db, raw, { actorId: c.padmin, apply });
const tenantId = async (orgId: string) => (await tenantOfOrg(c.sql, orgId))[0]?.id as string;
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe("N5-FR-06 · dry-run mặc định", () => {
  it("N5-FR-06 · không --apply ⇒ báo cáo số SẼ tạo, DB không đổi (không bump, không audit)", async () => {
    const before = await snapshot(c.sql);
    const raw = mkExport(
      [{ id: "dry-org", name: "Dry Co", tenant_key: "dry-co" }],
      [userX("a@dry.test", "dry-org", "owner"), userX("b@dry.test", "dry-org", "viewer")],
    );
    const r = await run(raw, false);
    expect(r.dry_run).toBe(true);
    expect(r.orgs).toEqual({ read: 1, created: 1, existing: 0, errors: 0 });
    expect(r.users.created).toBe(2);
    expect(await snapshot(c.sql)).toEqual(before);
  });
});

describe("N5-FR-02 · N5-FR-03 · N5-FR-07 · apply: tenant, Group vai, cách ly tenant", () => {
  const raw = () =>
    mkExport(
      [
        { id: "org-alpha", name: "Công ty Alpha" },
        { id: "org-bravo", name: "Bravo", tenant_key: "bravo-n5" },
      ],
      [
        userX("own@alpha.test", "org-alpha", "owner"),
        userX("ed@alpha.test", "org-alpha", "editor"),
        userX("vw@alpha.test", "org-alpha", "viewer"),
        userX("lan@example.test", "org-bravo", "editor"), // trùng email user acme ⇒ vẫn tạo riêng ở bravo
      ],
    );

  it("N5-FR-02 · tạo tenant (marker nguồn + org, slug bỏ dấu) + bật gói contracts (3 Group, 6 grant, 3 entitlement)", async () => {
    await run(raw(), true);
    const [a] = await tenantOfOrg(c.sql, "org-alpha");
    expect(a?.key).toBe("cong-ty-alpha");
    expect((await tenantOfOrg(c.sql, "org-bravo"))[0]?.key).toBe("bravo-n5");
    const [st] = await c.sql`select settings from admin.tenants where id = ${a?.id as string}`;
    expect(st?.settings).toEqual({ mgmt_source: "mgmt-test", mgmt_org_id: "org-alpha" });
    const [n] = await c.sql<{ g: number; gr: number; en: number }[]>`select
      (select count(*)::int from admin.groups where tenant_id = ${a?.id as string} and key like 'contracts-%') as g,
      (select count(*)::int from admin.feature_grants fg join admin.features f on f.id = fg.feature_id
        where fg.tenant_id = ${a?.id as string} and f.key like 'contracts-%') as gr,
      (select count(*)::int from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
        where e.tenant_id = ${a?.id as string} and f.key like 'contracts-%' and e.revoked_at is null) as en`;
    expect(n).toEqual({ g: 3, gr: 6, en: 3 });
  });

  it("N5-FR-07 · mỗi user chỉ vào Group vai của tenant org mình; owner ⇒ tenant_admin, còn lại member; 0 platform_admin", async () => {
    await run(raw(), true);
    const a = await tenantId("org-alpha");
    const b = await tenantId("org-bravo");
    expect(await rolesIn(c.sql, a)).toEqual({
      "ed@alpha.test": [ROLE_GROUP.editor],
      "own@alpha.test": [ROLE_GROUP.owner],
      "vw@alpha.test": [ROLE_GROUP.viewer],
    });
    expect(await rolesIn(c.sql, b)).toEqual({ "lan@example.test": [ROLE_GROUP.editor] });
    const roles = await c.sql<
      { email: string; role: string; tid: string }[]
    >`select lower(email) as email, role,
      tenant_id as tid from admin.users where lower(email) like '%@alpha.test' order by 1`;
    expect(roles.map((x) => [x.email, x.role, x.tid === a])).toEqual([
      ["ed@alpha.test", "member", true],
      ["own@alpha.test", "tenant_admin", true],
      ["vw@alpha.test", "member", true],
    ]);
    const [p] = await c.sql<{ n: number }[]>`select count(*)::int as n from admin.users
      where role = 'platform_admin' and tenant_id in (${a}, ${b})`;
    expect(p?.n).toBe(0);
  });

  it("N5-FR-07 · idempotent: chạy lại ⇒ 0 tạo mới, không nhân đôi user/Group/thành viên/audit, không bump", async () => {
    await run(raw(), true);
    const before = await snapshot(c.sql);
    const r = await run(raw(), true);
    expect(r.orgs).toEqual({ read: 2, created: 0, existing: 2, errors: 0 });
    expect(r.users).toMatchObject({ created: 0, existing: 4, errors: 0 });
    expect(await snapshot(c.sql)).toEqual(before);
  });
});

describe("N5-FR-07 · cách ly tenant fixture", () => {
  it("N5-FR-07 · key 'acme' (tenant fixture, không marker) ⇒ ORG_KEY_TAKEN, user ⇒ ORG_FAILED, acme giữ nguyên", async () => {
    const q = () => c.sql`select id, username, password_hash, role from admin.users
      where tenant_id = ${USERS.lan.tid} order by id`;
    const m = () =>
      c.sql`select * from admin.group_members where tenant_id = ${USERS.lan.tid} order by user_id`;
    const [u0, m0] = [[...(await q())], [...(await m())]];
    const r = await run(
      mkExport(
        [{ id: "org-steal", name: "Steal", tenant_key: "acme" }],
        [userX("x@steal.test", "org-steal", "owner")],
      ),
      true,
    );
    expect(r.issues).toEqual([
      { kind: "org", ref: "org-steal", code: "ORG_KEY_TAKEN" },
      { kind: "user", ref: "x@steal.test", code: "ORG_FAILED" },
    ]);
    expect([...(await q())]).toEqual(u0);
    expect([...(await m())]).toEqual(m0);
    expect(
      (await c.sql`select settings from admin.tenants where id = ${USERS.lan.tid}`)[0]?.settings,
    ).toEqual({});
  });
});

describe("N5-FR-07 · security M1: marker có nguồn", () => {
  it("N5-FR-07 · cùng org id nhưng nguồn khác ⇒ ORG_MISMATCH, user ⇒ ORG_FAILED, tenant cũ không nhận user", async () => {
    await run(
      mkExport(
        [{ id: "1", name: "Src A", tenant_key: "src-a" }],
        [userX("a@src.test", "1")],
        "mgmt-a",
      ),
      true,
    );
    const before = await snapshot(c.sql);
    const r = await run(
      mkExport(
        [{ id: "1", name: "Src A", tenant_key: "src-a" }],
        [userX("intruder@src.test", "1", "owner")],
        "mgmt-b",
      ),
      true,
    );
    expect(codes(r)).toEqual(["ORG_MISMATCH", "ORG_FAILED"]);
    expect(await snapshot(c.sql)).toEqual(before);
  });
});

describe("N5-FR-07 · review Trung 1 / security L2: chạy lại không hoàn tác thu hồi", () => {
  const raw = (extra: ReturnType<typeof userX>[] = []) =>
    mkExport(
      [{ id: "org-rv", name: "Revoke", tenant_key: "rv-n5" }],
      [userX("a@rv.test", "org-rv", "editor"), userX("b@rv.test", "org-rv", "viewer"), ...extra],
    );
  it("N5-FR-07 · admin gỡ thành viên + xoá grant ⇒ chạy lại: không gắn lại (ROLE_MISSING), không khôi phục grant", async () => {
    await run(raw(), true);
    const t = await tenantId("org-rv");
    await c.sql`delete from admin.group_members m using admin.users u
      where m.user_id = u.id and m.tenant_id = ${t} and lower(u.email) = 'b@rv.test'`;
    await c.sql`delete from admin.feature_grants fg using admin.groups g
      where fg.group_id = g.id and fg.tenant_id = ${t} and g.key = 'contracts-owner'`;
    const grants = async () =>
      (
        await c.sql<
          { n: number }[]
        >`select count(*)::int as n from admin.feature_grants where tenant_id = ${t}`
      )[0]?.n;
    const g0 = await grants();
    const r = await run(raw([userX("c@rv.test", "org-rv", "viewer")]), true);
    expect(r.issues).toEqual([{ kind: "user", ref: "b@rv.test", code: "ROLE_MISSING" }]);
    expect(r.users).toMatchObject({ created: 1, existing: 1 });
    expect(await rolesIn(c.sql, t)).toEqual({
      "a@rv.test": [ROLE_GROUP.editor],
      "c@rv.test": [ROLE_GROUP.viewer],
    });
    expect(await grants()).toBe(g0);
  });
  it("N5-FR-07 · admin thu hồi gói contracts ⇒ chạy lại: PACK_REVOKED, entitlement vẫn thu hồi, không thêm user", async () => {
    await run(raw(), true);
    const t = await tenantId("org-rv");
    await c.sql`update admin.feature_entitlements set revoked_at = now() where tenant_id = ${t}
      and feature_id in (select id from admin.features where key like 'contracts-%')`;
    const before = await snapshot(c.sql);
    const r = await run(raw([userX("d@rv.test", "org-rv", "editor")]), true);
    expect(r.issues.slice(0, 1)).toEqual([{ kind: "org", ref: "org-rv", code: "PACK_REVOKED" }]);
    expect(r.users.created).toBe(0);
    expect(await snapshot(c.sql)).toEqual(before);
    const [e] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from admin.feature_entitlements
      where tenant_id = ${t} and revoked_at is null`;
    expect(e?.n).toBe(0);
  });
});

describe("N5-FR-03 · user tạo tay trùng email khác username ⇒ USER_CONFLICT (apply và dry-run)", () => {
  const raw = () =>
    mkExport(
      [{ id: "org-uc", name: "Conflict", tenant_key: "uc-n5" }],
      [
        userX("seed@uc.test", "org-uc"),
        userX("manual@uc.test", "org-uc", "viewer"),
        userX("new2@uc.test", "org-uc"),
      ],
    );
  it("N5-FR-06 · review Trung 2: dry-run báo USER_CONFLICT giống apply; apply không tạo, không gán Group", async () => {
    await run(
      mkExport(
        [{ id: "org-uc", name: "Conflict", tenant_key: "uc-n5" }],
        [userX("seed@uc.test", "org-uc")],
      ),
      true,
    );
    const t = await tenantId("org-uc");
    await c.sql`insert into admin.users (tenant_id, username, email, password_hash, display_name, role)
      values (${t}, 'tay-tao', 'Manual@UC.test', 'x', 'Tay', 'member') on conflict do nothing`;
    const dry = await run(raw(), false);
    const app = await run(raw(), true);
    for (const r of [dry, app]) {
      expect(r.issues).toEqual([{ kind: "user", ref: "manual@uc.test", code: "USER_CONFLICT" }]);
      expect(r.users).toMatchObject({ created: 1, existing: 1 });
      expect(r.accounts.map((a) => a.email)).toEqual(["new2@uc.test"]);
    }
    expect((await rolesIn(c.sql, t))["manual@uc.test"]).toBeUndefined();
  });
});

describe("N5-FR-03 · review Thấp 10: chạy lại khi user đã nhận username fallback", () => {
  it("N5-FR-03 · lan@a + lan@b ⇒ 'lan' + fallback; chạy lại ⇒ existing 2, 0 issue, 0 ghi", async () => {
    const raw = mkExport(
      [{ id: "org-fb", name: "Fallback", tenant_key: "fb-n5" }],
      [userX("lan@a.fb", "org-fb"), userX("lan@b.fb", "org-fb")],
    );
    const r1 = await run(raw, true);
    expect(r1.accounts.map((a) => a.username)).toEqual([
      "lan",
      expect.stringMatching(/^lan-[0-9a-f]{8}$/),
    ]);
    const before = await snapshot(c.sql);
    const r2 = await run(raw, true);
    expect(r2.issues).toEqual([]);
    expect(r2.users).toMatchObject({ created: 0, existing: 2 });
    expect(await snapshot(c.sql)).toEqual(before);
  });
});
