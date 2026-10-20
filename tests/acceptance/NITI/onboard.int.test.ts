// niti-onboard · onboarding tenant NitiGroup (deploy/tenants/nitigroup.yaml) trên DB thật (role admin_api, RLS bật): tạo tenant +
// hồ sơ + 23 phòng ban (cây dưới Phòng Giám đốc, vi/en) + gói contracts (entitlement, Group vai, trợ lý `mgmt-assistant`) ·
// chạy lại không ghi gì · RLS (tenant khác không thấy) · marker importer (ORG_REBIND/ORG_TAKEN) · importer `--into-tenant`
// (I1, nguồn GIẢ): chỉ org đã gắn vào NitiGroup, org khác không tạo tenant, tiền khớp, chạy lại 0 hàng · gán phòng ban sau import.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import {
  type RunConfig,
  runMgmtImport,
} from "../../../apps/admin-api/src/modules/mgmt-import/mgmt-import.run";
import { onboardTenant } from "../../../apps/admin-api/src/modules/tenant-onboard/application/onboard.usecase";
import {
  type OnboardSpec,
  parseSpec,
} from "../../../apps/admin-api/src/modules/tenant-onboard/domain/onboard.rules";
import { T } from "../H1/_fixtures";
import { fakeReader, fixtureSnapshot, ORG_A, ORG_B, SOURCE } from "../I1/_support/fixture";
import { type CtxI1, startI1 } from "../I1/_support/i1";
import { ADMIN_API_URL } from "../N5/_support/n5";

const YAML = readFileSync(join(import.meta.dir, "../../../deploy/tenants/nitigroup.yaml"), "utf8");
const specOf = (o: { mgmtOrg?: string } = {}, edit?: (raw: string) => string): OnboardSpec => {
  const p = parseSpec(edit ? edit(YAML) : YAML, o);
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  // nguồn của fixture I1 (bản sao giả), không phải mgmt-prod
  return { ...p.spec, import: p.spec.import ? { ...p.spec.import, source: SOURCE } : undefined };
};

let ctx: CtxI1;
let tid = "";

const one = async <R>(q: Promise<R[]>): Promise<R> => (await q)[0] as R;
const state = async () =>
  one(
    ctx.sql<{ cv: number; audit: number; version: number }[]>`select
      (select config_version from admin.config_meta where id = 1)::int as cv,
      (select count(*) from admin.audit_log)::int as audit,
      (select version from admin.tenants where key = 'nitigroup') as version`,
  );
const cfg = (apply: boolean): RunConfig => ({
  source: SOURCE,
  actorId: ctx.padmin,
  apply,
  batch: 50,
  knowledgeOrg: ORG_A,
  withGraph: true,
  diffSample: 20,
  opensearch: { url: "http://unused" },
  neo4j: null,
  filesDir: ctx.filesDir,
  sinkDir: ctx.sinkDir,
  statePath: null,
  intoTenant: "nitigroup",
});
const runInto = (apply: boolean) =>
  runMgmtImport(ctx.db, ctx.hub, cfg(apply), fakeReader(fixtureSnapshot()));

/** Trợ lý gói `contracts` (`packs.pack_agents` → `mgmt-assistant`) phải có agent Hub để grant; mẫu DB chưa có ⇒ tạo tối thiểu. */
async function ensureAssistant(): Promise<void> {
  const [a] = await ctx.sql`select 1 from hub.agents where key = 'mgmt-assistant'`;
  if (a) return;
  await ctx.sql`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
    values ('niti-fake', 'subscription', 'fake', 1, true, true) on conflict do nothing`;
  const [p] = await ctx.sql<{ id: string }[]>`insert into hub.model_profiles (key, steps)
    values ('niti-fake-1', ${ctx.sql.json([{ provider_key: "niti-fake", model: null, on: [] }])}) returning id`;
  await ctx.sql`insert into hub.agents (key, name, description, runtime, profile_id)
    values ('mgmt-assistant', ${ctx.sql.json({ vi: "Trợ lý", en: "Assistant" })},
      'Trợ lý quản lý hợp đồng của gói contracts cho người dùng.', 'agentic-cli', ${p?.id as string})`;
}

beforeAll(async () => {
  ctx = await startI1();
  await ensureAssistant();
});
afterAll(async () => {
  await ctx?.stop();
});

describe("niti-onboard · onboarding NitiGroup", () => {
  test("lần đầu: tenant + hồ sơ + marker + 23 phòng ban (cây, vi/en, thứ tự) + gói contracts + trợ lý", async () => {
    const r = await onboardTenant(ctx.db, specOf({ mgmtOrg: ORG_A }), ctx.padmin);
    tid = r.tenant.id;
    expect(r.tenant).toMatchObject({ key: "nitigroup", created: true });
    expect(r.binding).toEqual({ source: SOURCE, org_id: ORG_A, state: "set" });
    expect(r.departments).toEqual({
      total: 23,
      groups_created: 23,
      groups_renamed: 0,
      changed: 23,
    });
    expect(r.packs).toEqual([{ key: "contracts", groups: 3 }]);
    const t = await one(
      ctx.sql<
        {
          name: string;
          tz: string;
          profile: Record<string, unknown>;
          settings: Record<string, string>;
        }[]
      >`
        select name, timezone as tz, profile, settings from admin.tenants where id = ${tid}`,
    );
    expect(t.name).toBe("CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ NITIGROUP");
    expect(t.profile).toMatchObject({ tax_id: "0318938091", zalo_oa: "NitiGroup" });
    expect(t.settings).toEqual({ visibility: "org", mgmt_source: SOURCE, mgmt_org_id: ORG_A });
    const depts = await ctx.sql<
      { key: string; name: { vi: string; en: string }; parent: string | null; sort: number }[]
    >`
      select g.key, g.name, pg.key as parent, d.sort_order as sort from admin.departments d
      join admin.groups g on g.id = d.group_id left join admin.groups pg on pg.id = d.parent_group_id
      where d.tenant_id = ${tid} order by d.sort_order`;
    expect(depts).toHaveLength(23);
    expect(depts[0]).toEqual({
      key: "pb-giam-doc",
      name: { vi: "Phòng Giám đốc", en: "Board of Directors" },
      parent: null,
      sort: 0,
    });
    expect(depts.slice(1).every((d) => d.parent === "pb-giam-doc")).toBe(true);
    expect(depts.map((d) => d.name.en)).toContain("Trade union");
    const pack = await one(
      ctx.sql<{ ent: number; groups: number; grants: number; agent: number }[]>`select
        (select count(*) from admin.feature_entitlements e join admin.features f on f.id = e.feature_id
          where e.tenant_id = ${tid} and f.key like 'contracts-%' and e.revoked_at is null)::int as ent,
        (select count(*) from admin.groups where tenant_id = ${tid} and key like 'contracts-%')::int as groups,
        (select count(*) from admin.feature_grants where tenant_id = ${tid})::int as grants,
        (select count(*) from hub.agent_grants g join hub.agents a on a.id = g.agent_id
          where g.tenant_id = ${tid} and a.key = 'mgmt-assistant')::int as agent`,
    );
    expect(pack).toEqual({ ent: 3, groups: 3, grants: 6, agent: 3 });
  });

  test("chạy lại: không đổi gì (không tăng version/config_version, không audit mới)", async () => {
    const s0 = await state();
    const r = await onboardTenant(ctx.db, specOf({ mgmtOrg: ORG_A }), ctx.padmin);
    expect(r.tenant).toEqual({ id: tid, key: "nitigroup", created: false, updated: false });
    expect(r.binding?.state).toBe("kept");
    expect(r.departments).toEqual({ total: 23, groups_created: 0, groups_renamed: 0, changed: 0 });
    expect(await state()).toEqual(s0);
  });

  test("đổi hồ sơ/nhãn ⇒ chỉ ghi phần đổi; đổi org ⇒ ORG_REBIND; org của tenant khác ⇒ ORG_TAKEN", async () => {
    const edit = (y: string) =>
      y
        .replace("zalo_oa: NitiGroup", "zalo_oa: NitiGroup OA")
        .replace("en: Wholesaler", "en: Wholesale");
    const r = await onboardTenant(ctx.db, specOf({ mgmtOrg: ORG_A }, edit), ctx.padmin);
    expect(r.tenant.updated).toBe(true);
    expect(r.departments).toMatchObject({ groups_created: 0, groups_renamed: 1, changed: 0 });
    await expect(
      onboardTenant(ctx.db, specOf({ mgmtOrg: ORG_B }), ctx.padmin),
    ).rejects.toMatchObject({
      details: { reason: "ORG_REBIND" },
    });
    await ctx.sql`insert into admin.tenants (key, name, settings)
      values ('niti-other', 'Khác', ${ctx.sql.json({ mgmt_source: SOURCE, mgmt_org_id: ORG_B })})`;
    const other = { ...specOf({ mgmtOrg: ORG_B }), key: "niti-new" };
    await expect(onboardTenant(ctx.db, other, ctx.padmin)).rejects.toMatchObject({
      details: { reason: "ORG_TAKEN" },
    });
    expect(await ctx.sql`select 1 from admin.tenants where key = 'niti-new'`).toHaveLength(0);
    await ctx.sql`delete from admin.tenants where key = 'niti-other'`;
    await onboardTenant(ctx.db, specOf({ mgmtOrg: ORG_A }), ctx.padmin); // trả về file gốc
  });

  test("RLS: tenant khác (acme) không thấy tenant/phòng ban NitiGroup; chính tenant thấy 23 phòng", async () => {
    // Đúng role CLI dùng (admin_api, NOBYPASSRLS) với scope tenant như request của tenant_admin.
    const api = postgres(ADMIN_API_URL, { max: 1, onnotice: () => {} });
    const seen = (tenantId: string) =>
      api.begin(async (tx) => {
        await tx`select set_config('app.scope', 'tenant', true), set_config('app.tenant_id', ${tenantId}, true)`;
        const [r] = await tx<{ d: number; g: number; t: number }[]>`select
          (select count(*) from admin.departments where tenant_id = ${tid})::int as d,
          (select count(*) from admin.groups where tenant_id = ${tid} and key like 'pb-%')::int as g,
          (select count(*) from admin.tenants where id = ${tid})::int as t`;
        return r;
      });
    try {
      expect(await seen(T.acme)).toEqual({ d: 0, g: 0, t: 0 });
      expect(await seen(tid)).toEqual({ d: 23, g: 23, t: 1 });
    } finally {
      await api.end();
    }
  });
});

describe("niti-onboard · importer I1 --into-tenant nitigroup", () => {
  test("dry-run không ghi; apply: org A ⇒ NitiGroup, org B bị loại (không tạo tenant), tiền khớp; chạy lại 0 hàng", async () => {
    const dry = await runInto(false);
    expect(dry.into).toEqual({ key: "nitigroup", tenant_id: tid, org_id: ORG_A });
    expect(dry.tables["contracts.contracts"]?.inserted).toBe(0);
    const tenants0 = (await ctx.sql`select id from admin.tenants`).length;
    const r = await runInto(true);
    expect(r.excluded).toEqual({ orgs: [ORG_B], users: 1 });
    expect(r.source_orgs.map((o) => o.id).sort()).toEqual([ORG_A, ORG_B].sort());
    expect(r.reconcile?.money_ok).toBe(true);
    expect(Object.keys(r.reconcile?.money ?? {})).toEqual([ORG_A]);
    expect((await ctx.sql`select id from admin.tenants`).length).toBe(tenants0);
    const c = await one(
      ctx.sql<{ mine: number; other: number; users: number }[]>`select
        (select count(*) from contracts.contracts where tenant_id = ${tid})::int as mine,
        (select count(*) from contracts.contracts where tenant_id <> ${tid})::int as other,
        (select count(*) from admin.users where tenant_id = ${tid})::int as users`,
    );
    expect(c.mine).toBeGreaterThan(0);
    expect(c.other).toBe(0);
    expect(c.users).toBe(5); // 5 user org A (gồm người được mời)
    const again = await runInto(true);
    const ins = Object.values(again.tables).reduce((s, t) => s + (t?.inserted ?? 0), 0);
    expect(ins).toBe(0);
    expect(again.reconcile?.money_ok).toBe(true);
  });

  test("onboarding sau import: gán trưởng phòng/thành viên theo email; email chưa có ⇒ pending", async () => {
    const edit = (y: string) =>
      y.replace(
        "{ key: pb-kinh-doanh, vi: Phòng Kinh doanh, en: Sales }",
        "{ key: pb-kinh-doanh, vi: Phòng Kinh doanh, en: Sales, head: m1@annam.test, members: [e1@annam.test, ghost@x.test] }",
      );
    const r = await onboardTenant(ctx.db, specOf({ mgmtOrg: ORG_A }, edit), ctx.padmin);
    expect(r.members).toEqual({ added: 2, heads_set: 1, pending_emails: ["ghost@x.test"] });
    const again = await onboardTenant(ctx.db, specOf({ mgmtOrg: ORG_A }, edit), ctx.padmin);
    expect(again.members).toEqual({ added: 0, heads_set: 0, pending_emails: ["ghost@x.test"] });
  });

  test("tenant chưa gắn org: dry-run báo into.TENANT_NOT_BOUND + source_orgs, không lập kế hoạch; apply ⇒ lỗi", async () => {
    await ctx.sql`insert into admin.tenants (key, name) values ('niti-unbound', 'Chưa gắn')`;
    const c = { ...cfg(false), intoTenant: "niti-unbound" };
    const dry = await runMgmtImport(ctx.db, ctx.hub, c, fakeReader(fixtureSnapshot()));
    expect(dry.issues_by_code["into.TENANT_NOT_BOUND"]).toBe(1);
    expect(dry.tables).toEqual({});
    expect(dry.source_orgs).toHaveLength(2);
    const apply = { ...c, apply: true };
    await expect(
      runMgmtImport(ctx.db, ctx.hub, apply, fakeReader(fixtureSnapshot())),
    ).rejects.toThrow("TENANT_NOT_BOUND");
  });
});
